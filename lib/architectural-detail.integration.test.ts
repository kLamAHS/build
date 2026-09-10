import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePlan } from './architecture.ts';
import { DEFAULT_SETTINGS, FAMILIES } from './model.ts';
import { buildDetailedModel } from './architectural-detail.ts';
import { voxelize, prepareMeshes } from './voxels.ts';
import { wholeBuilding, floorOutline, cellIndex, BLOCKS, paletteKey } from './litematica.ts';
import { openingTunnel, tunnelCells } from './building-repairs.ts';

// Full-repository acceptance tests. These require the real generator, not the isolated fixture.
// OUTLINE/224/3 is also exercised by the repository's existing litematica tests.
for (const kind of ['castle','manor','house'] as const) for (const family of FAMILIES[kind]) {
  void test(`architectural export preserves the generated ${family.id} plan`,()=>{
    const plan=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size:224,floors:3,seed:'OUTLINE'});
    const before=JSON.stringify(plan),raw=voxelize(plan),model=buildDetailedModel(plan),schematic=wholeBuilding(plan,model.grid);
    assert.equal(JSON.stringify(plan),before,'Detailing mutated the accepted floor plan.');
    // Roofs are replaced, fittings rebuilt, glazing re-cut as one plane in a reveal, and repairs remove what
    // they declare. Everything else the plan built is still exactly where the plan put it.
    const declared=model.repairs.filter(r=>['foreign-wall-in-room','roof-in-room','fitting-replacement','orphan-glazing'].includes(r.kind)).reduce((n,r)=>n+r.cells,0);
    const doorway=new Set<string>();
    for(const o of plan.openings)for(let d=-9;d<=9;d++)for(let w=0;w<o.width;w++)for(let y=o.y-1;y<o.y+o.height;y++)
      doorway.add(`${o.x+(o.axis==='z'?w:d)},${y},${o.z+(o.axis==='x'?w:d)}`);
    let changed=0;
    raw.forEach((x,y,z,value)=>{
      if(['roof','furniture','glass'].includes(raw.kindAt(x,y,z))||doorway.has(`${x},${y},${z}`))return;
      if(model.grid.get(x,y,z)!==value)changed++;
    });
    assert.ok(changed<=declared,`${family.id}: ${changed} structural blocks changed but only ${declared} removals were reported`);
    for(const floor of plan.floors)assert.deepEqual(floorOutline(plan,floor,model.structure),floorOutline(plan,floor,raw));
    // A doorway is clear through its own reveal, and a light is glazed across its aperture.
    const doorCells=new Set<string>();
    for(const o of plan.openings)if(o.type!=='window')tunnelCells(openingTunnel(plan,o),(x,y,z)=>doorCells.add(`${x},${y},${z}`));
    for(const o of plan.openings){
      const t=openingTunnel(plan,o);
      tunnelCells(t,(x,y,z,depth)=>{
        if(o.type!=='window')assert.equal(model.grid.get(x,y,z),0,`${family.id}: ${o.id} is blocked at ${x},${y},${z}`);
        else if(depth===0&&!doorCells.has(`${x},${y},${z}`))assert.match(model.grid.stateAt(x,y,z)?.name??'',/glass/,`${family.id}: ${o.id} is unglazed at ${x},${y},${z}`);
      });
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
