import { voxelize, type SparseBlocks } from './voxels.ts';
import { type Floor, type Plan } from './model.ts';
import { BASE_BLOCKS, parseBlockState } from './block-states.ts';
import { buildDetailedModel, DETAIL_VERSION } from './architectural-detail.ts';

/**
 * Litematica schematics, so a plan can be pasted into the world and built against.
 *
 * The file is gzipped big-endian NBT. Nothing here is generic: it writes the tags this one format needs and
 * no others, because a general NBT library would be more code than the format is.
 *
 * Schematic version 5 rather than the current 6: the two differ only in how entities and tile entities carry
 * their positions, this writer has neither, and every Litematica since Minecraft 1.13 reads 5 where the older
 * ones refuse 6. The data version is likewise deliberately behind — Minecraft upgrades a schematic that is
 * older than the client and refuses one that is newer, so being behind is the safe direction to be wrong in.
 * Every state the architectural compiler can write exists in Java 1.16.5, which is what that data version
 * claims: a block name the client does not know is pasted as air, and an export you cannot paste is not one.
 */
const SCHEMATIC_VERSION=5,MINECRAFT_DATA_VERSION=2586;

const TAG={byte:1,short:2,int:3,long:4,string:8,list:9,compound:10,longArray:12} as const;
type Nbt=
  |{t:'byte';v:number}|{t:'short';v:number}|{t:'int';v:number}|{t:'long';hi:number;lo:number}
  |{t:'string';v:string}
  |{t:'longArray';words:Uint32Array}
  |{t:'list';of:number;v:Nbt[]}
  |{t:'compound';v:Record<string,Nbt>};
const int=(v:number):Nbt=>({t:'int',v});
const str=(v:string):Nbt=>({t:'string',v});
const compound=(v:Record<string,Nbt>):Nbt=>({t:'compound',v});
const xyz=(x:number,y:number,z:number):Nbt=>compound({x:int(x),y:int(y),z:int(z)});
/** A millisecond timestamp as a signed 64-bit tag, in two 32-bit halves: the project targets ES2017. */
const millis=(ms:number):Nbt=>({t:'long',hi:Math.floor(ms/4294967296),lo:ms>>>0});

class Writer {
  private buffer=new Uint8Array(4096);
  private at=0;
  private room(n:number){
    if(this.at+n<=this.buffer.length)return;
    let size=this.buffer.length;while(size<this.at+n)size*=2;
    const next=new Uint8Array(size);next.set(this.buffer.subarray(0,this.at));this.buffer=next;
  }
  u8(v:number){this.room(1);this.buffer[this.at++]=v&0xff;}
  i16(v:number){this.room(2);this.buffer[this.at++]=(v>>8)&0xff;this.buffer[this.at++]=v&0xff;}
  i32(v:number){this.room(4);for(let shift=24;shift>=0;shift-=8)this.buffer[this.at++]=(v>>>shift)&0xff;}
  text(v:string){const bytes=new TextEncoder().encode(v);if(bytes.length>65535)throw new Error('An NBT string exceeds 65,535 bytes.');this.i16(bytes.length);this.room(bytes.length);this.buffer.set(bytes,this.at);this.at+=bytes.length;}
  bytes(){return this.buffer.slice(0,this.at);}
}

function payload(w:Writer,tag:Nbt):void {
  switch(tag.t){
    case 'byte':w.u8(tag.v);break;
    case 'short':w.i16(tag.v);break;
    case 'int':w.i32(tag.v);break;
    case 'long':w.i32(tag.hi);w.i32(tag.lo);break;
    case 'string':w.text(tag.v);break;
    // A long array is held as pairs of 32-bit words, high then low, because packing millions of entries
    // through BigInt costs more than the rest of the export put together.
    case 'longArray':w.i32(tag.words.length/2);for(const word of tag.words)w.i32(word|0);break;
    case 'list':w.u8(tag.v.length?tag.of:0);w.i32(tag.v.length);for(const item of tag.v)payload(w,item);break;
    case 'compound':
      for(const [name,value] of Object.entries(tag.v)){w.u8(TAG[value.t]);w.text(name);payload(w,value);}
      w.u8(0);break;
  }
}

/**
 * One region of blocks: a palette of canonical block states, and an index into it for every cell of a box.
 * A state is written the way the compiler and the mesher already hold it — `minecraft:oak_stairs[facing=north,…]`
 * — and split back into Name and Properties on the way out, so one string is the whole truth about a cell.
 */
export type Schematic={name:string;description:string;size:{x:number;y:number;z:number};palette:string[];cells:Uint16Array;origin?:{x:number;y:number;z:number}};
export const cellIndex=(size:Schematic['size'],x:number,y:number,z:number)=>(y*size.z+z)*size.x+x;

/**
 * Litematica's own bit packing: entries of `bits` bits, packed end to end, straddling the boundary between
 * one long and the next. This is not the packing modern Minecraft chunks use, which pads instead.
 */
export function packBlockStates(cells:Uint16Array,bits:number){
  if(!Number.isInteger(bits)||bits<2||bits>16)throw new Error('Block states require 2–16 bits per cell.');
  const longs=Math.max(1,Math.ceil(cells.length*bits/64));
  const words=new Uint32Array(longs*2);
  for(let i=0;i<cells.length;i++){
    const value=cells[i];
    if(!value)continue;
    if(value>=2**bits)throw new Error('A block state does not fit its palette.');
    const start=i*bits;
    for(let k=0;k<bits;k++){
      if(!((value>>>k)&1))continue;
      const bit=start+k,long=bit>>6,offset=bit&63;
      if(offset<32)words[long*2+1]|=1<<offset;else words[long*2]|=1<<(offset-32);
    }
  }
  return words;
}

export function nbtBytes(schematic:Schematic,when=Date.now()){
  const {size,palette,cells}=schematic;
  // A schematic that disagrees with itself pastes as rubble rather than failing, so it fails here instead.
  if(!Object.values(size).every(n=>Number.isInteger(n)&&n>0)||size.x*size.y*size.z!==cells.length)throw new Error('Schematic dimensions do not match its cells.');
  if(palette[0]!=='minecraft:air'||palette.length>65536||new Set(palette).size!==palette.length)throw new Error('Invalid schematic palette.');
  const bits=Math.max(2,Math.ceil(Math.log2(Math.max(2,palette.length))));
  let filled=0;
  for(const cell of cells){if(cell>=palette.length)throw new Error('A schematic cell references a missing state.');if(cell)filled++;}
  const stateTags=palette.map(key=>{
    const {name,properties}=parseBlockState(key);
    return compound({Name:str(name),...(Object.keys(properties).length?{Properties:compound(Object.fromEntries(Object.entries(properties).map(([k,v])=>[k,str(v)])))}:{})});
  });
  const root=compound({
    MinecraftDataVersion:int(MINECRAFT_DATA_VERSION),
    Version:int(SCHEMATIC_VERSION),
    Metadata:compound({
      Author:str('Keepwright'),
      Description:str(schematic.description),
      Name:str(schematic.name),
      EnclosingSize:xyz(size.x,size.y,size.z),
      RegionCount:int(1),
      TimeCreated:millis(when),
      TimeModified:millis(when),
      TotalBlocks:int(filled),
      TotalVolume:int(size.x*size.y*size.z),
    }),
    Regions:compound({
      [schematic.name]:compound({
        Position:xyz(0,0,0),
        Size:xyz(size.x,size.y,size.z),
        BlockStatePalette:{t:'list',of:TAG.compound,v:stateTags},
        BlockStates:{t:'longArray',words:packBlockStates(cells,bits)},
        Entities:{t:'list',of:TAG.compound,v:[]},
        TileEntities:{t:'list',of:TAG.compound,v:[]},
        PendingBlockTicks:{t:'list',of:TAG.compound,v:[]},
        PendingFluidTicks:{t:'list',of:TAG.compound,v:[]},
      }),
    }),
  });
  const w=new Writer();
  w.u8(TAG.compound);w.text('');payload(w,root);
  return w.bytes();
}

/** The file itself: gzipped, which is what Litematica expects and not something it sniffs for. */
export async function litematicaFile(schematic:Schematic,when=Date.now()):Promise<Uint8Array> {
  const bytes=nbtBytes(schematic,when);
  const stream=new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** What a bare material is built out of, for cells the architectural compiler left undressed. */
export const BLOCKS=BASE_BLOCKS;
export const OUTLINE_BLOCKS=['minecraft:air','minecraft:stone_bricks','minecraft:glass','minecraft:oak_planks'];

/**
 * One floor's walls as a single course, to lay out on the ground and build up from. It is read at head
 * height rather than at the floor, because that is the course a doorway is a gap in and a window is glass
 * in: an outline taken at the floor would be a continuous ring telling you nothing about the way in.
 *
 * Three blocks, so the course reads without a legend: stone brick where the wall stands, glass where a light
 * goes, and planks across each threshold — a doorway you can walk through and still see the line of. This is
 * the structural grid, not the dressed one: an outline to build against wants the mass, not the masonry.
 */
export function floorOutline(plan:Plan,floor:Floor,grid:SparseBlocks=voxelize(plan)):Schematic {
  const b=plan.bounds,size={x:b.w,y:1,z:b.d},at=floor.elevation+2;
  const cells=new Uint16Array(size.x*size.z);
  for(let z=0;z<size.z;z++)for(let x=0;x<size.x;x++){
    const kind=grid.kindAt(b.x+x,at,b.z+z);
    cells[cellIndex(size,x,0,z)]=kind==='wall'||kind==='chimney'?1:kind==='glass'?2:0;
  }
  for(const o of plan.openings){
    if(o.type==='window'||o.y>at||o.y+o.height<=at)continue;
    for(let w=0;w<o.width;w++){
      const x=o.x+(o.axis==='z'?w:0)-b.x,z=o.z+(o.axis==='x'?w:0)-b.z;
      if(x>=0&&x<size.x&&z>=0&&z<size.z)cells[cellIndex(size,x,0,z)]=3;
    }
  }
  return {name:`${plan.name} ${floor.name}`.replace(/[^\w -]/g,''),
    description:`${plan.name}: ${floor.name} outline at Y ${floor.elevation}. Stone brick is wall, glass is a window, planks are a doorway. Seed ${plan.settings.seed}.`,
    size,palette:OUTLINE_BLOCKS,cells};
}

/**
 * The whole estate, every block of it, exactly as the 3D view shows it — which is what makes it worth
 * pasting rather than tracing. The massing comes from the plan and the architecture from
 * `lib/architectural-detail.ts`: one model, meshed for the viewer and written out here, so what you paste
 * is what you looked at. Passing a raw grid instead exports the structure undressed.
 */
export function wholeBuilding(plan:Plan,grid:SparseBlocks=buildDetailedModel(plan).grid):Schematic {
  const {bounds:b,minY:low,maxY:high}=grid.extent(plan.minY,plan.maxY),size={x:b.w,y:high-low+1,z:b.d};
  const volume=size.x*size.y*size.z;
  if(!Number.isSafeInteger(volume)||volume>64*1024*1024)throw new Error('This schematic exceeds 64 million cells. Reduce the footprint or storeys before exporting.');
  const blockAt=(x:number,y:number,z:number,value:number)=>grid.stateAt(x,y,z)?.key??BLOCKS[value&15]??'minecraft:stone';
  const used=new Set<string>();grid.forEach((x,y,z,value)=>used.add(blockAt(x,y,z,value)));
  const palette=['minecraft:air',...[...used].sort()];
  if(palette.length>65536)throw new Error('Too many block states for a schematic.');
  const slot=new Map(palette.map((state,i)=>[state,i])),cells=new Uint16Array(volume);
  grid.forEach((x,y,z,value)=>{cells[cellIndex(size,x-b.x,y-low,z-b.z)]=slot.get(blockAt(x,y,z,value))!;});
  return {name:plan.name.replace(/[^\w -]/g,''),
    description:`${plan.name}, every block. ${plan.settings.kind} · ${plan.family} · seed ${plan.settings.seed}. Architecture ${DETAIL_VERSION}. Origin X ${b.x}, Y ${low}, Z ${b.z}.`,
    size,palette,cells,origin:{x:b.x,y:low,z:b.z}};
}
