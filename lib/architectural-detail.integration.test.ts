import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePlan } from './architecture.ts';
import { DEFAULT_SETTINGS, FAMILIES } from './model.ts';
import { buildDetailedModel } from './architectural-detail.ts';
import { voxelize, prepareMeshes } from './voxels.ts';
import { wholeBuilding, floorOutline, cellIndex, BLOCKS, paletteKey } from './litematica.ts';

// Full-repository acceptance tests. These require the real generator, not the isolated fixture.
// OUTLINE/224/3 is also exercised by the repository's existing litematica tests.
for (const kind of ['castle','manor','house'] as const) for (const family of FAMILIES[kind]) {
  void test(`architectural export preserves the generated ${family.id} plan`,()=>{
    const plan=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size:224,floors:3,seed:'OUTLINE'});
    const before=JSON.stringify(plan),raw=voxelize(plan),model=buildDetailedModel(plan),schematic=wholeBuilding(plan,model.grid);
    assert.equal(JSON.stringify(plan),before,'Detailing mutated the accepted floor plan.');
    raw.forEach((x,y,z,value)=>{
      if(!['roof','furniture'].includes(raw.kindAt(x,y,z)))assert.equal(model.grid.get(x,y,z),value,`Structural block changed at ${x},${y},${z}`);
    });
    for(const floor of plan.floors)assert.deepEqual(floorOutline(plan,floor,model.structure),floorOutline(plan,floor,raw));
    for(const opening of plan.openings)for(let along=0;along<opening.width;along++)for(let y=opening.y;y<opening.y+opening.height;y++)for(let depth=-7;depth<=7;depth++){
      const x=opening.x+(opening.axis==='z'?along:depth),z=opening.z+(opening.axis==='x'?along:depth);
      if(!raw.get(x,y,z))assert.equal(model.grid.get(x,y,z),0,`Opening clearance closed at ${x},${y},${z}`);
    }
    model.grid.forEach((x,y,z,value)=>{
      const at=cellIndex(schematic.size,x-schematic.origin!.x,y-schematic.origin!.y,z-schematic.origin!.z);
      assert.equal(paletteKey(schematic.palette[schematic.cells[at]]),model.grid.stateAt(x,y,z)?.key??BLOCKS[value&15]??'minecraft:stone');
    });
    const meshes=prepareMeshes(model.grid);assert.ok(meshes.length>0);
    for(const mesh of meshes){
      for(const coordinate of mesh.positions)assert.ok(Number.isFinite(coordinate));
      for(const index of mesh.indices)assert.ok(index<mesh.positions.length/3);
    }
  });
}
