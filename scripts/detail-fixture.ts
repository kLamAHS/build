import { writeFileSync } from 'node:fs';
import { architectureFixture } from '../lib/test-fixtures/architecture.ts';
import { buildDetailedModel } from '../lib/architectural-detail.ts';
import { voxelize, prepareMeshes } from '../lib/voxels.ts';
import { MATERIALS } from '../lib/model.ts';
import { wholeBuilding, litematicaFile } from '../lib/litematica.ts';
const plan=architectureFixture(),model=buildDetailedModel(plan);
const out=process.argv[2]??'.';
for(const [name,grid] of [['before',voxelize(plan)],['after',model.grid]] as const){
  const start=performance.now(),meshes=prepareMeshes(grid);
  writeFileSync(`${out}/${name}-geometry.json`,JSON.stringify(meshes.map(m=>({positions:Array.from(m.positions),normals:Array.from(m.normals),indices:Array.from(m.indices),color:m.color??MATERIALS[m.material].color,roof:m.roof,floor:m.floor}))));
  console.log(name,grid.stats(),`${meshes.length} meshes`,`${meshes.reduce((s,m)=>s+m.indices.length/3,0)} triangles`,`${Math.round(performance.now()-start)}ms`);
}
writeFileSync(`${out}/architectural-detail-fixture.litematic`,await litematicaFile(wholeBuilding(plan,model.grid),1700000000000));
