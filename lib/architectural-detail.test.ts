import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { architectureFixture } from './test-fixtures/architecture.ts';
import { buildDetailedModel } from './architectural-detail.ts';
import { solid, slab, stair, wallPost, parseBlockState, stateKey } from './block-states.ts';
import { SparseBlocks, voxelize, prepareMeshes, type MeshData } from './voxels.ts';
import { wholeBuilding, floorOutline, cellIndex, litematicaFile, nbtBytes, paletteKey } from './litematica.ts';
import { packBlockStates } from './nbt.ts';

function one(x=0,y=0,z=0){const grid=new SparseBlocks({x:-20,z:-20,w:60,d:60});grid.apply({x,y,z,w:1,h:1,d:1,material:1,kind:'wall',componentId:'test'});return grid;}
function surface(meshes:MeshData[]){let area=0;for(const m of meshes)for(let i=0;i<m.indices.length;i+=3){
  const [a,b,c]=[m.indices[i],m.indices[i+1],m.indices[i+2]].map(index=>Array.from(m.positions.slice(index*3,index*3+3)));
  const u=b.map((v,j)=>v-a[j]),v=c.map((n,j)=>n-a[j]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  area+=Math.hypot(...cross)/2;const n=m.normals.slice(m.indices[i]*3,m.indices[i]*3+3);
  assert.ok(cross.reduce((sum,v,j)=>sum+v*n[j],0)>0,'Triangle winding disagrees with its normal');
}return area;}
function snapshot(grid:SparseBlocks){const cells:string[]=[];grid.forEach((x,y,z,v)=>cells.push(`${x},${y},${z}:${v}:${grid.stateAt(x,y,z)?.key??''}`));return cells.sort();}

void test('exact cube, slab, stair and post meshes have correct area and winding',()=>{
  const cube=one();assert.equal(surface(prepareMeshes(cube)),6);
  for(const half of ['top','bottom'] as const){const g=one();g.setState(0,0,0,slab('stone_brick_slab',half));assert.equal(surface(prepareMeshes(g)),4);
    for(const facing of ['north','south','east','west'] as const){const s=one();s.setState(0,0,0,stair('stone_brick_stairs',facing,half));assert.equal(surface(prepareMeshes(s)),5.5);}}
  const g=one();g.setState(0,0,0,wallPost());assert.equal(surface(prepareMeshes(g)),2.5);
});
void test('shape and cube faces cull across positive and negative chunk boundaries',()=>{
  for(const x of [-17,-1,15]){const g=one(x);g.apply({x:x+1,y:0,z:0,w:1,h:1,d:1,material:1,kind:'wall',componentId:'test'});assert.equal(surface(prepareMeshes(g)),10);
    g.setState(x+1,0,0,slab('stone_brick_slab'));assert.equal(surface(prepareMeshes(g)),9);
    g.setState(x,0,0,slab('stone_brick_slab'));assert.equal(surface(prepareMeshes(g)),7);}
});
void test('floor and roof interfaces remain present for cutaways and exploded floors',()=>{
  const g=one(0,5);g.apply({x:0,y:6,z:0,w:1,h:1,d:1,material:1,kind:'wall',componentId:'test'});assert.equal(surface(prepareMeshes(g)),12);
  const h=one();h.apply({x:0,y:1,z:0,w:1,h:1,d:1,material:3,kind:'roof',ownerFloor:0,componentId:'test'});assert.equal(surface(prepareMeshes(h)),12);
  assert.equal(prepareMeshes(h).filter(m=>m.roof)[0].floor,0);
});
void test('overwriting a shaped block clears its state, including overwrites with air',()=>{
  const g=one();g.setState(0,0,0,slab('stone_brick_slab'));g.apply({x:0,y:0,z:0,w:1,h:1,d:1,material:0,kind:'air',componentId:'test'});
  assert.equal(g.stateAt(0,0,0),undefined);assert.equal(g.stats().blocks,0);assert.throws(()=>g.setState(0,0,0,solid('stone_bricks')));
});
void test('compilation leaves the source plan, structural cells and floor outline unchanged',()=>{
  const plan=architectureFixture(),json=JSON.stringify(plan),original=voxelize(plan),outline=floorOutline(plan,plan.floors[0]);
  const model=buildDetailedModel(plan);
  assert.equal(JSON.stringify(plan),json);assert.deepEqual(snapshot(model.structure),snapshot(original));
  assert.deepEqual(floorOutline(plan,plan.floors[0],model.structure),outline);
  // A doorway's own threshold is relabelled as the floor you walk across, and its reveal is re-cut, but no
  // other structural cell moves. Fittings are rebuilt from their footprints rather than kept as cuboids.
  const doorway=new Set<string>();
  for(const o of plan.openings)for(let d=-9;d<=9;d++)for(let w=0;w<o.width;w++)for(let y=o.y-1;y<o.y+o.height;y++)
    doorway.add(`${o.x+(o.axis==='z'?w:d)},${y},${o.z+(o.axis==='x'?w:d)}`);
  original.forEach((x,y,z,value)=>{
    if(['roof','furniture'].includes(original.kindAt(x,y,z))||doorway.has(`${x},${y},${z}`))return;
    assert.equal(model.grid.get(x,y,z),value,`Structural cell changed at ${x},${y},${z}`);
  });
});
void test('doors, glass, hall interior, entry approach and explicit louver remain clear',()=>{
  const plan=architectureFixture(),{grid,structure}=buildDetailedModel(plan);
  for(let x=18;x<21;x++)for(let z=-10;z<=2;z++)for(let y=1;y<5;y++)assert.equal(grid.get(x,y,z),structure.get(x,y,z));
  // The light is one plane of glazing in a recessed reveal, not three courses of solid glass block.
  for(let x=6;x<8;x++)for(let y=2;y<6;y++){
    assert.equal(grid.stateAt(x,y,0)?.name,'minecraft:gray_stained_glass_pane',`Unglazed aperture at ${x},${y},0`);
    for(const z of [-2,-1])assert.equal(grid.get(x,y,z),0,`The reveal at ${x},${y},${z} is still bricked up`);
  }
  // The inside of a room belongs to its fittings, its lights and its ceiling. No facade ornament, no roof and
  // no masonry may reach into it, and nothing but a fitting may stand in the head of someone walking through.
  for(let x=1;x<28;x++)for(let z=1;z<16;z++)for(let y=1;y<12;y++){
    if(!grid.get(x,y,z))continue;
    const kind=grid.kindAt(x,y,z);
    assert.ok(kind==='furniture'||kind==='support',`${kind} intrudes into the hall at ${x},${y},${z}`);
    assert.ok(y>=4||kind==='furniture',`Ceiling structure hangs into standing headroom at ${x},${y},${z}`);
  }
  for(let x=12;x<15;x++)for(let z=7;z<10;z++)for(let y=12;y<34;y++)assert.equal(grid.get(x,y,z),0,`Louver closed at ${x},${y},${z}`);
});
void test('protected court stays open to the sky',()=>{
  const plan=architectureFixture();plan.reservations.push({id:'court',name:'Open test court',kind:'court',componentId:'hall',bounds:{x:6,z:-8,w:12,d:9},polygon:[{x:6,z:-8},{x:18,z:-8},{x:18,z:1},{x:6,z:1}],fromY:0,toY:50,open:'exterior',reason:'Test reservation'});
  const {grid}=buildDetailedModel(plan);for(let x=9;x<=15;x++)for(let z=-5;z<=-3;z++)for(let y=1;y<45;y++)assert.equal(grid.get(x,y,z),0);
});
void test('stair treads retain their rise and direction without blocking the three-block headroom',()=>{
  const plan=architectureFixture();plan.stairs.push({id:'test-stair',componentId:'keep',roomIds:['keep-room'],bounds:{x:34,z:0,w:10,d:10},fromY:0,toY:6,width:2,headroom:3,landings:[]});
  for(let j=0;j<6;j++){
    plan.blocks.push({x:37,y:j+1,z:3+j,w:2,h:1,d:1,material:2,kind:'stair',componentId:'keep'});
    plan.blocks.push({x:37,y:j+2,z:3+j,w:2,h:3,d:1,material:0,kind:'air',componentId:'keep'});
  }
  const model=buildDetailedModel(plan),built=model.staircases.find(a=>a.id==='test-stair')!;
  // The flight is rebuilt as a real assembly with landings, strings and rails. What has to hold is that every
  // tread is a stair facing the way it climbs, and that nothing stands in the head of anyone climbing it.
  assert.equal(built.style,'switchback');
  const treads=built.pieces.filter(p=>p.kind==='stair');
  assert.ok(treads.length>=12,`only ${treads.length} treads`);
  for(const p of treads){
    assert.match(model.grid.stateAt(p.x,p.y,p.z)?.name??'',/stairs$/);
    assert.ok(['north','south'].includes(model.grid.stateAt(p.x,p.y,p.z)?.properties.facing??''));
    for(let y=p.y+1;y<p.y+3;y++)assert.equal(model.grid.get(p.x,y,p.z),0,`Headroom closed above a tread at ${p.x},${y},${p.z}`);
  }
  assert.ok(model.audit.stairs.find(s=>s.id==='test-stair')?.connected,'The rebuilt flight does not connect its landings');
});
void test('a chamfered tower no longer has floating square merlons at its bounding-box corners',()=>{
  const plan=architectureFixture(),{grid}=buildDetailedModel(plan),c=plan.components[2];
  for(const x of [c.bounds.x,c.bounds.x+c.bounds.w])for(const z of [c.bounds.z,c.bounds.z+c.bounds.d])for(let y=c.topY+2;y<=c.topY+4;y++)assert.equal(grid.get(x,y,z),0);
  assert.ok([...grid.states.values()].some(s=>s.name.endsWith('_slab')));
  assert.ok([...grid.states.values()].some(s=>s.name.endsWith('_stairs')));
});
void test('compiled geometry, material patches and exact state exports are deterministic',()=>{
  const plan=architectureFixture(),a=buildDetailedModel(plan),b=buildDetailedModel(plan);assert.deepEqual(snapshot(a.grid),snapshot(b.grid));
  assert.deepEqual(wholeBuilding(plan,a.grid,{audited:false}),wholeBuilding(plan,b.grid,{audited:false}));
  const changed=architectureFixture();changed.settings.seed='ANOTHER';assert.notDeepEqual(snapshot(a.grid),snapshot(buildDetailedModel(changed).grid));
});
void test('tall roofs and negative coordinates are fully enclosed in whole-building exports',()=>{
  const plan=architectureFixture(),model=buildDetailedModel(plan),s=wholeBuilding(plan,undefined,{audited:false});
  assert.ok(model.maxY>plan.maxY);assert.ok(s.palette.length>9);assert.ok(s.palette.some(p=>p.props?.facing));
  model.grid.forEach((x,y,z)=>{const at=cellIndex(s.size,x-s.origin!.x,y-s.origin!.y,z-s.origin!.z);
    assert.ok(at>=0&&at<s.cells.length);const expected=model.grid.stateAt(x,y,z)?.key;
    assert.ok(s.cells[at]>0);if(expected)assert.equal(paletteKey(s.palette[s.cells[at]]),expected);
  });
  assert.equal(s.cells.reduce((sum,v)=>sum+(v?1:0),0),model.grid.stats().blocks);
  const raw=wholeBuilding(plan,voxelize(plan),{audited:false});assert.deepEqual(raw,s,'A caller-supplied structural grid must still receive the same architectural treatment');
});

// Independent NBT reader: deliberately does not call any of the writer's parsing helpers.
type Tag=number|bigint|string|Tag[]|{[k:string]:Tag};
type State={Name:string;Properties?:Record<string,string>};
function readNbt(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
  const byte=()=>view.getUint8(at++),short=()=>{const v=view.getUint16(at);at+=2;return v;},int=()=>{const v=view.getInt32(at);at+=4;return v;};
  const text=()=>{const n=short(),s=new TextDecoder().decode(bytes.subarray(at,at+n));at+=n;return s;};
  const long=()=>{const v=view.getBigInt64(at);at+=8;return v;};
  function value(t:number):Tag{
    if(t===1)return byte();if(t===2)return short();if(t===3)return int();if(t===4)return long();if(t===8)return text();
    if(t===9){const type=byte(),n=int();return Array.from({length:n},()=>value(type));}
    if(t===10){const out:Record<string,Tag>={};for(;;){const type=byte();if(!type)return out;const name=text();out[name]=value(type);}}
    if(t===12){const n=int();return Array.from({length:n},()=>BigInt.asUintN(64,long()));}
    throw new Error(`Unsupported test tag ${t}`);
  }
  assert.equal(byte(),10);assert.equal(text(),'');const result=value(10);assert.equal(at,bytes.length);return result as Record<string,Record<string,Tag>>;
}
void test('gzipped NBT round-trips all properties and every packed cell across 64-bit boundaries',async()=>{
  const s=wholeBuilding(architectureFixture(),undefined,{audited:false}),file=await litematicaFile(s,1700000000000),nbt=readNbt(gunzipSync(file));
  const region=nbt.Regions[s.name] as unknown as {BlockStatePalette:State[];BlockStates:bigint[]};
  assert.equal(nbt.Version,5);assert.equal(nbt.MinecraftDataVersion,2586);assert.equal(nbt.Metadata.TimeCreated,BigInt(1700000000000));
  const palette=region.BlockStatePalette.map(p=>stateKey(p.Name,p.Properties??{}));assert.deepEqual(palette,s.palette.map(paletteKey));
  const bits=Math.max(2,Math.ceil(Math.log2(s.palette.length))),mask=(BigInt(1)<<BigInt(bits))-BigInt(1),words=region.BlockStates;
  for(let i=0;i<s.cells.length;i++){
    const bit=i*bits,word=Math.floor(bit/64),offset=bit%64;let v=words[word]>>BigInt(offset);
    if(offset+bits>64)v|=words[word+1]<<BigInt(64-offset);
    assert.equal(Number(v&mask),s.cells[i],`Packed cell ${i}`);
  }
  assert.ok(region.BlockStatePalette.some(p=>p.Properties?.half==='top'));
});
void test('invalid block states and inconsistent schematic palettes fail rather than silently corrupt exports',()=>{
  for(const text of ['stone_bricks','minecraft:stone[x=]','minecraft:stone[x=a,x=b]'])assert.throws(()=>parseBlockState(text));
  assert.deepEqual(parseBlockState('minecraft:spruce_stairs[facing=north,half=top]'),{name:'minecraft:spruce_stairs',properties:{facing:'north',half:'top'}});
  const s=wholeBuilding(architectureFixture(),voxelize(architectureFixture()),{audited:false});
  assert.throws(()=>nbtBytes({...s,size:{x:1,y:1,z:1}}));assert.throws(()=>nbtBytes({...s,palette:[{name:'minecraft:stone'}]}));
  assert.throws(()=>packBlockStates(new Uint16Array([4]),2));assert.throws(()=>packBlockStates(new Uint16Array([0]),1));
});
