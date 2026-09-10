import { MATERIALS, type BlockBox, type BlockKind, type Plan } from './model.ts';
import type { BlockState } from './block-states.ts';
import type { BuiltAudit } from './built-audit.ts';

export const CHUNK_SIZE=16;
const KINDS:BlockKind[]=['air','wall','floor','roof','stair','support','furniture','ground','glass','chimney'];
export type LayerRun={x:number;z:number;length:number;material:number;kind:BlockKind};
export type BlockLayer={y:number;runs:LayerRun[];counts:Record<number,number>;bounds:Plan['bounds']};
export type MeshData={key:string;material:number;color?:string;emissive?:string;roof:boolean;floor:number;positions:Float32Array;normals:Float32Array;indices:Uint32Array};
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
const index=(x:number,y:number,z:number)=>x+16*(z+16*y);

/** Sparse material/role cells, with exact Minecraft states only where the architectural compiler needs them. */
export class SparseBlocks {
  chunks=new Map<string,Uint16Array>();
  states=new Map<string,BlockState>();
  detailVersion?:number;
  /** Bumped by every write, so the built audit can tell a cached verdict from a stale one. */
  revision=0;
  buildAudit?:BuiltAudit;
  auditedRevision?:number;
  auditKey?:string;
  bounds:Plan['bounds'];
  // One-entry chunk cache. Reading a cell is the innermost operation of meshing, lighting and the walking
  // audit, and a neighbourhood scan asks about the same chunk sixteen times; building its key each time is
  // most of the cost. Any write, or a new chunk, drops the cache.
  private nearX=NaN;private nearY=NaN;private nearZ=NaN;private nearAt=-1;private nearSize=-1;private near?:Uint16Array;
  constructor(bounds:Plan['bounds']) {this.bounds={...bounds};}
  private chunkAt(cx:number,cy:number,cz:number){
    if(cx!==this.nearX||cy!==this.nearY||cz!==this.nearZ||this.nearAt!==this.revision||this.nearSize!==this.chunks.size){
      this.nearX=cx;this.nearY=cy;this.nearZ=cz;this.nearAt=this.revision;this.nearSize=this.chunks.size;this.near=this.chunks.get(key(cx,cy,cz));
    }
    return this.near;
  }
  get(x:number,y:number,z:number){const cx=Math.floor(x/16),cy=Math.floor(y/16),cz=Math.floor(z/16);return this.chunkAt(cx,cy,cz)?.[index(x-cx*16,y-cy*16,z-cz*16)]||0;}
  material(x:number,y:number,z:number){return this.get(x,y,z)&15;}
  kindAt(x:number,y:number,z:number):BlockKind{const v=this.get(x,y,z);return v?KINDS[(v>>4)&15]:'air';}
  stateAt(x:number,y:number,z:number){return this.states.get(key(x,y,z));}
  setState(x:number,y:number,z:number,state:BlockState){
    if(!this.get(x,y,z))throw new Error('A block state must belong to an occupied cell.');
    this.revision++;this.states.set(key(x,y,z),state);
  }
  apply(b:BlockBox){
    this.revision++;
    const value=b.material?((b.kind==='roof'?((b.ownerFloor??Math.floor(b.y/6))+8)<<8:0)|(KINDS.indexOf(b.kind)<<4)|b.material):0;
    // An overwrite, including air, must never leave an obsolete stair/slab behind.
    if(this.states.size)for(let y=b.y;y<b.y+b.h;y++)for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)this.states.delete(key(x,y,z));
    for(let cy=Math.floor(b.y/16);cy<=Math.floor((b.y+b.h-1)/16);cy++)for(let cz=Math.floor(b.z/16);cz<=Math.floor((b.z+b.d-1)/16);cz++)for(let cx=Math.floor(b.x/16);cx<=Math.floor((b.x+b.w-1)/16);cx++){
      const k=key(cx,cy,cz);let chunk=this.chunks.get(k);if(!chunk){if(!value)continue;chunk=new Uint16Array(4096);this.chunks.set(k,chunk);}
      const x0=Math.max(b.x-cx*16,0),x1=Math.min(b.x+b.w-cx*16,16),y0=Math.max(b.y-cy*16,0),y1=Math.min(b.y+b.h-cy*16,16),z0=Math.max(b.z-cz*16,0),z1=Math.min(b.z+b.d-cz*16,16);
      for(let y=y0;y<y1;y++)for(let z=z0;z<z1;z++)chunk.fill(value,index(x0,y,z),index(x1,y,z));
    }
  }
  forEach(visit:(x:number,y:number,z:number,value:number)=>void){
    for(const [k,chunk] of this.chunks){
      const [cx,cy,cz]=k.split(',').map(Number);
      for(let i=0;i<chunk.length;i++)if(chunk[i])visit(cx*16+i%16,cy*16+Math.floor(i/256),cz*16+Math.floor(i/16)%16,chunk[i]);
    }
  }
  /** Preserve the plan's margin, but never truncate a new cornice or roof finial in export. */
  extent(minY:number,maxY:number){
    let x=this.bounds.x,z=this.bounds.z,right=x+this.bounds.w,back=z+this.bounds.d;
    this.forEach((xx,yy,zz)=>{x=Math.min(x,xx);z=Math.min(z,zz);right=Math.max(right,xx+1);back=Math.max(back,zz+1);minY=Math.min(minY,yy);maxY=Math.max(maxY,yy);});
    return {bounds:{x,z,w:right-x,d:back-z},minY,maxY};
  }
  layer(y:number):BlockLayer {
    const runs:LayerRun[]=[],counts:Record<number,number>={};const {x,z,w,d}=this.bounds;
    for(let zz=z;zz<z+d;zz++){
      let start=x,value=0;
      for(let xx=x;xx<=x+w;xx++){
        const next=xx===x+w?0:this.get(xx,y,zz);
        if(next!==value){if(value){const material=value&15;runs.push({x:start,z:zz,length:xx-start,material,kind:KINDS[(value>>4)&15]});counts[material]=(counts[material]||0)+xx-start;}start=xx;value=next;}
      }
    }
    return {y,runs,counts,bounds:this.bounds};
  }
  stats(){let blocks=0;for(const chunk of this.chunks.values())for(const v of chunk)if(v)blocks++;return {blocks,chunks:this.chunks.size,bytes:this.chunks.size*8192};}
}
/** Structural voxelization stays unchanged: audits and floor outlines do not depend on facade decoration. */
export function voxelize(plan:Plan){const grid=new SparseBlocks(plan.bounds),components=new Map(plan.components.map(c=>[c.id,c]));for(const box of plan.blocks){const component=components.get(box.componentId);grid.apply(box.kind==='roof'?{...box,ownerFloor:component?Math.floor(component.topY/6)-1:Math.floor(box.y/6)}:box);}return grid;}

type Acc={material:number;color?:string;emissive?:string;roof:boolean;floor:number;p:number[];n:number[];i:number[]};
const roofOf=(value:number)=>((value>>4)&15)===3;
const floorOf=(value:number,y:number)=>roofOf(value)?(value>>8)-8:Math.floor(y/6);
// Keep both sides of interfaces that are separated by roof hiding or floor explosion.
const samePart=(a:number,ay:number,b:number,by:number)=>roofOf(a)===roofOf(b)&&floorOf(a,ay)===floorOf(b,by);
function quad(g:Acc,start:number[],axis:number,sign:number,width:number,height:number){
  const u=(axis+1)%3,v=(axis+2)%3,normal=[0,0,0];normal[axis]=sign;
  const a=[...start],b=[...start],c=[...start],d=[...start];b[u]+=width;c[u]+=width;c[v]+=height;d[v]+=height;
  const offset=g.p.length/3;for(const vert of [a,b,c,d]){g.p.push(...vert);g.n.push(...normal);}
  if(sign>0)g.i.push(offset,offset+1,offset+2,offset,offset+2,offset+3);else g.i.push(offset,offset+2,offset+1,offset,offset+3,offset+2);
}
function rectangles(mask:Int32Array,size:number,emit:(i:number,j:number,w:number,h:number,id:number)=>void){
  for(let j=0;j<size;j++)for(let i=0;i<size;){
    const value=mask[i+j*size];if(!value){i++;continue;}let width=1,height=1;
    while(i+width<size&&mask[i+width+j*size]===value)width++;
    outer:while(j+height<size){for(let k=0;k<width;k++)if(mask[i+k+(j+height)*size]!==value)break outer;height++;}
    for(let yy=0;yy<height;yy++)mask.fill(0,i+(j+yy)*size,i+width+(j+yy)*size);
    emit(i,j,width,height,value);i+=width;
  }
}
/** Greedy full-block faces plus exact quarter-block stair/slab/post faces. Export uses these same states. */
export function prepareMeshes(grid:SparseBlocks):MeshData[]{
  const groups=new Map<string,Acc>(),ids=new Map<string,number>(),byId:Acc[]=[];
  // The face pass asks about the same cell up to twelve times, and a keyed lookup for each of those costs
  // more than the greedy pass it serves. Bucket the sidecar by chunk once and remember the last chunk.
  const shaped=new Map<string,(BlockState|undefined)[]>();
  for(const [at,state] of grid.states){
    const [x,y,z]=at.split(',').map(Number),cx=Math.floor(x/16),cy=Math.floor(y/16),cz=Math.floor(z/16),k=key(cx,cy,cz);
    let cells=shaped.get(k);if(!cells){cells=Array.from<BlockState|undefined>({length:4096});shaped.set(k,cells);}
    cells[index(x-cx*16,y-cy*16,z-cz*16)]=state;
  }
  let nearX=NaN,nearY=NaN,nearZ=NaN,nearCells:(BlockState|undefined)[]|undefined;
  const stateAt=(x:number,y:number,z:number)=>{
    const cx=Math.floor(x/16),cy=Math.floor(y/16),cz=Math.floor(z/16);
    if(cx!==nearX||cy!==nearY||cz!==nearZ){nearX=cx;nearY=cy;nearZ=cz;nearCells=shaped.get(key(cx,cy,cz));}
    return nearCells?.[index(x-cx*16,y-cy*16,z-cz*16)];
  };
  const group=(value:number,y:number,state?:BlockState)=>{
    const material=value&15,roof=roofOf(value),floor=floorOf(value,y),k=`${material}/${+roof}/${floor}/${state?.color??''}/${state?.emissive??''}`;
    let id=ids.get(k);if(id===undefined){id=byId.length+1;ids.set(k,id);const g:Acc={material,roof,floor,...(state?{color:state.color,emissive:state.emissive}:{}),p:[],n:[],i:[]};groups.set(k,g);byId.push(g);}return id;
  };
  const mask=new Int32Array(256),coords=[0,0,0];
  for(const [chunkKey,chunk] of grid.chunks){
    const origin=chunkKey.split(',').map(n=>Number(n)*16);
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const u=(axis+1)%3,v=(axis+2)%3;
      for(let plane=0;plane<16;plane++){
        mask.fill(0);
        for(let j=0;j<16;j++)for(let i=0;i<16;i++){
          coords[axis]=plane;coords[u]=i;coords[v]=j;
          const value=chunk[index(coords[0],coords[1],coords[2])];if(!value)continue;
          const x=origin[0]+coords[0],y=origin[1]+coords[1],z=origin[2]+coords[2],state=stateAt(x,y,z);
          if(state?.occupancy)continue;
          const nx=x+(axis===0?sign:0),ny=y+(axis===1?sign:0),nz=z+(axis===2?sign:0),other=grid.get(nx,ny,nz);
          if(other&&samePart(value,y,other,ny)){
            const neighbor=stateAt(nx,ny,nz),shape=neighbor?.occupancy;if(!shape)continue;
            const n=neighbor?.resolution??4,interfaceMask=new Int32Array(n*n);
            const g=byId[group(value,y,state)-1];
            for(let jj=0;jj<n;jj++)for(let ii=0;ii<n;ii++){
              const c=[0,0,0];c[axis]=sign>0?0:n-1;c[u]=ii;c[v]=jj;
              if(!shape[c[0]+n*(c[2]+n*c[1])])interfaceMask[ii+jj*n]=1;
            }
            rectangles(interfaceMask,n,(ii,jj,w,h)=>{const start=[x,y,z];start[axis]+=sign>0?1:0;start[u]+=ii/n;start[v]+=jj/n;quad(g,start,axis,sign,w/n,h/n);});
            continue;
          }
          mask[i+j*16]=group(value,y,state);
        }
        rectangles(mask,16,(i,j,w,h,id)=>{const start=[...origin];start[axis]+=plane+(sign>0?1:0);start[u]+=i;start[v]+=j;quad(byId[id-1],start,axis,sign,w,h);});
      }
    }
  }
  // Resolve each shaped block at its own precision, promoted at mixed-resolution seams.
  // Only the six face neighbours are ever consulted, and each is asked about up to 256 times: read each one
  // once per block, into buffers that are reused rather than reallocated for every stair and slab.
  const masks=new Map<number,Int32Array>(),cursor=[0,0,0];
  // A chain is two sixteenths of a block in a sixteenth-block grid: all but a few of its four thousand
  // sub-cells are empty. Walk each shape's own occupied span rather than the whole cube it sits in.
  const spans=new Map<string,number[]>();
  const spanOf=(state:BlockState)=>{
    let span=spans.get(state.key);
    if(!span){
      const n=state.resolution??4,cells=state.occupancy!,lo=[n,n,n],hi=[-1,-1,-1];
      for(let y=0;y<n;y++)for(let z=0;z<n;z++)for(let x=0;x<n;x++)if(cells[x+n*(z+n*y)]){
        const at=[x,y,z];for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],at[a]);hi[a]=Math.max(hi[a],at[a]);}
      }
      span=[...lo,...hi];spans.set(state.key,span);
    }
    return span;
  };
  const nearValue=new Int32Array(6),nearStamp=new Int32Array(6).fill(-1),nearState:(BlockState|undefined)[]=[];
  let stamp=0;
  for(const [k,state] of grid.states){
    if(!state.occupancy)continue;
    const origin=k.split(',').map(Number),value=grid.get(origin[0],origin[1],origin[2]);if(!value)continue;
    const own=state.resolution??4;
    stamp++;
    const slotOf=(bx:number,by:number,bz:number)=>bx<0?0:bx>0?1:by<0?2:by>0?3:bz<0?4:5;
    const readNear=(bx:number,by:number,bz:number)=>{
      const slot=slotOf(bx,by,bz);
      if(nearStamp[slot]!==stamp){
        const nx=origin[0]+bx,ny=origin[1]+by,nz=origin[2]+bz;
        nearStamp[slot]=stamp;nearValue[slot]=grid.get(nx,ny,nz);nearState[slot]=stateAt(nx,ny,nz);
      }
      return slot;
    };
    const g=byId[group(value,origin[1],state)-1],shape=state.occupancy,span=spanOf(state);
    if(span[3]<0)continue;
    // Sub-block occupancy is asked millions of times per estate, so nothing in here allocates.
    const occupiedAt=(n:number,x:number,y:number,z:number)=>{
      if(x>=0&&x<n&&y>=0&&y<n&&z>=0&&z<n)
        return !!shape[Math.floor(x*own/n)+own*(Math.floor(z*own/n)+own*Math.floor(y*own/n))];
      const bx=Math.floor(x/n),by=Math.floor(y/n),bz=Math.floor(z/n),slot=readNear(bx,by,bz);
      if(!nearValue[slot]||!samePart(value,origin[1],nearValue[slot],origin[1]+by))return false;
      const other=nearState[slot]?.occupancy,ns=nearState[slot]?.resolution??4;
      return !other||!!other[Math.floor((x-bx*n)*ns/n)+ns*(Math.floor((z-bz*n)*ns/n)+ns*Math.floor((y-by*n)*ns/n))];
    };
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      // Only the face that meets a finer neighbour is resolved on the finer neighbour's grid; the other five
      // stay on this block's own. Promoting all six would cost a chain's neighbours sixty-four times over.
      cursor[0]=cursor[1]=cursor[2]=0;cursor[axis]=sign;
      const n=Math.max(own,nearState[readNear(cursor[0],cursor[1],cursor[2])]?.resolution??4);
      let smallMask=masks.get(n);if(!smallMask){smallMask=new Int32Array(n*n);masks.set(n,smallMask);}
      const u=(axis+1)%3,v=(axis+2)%3,scale=n/own;
      const from=(a:number)=>Math.floor(span[a]*scale),to=(a:number)=>Math.floor((span[a+3]+1)*scale)-1;
      for(let plane=from(axis);plane<=to(axis);plane++){
        smallMask.fill(0);let hits=0;
        for(let j=from(v);j<=to(v);j++)for(let i=from(u);i<=to(u);i++){
          cursor[axis]=plane;cursor[u]=i;cursor[v]=j;
          if(!occupiedAt(n,cursor[0],cursor[1],cursor[2]))continue;cursor[axis]+=sign;
          if(!occupiedAt(n,cursor[0],cursor[1],cursor[2])){smallMask[i+j*n]=1;hits++;}
        }
        if(hits)rectangles(smallMask,n,(i,j,w,h)=>{const start=[...origin];start[axis]+=(plane+(sign>0?1:0))/n;start[u]+=i/n;start[v]+=j/n;quad(g,start,axis,sign,w/n,h/n);});
      }
    }
  }
  return [...groups].filter(([,g])=>g.i.length).map(([key,g])=>({key,material:g.material,...(g.color?{color:g.color}:{}),...(g.emissive?{emissive:g.emissive}:{}),roof:g.roof,floor:g.floor,positions:new Float32Array(g.p),normals:new Float32Array(g.n),indices:new Uint32Array(g.i)}));
}
export function layerSvg(layer:BlockLayer,previous?:BlockLayer){
  const {bounds:b,y}=layer,legend=Object.entries(layer.counts).map(([id,count])=>`${MATERIALS[+id].name}: ${count}`).join(' · ');
  const rows=(data:BlockLayer,ghost=false)=>data.runs.map(r=>`<rect x="${r.x}" y="${r.z}" width="${r.length}" height="1" fill="${MATERIALS[r.material].color}"${ghost?' opacity=".2"':''}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2000" viewBox="${b.x} ${b.z-8} ${b.w} ${b.d+16}"><defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#5d655e" stroke-width=".06"/></pattern></defs><rect x="${b.x}" y="${b.z-8}" width="${b.w}" height="${b.d+16}" fill="#f4f0e4"/><g font-family="sans-serif" fill="#344d3c"><text x="${b.x+2}" y="${b.z-3}" font-size="2.5">KEEPWRIGHT · Block layer Y=${y} · X ${b.x}…${b.x+b.w-1} / Z ${b.z}…${b.z+b.d-1}</text>${previous?rows(previous,true):''}${rows(layer)}<rect x="${b.x}" y="${b.z}" width="${b.w}" height="${b.d}" fill="url(#grid)"/><text x="${b.x+2}" y="${b.z+b.d+5}" font-size="1.6">${legend}</text></g></svg>`;
}
