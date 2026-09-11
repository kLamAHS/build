import { voxelize, type SparseBlocks } from './voxels.ts';
import { type Floor, type Plan } from './model.ts';
import { BASE_BLOCKS, parseBlockState, stateKey } from './block-states.ts';
import { buildDetailedModel, DETAIL_VERSION } from './architectural-detail.ts';
import { auditBuiltModel } from './built-audit.ts';
import { compound, gzip, int, list, millis, MINECRAFT_DATA_VERSION, nbtFile, packBlockStates, paletteBits, SCHEMATIC_VERSION, str, TAG, xyz } from './nbt.ts';

/**
 * Litematica schematics, so a plan can be pasted into the world and built against. The NBT tags, the bit
 * packing, the gzip envelope and the reason this writes schematic version 5 all live in `lib/nbt.ts`, shared
 * with the outline exporter in `lib/litematica-outlines.ts`.
 */

/** One entry of a region's palette: a block and the properties that make it this exact state. */
export type PaletteState={name:string;props?:Record<string,string>};
export const paletteKey=(block:PaletteState)=>stateKey(block.name,block.props??{});
export type Schematic={name:string;description:string;size:{x:number;y:number;z:number};palette:PaletteState[];cells:Uint16Array;origin?:{x:number;y:number;z:number}};
export const cellIndex=(size:Schematic['size'],x:number,y:number,z:number)=>(y*size.z+z)*size.x+x;
export function nbtBytes(schematic:Schematic,when=Date.now()){
  const {size,palette,cells}=schematic;
  if(!Object.values(size).every(n=>Number.isInteger(n)&&n>0)||size.x*size.y*size.z!==cells.length)throw new Error('Schematic dimensions do not match its cells.');
  if(palette[0]?.name!=='minecraft:air'||palette.length>65536||new Set(palette.map(paletteKey)).size!==palette.length)throw new Error('Invalid schematic palette.');
  const bits=paletteBits(palette.length);let filled=0;
  for(const cell of cells){if(cell>=palette.length)throw new Error('A schematic cell references a missing state.');if(cell)filled++;}
  const stateTags=palette.map(block=>{const {name,properties}=parseBlockState(paletteKey(block));return compound({Name:str(name),...(Object.keys(properties).length?{Properties:compound(Object.fromEntries(Object.entries(properties).map(([k,v])=>[k,str(v)])))}:{})});});
  const root=compound({
    MinecraftDataVersion:int(MINECRAFT_DATA_VERSION),Version:int(SCHEMATIC_VERSION),
    Metadata:compound({Author:str('Keepwright'),Description:str(schematic.description),Name:str(schematic.name),EnclosingSize:xyz(size.x,size.y,size.z),RegionCount:int(1),TimeCreated:millis(when),TimeModified:millis(when),TotalBlocks:int(filled),TotalVolume:int(size.x*size.y*size.z)}),
    Regions:compound({[schematic.name]:compound({Position:xyz(0,0,0),Size:xyz(size.x,size.y,size.z),
      BlockStatePalette:list(TAG.compound,stateTags),BlockStates:{t:'longArray',words:packBlockStates(cells,bits)},
      Entities:list(TAG.compound,[]),TileEntities:list(TAG.compound,[]),PendingBlockTicks:list(TAG.compound,[]),PendingFluidTicks:list(TAG.compound,[])})}),
  });
  return nbtFile(root);
}
export const litematicaFile=async(schematic:Schematic,when=Date.now())=>gzip(nbtBytes(schematic,when));
export const BLOCKS=BASE_BLOCKS;
export const OUTLINE_BLOCKS:PaletteState[]=['minecraft:air','minecraft:stone_bricks','minecraft:glass','minecraft:oak_planks'].map(name=>({name}));
/**
 * One floor's walls as a single course, to lay out on the ground and build up from. It is read at head
 * height rather than at the floor, because that is the course a doorway is a gap in and a window is glass
 * in: an outline taken at the floor would be a continuous ring telling you nothing about the way in.
 *
 * Three blocks, so the course reads without a legend: stone brick where the wall stands, glass where a light
 * goes, and planks across each threshold — a doorway you can walk through and still see the line of. This is
 * the structural grid, not the compiled one: an outline to build against wants the mass, not the masonry.
 */
export function floorOutline(plan:Plan,floor:Floor,grid:SparseBlocks=voxelize(plan)):Schematic {
  const b=plan.bounds,size={x:b.w,y:1,z:b.d},at=floor.elevation+2,cells=new Uint16Array(size.x*size.z);
  for(let z=0;z<size.z;z++)for(let x=0;x<size.x;x++){
    const kind=grid.kindAt(b.x+x,at,b.z+z);cells[cellIndex(size,x,0,z)]=kind==='wall'||kind==='chimney'?1:kind==='glass'?2:0;
  }
  for(const o of plan.openings){
    if(o.type==='window'||o.y>at||o.y+o.height<=at)continue;
    for(let w=0;w<o.width;w++){
      const x=o.x+(o.axis==='z'?w:0)-b.x,z=o.z+(o.axis==='x'?w:0)-b.z;
      if(x>=0&&x<size.x&&z>=0&&z<size.z)cells[cellIndex(size,x,0,z)]=3;
    }
  }
  return {name:`${plan.name} ${floor.name}`.replace(/[^\w -]/g,''),description:`${plan.name}: ${floor.name} outline at Y ${floor.elevation}. Stone brick is wall, glass is a window, planks are a doorway. Seed ${plan.settings.seed}.`,size,palette:OUTLINE_BLOCKS,cells};
}
/**
 * The whole estate, every block of it, exactly as the 3D view shows it — which is what makes it worth
 * pasting rather than tracing. The massing comes from the plan and the architecture from
 * `lib/architectural-detail.ts`: one model, meshed for the viewer and written out here, so what you paste is
 * what you looked at. A grid that has already been compiled is written as it stands; a bare structural one
 * is compiled first, so no caller can quietly export the massing model by passing the wrong grid.
 *
 * A schematic that fails the finished-building audit is still written, and says so in its own description.
 * Refusing to write it takes away the one thing the file is for, and a build with an unreachable cellar is
 * still worth pasting and fixing by hand; what matters is that nobody finds out in the world. The studio's
 * walkable score names every failure, and the export says how many. `audited: false` skips the check entirely,
 * for the authored reference and the test fixtures, which are not generator output.
 */
export function wholeBuilding(plan:Plan,grid?:SparseBlocks,{audited=true}:{audited?:boolean}={}):Schematic {
  grid=grid?.detailVersion===DETAIL_VERSION?grid:buildDetailedModel(plan,grid).grid;
  const finalGrid=grid;
  const {bounds:b,minY:low,maxY:high}=finalGrid.extent(plan.minY,plan.maxY),size={x:b.w,y:high-low+1,z:b.d};
  const volume=size.x*size.y*size.z;
  if(!Number.isSafeInteger(volume)||volume>64*1024*1024)throw new Error('This schematic exceeds 64 million cells. Reduce the footprint or storeys before exporting.');
  const failures=audited?auditBuiltModel(plan,finalGrid).issues.filter(i=>i.severity==='error'):[];
  const blockAt=(x:number,y:number,z:number,value:number)=>finalGrid.stateAt(x,y,z)?.key??BLOCKS[value&15]??'minecraft:stone';
  const used=new Set<string>();finalGrid.forEach((x,y,z,value)=>used.add(blockAt(x,y,z,value)));
  const keys=['minecraft:air',...[...used].sort()];if(keys.length>65536)throw new Error('Too many block states for a schematic.');
  const palette:PaletteState[]=keys.map(key=>{const {name,properties}=parseBlockState(key);return {name,...(Object.keys(properties).length?{props:properties}:{})};});
  const slot=new Map(keys.map((state,i)=>[state,i])),cells=new Uint16Array(volume);
  finalGrid.forEach((x,y,z,value)=>{cells[cellIndex(size,x-b.x,y-low,z-b.z)]=slot.get(blockAt(x,y,z,value))!;});
  return {name:plan.name.replace(/[^\w -]/g,''),description:`${plan.name}, every block. ${plan.settings.kind} · ${plan.family} · seed ${plan.settings.seed}. Architecture ${DETAIL_VERSION}. Origin X ${b.x}, Y ${low}, Z ${b.z}.${failures.length?` NOT SOUND: ${failures.length} physical check${failures.length===1?'':'s'} failed, beginning ${failures[0].message}`:''}`,size,palette,cells,origin:{x:b.x,y:low,z:b.z}};
}
