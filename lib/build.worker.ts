/// <reference lib="webworker" />
import { tryGenerate } from './architecture.ts';
import { voxelize, prepareMeshes, type SparseBlocks } from './voxels.ts';
import type { Settings } from './model.ts';

let grid:SparseBlocks|undefined;
let currentId=0;
self.onmessage=(event:MessageEvent<{type:'generate'|'layer';id:number;settings?:Settings;y?:number;requestId?:number}>)=>{
  const message=event.data;
  try{
    if(message.type==='generate'){
      currentId=message.id;
      const start=performance.now(),result=tryGenerate(message.settings!);
      if(!result.ok){self.postMessage({type:'error',id:message.id,error:result.error});return;}
      self.postMessage({type:'progress',id:message.id,stage:'Preparing block geometry…'});
      grid=voxelize(result.plan);
      const meshes=prepareMeshes(grid),stats={...grid.stats(),milliseconds:Math.round(performance.now()-start),triangles:meshes.reduce((n,m)=>n+m.indices.length/3,0)};
      const floorLayers=Object.fromEntries(result.plan.floors.map(f=>[f.elevation,grid!.layer(f.elevation+2)]));
      self.postMessage({type:'ready',id:message.id,plan:result.plan,meshes,stats,floorLayers}, {transfer:meshes.flatMap(m=>[m.positions.buffer,m.normals.buffer,m.indices.buffer])});
    }else if(grid&&message.id===currentId){
      self.postMessage({type:'layer',id:message.id,requestId:message.requestId,layer:grid.layer(message.y!),previous:grid.layer(message.y!-1)});
    }
  }catch(error){self.postMessage({type:'error',id:message.id,error:error instanceof Error?error.message:'The build could not be prepared. Your previous build is retained.'});}
};
