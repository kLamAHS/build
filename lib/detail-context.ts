import type { BlockBox, BuildingComponent, Plan } from './model.ts';
import type { SparseBlocks } from './voxels.ts';
import type { BlockState } from './block-states.ts';
export type DetailFeature={kind:string;componentId:string;blocks:number;bounds:{x:number;y:number;z:number;w:number;h:number;d:number}};
export type DetailContext={
  plan:Plan;grid:SparseBlocks;structure:SparseBlocks;features:DetailFeature[];
  protectedAt:(x:number,y:number,z:number)=>boolean;
  put:(x:number,y:number,z:number,state:BlockState,material:number,kind:BlockBox['kind'],c:BuildingComponent,replaceRoof?:boolean)=>boolean;
};
