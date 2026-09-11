/**
 * The file half of a .litematic — big-endian NBT in a gzip envelope — shared by the two exporters:
 * `lib/litematica.ts` writes the finished building, `lib/litematica-outlines.ts` writes the wall lines to
 * build against. Nothing here is a general NBT library: it writes the tags this one format needs and no
 * others, because a general library would be more code than the format is.
 *
 * Schematic version 5 rather than the current 6: the two differ only in how entities and tile entities carry
 * their positions, neither exporter has any, and every Litematica since Minecraft 1.13 reads 5 where the
 * older ones refuse 6. The data version is likewise deliberately behind — Minecraft upgrades a schematic
 * that is older than the client and refuses one that is newer, so being behind is the safe direction to be
 * wrong in. Every state either exporter can write exists in Java 1.16.5, which is what that data version
 * claims: a block name the client does not know is pasted as air, and an export you cannot paste is not one.
 */
export const SCHEMATIC_VERSION=5,MINECRAFT_DATA_VERSION=2586;
export const TAG={byte:1,short:2,int:3,long:4,string:8,list:9,compound:10,longArray:12} as const;
export type Nbt=
  |{t:'byte';v:number}|{t:'short';v:number}|{t:'int';v:number}|{t:'long';hi:number;lo:number}
  |{t:'string';v:string}|{t:'longArray';words:Uint32Array}|{t:'list';of:number;v:Nbt[]}|{t:'compound';v:Record<string,Nbt>};
export const int=(v:number):Nbt=>({t:'int',v});
export const str=(v:string):Nbt=>({t:'string',v});
export const compound=(v:Record<string,Nbt>):Nbt=>({t:'compound',v});
export const list=(of:number,v:Nbt[]):Nbt=>({t:'list',of,v});
export const xyz=(x:number,y:number,z:number):Nbt=>compound({x:int(x),y:int(y),z:int(z)});
export const millis=(ms:number):Nbt=>({t:'long',hi:Math.floor(ms/4294967296),lo:ms>>>0});
class Writer {
  private buffer=new Uint8Array(4096);private at=0;
  private room(n:number){if(this.at+n<=this.buffer.length)return;let size=this.buffer.length;while(size<this.at+n)size*=2;const next=new Uint8Array(size);next.set(this.buffer.subarray(0,this.at));this.buffer=next;}
  u8(v:number){this.room(1);this.buffer[this.at++]=v&0xff;}
  i16(v:number){this.room(2);this.buffer[this.at++]=(v>>8)&0xff;this.buffer[this.at++]=v&0xff;}
  i32(v:number){this.room(4);for(let shift=24;shift>=0;shift-=8)this.buffer[this.at++]=(v>>>shift)&0xff;}
  /** Java's modified UTF-8, which is what reads these back: NUL is two bytes and an astral character is two
   * three-byte halves. Plain UTF-8 would put a four-byte sequence in front of a reader that refuses one. */
  text(v:string){
    const bytes:number[]=[];
    for(let i=0;i<v.length;i++){
      const c=v.charCodeAt(i);
      if(c>0&&c<0x80)bytes.push(c);
      else if(c<0x800)bytes.push(0xc0|(c>>6),0x80|(c&0x3f));
      else bytes.push(0xe0|(c>>12),0x80|((c>>6)&0x3f),0x80|(c&0x3f));
    }
    if(bytes.length>65535)throw new Error('An NBT string exceeds 65,535 bytes.');
    this.i16(bytes.length);this.room(bytes.length);this.buffer.set(bytes,this.at);this.at+=bytes.length;
  }
  bytes(){return this.buffer.slice(0,this.at);}
}
function payload(w:Writer,tag:Nbt):void {
  switch(tag.t){
    case 'byte':w.u8(tag.v);break;case 'short':w.i16(tag.v);break;case 'int':w.i32(tag.v);break;
    case 'long':w.i32(tag.hi);w.i32(tag.lo);break;case 'string':w.text(tag.v);break;
    case 'longArray':w.i32(tag.words.length/2);for(const word of tag.words)w.i32(word|0);break;
    case 'list':w.u8(tag.v.length?tag.of:0);w.i32(tag.v.length);for(const item of tag.v)payload(w,item);break;
    case 'compound':for(const [name,value] of Object.entries(tag.v)){w.u8(TAG[value.t]);w.text(name);payload(w,value);}w.u8(0);break;
  }
}
/** The unnamed root compound every .litematic is, and the bytes that go into the gzip envelope. */
export function nbtFile(root:Nbt){const w=new Writer();w.u8(TAG.compound);w.text('');payload(w,root);return w.bytes();}
/**
 * Litematica's own bit packing: entries of `bits` bits, packed end to end, straddling the boundary between
 * one long and the next. This is not the packing modern Minecraft chunks use, which pads instead. The longs
 * are held as pairs of 32-bit words, high then low, because packing millions of entries through BigInt costs
 * more than the rest of the export put together.
 */
export function packBlockStates(cells:Uint16Array,bits:number){
  if(!Number.isInteger(bits)||bits<2||bits>16)throw new Error('Block states require 2–16 bits per cell.');
  const longs=Math.max(1,Math.ceil(cells.length*bits/64)),words=new Uint32Array(longs*2);
  for(let i=0;i<cells.length;i++){
    const value=cells[i];if(!value)continue;
    if(value>=2**bits)throw new Error('A block state does not fit its palette.');
    const start=i*bits;
    for(let k=0;k<bits;k++){
      if(!((value>>>k)&1))continue;const bit=start+k,long=bit>>6,offset=bit&63;
      if(offset<32)words[long*2+1]|=1<<offset;else words[long*2]|=1<<(offset-32);
    }
  }
  return words;
}
/** The number of bits a palette of this many states is packed at: two is the format's floor. */
export const paletteBits=(states:number)=>Math.max(2,Math.ceil(Math.log2(Math.max(2,states))));
/** A gzip member whose deflate blocks are all stored, for anything without CompressionStream. */
export function storedGzip(bytes:Uint8Array){
  const blocks=Math.max(1,Math.ceil(bytes.length/65535)),out=new Uint8Array(18+5*blocks+bytes.length);
  out.set([31,139,8,0,0,0,0,0,0,255]);
  let at=10;
  for(let i=0;i<blocks;i++){
    const start=i*65535,length=Math.min(65535,bytes.length-start);
    out[at++]=i===blocks-1?1:0;
    out[at++]=length&0xff;out[at++]=length>>8;out[at++]=~length&0xff;out[at++]=(~length>>8)&0xff;
    out.set(bytes.subarray(start,start+length),at);at+=length;
  }
  const table=new Uint32Array(256);
  for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c>>>1)^(c&1?0xedb88320:0);table[i]=c;}
  let crc=0xffffffff;
  for(const byte of bytes)crc=(crc>>>8)^table[(crc^byte)&0xff];
  const view=new DataView(out.buffer);view.setUint32(at,(crc^0xffffffff)>>>0,true);view.setUint32(at+4,bytes.length>>>0,true);
  return out;
}
/** Litematica reads the file gzipped. Every current engine compresses it; the rest still get a valid file. */
export async function gzip(bytes:Uint8Array):Promise<Uint8Array> {
  if(typeof CompressionStream==='undefined')return storedGzip(bytes);
  try {
    const stream=new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {return storedGzip(bytes);}
}
