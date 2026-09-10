import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePlan } from './architecture.ts';
import { DEFAULT_SETTINGS, FAMILIES } from './model.ts';
import { voxelize } from './voxels.ts';
import { cellIndex, floorOutline, litematicaFile, nbtBytes, type Schematic } from './litematica.ts';
import { dress } from './dressing.ts';

// A reader written from the format rather than from the writer: if the two agree, the writer is writing NBT
// and not merely something this file can read back.
type Tag=number|string|Tag[]|{[k:string]:Tag}|{longs:bigint[]};
function readNbt(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let at=0;
  const u8=()=>view.getUint8(at++),i16=()=>{const v=view.getInt16(at);at+=2;return v;},i32=()=>{const v=view.getInt32(at);at+=4;return v;};
  const i64=()=>{const hi=BigInt(i32()>>>0),lo=BigInt(i32()>>>0);return (hi<<BigInt(32))|lo;};
  const text=()=>{const n=i16()&0xffff,s=new TextDecoder().decode(bytes.subarray(at,at+n));at+=n;return s;};
  function payload(type:number):Tag{
    if(type===1)return u8();
    if(type===2)return i16();
    if(type===3)return i32();
    if(type===4)return Number(i64());
    if(type===8)return text();
    if(type===9){const of=u8(),n=i32(),out:Tag[]=[];for(let i=0;i<n;i++)out.push(payload(of));return out;}
    if(type===10){const out:{[k:string]:Tag}={};for(;;){const id=u8();if(!id)break;const name=text();out[name]=payload(id);}return out;}
    if(type===12){const n=i32(),longs:bigint[]=[];for(let i=0;i<n;i++)longs.push(i64());return {longs};}
    throw new Error(`unsupported tag ${type}`);
  }
  assert.equal(u8(),10,'the root is not a compound');
  assert.equal(text(),'','the root compound is named');
  return payload(10) as {[k:string]:Tag};
}
/** Litematica's own read: entries straddle the boundary between one long and the next. */
function entryAt(longs:bigint[],bits:number,index:number){
  const wide=BigInt(bits),start=BigInt(index)*wide,max=(BigInt(1)<<wide)-BigInt(1);
  const first=Number(start>>BigInt(6)),last=Number(((BigInt(index)+BigInt(1))*wide-BigInt(1))>>BigInt(6));
  const offset=Number(start&BigInt(63));
  if(first===last)return Number((longs[first]>>BigInt(offset))&max);
  return Number(((longs[first]>>BigInt(offset))|(longs[last]<<BigInt(64-offset)))&max);
}
function readSchematic(schematic:Schematic){
  const nbt=readNbt(nbtBytes(schematic,1700000000000)) as Record<string,Record<string,Tag>>;
  const region=(nbt.Regions as Record<string,Record<string,Tag>>)[schematic.name];
  return {nbt,region};
}

void test('a litematica file is gzipped NBT that says what it is',async()=>{
  const plan=generatePlan(DEFAULT_SETTINGS);
  const schematic=floorOutline(plan,plan.floors.find(f=>f.elevation===0)!);
  const file=await litematicaFile(schematic,1700000000000);
  assert.equal(file[0],0x1f);assert.equal(file[1],0x8b,'the file is not gzipped');
  const nbt=readNbt(new Uint8Array(await new Response(new Blob([file as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())) as Record<string,Tag>;
  // Schematic version 5, because every Litematica since 1.13 reads it and the older ones refuse 6.
  assert.equal(nbt.Version,5);
  assert.ok(typeof nbt.MinecraftDataVersion==='number'&&nbt.MinecraftDataVersion>0);
  const meta=nbt.Metadata as Record<string,Tag>;
  assert.equal(meta.RegionCount,1);
  assert.equal(meta.Author,'Keepwright');
  assert.deepEqual(meta.EnclosingSize,{x:schematic.size.x,y:schematic.size.y,z:schematic.size.z});
  assert.equal(meta.TotalVolume,schematic.size.x*schematic.size.y*schematic.size.z);
  assert.equal(meta.TotalBlocks,schematic.cells.reduce((n,c)=>n+(c?1:0),0));
  assert.equal(meta.TimeCreated,1700000000000,'the timestamp does not survive as a long');
  assert.equal(meta.TimeModified,1700000000000);
});
void test('every cell comes back out of the packed block states',()=>{
  const plan=generatePlan({...DEFAULT_SETTINGS,kind:'castle',family:'courtyard-castle',size:256,floors:3,seed:'LITEMATIC'});
  for(const schematic of [floorOutline(plan,plan.floors.find(f=>f.elevation===0)!),floorOutline(plan,plan.floors.find(f=>f.elevation===6)!)]){
    const {region}=readSchematic(schematic);
    assert.deepEqual(region.Position,{x:0,y:0,z:0});
    assert.deepEqual(region.Size,{x:schematic.size.x,y:schematic.size.y,z:schematic.size.z});
    const palette=region.BlockStatePalette as {Name:string;Properties?:Record<string,string>}[];
    assert.deepEqual(palette.map(p=>p.Name),schematic.palette.map(p=>p.name));
    assert.equal(palette[0].Name,'minecraft:air','the empty cell is not the first entry of the palette');
    const {longs}=region.BlockStates as {longs:bigint[]};
    const bits=Math.max(2,Math.ceil(Math.log2(Math.max(2,schematic.palette.length))));
    assert.equal(longs.length,Math.max(1,Math.ceil(schematic.cells.length*bits/64)));
    for(let i=0;i<schematic.cells.length;i++)
      assert.equal(entryAt(longs,bits,i),schematic.cells[i],`cell ${i} came back wrong`);
    for(const list of ['Entities','TileEntities','PendingBlockTicks','PendingFluidTicks'])
      assert.deepEqual(region[list],[],`${list} is not an empty list`);
  }
});
void test('a floor outline is the wall course, with the doorways in it and the lights',()=>{
  // The defect this answers: a schematic you cannot build from, because the ring of wall it shows has no
  // way in and nothing to say which gaps were meant.
  for(const kind of ['manor','castle','house'] as const)for(const family of FAMILIES[kind]){
    const plan=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size:224,floors:3,seed:'OUTLINE'});
    const grid=voxelize(plan),floor=plan.floors.find(f=>f.elevation===0)!;
    const outline=floorOutline(plan,floor,grid);
    const tag=`${family.id}`;
    assert.equal(outline.size.y,1,`${tag}: the outline is more than one course`);
    assert.equal(outline.size.x,plan.bounds.w);assert.equal(outline.size.z,plan.bounds.d);
    const counts=[0,0,0,0];
    for(const cell of outline.cells)counts[cell]++;
    assert.ok(counts[1]>200,`${tag}: only ${counts[1]} blocks of wall in the outline`);
    assert.ok(counts[2]>0,`${tag}: the outline shows no windows`);
    assert.ok(counts[3]>0,`${tag}: the outline shows no doorways`);
    // Every doorway of this floor is in it, and each one is a threshold rather than a wall.
    for(const o of plan.openings.filter(o=>o.type!=='window'&&o.y<=2&&o.y+o.height>2)){
      const x=o.x-plan.bounds.x,z=o.z-plan.bounds.z;
      if(x<0||x>=outline.size.x||z<0||z>=outline.size.z)continue;
      assert.equal(outline.cells[cellIndex(outline.size,x,0,z)],3,`${tag}: the ${o.type} at ${o.x},${o.z} is not marked`);
    }
    // The entrance is a doorway you can walk through, not a block of wall.
    const entrance=plan.openings.find(o=>o.type==='entrance')!;
    assert.equal(outline.cells[cellIndex(outline.size,entrance.x-plan.bounds.x,0,entrance.z-plan.bounds.z)],3,`${tag}: the entrance is walled up`);
  }
});
void test('the whole building is dressed, not blocked out',()=>{
  // The defect this answers: an export made of one grey block and no light in it — a massing model, which is
  // not a thing anybody wants to paste into a world. The numbers below come from reading two hand-built
  // castles: a fifth of what they place is stairs and slabs, their stone is a dozen stones in patches, and
  // they are lit.
  for(const settings of [{...DEFAULT_SETTINGS,kind:'manor' as const,family:'crosswing' as const,size:192,floors:3,seed:'DRESS'},
    {...DEFAULT_SETTINGS,kind:'castle' as const,family:'courtyard-castle' as const,size:288,floors:3,seed:'DRESS'},
    {...DEFAULT_SETTINGS,kind:'house' as const,family:'hall-house' as const,size:128,floors:2,seed:'DRESS'}]){
    const plan=generatePlan(settings),grid=voxelize(plan);
    const {size,palette,cells,lights}=dress(plan,grid);
    const tag=`${settings.kind}/${settings.family}`;
    // Nothing the plan built is lost in the dressing.
    let lost=0,placed=0;
    for(let y=0;y<size.y;y+=2)for(let z=0;z<size.z;z+=3)for(let x=0;x<size.x;x+=3){
      const material=grid.material(plan.bounds.x+x,plan.minY+y,plan.bounds.z+z);
      if(material&&!cells[cellIndex(size,x,y,z)])lost++;
    }
    assert.equal(lost,0,`${tag}: ${lost} sampled blocks of the plan are missing from the build`);
    const tally=new Map<string,number>();
    for(const cell of cells){if(!cell)continue;placed++;const p=palette[cell];tally.set(p.name,(tally.get(p.name)??0)+1);}
    const share=(test:RegExp)=>[...tally].filter(([n])=>test.test(n)).reduce((t,[,n])=>t+n,0)/placed;
    assert.ok(palette.length>=25,`${tag}: a palette of ${palette.length} blocks`);
    // A fifth of what a good build places is trim. Half of that is the floor of what we should manage.
    assert.ok(share(/_stairs|_slab/)>=0.08,`${tag}: stairs and slabs are ${(100*share(/_stairs|_slab/)).toFixed(1)}% of the build`);
    const stones=[...tally.keys()].filter(n=>/tuff|stone|andesite|deepslate|cobble|granite|diorite|calcite/.test(n)&&!/_stairs|_slab/.test(n));
    assert.ok(stones.length>=6,`${tag}: the walls are made of ${stones.length} stones: ${stones.join(', ')}`);
    // A window is a pane. A wall of glass blocks is a greenhouse.
    assert.ok(!tally.has('minecraft:glass'),`${tag}: solid glass in the walls`);
    assert.ok((tally.get('minecraft:gray_stained_glass_pane')??0)>20,`${tag}: only ${tally.get('minecraft:gray_stained_glass_pane')??0} panes`);
    // And it is lit, which is the difference between a castle and a mob farm.
    assert.ok(lights>=8,`${tag}: ${lights} lights in the whole estate`);
    assert.ok((tally.get('minecraft:lantern')??0)>0&&(tally.get('minecraft:campfire')??0)>0,`${tag}: no lanterns or no fires`);
    // The stone is patchy rather than salt-and-pepper: a neighbour is the same block far more often than chance.
    let pairs=0,same=0;
    for(let y=1;y<size.y;y++)for(let z=0;z<size.z;z+=2)for(let x=0;x<size.x;x+=2){
      const a=cells[cellIndex(size,x,y,z)],c=cells[cellIndex(size,x,y-1,z)];
      if(!a||!c||!/tuff|stone|andesite|cobble|granite|diorite|calcite/.test(palette[a].name))continue;
      pairs++;if(a===c)same++;
    }
    assert.ok(same/pairs>0.25,`${tag}: only ${(100*same/pairs).toFixed(0)}% of stone neighbours match, which is noise and not masonry`);
  }
});
