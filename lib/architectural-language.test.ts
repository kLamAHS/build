import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crownwardPlan } from './showcase-plan.ts';
import { architectureFixture } from './test-fixtures/architecture.ts';
import { buildDetailedModel } from './architectural-detail.ts';
import { wholeBuilding, floorOutline, paletteKey } from './litematica.ts';
import { prepareMeshes, SparseBlocks, type MeshData } from './voxels.ts';
import { pane, chain, bed } from './block-states.ts';
import { buildingGlb } from './gltf.ts';
import { openingTunnel, tunnelCells } from './building-repairs.ts';

// A large authored reference exercises intersections and motifs together; it is not an architecture.ts candidate.
const reference=crownwardPlan(),sourceJSON=JSON.stringify(reference),model=buildDetailedModel(reference);
const schematic=wholeBuilding(reference,model.grid);

void test('a complete reference castle receives several scales of architectural treatment',()=>{
  const counts=new Map<string,number>();for(const f of model.features)counts.set(f.kind,(counts.get(f.kind)??0)+1);
  assert.equal(reference.components.length,12);
  assert.ok((counts.get('lantern-crown')??0)>=3);
  assert.ok((counts.get('gabled-dormer')??0)>=6);
  assert.ok((counts.get('corbelled-bartizan')??0)>=4);
  assert.ok((counts.get('traceried-gable')??0)>=8);
  assert.ok((counts.get('carved-portal')??0)>=4);
  assert.ok((counts.get('heraldic-hanging')??0)>=4);
  assert.ok((counts.get('interior-lighting')??0)>=10);
  assert.equal(model.grid.detailVersion,2);
  assert.ok(schematic.palette.length>=40);
});
void test('reference detailing preserves all non-furniture structure and every structural floor outline',()=>{
  assert.equal(JSON.stringify(reference),sourceJSON);
  // Roofs are replaced, fittings are rebuilt from their footprints, glazing becomes one plane of panes in its
  // own reveal, and a doorway's threshold is relabelled as the floor across it. Nothing else moves.
  const doorway=new Set<string>();
  for(const o of reference.openings)for(let d=-9;d<=9;d++)for(let w=0;w<o.width;w++)for(let y=o.y-1;y<o.y+o.height;y++)
    doorway.add(`${o.x+(o.axis==='z'?w:d)},${y},${o.z+(o.axis==='x'?w:d)}`);
  // A cell is either still exactly what the plan built, or it was removed by a repair the model declares.
  const declared=model.repairs.filter(r=>['foreign-wall-in-room','roof-in-room','fitting-replacement','orphan-glazing'].includes(r.kind)).reduce((n,r)=>n+r.cells,0);
  let changed=0;
  model.structure.forEach((x,y,z,value)=>{
    if(['roof','furniture','glass'].includes(model.structure.kindAt(x,y,z))||doorway.has(`${x},${y},${z}`))return;
    // A cell a repair emptied may afterwards hold a fitting, a lamp or a ceiling beam. What no cell may do is
    // change without the model saying so, so the count of changes is held against the count it declares.
    if(model.grid.get(x,y,z)!==value)changed++;
  });
  assert.ok(changed<=declared,`${changed} structural cells changed but only ${declared} removals were reported`);
  assert.ok(changed>0,'The reference reports repairs it did not make');
  for(const floor of reference.floors)assert.deepEqual(floorOutline(reference,floor,model.structure),floorOutline(reference,floor));
  // The clearance a doorway is owed is its own reveal, not an arbitrary corridor either side of it.
  const doorCells=new Set<string>();
  for(const o of reference.openings)if(o.type!=='window')tunnelCells(openingTunnel(reference,o),(x,y,z)=>doorCells.add(`${x},${y},${z}`));
  for(const o of reference.openings){
    const t=openingTunnel(reference,o);
    tunnelCells(t,(x,y,z,depth)=>{
      if(o.type!=='window')assert.equal(model.grid.get(x,y,z),0,`${o.id} is blocked at ${x},${y},${z}`);
      else if(depth===0&&!doorCells.has(`${x},${y},${z}`))assert.match(model.grid.stateAt(x,y,z)?.name??'',/glass/,`${o.id} is unglazed at ${x},${y},${z}`);
    });
  }
});
void test('all reference export blocks form one face-adjacent assembly, apart from the open flights',()=>{
  // This checks occupied block cells, not structural engineering or exact partial-block contact. An open
  // stair is the deliberate exception: its treads and its sloping strings run diagonally, so a flight is a
  // string of two-block clusters by design rather than a solid mass. Nothing else may hang in the air.
  const {cells,size,origin}=schematic,seen=new Uint8Array(cells.length),queue=new Uint32Array(cells.length),plane=size.x*size.z;
  const first=cells.findIndex(v=>v!==0);assert.ok(first>=0);let head=0,tail=1;queue[0]=first;seen[first]=1;
  const visit=(i:number)=>{if(cells[i]&&!seen[i]){seen[i]=1;queue[tail++]=i;}};
  while(head<tail){const i=queue[head++],x=i%size.x,z=Math.floor(i/size.x)%size.z,y=Math.floor(i/plane);
    if(x)visit(i-1);if(x+1<size.x)visit(i+1);if(z)visit(i-size.x);if(z+1<size.z)visit(i+size.x);if(y)visit(i-plane);if(y+1<size.y)visit(i+plane);
  }
  let stranded=0;
  for(let i=0;i<cells.length;i++){
    if(!cells[i]||seen[i])continue;
    const x=i%size.x+origin!.x,z=Math.floor(i/size.x)%size.z+origin!.z,y=Math.floor(i/plane)+origin!.y;
    const inFlight=model.staircases.some(a=>x>=a.bounds.x&&x<a.bounds.x+a.bounds.w&&z>=a.bounds.z&&z<a.bounds.z+a.bounds.d&&y>a.fromY&&y<=a.toY+3);
    assert.ok(inFlight,`A detached block hangs at ${x},${y},${z}`);
    stranded++;
  }
  assert.ok(stranded*200<tail,`${stranded} of ${tail} blocks stand clear of the rest of the building`);
});
void test('hanging lanterns have an overhead block and beds export in complete facing-matched pairs',()=>{
  let lamps=0,beds=0;
  model.grid.forEach((x,y,z)=>{
    const s=model.grid.stateAt(x,y,z);if(!s)return;
    if(s.name==='minecraft:lantern'&&s.properties.hanging==='true'){assert.ok(model.grid.get(x,y+1,z),`Unsupported lamp at ${x},${y},${z}`);lamps++;}
    if(s.name==='minecraft:red_bed'&&s.properties.part==='foot'){
      const f=s.properties.facing,dx=f==='east'?1:f==='west'?-1:0,dz=f==='south'?1:f==='north'?-1:0;
      const other=model.grid.stateAt(x+dx,y,z+dz);assert.equal(other?.properties.part,'head');assert.equal(other?.properties.facing,f);beds++;
    }
  });
  assert.ok(lamps>10);assert.ok(beds>10);
});
void test('all occupied reference cells are enclosed and retain their exact exported state',()=>{
  const {size,origin,cells,palette}=schematic;assert.ok(origin);
  model.grid.forEach((x,y,z)=>{
    const lx=x-origin.x,ly=y-origin.y,lz=z-origin.z;
    assert.ok(lx>=0&&lx<size.x&&ly>=0&&ly<size.y&&lz>=0&&lz<size.z);
    const i=(ly*size.z+lz)*size.x+lx;assert.ok(cells[i]);
    const expected=model.grid.stateAt(x,y,z);if(expected)assert.equal(paletteKey(palette[cells[i]]),expected.key);
  });
});
function area(meshes:MeshData[]){let area=0;for(const m of meshes)for(let i=0;i<m.indices.length;i+=3){
  const [a,b,c]=Array.from(m.indices.subarray(i,i+3),j=>m.positions.subarray(j*3,j*3+3));
  const u=Array.from(b,(v,j)=>v-a[j]),v=Array.from(c,(v,j)=>v-a[j]);area+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
}return area;}
void test('thin glazing and chain meshes retain their sixteenth-block geometry',()=>{
  const g=new SparseBlocks({x:0,z:0,w:8,d:8});g.apply({x:1,y:1,z:1,w:1,h:1,d:1,material:4,kind:'glass',componentId:'test'});
  g.setState(1,1,1,pane());assert.equal(area(prepareMeshes(g)),2.5);
  g.setState(1,1,1,chain());assert.equal(area(prepareMeshes(g)),.53125);
  g.setState(1,1,1,bed('east','foot'));assert.equal(area(prepareMeshes(g)),4.25);
});
void test('GLB contains the original mesh buffers, floor ownership and material factors',()=>{
  const meshes=prepareMeshes(buildDetailedModel(architectureFixture()).grid),bytes=buildingGlb(meshes,'Test reference'),view=new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(4,true),2);assert.equal(view.getUint32(8,true),bytes.length);
  const jsonLength=view.getUint32(12,true);assert.equal(view.getUint32(16,true),0x4e4f534a);
  const doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonLength)));
  assert.equal(doc.asset.version,'2.0');assert.equal(doc.nodes.length,meshes.length);assert.equal(doc.extras.fullBuilding,true);
  const binHeader=20+jsonLength,binStart=binHeader+8;assert.equal(view.getUint32(binHeader+4,true),0x004e4942);
  for(let i=0;i<meshes.length;i++){
    const mesh=meshes[i],p=doc.meshes[i].primitives[0];assert.equal(doc.nodes[i].extras.floor,mesh.floor);assert.equal(doc.nodes[i].extras.roof,mesh.roof);
    for(const [accessor,data] of [[p.attributes.POSITION,mesh.positions],[p.attributes.NORMAL,mesh.normals],[p.indices,mesh.indices]] as const){
      const a=doc.accessors[accessor],v=doc.bufferViews[a.bufferView];assert.equal(v.byteOffset%4,0);assert.equal(v.byteLength,data.byteLength);
      assert.deepEqual(bytes.subarray(binStart+v.byteOffset,binStart+v.byteOffset+v.byteLength),new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
    }
  }
  for(const m of doc.materials)for(const v of m.pbrMetallicRoughness.baseColorFactor)assert.ok(Number.isFinite(v)&&v>=0&&v<=1);
  assert.throws(()=>buildingGlb([]));
  assert.throws(()=>buildingGlb([{...meshes[0],indices:new Uint32Array([0,1,999999999])}]));
  const bad={...meshes[0],positions:meshes[0].positions.slice()};bad.positions[0]=NaN;assert.throws(()=>buildingGlb([bad]));
});

void test('viewer-expanded vertical bounds do not trigger a different second export',()=>{
  const plan=architectureFixture(),a=buildDetailedModel(plan),viewerPlan={...plan,minY:a.minY,maxY:a.maxY};
  assert.deepEqual(wholeBuilding(viewerPlan),wholeBuilding(plan,a.grid));
});
