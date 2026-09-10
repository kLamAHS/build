import { buildingGlb } from '../lib/gltf.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { crownwardPlan } from '../lib/showcase-plan.ts';
import { architectureFixture } from '../lib/test-fixtures/architecture.ts';
import { buildDetailedModel } from '../lib/architectural-detail.ts';
import { prepareMeshes, voxelize } from '../lib/voxels.ts';
import { wholeBuilding, litematicaFile } from '../lib/litematica.ts';
const folder=resolve(process.argv[2]??'exports/crownward');await mkdir(folder,{recursive:true});
const plan=process.argv.includes('--small')?architectureFixture():crownwardPlan();
const started=performance.now(),model=buildDetailedModel(plan),compiled=performance.now();
const meshes=prepareMeshes(model.grid),meshed=performance.now();
// The reference is authored, not generated: it is exported for inspection whatever its audit says, and the
// report below states what that audit found rather than hiding it.
const schematic=wholeBuilding(plan,model.grid,{audited:false});await writeFile(resolve(folder,'crownward-citadel.glb'),buildingGlb(meshes,plan.name));await writeFile(resolve(folder,'cells.bin'),new Uint8Array(schematic.cells.buffer));await writeFile(resolve(folder,'palette.json'),JSON.stringify(schematic.palette));await writeFile(resolve(folder,'crownward-citadel.litematic'),await litematicaFile(schematic,1700000000000));
await writeFile(resolve(folder,'plan.json'),JSON.stringify(plan));
await writeFile(resolve(folder,'features.json'),JSON.stringify(model.features,null,2));
await writeFile(resolve(folder,'mesh.json'),JSON.stringify(meshes.map(m=>({...m,positions:Array.from(m.positions),normals:Array.from(m.normals),indices:Array.from(m.indices)}))));
const before=prepareMeshes(voxelize(plan));await writeFile(resolve(folder,'before-mesh.json'),JSON.stringify(before.map(m=>({...m,positions:Array.from(m.positions),normals:Array.from(m.normals),indices:Array.from(m.indices)}))));
const report={name:plan.name,reference:'Authored reference composition, not candidate-search output',components:plan.components.length,rooms:plan.rooms.length,storeys:plan.floors.length,blocks:model.grid.stats().blocks,dimensions:schematic.size,palette:schematic.palette.length,triangles:meshes.reduce((n,m)=>n+m.indices.length/3,0),drawGroups:meshes.length,compileMs:Math.round(compiled-started),meshMs:Math.round(meshed-compiled),features:Object.fromEntries([...new Set(model.features.map(f=>f.kind))].map(k=>[k,model.features.filter(f=>f.kind===k).length])),
  audit:{valid:model.audit.valid,standing:model.audit.walking.nodes,reachable:model.audit.walking.reached,
    issues:Object.fromEntries([...new Set(model.audit.issues.map(i=>i.code))].map(c=>[c,model.audit.issues.filter(i=>i.code===c).length]))}};
await writeFile(resolve(folder,'report.json'),JSON.stringify(report,null,2));console.log(report);
