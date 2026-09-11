import { compound, gzip, int, list, millis, MINECRAFT_DATA_VERSION, nbtFile, packBlockStates, paletteBits, SCHEMATIC_VERSION, str, TAG, xyz, type Nbt } from './nbt.ts';

/**
 * The wall lines of a plan as markers to build against, rather than the finished masonry `lib/litematica.ts`
 * writes. One is a hologram you stand inside and lay courses along; the other is the building itself. A floor
 * you can see the shape of, at the scale you want to build it, is worth more at the start of a build than
 * every block of the roof.
 *
 * It reads `plan.blocks` rather than a voxel grid, in the order the generator wrote them and including the
 * boxes of air that erase — the same sampling `voxelize()` does — so this module depends on nothing but the
 * NBT writer. That is what lets the studio preview an outline on every keystroke, and lets `/litematica`
 * open a building JSON saved months ago without compiling it.
 */
export type OutlineFloor={index:number;name:string;elevation:number};
export type OutlineBox={x:number;y:number;z:number;w:number;h:number;d:number;material:number;kind:string};
/** The shape of an exported building JSON, which is also the shape of a live `Plan`. */
export type OutlinePlan={schemaVersion:2;name:string;bounds:{x:number;z:number;w:number;d:number};floors:OutlineFloor[];blocks:OutlineBox[]};
export type OutlineOptions={floor:'all'|number;scale:number;height:number;material:string;colorByFloor:boolean;includeStairs:boolean};
export const OUTLINE_MATERIALS:[string,string][]=[['minecraft:white_wool','White wool'],['minecraft:stone_bricks','Stone bricks'],
  ['minecraft:cobblestone','Cobblestone'],['minecraft:oak_planks','Oak planks'],['minecraft:lime_wool','Lime wool'],['minecraft:red_wool','Red wool']];
export const DEFAULT_OUTLINE_OPTIONS:OutlineOptions={floor:'all',scale:1,height:1,material:'minecraft:white_wool',colorByFloor:false,includeStairs:false};
export const MAX_JSON_BYTES=64*1024*1024;
const MAX_CELLS=16*1024*1024,MAX_PAINT=100*1024*1024;
const COLORS=['white','orange','lime','light_blue','yellow','pink','cyan','purple','red'];
/** What holds a building up and is worth marking on the ground. Glass keeps a window wall's line unbroken. */
const STRUCTURE=new Set(['wall','support','chimney','glass']);
const KINDS=new Set([...STRUCTURE,'floor','roof','stair','furniture','ground','air']);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
/**
 * A file off somebody's disk, checked before a single cell is allocated or a single coordinate looped over.
 * Every bound here is a refusal to let a hand-edited JSON decide how much memory this page takes.
 */
export function parseOutlinePlan(value:unknown):OutlinePlan {
  const fail=():never=>{throw new Error('Use Keepwright’s “Complete building · JSON” export (schema version 2).');};
  if(!record(value)||value.schemaVersion!==2||typeof value.name!=='string'||value.name.length>512)return fail();
  const b=value.bounds;
  if(!record(b)||!integer(b.x,-1e6,1e6)||!integer(b.z,-1e6,1e6)||!integer(b.w,1,2048)||!integer(b.d,1,2048))return fail();
  if(!Array.isArray(value.floors)||!value.floors.length||value.floors.length>16||!Array.isArray(value.blocks)||value.blocks.length>1e6)return fail();
  const seen=new Set<number>();
  for(const f of value.floors as unknown[]){
    if(!record(f)||!integer(f.index,-128,128)||seen.has(f.index)||typeof f.name!=='string'||f.name.length>256||!integer(f.elevation,-2048,2048))return fail();
    seen.add(f.index);
  }
  for(const box of value.blocks as unknown[])
    if(!record(box)||!integer(box.x,-1e6,1e6)||!integer(box.z,-1e6,1e6)||!integer(box.y,-4096,4096)||!integer(box.w,1,4096)||!integer(box.d,1,4096)||
      !integer(box.h,1,4096)||!integer(box.material,0,15)||typeof box.kind!=='string'||!KINDS.has(box.kind))return fail();
  return value as unknown as OutlinePlan;
}
/** One floor's cut, at the source grid's own scale: 0 air, 1 outline, 2 a stair. */
export type OutlineRegion={name:string;floor:OutlineFloor;y:number;width:number;depth:number;height:number;cells:Uint8Array;palette:string[];blocks:number};
export type OutlineResult={plan:OutlinePlan;options:OutlineOptions;regions:OutlineRegion[];
  width:number;depth:number;height:number;minY:number;blocks:number;volume:number;warnings:string[]};
/**
 * Every floor is cut at its elevation plus two, the height the studio's own floor plan is drawn at: a cut at
 * the floor is an unbroken ring that tells you nothing, where a cut at head height is the course a doorway is
 * a gap in. Roofs, slabs, furniture and ground stay out of it — what you want on the ground is where the
 * walls go.
 */
export function buildOutlines(input:unknown,requested:Partial<OutlineOptions>={}):OutlineResult {
  const plan=parseOutlinePlan(input),o={...DEFAULT_OUTLINE_OPTIONS,...requested};
  if(!integer(o.scale,1,4)||!integer(o.height,1,5))throw new Error('Horizontal scale must be 1–4 and outline height 1–5 whole blocks.');
  if(!OUTLINE_MATERIALS.some(([id])=>id===o.material)||typeof o.colorByFloor!=='boolean'||typeof o.includeStairs!=='boolean')throw new Error('Choose a supported outline material and valid options.');
  if(o.floor!=='all'&&!integer(o.floor,-128,128))throw new Error('Choose a floor or all floors.');
  const floors=plan.floors.filter(f=>o.floor==='all'||f.index===o.floor).sort((a,b)=>a.elevation-b.elevation||a.index-b.index);
  if(!floors.length)throw new Error('That floor is not in this building.');
  if(floors.some((f,i)=>i>0&&f.elevation<floors[i-1].elevation+o.height))throw new Error('The outline height overlaps the next floor. Reduce the height or export one floor.');
  const b=plan.bounds,width=b.w*o.scale,depth=b.d*o.scale;
  if(width*depth*o.height*floors.length>MAX_CELLS)throw new Error('This export is too large. Reduce the scale/height or export one floor at a time.');
  // Count the painting before doing any of it: overlapping boxes must not be able to buy unbounded work.
  let work=0,clipped=false;
  const jobs=floors.map(f=>{
    const at=f.elevation+2;
    return plan.blocks.filter(box=>{
      if(at<box.y||at>=box.y+box.h)return false;
      const w=Math.max(0,Math.min(b.x+b.w,box.x+box.w)-Math.max(b.x,box.x)),d=Math.max(0,Math.min(b.z+b.d,box.z+box.d)-Math.max(b.z,box.z));
      if(box.material&&(STRUCTURE.has(box.kind)||(o.includeStairs&&box.kind==='stair'))&&(w<box.w||d<box.d))clipped=true;
      work+=w*d;
      if(work>MAX_PAINT)throw new Error('This plan requires too much work. Export one floor at a time.');
      return w>0&&d>0;
    });
  });
  const warnings:string[]=[],regions:OutlineRegion[]=[];
  if(clipped)warnings.push('Structural blocks outside the plan bounds were clipped, as the block-layer view clips them.');
  for(const [i,f] of floors.entries()){
    const cells=new Uint8Array(b.w*b.d);
    for(const box of jobs[i]){
      // What is excluded still overwrites: a wall the generator took out again must not survive as an outline.
      const value=!box.material?0:STRUCTURE.has(box.kind)?1:o.includeStairs&&box.kind==='stair'?2:0;
      const x0=Math.max(b.x,box.x)-b.x,x1=Math.min(b.x+b.w,box.x+box.w)-b.x;
      const z0=Math.max(b.z,box.z)-b.z,z1=Math.min(b.z+b.d,box.z+box.d)-b.z;
      for(let z=z0;z<z1;z++)cells.fill(value,z*b.w+x0,z*b.w+x1);
    }
    let count=0,stairs=false;
    for(const cell of cells){if(cell)count++;if(cell===2)stairs=true;}
    if(!count){warnings.push(`${f.name}: nothing structural at the cut, Y ${f.elevation+2}; left out.`);continue;}
    const color=COLORS[((f.index%COLORS.length)+COLORS.length)%COLORS.length];
    const palette=['minecraft:air',o.colorByFloor?`minecraft:${color}_wool`:o.material];
    if(stairs)palette.push('minecraft:gold_block');
    regions.push({name:`Floor_${f.index}`,floor:f,y:o.floor==='all'?f.elevation:0,width,depth,height:o.height,cells,palette,blocks:count*o.scale*o.scale*o.height});
  }
  if(!regions.length)throw new Error('There are no structural outline blocks on the selected floors.');
  const minY=Math.min(...regions.map(r=>r.y)),maxY=Math.max(...regions.map(r=>r.y+r.height));
  return {plan,options:o,regions,width,depth,minY,height:maxY-minY,
    blocks:regions.reduce((n,r)=>n+r.blocks,0),volume:width*depth*o.height*regions.length,warnings};
}
/** The source cut stretched to the chosen scale and repeated up to the chosen height, x fastest, then z, then y. */
function regionCells(r:OutlineRegion,sourceWidth:number,scale:number){
  const cells=new Uint16Array(r.width*r.depth*r.height);
  for(let z=0;z<r.depth;z++)for(let x=0;x<r.width;x++){
    const value=r.cells[Math.floor(z/scale)*sourceWidth+Math.floor(x/scale)];
    if(!value)continue;
    for(let y=0;y<r.height;y++)cells[x+r.width*(z+r.depth*y)]=value;
  }
  return cells;
}
/** The uncompressed NBT, which is also what a reader written from the format can be pointed at. */
export function outlineBytes(result:OutlineResult,when=Date.now()):Uint8Array {
  if(!Number.isSafeInteger(when)||when<0)throw new Error('Invalid creation timestamp.');
  const {plan,options:o}=result;
  const regions=Object.fromEntries(result.regions.map(r=>[r.name,compound({
    Position:xyz(0,r.y,0),Size:xyz(r.width,r.height,r.depth),
    BlockStatePalette:list(TAG.compound,r.palette.map(name=>compound({Name:str(name)}))),
    BlockStates:{t:'longArray',words:packBlockStates(regionCells(r,plan.bounds.w,o.scale),paletteBits(r.palette.length))},
    Entities:list(TAG.compound,[]),TileEntities:list(TAG.compound,[]),PendingBlockTicks:list(TAG.compound,[]),PendingFluidTicks:list(TAG.compound,[]),
  })] as [string,Nbt]));
  return nbtFile(compound({
    MinecraftDataVersion:int(MINECRAFT_DATA_VERSION),Version:int(SCHEMATIC_VERSION),
    Metadata:compound({Author:str('Keepwright'),Name:str(`${plan.name} · outlines`),
      Description:str(`${plan.name}: wall, support, chimney and glass lines cut at each floor + 2. Origin X ${plan.bounds.x}, Z ${plan.bounds.z}. Scale ${o.scale}, marker height ${o.height}. ${o.floor==='all'?'Floor elevations are kept: Y 0 is the ground datum and a cellar is below it.':'This floor starts at Y 0.'}`),
      EnclosingSize:xyz(result.width,result.height,result.depth),RegionCount:int(result.regions.length),
      TimeCreated:millis(when),TimeModified:millis(when),TotalBlocks:int(result.blocks),TotalVolume:int(result.volume)}),
    Regions:compound(regions),
  }));
}
const slug=(name:string)=>name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'keepwright';
/** The file to put in the schematics folder, named after the building and the floors it holds. */
export async function outlineFile(input:unknown,options:Partial<OutlineOptions>={},when=Date.now()){
  const result=buildOutlines(input,options),bytes=await gzip(outlineBytes(result,when));
  return {bytes,result,filename:`${slug(result.plan.name)}-${result.options.floor==='all'?'all-floors':`floor-${result.options.floor}`}-outlines.litematic`};
}
