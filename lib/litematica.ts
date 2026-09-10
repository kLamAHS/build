import { voxelize, type SparseBlocks } from './voxels.ts';
import { type Floor, type Plan } from './model.ts';

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
  text(v:string){const bytes=new TextEncoder().encode(v);this.i16(bytes.length);this.room(bytes.length);this.buffer.set(bytes,this.at);this.at+=bytes.length;}
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

/** One region of blocks: a palette, and an index into it for every cell of a box. */
export type Schematic={name:string;description:string;size:{x:number;y:number;z:number};palette:string[];cells:Uint16Array};
export const cellIndex=(size:Schematic['size'],x:number,y:number,z:number)=>(y*size.z+z)*size.x+x;

/**
 * Litematica's own bit packing: entries of `bits` bits, packed end to end, straddling the boundary between
 * one long and the next. This is not the packing modern Minecraft chunks use, which pads instead.
 */
export function packBlockStates(cells:Uint16Array,bits:number){
  const longs=Math.max(1,Math.ceil(cells.length*bits/64));
  const words=new Uint32Array(longs*2);
  for(let i=0;i<cells.length;i++){
    const value=cells[i];
    if(!value)continue;
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
  const bits=Math.max(2,Math.ceil(Math.log2(Math.max(2,palette.length))));
  let filled=0;
  for(const cell of cells)if(cell)filled++;
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
        BlockStatePalette:{t:'list',of:TAG.compound,v:palette.map(block=>compound({Name:str(block)}))},
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

/**
 * What to build each material out of. Vanilla blocks, and old enough that any client since 1.13 knows them,
 * because a schematic that will not paste is not an export.
 */
export const BLOCKS:Record<number,string>={
  1:'minecraft:stone_bricks',2:'minecraft:oak_planks',3:'minecraft:gray_terracotta',4:'minecraft:glass',
  5:'minecraft:white_terracotta',6:'minecraft:cobblestone',7:'minecraft:grass_block',8:'minecraft:bricks',
  9:'minecraft:oak_log',
};
export const OUTLINE_BLOCKS=['minecraft:air','minecraft:stone_bricks','minecraft:glass','minecraft:oak_planks'];

/**
 * One floor's walls as a single course, to lay out on the ground and build up from. It is read at head
 * height rather than at the floor, because that is the course a doorway is a gap in and a window is glass
 * in: an outline taken at the floor would be a continuous ring telling you nothing about the way in.
 *
 * Three blocks, so the course reads without a legend: stone brick where the wall stands, glass where a light
 * goes, and planks across each threshold — a doorway you can walk through and still see the line of.
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

/** The whole estate, every block of it, for pasting rather than tracing. */
export function wholeBuilding(plan:Plan,grid:SparseBlocks=voxelize(plan)):Schematic {
  const b=plan.bounds,low=plan.minY,size={x:b.w,y:plan.maxY-low+1,z:b.d};
  const used=[...new Set(plan.blocks.filter(k=>k.material).map(k=>k.material))].sort((m,n)=>m-n);
  const palette=['minecraft:air',...used.map(m=>BLOCKS[m]??'minecraft:stone')];
  const slot=new Map(used.map((m,i)=>[m,i+1]));
  const cells=new Uint16Array(size.x*size.y*size.z);
  for(let y=0;y<size.y;y++)for(let z=0;z<size.z;z++)for(let x=0;x<size.x;x++){
    const material=grid.material(b.x+x,low+y,b.z+z);
    if(material)cells[cellIndex(size,x,y,z)]=slot.get(material)??0;
  }
  return {name:plan.name.replace(/[^\w -]/g,''),
    description:`${plan.name}, every block. ${plan.settings.kind} · ${plan.family} · seed ${plan.settings.seed}. Y ${low} is the lowest course.`,
    size,palette,cells};
}
