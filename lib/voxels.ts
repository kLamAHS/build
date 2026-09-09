import { MATERIALS, type BlockBox, type BlockKind, type Plan } from './model.ts';

export const CHUNK_SIZE=16;
const KINDS:BlockKind[]=['air','wall','floor','roof','stair','support','furniture','ground','glass','chimney'];
export type LayerRun={x:number;z:number;length:number;material:number;kind:BlockKind};
export type BlockLayer={y:number;runs:LayerRun[];counts:Record<number,number>;bounds:Plan['bounds']};
export type MeshData={key:string;material:number;roof:boolean;floor:number;positions:Float32Array;normals:Float32Array;indices:Uint32Array};
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
const index=(x:number,y:number,z:number)=>x+16*(z+16*y);

/** Only occupied chunks are allocated. The same cells feed layers and exposed faces. */
export class SparseBlocks {
  chunks=new Map<string,Uint16Array>();
  bounds:Plan['bounds'];
  constructor(bounds:Plan['bounds']) {this.bounds=bounds;}
  get(x:number,y:number,z:number){const cx=Math.floor(x/16),cy=Math.floor(y/16),cz=Math.floor(z/16);return this.chunks.get(key(cx,cy,cz))?.[index(x-cx*16,y-cy*16,z-cz*16)]||0;}
  material(x:number,y:number,z:number){return this.get(x,y,z)&15;}
  apply(b:BlockBox){
    const value=b.material?((b.kind==='roof'?((b.ownerFloor??Math.floor(b.y/6))+8)<<8:0)|(KINDS.indexOf(b.kind)<<4)|b.material):0;
    for(let cy=Math.floor(b.y/16);cy<=Math.floor((b.y+b.h-1)/16);cy++)for(let cz=Math.floor(b.z/16);cz<=Math.floor((b.z+b.d-1)/16);cz++)for(let cx=Math.floor(b.x/16);cx<=Math.floor((b.x+b.w-1)/16);cx++){
      const k=key(cx,cy,cz);let chunk=this.chunks.get(k);if(!chunk){if(!value)continue;chunk=new Uint16Array(4096);this.chunks.set(k,chunk);}
      const x0=Math.max(b.x-cx*16,0),x1=Math.min(b.x+b.w-cx*16,16),y0=Math.max(b.y-cy*16,0),y1=Math.min(b.y+b.h-cy*16,16),z0=Math.max(b.z-cz*16,0),z1=Math.min(b.z+b.d-cz*16,16);
      for(let y=y0;y<y1;y++)for(let z=z0;z<z1;z++)chunk.fill(value,index(x0,y,z),index(x1,y,z));
    }
  }
  layer(y:number):BlockLayer {
    const runs:LayerRun[]=[],counts:Record<number,number>={};
    const {x,z,w,d}=this.bounds;
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
export function voxelize(plan:Plan){const grid=new SparseBlocks(plan.bounds);for(const box of plan.blocks){const component=plan.components.find(c=>c.id===box.componentId);grid.apply(box.kind==='roof'?{...box,ownerFloor:component?Math.floor(component.topY/6)-1:Math.floor(box.y/6)}:box);}return grid;}

/** Greedy rectangles on exposed chunk faces. Material, roof and elevation boundaries
 * remain separate so cutaways and exploded floors share the exact block geometry. */
export function prepareMeshes(grid:SparseBlocks):MeshData[]{
  type Acc={material:number;roof:boolean;floor:number;p:number[];n:number[];i:number[]};
  const groups=new Map<string,Acc>();
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
          const x=origin[0]+coords[0],y=origin[1]+coords[1],z=origin[2]+coords[2];
          const other=grid.get(x+(axis===0?sign:0),y+(axis===1?sign:0),z+(axis===2?sign:0));
          // Keep interfaces against roof cells: hiding the roof must not erase wall tops.
          if(other&& !(((other>>4)&15)===3&&((value>>4)&15)!==3))continue;
          const roof=((value>>4)&15)===3?1:0,floor=roof?(value>>8):Math.floor(y/6)+8;
          mask[i+j*16]=(value&15)|(roof<<4)|(floor<<5);
        }
        for(let j=0;j<16;j++)for(let i=0;i<16;){
          const value=mask[i+j*16];if(!value){i++;continue;}
          let width=1,height=1;
          while(i+width<16&&mask[i+width+j*16]===value)width++;
          outer:while(j+height<16){for(let k=0;k<width;k++)if(mask[i+k+(j+height)*16]!==value)break outer;height++;}
          for(let yy=0;yy<height;yy++)mask.fill(0,i+(j+yy)*16,i+width+(j+yy)*16);
          const material=value&15,roof=!!(value&16),floor=(value>>5)-8;
          const k=`${material}/${+roof}/${floor}`;
          let g=groups.get(k);if(!g){g={material,roof,floor,p:[],n:[],i:[]};groups.set(k,g);}
          const start=[...origin];start[axis]+=plane+(sign>0?1:0);start[u]+=i;start[v]+=j;
          const normal=[0,0,0];normal[axis]=sign;
          const a=[...start],b=[...start],c=[...start],d=[...start];b[u]+=width;c[u]+=width;c[v]+=height;d[v]+=height;
          const offset=g.p.length/3;
          for(const vert of [a,b,c,d]){g.p.push(...vert);g.n.push(...normal);}
          if(sign>0)g.i.push(offset,offset+1,offset+2,offset,offset+2,offset+3);else g.i.push(offset,offset+2,offset+1,offset,offset+3,offset+2);
          i+=width;
        }
      }
    }
  }
  return [...groups].map(([key,g])=>({key,material:g.material,roof:g.roof,floor:g.floor,positions:new Float32Array(g.p),normals:new Float32Array(g.n),indices:new Uint32Array(g.i)}));
}
export function layerSvg(layer:BlockLayer,previous?:BlockLayer){
  const {bounds:b,y}=layer,legend=Object.entries(layer.counts).map(([id,count])=>`${MATERIALS[+id].name}: ${count}`).join(' · ');
  const rows=(data:BlockLayer,ghost=false)=>data.runs.map(r=>`<rect x="${r.x}" y="${r.z}" width="${r.length}" height="1" fill="${MATERIALS[r.material].color}"${ghost?' opacity=".2"':''}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2000" viewBox="${b.x} ${b.z-8} ${b.w} ${b.d+16}"><defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#5d655e" stroke-width=".06"/></pattern></defs><rect x="${b.x}" y="${b.z-8}" width="${b.w}" height="${b.d+16}" fill="#f4f0e4"/><g font-family="sans-serif" fill="#344d3c"><text x="${b.x+2}" y="${b.z-3}" font-size="2.5">KEEPWRIGHT · Block layer Y=${y} · X ${b.x}…${b.x+b.w-1} / Z ${b.z}…${b.z+b.d-1}</text>${previous?rows(previous,true):''}${rows(layer)}<rect x="${b.x}" y="${b.z}" width="${b.w}" height="${b.d}" fill="url(#grid)"/><text x="${b.x+2}" y="${b.z+b.d+5}" font-size="1.6">${legend}</text></g></svg>`;
}
