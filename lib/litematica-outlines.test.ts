import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { generatePlan } from './architecture.ts';
import { DEFAULT_SETTINGS } from './model.ts';
import { storedGzip } from './nbt.ts';
import { buildOutlines, outlineBytes, outlineFile, parseOutlinePlan, type OutlineBox, type OutlineOptions, type OutlinePlan } from './litematica-outlines.ts';

const box=(x:number,y:number,z:number,w=1,h=1,d=1,kind='wall',material=1):OutlineBox=>({x,y,z,w,h,d,kind,material});
/** Three storeys of one room split by a partition, with a doorway through it, a window and a stair. */
function fixture():OutlinePlan {
  const floors=[-1,0,1].map(index=>({index,name:index<0?'Cellar':`Floor ${index}`,elevation:index*6}));
  return {schemaVersion:2,name:'Test manor',bounds:{x:-5,z:10,w:9,d:7},floors,
    blocks:floors.flatMap(f=>[
      box(-5,f.elevation,10,9,1,7,'floor'),
      box(-5,f.elevation+1,10,9,5,1),box(-5,f.elevation+1,16,9,5,1),
      box(-5,f.elevation+1,11,1,5,5),box(3,f.elevation+1,11,1,5,5),
      box(-1,f.elevation+1,11,1,5,5),
      box(-1,f.elevation+1,13,1,3,1,'air',0),
      box(1,f.elevation+1,13,1,3,1,'furniture',9),
      box(0,f.elevation+2,10,1,2,1,'glass',4),
      box(1,f.elevation+2,14,1,1,1,'stair',2),
      box(-5,f.elevation+5,10,9,1,7,'roof',3),
    ])};
}
// A reader written from the format rather than from the writer, including the modified UTF-8 that Java reads
// NBT strings as: if the two agree, the writer is writing a .litematic and not merely something this can read.
type Tag=number|string|Tag[]|{[k:string]:Tag}|{longs:bigint[]};
function readNbt(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let at=0;
  const u8=()=>view.getUint8(at++),i32=()=>{const v=view.getInt32(at);at+=4;return v;};
  const i64=()=>{const hi=BigInt(i32()>>>0),lo=BigInt(i32()>>>0);return (hi<<BigInt(32))|lo;};
  const text=()=>{
    const length=(u8()<<8)|u8(),end=at+length;let s='';
    while(at<end){
      const a=u8();
      if(a<0x80)s+=String.fromCharCode(a);
      else if((a&0xe0)===0xc0)s+=String.fromCharCode(((a&0x1f)<<6)|(u8()&0x3f));
      else s+=String.fromCharCode(((a&0x0f)<<12)|((u8()&0x3f)<<6)|(u8()&0x3f));
    }
    assert.equal(at,end,'a string ran past its own length');return s;
  };
  function payload(type:number):Tag{
    if(type===3)return i32();
    if(type===4)return Number(i64());
    if(type===8)return text();
    if(type===9){const of=u8(),n=i32(),out:Tag[]=[];assert.ok(n>=0);for(let i=0;i<n;i++)out.push(payload(of));return out;}
    if(type===10){const out:{[k:string]:Tag}={};for(;;){const id=u8();if(!id)break;const name=text();out[name]=payload(id);}return out;}
    if(type===12){const n=i32(),longs:bigint[]=[];for(let i=0;i<n;i++)longs.push(i64());return {longs};}
    throw new Error(`unsupported tag ${type}`);
  }
  assert.equal(u8(),10,'the root is not a compound');
  assert.equal(text(),'','the root compound is named');
  const root=payload(10) as {[k:string]:Tag};
  assert.equal(at,bytes.length,'the file has trailing bytes');
  return root;
}
type Doc={[k:string]:Tag};
const obj=(tag:Tag)=>tag as Doc,num=(tag:Tag)=>tag as number,text=(tag:Tag)=>tag as string;
const paletteName=(region:Doc,slot:number)=>text(obj((region.BlockStatePalette as Tag[])[slot]).Name);
const doc=(plan:OutlinePlan,options:Partial<OutlineOptions>={})=>readNbt(outlineBytes(buildOutlines(plan,options),1700000000123));
const regionOf=(root:Doc,name:string)=>obj(obj(root.Regions)[name]);
/** The format's own read: two bits a cell, x fastest, then z, then y, thirty-two to a big-endian long. */
function state(region:Doc,x:number,y:number,z:number){
  const size=obj(region.Size),index=x+num(size.x)*(z+num(size.z)*y);
  const {longs}=region.BlockStates as {longs:bigint[]};
  return paletteName(region,Number((longs[Math.floor(index/32)]>>BigInt((index%32)*2))&BigInt(3)));
}

void test('every floor keeps its own elevation, the cellar below the datum',()=>{
  const result=buildOutlines(fixture());
  assert.deepEqual(result.regions.map(r=>r.y),[-6,0,6]);
  assert.equal(result.minY,-6);assert.equal(result.height,13);
  assert.equal(result.width,9);assert.equal(result.depth,7);
  assert.equal(result.volume,9*7*3);assert.equal(result.blocks,32*3);
});
void test('the cut at floor + 2 keeps the doorways and leaves out the furniture, roof and slab',()=>{
  const region=regionOf(doc(fixture()),'Floor_0');
  assert.equal(state(region,4,0,3),'minecraft:air','the doorway through the partition is walled up');
  assert.equal(state(region,6,0,3),'minecraft:air','a chair is standing in for a wall');
  assert.equal(state(region,6,0,4),'minecraft:air','the stairs are marked without being asked for');
  assert.equal(state(region,5,0,0),'minecraft:white_wool','the window has broken the wall line');
  assert.equal(state(region,4,0,2),'minecraft:white_wool','the interior partition is missing');
  assert.equal(state(region,0,0,0),'minecraft:white_wool','a negative source X is misplaced');
});
void test('one floor on its own starts at Y 0 without moving in X or Z',()=>{
  const root=doc(fixture(),{floor:1});
  assert.deepEqual(Object.keys(obj(root.Regions)),['Floor_1']);
  assert.deepEqual(regionOf(root,'Floor_1').Position,{x:0,y:0,z:0});
  assert.equal(obj(obj(root.Metadata).EnclosingSize).y,1);
});
void test('scale and height repeat the markers and not the gaps between them',()=>{
  const result=buildOutlines(fixture(),{floor:0,scale:2,height:3});
  assert.equal(result.blocks,32*4*3);
  const region=regionOf(readNbt(outlineBytes(result,1700000000123)),'Floor_0');
  assert.deepEqual(region.Size,{x:18,y:3,z:14});
  for(let y=0;y<3;y++)for(let dx=0;dx<2;dx++)for(let dz=0;dz<2;dz++){
    assert.equal(state(region,8+dx,y,6+dz),'minecraft:air','a doorway was filled in by the scale');
    assert.equal(state(region,dx,y,dz),'minecraft:white_wool','a corner was lost by the scale');
  }
});
void test('what the plan took out again stays out, air and excluded kinds alike',()=>{
  // The defect this answers: an outline that shows a wall the generator demolished twenty boxes later.
  const plan=fixture();plan.blocks.push(box(-5,2,12,1,1,1,'furniture',9),box(-5,2,13,1,1,1,'floor'));
  const region=regionOf(doc(plan),'Floor_0');
  assert.equal(state(region,0,0,2),'minecraft:air');assert.equal(state(region,0,0,3),'minecraft:air');
  plan.blocks.push(box(-5,2,12));
  assert.equal(state(regionOf(doc(plan),'Floor_0'),0,0,2),'minecraft:white_wool','the later wall did not come back');
});
void test('stairs are asked for, and then have their own block and their own count',()=>{
  const root=doc(fixture(),{includeStairs:true});
  assert.equal(state(regionOf(root,'Floor_0'),6,0,4),'minecraft:gold_block');
  assert.equal(obj(root.Metadata).TotalBlocks,33*3);
});
void test('a floor colour follows the floor index, negative ones included',()=>{
  const all=doc(fixture(),{colorByFloor:true}),single=doc(fixture(),{colorByFloor:true,floor:1});
  assert.equal(paletteName(regionOf(all,'Floor_-1'),1),'minecraft:red_wool');
  assert.equal(paletteName(regionOf(all,'Floor_1'),1),paletteName(regionOf(single,'Floor_1'),1),'one floor alone is a different colour');
});
void test('the packing fills a long to its sign bit and carries on into the next',()=>{
  const plan:OutlinePlan={schemaVersion:2,name:'Packing',bounds:{x:0,z:0,w:65,d:1},floors:[{index:0,name:'Ground',elevation:0}],
    blocks:[box(0,2,0,65),box(31,2,0,1,1,1,'stair',2)]};
  const region=regionOf(doc(plan,{includeStairs:true}),'Floor_0'),{longs}=region.BlockStates as {longs:bigint[]};
  assert.equal(longs.length,3,'65 cells at two bits is three longs');
  assert.equal(longs[0]>>BigInt(63),BigInt(1),'the top bit of the first long is clear, so it never went signed');
  for(let x=0;x<65;x++)assert.equal(state(region,x,0,0),x===31?'minecraft:gold_block':'minecraft:white_wool');
});
void test('the header says what the file is, in the version Litematica reads',()=>{
  const plan=fixture();plan.name='Château 🏰 ';
  const root=doc(plan),meta=obj(root.Metadata);
  // Schematic version 5, for the reason lib/nbt.ts gives: every Litematica since 1.13 reads it.
  assert.equal(root.Version,5);assert.equal(root.MinecraftDataVersion,2586);
  assert.equal(meta.Author,'Keepwright');
  assert.equal(meta.Name,'Château 🏰  · outlines','a name did not survive modified UTF-8');
  assert.equal(meta.TimeCreated,1700000000123);assert.equal(meta.TimeModified,1700000000123);
  assert.equal(meta.TotalVolume,189);assert.equal(meta.RegionCount,3);
  for(const list of ['Entities','TileEntities','PendingBlockTicks','PendingFluidTicks'])
    assert.deepEqual(regionOf(root,'Floor_0')[list],[],`${list} is not an empty list`);
});
void test('a block that hangs over the bounds is clipped and never wraps into the next row',()=>{
  const plan=fixture();plan.blocks=[box(-7,2,10,4,1,1)];
  const result=buildOutlines(plan,{floor:0});
  assert.equal(result.blocks,2);assert.ok(result.warnings.some(w=>w.includes('clipped')),'the clipping was not reported');
  const region=regionOf(readNbt(outlineBytes(result,1700000000123)),'Floor_0');
  assert.equal(state(region,0,0,0),'minecraft:white_wool');assert.equal(state(region,1,0,0),'minecraft:white_wool');
  assert.equal(state(region,2,0,0),'minecraft:air');assert.equal(state(region,0,0,1),'minecraft:air','the row wrapped');
});
void test('an empty floor is named and left out, and an empty export refuses',()=>{
  const plan=fixture();plan.blocks=plan.blocks.filter(b=>b.y>=0);
  assert.ok(buildOutlines(plan).warnings.some(w=>w.includes('Cellar')));
  assert.throws(()=>buildOutlines(plan,{floor:-1}),/no structural/);
});
void test('a file off somebody else’s disk is refused before anything is allocated for it',()=>{
  for(const value of [null,[],{},{...fixture(),schemaVersion:1},{...fixture(),bounds:{x:0,z:0,w:1.5,d:2}},
    {...fixture(),blocks:[{...box(0,2,0),kind:'invalid'}]},{...fixture(),blocks:[{...box(0,2,0),w:Infinity}]}])
    assert.throws(()=>parseOutlinePlan(value));
  const plan=fixture();plan.floors[1].index=-1;
  assert.throws(()=>parseOutlinePlan(plan),/schema version 2/,'two floors share one index');
});
void test('an option the format cannot carry is refused by name',()=>{
  for(const option of [{scale:0},{scale:1.5},{height:6},{material:'minecraft:air'},{floor:99},{colorByFloor:null}])
    assert.throws(()=>buildOutlines(fixture(),option as Partial<OutlineOptions>));
  const plan=fixture();plan.floors[2].elevation=1;
  assert.throws(()=>buildOutlines(plan,{height:2}),/overlaps/);
});
void test('the budgets fail before the rasterizing, not during it',()=>{
  const plan=fixture();plan.bounds={x:0,z:0,w:2048,d:2048};
  assert.throws(()=>buildOutlines(plan,{scale:4}),/too large/);
  plan.floors=[{index:0,elevation:0,name:'Ground'}];plan.blocks=Array.from({length:30},()=>box(0,2,0,2048,1,2048));
  assert.throws(()=>buildOutlines(plan),/too much work/);
});
for(const size of [0,1,65535,65536,131074])void test(`the stored gzip fallback round-trips ${size} bytes`,()=>{
  const bytes=Uint8Array.from({length:size},(_,i)=>(i*31)&255);
  assert.deepEqual(new Uint8Array(gunzipSync(storedGzip(bytes))),bytes);
});
void test('the download is a gzipped file with a name a filesystem will take',async()=>{
  const plan=fixture();plan.name='../../Manor <script>';
  const {bytes,filename}=await outlineFile(plan,{floor:0},1700000000123);
  assert.equal(filename,'manor-script-floor-0-outlines.litematic');
  assert.equal(bytes[0],0x1f);assert.equal(bytes[1],0x8b,'the file is not gzipped');
  assert.equal(obj(readNbt(gunzipSync(bytes)).Metadata).TotalBlocks,32);
});
void test('a browser without CompressionStream still gets a file it can load',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'CompressionStream');
  Object.defineProperty(globalThis,'CompressionStream',{configurable:true,value:undefined});
  try {
    const {bytes}=await outlineFile(fixture(),{},1700000000123);
    assert.equal(obj(readNbt(gunzipSync(bytes)).Metadata).RegionCount,3);
  } finally {if(descriptor)Object.defineProperty(globalThis,'CompressionStream',descriptor);}
});
void test('a generated estate outlines as walls you can walk into',()=>{
  // The defect this answers: an outline of a real building that is a solid slab, or a ring with no way in.
  for(const seed of ['OUTLINES','ALDERHALL']){
    const plan=generatePlan({...DEFAULT_SETTINGS,seed}),b=plan.bounds,result=buildOutlines(plan);
    assert.deepEqual(result.regions.map(r=>r.name),plan.floors.map(f=>`Floor_${f.index}`),`${seed}: a floor was lost`);
    const ground=result.regions.find(r=>r.floor.elevation===0)!;
    let filled=0;for(const cell of ground.cells)if(cell)filled++;
    assert.ok(filled>300,`${seed}: only ${filled} blocks of wall in the ground outline`);
    assert.ok(filled<ground.cells.length/3,`${seed}: the outline is a slab, not a set of walls`);
    // Every doorway standing at the cut is a gap you can walk through, the entrance above all.
    for(const o of plan.openings.filter(o=>o.type!=='window'&&o.y<=2&&o.y+o.height>2)){
      const x=o.x-b.x,z=o.z-b.z;
      if(x<0||x>=b.w||z<0||z>=b.d)continue;
      assert.equal(ground.cells[z*b.w+x],0,`${seed}: the ${o.type} at ${o.x},${o.z} is walled up`);
    }
  }
});
