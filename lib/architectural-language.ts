import { componentFootprint, insidePolygon, rectPolygon, type BuildingComponent, type Opening, type Point } from './model.ts';
import { solid, stair, slab, wallPost, timber, lantern, fence, opposite, type BlockState, type Facing } from './block-states.ts';
import type { DetailContext } from './detail-context.ts';

type Piece={x:number;y:number;z:number;state:BlockState;material:number};
const stone=solid('stone_bricks'),ashlar=solid('polished_andesite'),carved=solid('chiseled_stone_bricks');
const dark=solid('polished_blackstone_bricks'),glass=solid('gray_stained_glass');
const SIDES=[{x:0,z:-1,facing:'north'},{x:0,z:1,facing:'south'},{x:-1,z:0,facing:'west'},{x:1,z:0,facing:'east'}] as const;
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
const oct=(x:number,z:number,r:number)=>Math.max(Math.abs(x),Math.abs(z))<=r&&Math.abs(x)+Math.abs(z)<=r+Math.floor(r*.55);
const rim=(x:number,z:number,r:number)=>oct(x,z,r)&&SIDES.some(d=>!oct(x+d.x,z+d.z,r));
const inward=(x:number,z:number):Facing=>Math.abs(x)>Math.abs(z)?(x<0?'east':'west'):(z<0?'south':'north');
/** Each named ornament is drafted before it is placed: a collision rejects the complete upper motif. */
class Draft {
  pieces=new Map<string,Piece>();
  put(x:number,y:number,z:number,state:BlockState=stone,material=1){
    if(![x,y,z].every(Number.isInteger))throw new Error('Architectural details must be on the block grid.');
    this.pieces.set(key(x,y,z),{x,y,z,state,material});
  }
  disc(cx:number,y:number,cz:number,r:number,state=stone,material=1){for(let z=-r;z<=r;z++)for(let x=-r;x<=r;x++)if(oct(x,z,r))this.put(cx+x,y,cz+z,state,material);}
  ring(cx:number,y:number,cz:number,r:number,state=stone,material=1){for(let z=-r;z<=r;z++)for(let x=-r;x<=r;x++)if(rim(x,z,r))this.put(cx+x,y,cz+z,state,material);}
}
function feature(ctx:DetailContext,c:BuildingComponent,kind:string,d:Draft,omitBelow=-Infinity):boolean {
  const pieces=[...d.pieces.values()].filter(p=>!(p.y<omitBelow&&(ctx.protectedAt(p.x,p.y,p.z)||!['air','roof'].includes(ctx.grid.kindAt(p.x,p.y,p.z)))));
  if(!pieces.length||pieces.some(p=>ctx.protectedAt(p.x,p.y,p.z)||!['air','roof'].includes(ctx.grid.kindAt(p.x,p.y,p.z))))return false;
  for(const p of pieces)ctx.put(p.x,p.y,p.z,p.state,p.material,'roof',c,true);
  const xs=pieces.map(p=>p.x),ys=pieces.map(p=>p.y),zs=pieces.map(p=>p.z);
  ctx.features.push({kind,componentId:c.id,blocks:pieces.length,bounds:{x:Math.min(...xs),y:Math.min(...ys),z:Math.min(...zs),w:Math.max(...xs)-Math.min(...xs)+1,h:Math.max(...ys)-Math.min(...ys)+1,d:Math.max(...zs)-Math.min(...zs)+1}});
  return true;
}
function record(ctx:DetailContext,c:BuildingComponent,kind:string,placed:Piece[]){
  if(!placed.length)return;
  let x=Infinity,y=Infinity,z=Infinity,r=-Infinity,t=-Infinity,b=-Infinity;
  for(const p of placed){x=Math.min(x,p.x);y=Math.min(y,p.y);z=Math.min(z,p.z);r=Math.max(r,p.x);t=Math.max(t,p.y);b=Math.max(b,p.z);}
  ctx.features.push({kind,componentId:c.id,blocks:placed.length,bounds:{x,y,z,w:r-x+1,h:t-y+1,d:b-z+1}});
}
/** A flared skirt, octagonal glazed drum, steep second roof and a supported finial, not one giant pyramid. */
export function buildTowerCrown(ctx:DetailContext,c:BuildingComponent){
  const {plan}=ctx,b=c.bounds,castle=plan.settings.kind==='castle';
  const over=c.polygon.length>4?2:(castle?3:2)+(c.phase===0?1:0)+1;
  const left=b.x-over,right=b.x+b.w+over,front=b.z-over,back=b.z+b.d+over;
  const cx=Math.floor((left+right)/2),cz=Math.floor((front+back)/2),r=Math.floor(Math.min(right-left,back-front)/2);
  const important=c.kind==='tower'&&c.topY>=24&&Math.min(b.w,b.d)>=12;
  const lr=important?(Math.min(b.w,b.d)>=18?4:3):0,cut=Math.max(1,Math.floor(r/3));
  const rise=(d:number)=>Math.max(0,d-1)+(important?Math.floor(Math.max(0,d-6)/3):0);
  const d=new Draft();let apex=c.topY;
  for(let z=front;z<=back;z++)for(let x=left;x<=right;x++){
    const dx=Math.min(x-left,right-x),dz=Math.min(z-front,back-z),dist=Math.min(dx,dz,Math.floor((dx+dz-cut)/2));
    if(dist<0)continue;
    if(important&&oct(x-cx,z-cz,lr))continue;
    const y=c.topY+rise(dist),face=inward(x-cx,z-cz),seam=dx===dz;
    d.put(x,y,z,seam?dark:stair('polished_blackstone_brick_stairs',face),3);
    if(dist>0)for(let k=1;k<=Math.max(1,rise(dist)-rise(dist-1));k++)d.put(x,y-k,z,dark,3);
    if(dist===0)d.put(x,y-1,z,slab(castle?'stone_brick_slab':'spruce_slab','top'),castle?1:2);
    if(dist===1)d.put(x,y-1,z,slab('polished_blackstone_brick_slab','top'),3);
    apex=Math.max(apex,y);
  }
  // The primary roof must adapt at a junction. Strict atomicity is for its free-standing ornaments.
  const placed:Piece[]=[];
  for(const p of d.pieces.values())if(ctx.put(p.x,p.y,p.z,p.state,p.material,'roof',c,true))placed.push(p);
  record(ctx,c,'flared-hip-roof',placed);
  if(important){
    const base=c.topY+rise(r-lr-1)+1,drum=c.topY>=36?7:5,cap=new Draft();
    cap.disc(cx,base-1,cz,lr+1,dark,3);cap.disc(cx,base,cz,lr+1,ashlar);
    for(let y=1;y<drum;y++)for(let z=-lr;z<=lr;z++)for(let x=-lr;x<=lr;x++)if(rim(x,z,lr)){
      const pier=(lr>=4&&(x===0||z===0))||(Math.abs(x)===lr&&Math.abs(z)===Math.floor(lr*.55))||(Math.abs(z)===lr&&Math.abs(x)===Math.floor(lr*.55));
      cap.put(cx+x,base+y,cz+z,y===1||y===drum-1?carved:pier?ashlar:glass,pier||y===1||y===drum-1?1:4);
    }
    cap.put(cx,base+drum-1,cz,lantern(true),8);
    cap.disc(cx,base+drum,cz,lr,ashlar);cap.ring(cx,base+drum,cz,lr+1,slab('stone_brick_slab','top'));
    const rr=lr+2,roof=base+drum+1;
    for(let z=-rr;z<=rr;z++)for(let x=-rr;x<=rr;x++){
      if(!oct(x,z,rr))continue;
      const dist=rr-Math.max(Math.abs(x),Math.abs(z)),y=roof+Math.floor(dist*1.5);
      cap.put(cx+x,y,cz+z,Math.abs(x)===Math.abs(z)?dark:stair('polished_blackstone_brick_stairs',inward(x,z)),3);
      if(dist>0)for(let k=1;k<=Math.ceil(dist*1.5)-Math.floor((dist-1)*1.5);k++)cap.put(cx+x,y-k,cz+z,dark,3);
    }
    const top=roof+Math.floor(rr*1.5);
    cap.put(cx,top+1,cz,solid('polished_blackstone'),3);cap.put(cx,top+2,cz,wallPost('polished_blackstone_brick_wall'),3);
    cap.put(cx,top+3,cz,fence('dark_oak_fence'),2);cap.put(cx,top+4,cz,solid('gold_block'),8);
    if(!feature(ctx,c,'lantern-crown',cap)){
      // An adjoining taller range vetoed the drum. Close the skirt's opening rather than leaving a hole.
      for(let z=-lr-1;z<=lr+1;z++)for(let x=-lr-1;x<=lr+1;x++)if(oct(x,z,lr+1))ctx.put(cx+x,base-1,cz+z,dark,3,'roof',c,true);
    }
  }else{
    const cap=new Draft();cap.put(cx,apex+1,cz,dark,3);cap.put(cx,apex+2,cz,wallPost('polished_blackstone_brick_wall'),3);
    cap.put(cx,apex+3,cz,slab('polished_blackstone_brick_slab'),3);feature(ctx,c,'roof-finial',cap);
  }
}
function dormers(ctx:DetailContext,c:BuildingComponent){
  if(c.roof!=='gable-x'&&c.roof!=='gable-z')return;
  const b=c.bounds,ax=c.roof==='gable-x',long=ax?b.w:b.d,short=ax?b.d:b.w;
  if(long<18||short<10||c.kind==='workshop')return;
  const castle=ctx.plan.settings.kind==='castle',shell=(castle?3:2)+(c.phase===0?1:0),over=shell+1;
  const a0=ax?b.x:b.z,c0=ax?b.z:b.x,c1=c0+short;
  const roofY=(q:number)=>c.topY+Math.min(q-c0+over,c1+over-q);
  const point=(a:number,q:number)=>ax?{x:a,z:q}:{x:q,z:a};
  const step=ctx.plan.settings.kind==='house'?14:11,n=Math.max(1,Math.floor((long-10)/step));
  for(const side of [-1,1])for(let i=0;i<n;i++){
    const a=a0+Math.round(long*(i+1)/(n+1)),q=side<0?c0-over+4:c1+over-4,dir=-side,base=roofY(q),d=new Draft();
    const fill=(da:number,dq:number,y:number,s:BlockState,m=1)=>{const p=point(a+da,q+dq*dir);d.put(p.x,y,p.z,s,m);};
    // The cheek walls terminate on the existing roof slope rather than hanging down through the rooms.
    for(let depth=0;depth<=6;depth++)for(let da=-2;da<=2;da++){
      const at=roofY(q+depth*dir);
      if(depth===0||Math.abs(da)===2)for(let y=at;y<=base+4;y++){
        const light=depth===0&&Math.abs(da)<=1&&y>base&&y<base+4;
        fill(da,depth,y,light?glass:Math.abs(da)===2?ashlar:castle?stone:solid('spruce_planks'),light?4:castle?1:2);
      }
      const ry=base+4+2-Math.abs(da),face:Facing=ax?(da<0?'east':'west'):(da<0?'south':'north');
      if(ry-1>=at)fill(da,depth,ry-1,dark,3);
      if(ry>=at)fill(da,depth,ry,stair(depth===0?'stone_brick_stairs':'polished_blackstone_brick_stairs',face),depth===0?1:3);
    }
    for(let da=-3;da<=3;da++)fill(da,-1,base,slab(castle?'stone_brick_slab':'spruce_slab','top'),castle?1:2);
    for(let depth=-1;depth<=4;depth++)fill(0,depth,base+7,slab('polished_blackstone_brick_slab'),3);
    fill(0,-1,base+7,carved);fill(0,-1,base+8,wallPost('stone_brick_wall'));
    feature(ctx,c,'gabled-dormer',d);
  }
}
function gableEnds(ctx:DetailContext,c:BuildingComponent){
  if(c.roof!=='gable-x'&&c.roof!=='gable-z')return;
  const b=c.bounds,ax=c.roof==='gable-x',castle=ctx.plan.settings.kind==='castle',shell=(castle?3:2)+(c.phase===0?1:0);
  const span=ax?b.d:b.w,mid=Math.floor((ax?b.z:b.x)+span/2),crest=c.topY+Math.floor(span/2)+shell+1;
  for(const sign of [-1,1]){
    const edge=ax?(sign<0?b.x:b.x+b.w):(sign<0?b.z:b.z+b.d),front=edge+sign*(shell-1),d=new Draft();
    const at=(cross:number,y:number,s:BlockState,m=1,depth=0)=>ax?d.put(front+sign*depth,y,cross,s,m):d.put(cross,y,front+sign*depth,s,m);
    for(let cross=(ax?b.z:b.x)-shell+1;cross<=(ax?b.z+b.d:b.x+b.w)+shell-1;cross++){
      const height=crest-Math.abs(cross-mid);
      for(let y=c.topY;y<height;y++)at(cross,y,castle?stone:solid('spruce_planks'),castle?1:2);
      at(cross,height,cross<mid?stair(castle?'stone_brick_stairs':'spruce_stairs',ax?'south':'east'):stair(castle?'stone_brick_stairs':'spruce_stairs',ax?'north':'west'),castle?1:2,1);
    }
    const centre=c.topY+Math.floor((crest-c.topY)*.43),radius=span>=16?2:1;
    for(let x=-radius;x<=radius;x++)for(let y=-radius;y<=radius;y++)if(Math.abs(x)+Math.abs(y)<=radius+1)
      at(mid+x,centre+y,Math.abs(x)+Math.abs(y)===radius+1?carved:glass,Math.abs(x)+Math.abs(y)===radius+1?1:4);
    if(radius===2){at(mid,centre,carved);at(mid,centre+1,ashlar);at(mid,centre-1,ashlar);}
    // A short masonry saddle/pinnacle anchors the carved verge at its apex.
    at(mid,crest+1,carved,1,1);at(mid,crest+2,wallPost('stone_brick_wall'),1,1);
    // A junction may obscure half a gable. Keep the visible face, never cut through the adjoining room.
    const placed:Piece[]=[];for(const p of d.pieces.values())if(ctx.put(p.x,p.y,p.z,p.state,p.material,'roof',c,true))placed.push(p);
    record(ctx,c,castle?'traceried-gable':'timbered-gable',placed);
  }
}
function bartizans(ctx:DetailContext,c:BuildingComponent){
  if(ctx.plan.settings.kind!=='castle'||c.roof!=='battlement'||Math.min(c.bounds.w,c.bounds.d)<12)return;
  const b=c.bounds,rad=c.bounds.w>=18?3:2;
  for(const [cx,cz] of [[b.x,b.z],[b.x+b.w,b.z+b.d]]){
    // Never invent a square-corner turret on a chamfered building with no masonry beneath it.
    if(c.polygon.length>4)continue;
    if(ctx.plan.components.some(o=>o.id!==c.id&&o.kind!=='court'&&o.topY>=c.topY-3&&cx+rad+1>o.bounds.x&&cx-rad-1<o.bounds.x+o.bounds.w&&cz+rad+1>o.bounds.z&&cz-rad-1<o.bounds.z+o.bounds.d))continue;
    const d=new Draft(),base=c.topY;
    for(let step=0;step<3;step++)d.disc(cx,base-3+step,cz,Math.min(rad,step+1),step===0?dark:stone,step===0?3:1);
    d.disc(cx,base,cz,rad+1,ashlar);
    for(let y=1;y<=5;y++)for(let z=-rad;z<=rad;z++)for(let x=-rad;x<=rad;x++)if(rim(x,z,rad)){
      const slit=y>=2&&y<=3&&(x===0||z===0);
      d.put(cx+x,base+y,cz+z,slit?glass:y===5?carved:stone,slit?4:1);
    }
    d.disc(cx,base+6,cz,rad+1,dark,3);
    for(let r=rad+1;r>=0;r--){const y=base+7+(rad+1-r)*2;d.ring(cx,y,cz,r,dark,3);if(r<rad+1){d.ring(cx,y-1,cz,r,dark,3);d.ring(cx,y-2,cz,r,dark,3);}}
    const top=base+7+(rad+1)*2;d.put(cx,top+1,cz,wallPost('polished_blackstone_brick_wall'),3);d.put(cx,top+2,cz,solid('gold_block'),8);
    feature(ctx,c,'corbelled-bartizan',d,c.topY);
  }
}
/** Locate the actual exterior, including outward-thickened and stepped-back storeys. */
function outer(ctx:DetailContext,c:BuildingComponent,side:typeof SIDES[number],along:number,y:number):Point|undefined {
  const shell=(ctx.plan.settings.kind==='castle'?3:2)+(c.phase===0?1:0),f=c.kind==='hall'||c.kind==='tower'?c.bounds:componentFootprint(c,Math.floor(y/6)*6,ctx.plan.family);
  const horizontal=side.z!==0,fixed=side.z<0?f.z:side.z>0?f.z+f.d:side.x<0?f.x:f.x+f.w;
  for(let t=shell+1;t>=0;t--){
    const x=horizontal?along:fixed+side.x*t,z=horizontal?fixed+side.z*t:along;
    if(ctx.structure.kindAt(x,y,z)==='wall'&&!ctx.structure.get(x+side.x,y,z+side.z))return {x,z};
  }
}
function facades(ctx:DetailContext,c:BuildingComponent){
  if(c.kind==='court')return;
  const castle=ctx.plan.settings.kind==='castle',decorated=c.kind==='tower'||c.kind==='hall'||c.kind==='chapel'||c.kind==='gatehouse';
  const placed:Piece[]=[],put=(x:number,y:number,z:number,s:BlockState,m=1)=>{if(ctx.put(x,y,z,s,m,'support',c))placed.push({x,y,z,state:s,material:m});};
  if(c.polygon.length===4)for(const side of SIDES){
    const alongX=side.z!==0,from=alongX?c.bounds.x:c.bounds.z,to=from+(alongX?c.bounds.w:c.bounds.d);
    // Bases, capitals and corbel tables are continuous architectural bands; not random all-over texture.
    for(let a=from;a<=to;a++)for(const y of [0,1,c.topY-3,c.topY-2,c.topY-1]){
      const p=outer(ctx,c,side,a,y);if(!p)continue;
      const x=p.x+side.x,z=p.z+side.z;
      if(y===0){put(x,-1,z,dark,3);put(x,0,z,dark,3);}
      else if(y===1&&ctx.grid.get(x,0,z))put(x,y,z,stair('stone_brick_stairs',opposite(side.facing)));
      else if(y===c.topY-3&&(a-from)%3===0)put(x,y,z,stair('stone_brick_stairs',opposite(side.facing),'top'));
      else if(y===c.topY-2)put(x,y,z,slab('polished_blackstone_brick_slab','top'),3);
      else if(y===c.topY-1){put(x,y,z,carved);if(decorated)put(x+side.x,y,z+side.z,slab('stone_brick_slab','top'));}
    }
    // Engaged piers are attached to real wall faces. A doorway interrupts the whole lower segment.
    if(castle&&decorated)for(const a of [from+2,to-2]){
      let base:Point|undefined;
      for(let y=0;y<c.topY-3;y++){
        const p=outer(ctx,c,side,a,y);if(!p)continue;
        const x=p.x+side.x,z=p.z+side.z;if(y===0){put(x,-1,z,stone);base={x,z};}
        if(base&&ctx.grid.get(x,y-1,z))put(x,y,z,y%6===4?carved:y%6===5?slab('stone_brick_slab','top'):stone);
      }
    }
    // Attached lantern brackets high enough to leave the actual approach and door envelope untouched.
    const at=from+Math.floor((to-from)/2),p=outer(ctx,c,side,at,Math.min(7,c.topY-4));
    if(p&&c.topY>=12){const y=Math.min(7,c.topY-4);put(p.x+side.x,y,p.z+side.z,stair('stone_brick_stairs',opposite(side.facing),'top'));put(p.x+side.x,y-1,p.z+side.z,lantern(true),8);}
  }
  // Polygon towers get their own ordered string courses, never a rectangular frame floating outside them.
  if(c.polygon.length>4){
    const cells=new Map<string,Point>();
    for(let i=0;i<c.polygon.length;i++){
      const a=c.polygon[i],b=c.polygon[(i+1)%c.polygon.length],steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.z-a.z));
      for(let j=0;j<steps;j++){const p={x:Math.round(a.x+(b.x-a.x)*j/steps),z:Math.round(a.z+(b.z-a.z)*j/steps)};cells.set(`${p.x},${p.z}`,p);}
    }
    for(const {x,z} of cells.values())for(const y of [0,5,11,17,23,29,c.topY-1])if(y<c.topY)for(const side of SIDES){
      if(insidePolygon(x+side.x+.5,z+side.z+.5,c.polygon)||ctx.structure.get(x+side.x,y,z+side.z))continue;
      put(x+side.x,y,z+side.z,y===0?dark:slab('stone_brick_slab','top'),y===0?3:1);
    }
  }
  record(ctx,c,'layered-facade',placed);
}
function frame(ctx:DetailContext,o:Opening){
  const room=ctx.plan.rooms.find(r=>r.id===o.roomIds[0]),c=ctx.plan.components.find(c=>c.id===room?.componentId);
  if(!c||!room)return;
  const ax=o.axis==='z',out=ax?(room.bounds.z+room.bounds.d/2>o.z?-1:1):(room.bounds.x+room.bounds.w/2>o.x?-1:1);
  const dx=ax?0:out,dz=ax?out:0,facing:Facing=dx<0?'west':dx>0?'east':dz<0?'north':'south';
  const maxDepth=c.polygon.length>4?0:(ctx.plan.settings.kind==='castle'?3:2)+(c.phase===0?1:0)-1;
  let dep=0;while(dep<maxDepth&&['glass','wall'].includes(ctx.structure.kindAt(o.x+dx*(dep+1),o.y,o.z+dz*(dep+1))))dep++;
  // For a door, derive the reveal depth from its jamb rather than the air in its passage.
  if(o.type!=='window'){while(dep<maxDepth&&ctx.structure.kindAt(o.x+(ax?-1:0)+dx*(dep+1),o.y,o.z+(ax?0:-1)+dz*(dep+1))==='wall')dep++;}
  const x=o.x+dx*(dep+1),z=o.z+dz*(dep+1),placed:Piece[]=[];
  if(ctx.plan.components.some(other=>other.id!==c.id&&other.kind!=='court'&&o.y<other.topY&&insidePolygon(x+.5,z+.5,other.polygon)))return;
  const put=(a:number,y:number,s:BlockState,m=1,proud=0)=>{const xx=x+(ax?a:0)+dx*proud,zz=z+(ax?0:a)+dz*proud;if(ctx.put(xx,y,zz,s,m,'support',c))placed.push({x:xx,y,z:zz,state:s,material:m});};
  for(const a of [-1,o.width])for(let y=o.y;y<o.y+o.height;y++)put(a,y,y===o.y?carved:wallPost('stone_brick_wall'));
  // Pointed hood rises outside the opening, so all of the original aperture remains usable.
  for(let a=-2;a<=o.width+1;a++){
    const rise=Math.max(0,Math.min(a+2,o.width+1-a)),y=Math.min(c.topY-1,o.y+o.height+Math.floor(rise/2));
    put(a,y,stair('stone_brick_stairs',opposite(facing),'top'));
  }
  if(o.type!=='window'&&o.width>=3){
    const middle=Math.floor((o.width-1)/2),top=o.y+o.height+2;
    put(middle,top,carved);put(middle,top+1,solid('red_wool'));put(middle,top+2,solid('gold_block'));
    for(const a of [-2,o.width+1]){put(a,o.y+o.height-1,stair('stone_brick_stairs',opposite(facing),'top'));put(a,o.y+o.height-1,stair('stone_brick_stairs',opposite(facing),'top'),1,1);put(a,o.y+o.height-2,lantern(true),8,1);}
  }
  record(ctx,c,o.type==='window'?'hooded-window':'carved-portal',placed);
}
function heraldry(ctx:DetailContext,c:BuildingComponent){
  if(ctx.plan.settings.kind!=='castle'||c.kind!=='tower'||c.topY<24||c.polygon.length>4)return;
  const side=SIDES[1],y=c.topY-12;
  for(let a=c.bounds.x+4;a<c.bounds.x+c.bounds.w-3;a++){
    const p=outer(ctx,c,side,a,y+2);if(!p)continue;
    const z=p.z+1,pieces:Piece[]=[];
    for(let dy=0;dy<5;dy++)for(let da=-1;da<=1;da++){
      if(dy===0&&da!==0)continue;
      pieces.push({x:a+da,y:y+dy,z,state:solid(da===0&&dy>=2?'gold_block':'red_wool'),material:9});
    }
    // Every part of the cloth must fit in a genuinely blind bay, never over a window.
    if(pieces.some(b=>ctx.protectedAt(b.x,b.y,b.z)||ctx.grid.get(b.x,b.y,b.z)))continue;
    const barY=y+5;
    for(let da=-2;da<=2;da++){
      const x=a+da;
      if(ctx.structure.get(x,barY,z)||ctx.protectedAt(x,barY,z))continue;
      ctx.grid.apply({x,y:barY,z,w:1,h:1,d:1,material:2,kind:'support',componentId:c.id});
      ctx.grid.setState(x,barY,z,timber('x'));
    }
    for(const b of pieces)ctx.put(b.x,b.y,b.z,b.state,b.material,'support',c);
    record(ctx,c,'heraldic-hanging',pieces);break;
  }
}
function gatehouses(ctx:DetailContext){
  for(const court of ctx.plan.courts){
    const b=court.gatehouse,top=court.wallHeight+3;
    const c:BuildingComponent={id:court.id,name:court.name+' gatehouse',kind:'gatehouse',bounds:b,polygon:rectPolygon(b),baseY:0,storeys:2,topY:top,roof:'gable-x',phase:1};
    const d=new Draft(),middle=court.gate.x;
    // Central gate arch: two recessed orders and a keystone, with no closed portcullis in the route.
    for(const z of [b.z-1,b.z+b.d+1]){
      for(const side of [-1,1])for(let y=0;y<=6;y++){
        d.put(middle+side*4,y,z,y===0?dark:carved,y===0?3:1);
        if(y<5)d.put(middle+side*5,y,z,stone);
      }
      for(let x=-4;x<=4;x++)d.put(middle+x,7+Math.floor((4-Math.abs(x))/2),z,Math.abs(x)<2?carved:stair('stone_brick_stairs',x<0?'east':'west','top'));
      d.put(middle,10,z,solid('red_wool'),9);d.put(middle,11,z,solid('gold_block'),8);
    }
    // Lower carving is allowed to meet the existing masonry, but never to fill the passage guard.
    const placed:Piece[]=[];for(const p of d.pieces.values())if(ctx.put(p.x,p.y,p.z,p.state,p.material,'support',c))placed.push(p);record(ctx,c,'gate-arch',placed);
    const roof=new Draft();
    for(let z=b.z-1;z<=b.z+b.d+1;z++)for(let x=b.x-1;x<=b.x+b.w+1;x++){
      const y=top+Math.min(z-b.z+1,b.z+b.d+1-z);
      roof.put(x,y,z,stair(x===b.x-1||x===b.x+b.w+1?'stone_brick_stairs':'polished_blackstone_brick_stairs',z<b.z+b.d/2?'south':'north'),x===b.x-1||x===b.x+b.w+1?1:3);
    }
    const rp:Piece[]=[];for(const p of roof.pieces.values())if(ctx.put(p.x,p.y,p.z,p.state,p.material,'roof',c,true))rp.push(p);record(ctx,c,'gatehouse-roof',rp);
    // Coped curtains with a legible dark belt. The shared gate and its wall walk are left intact.
    const wall=court.bounds,h=court.wallHeight;
    for(let x=wall.x;x<=wall.x+wall.w;x++)for(const z of [wall.z,wall.z+wall.d]){
      if(ctx.grid.kindAt(x,h-1,z)==='wall')ctx.grid.setState(x,h-1,z,dark);
      if(ctx.grid.kindAt(x,h+1,z)==='wall')ctx.put(x,h+2,z,slab('stone_brick_slab'),1,'support',c);
    }
    for(let z=wall.z;z<=wall.z+wall.d;z++)for(const x of [wall.x,wall.x+wall.w]){
      if(ctx.grid.kindAt(x,h-1,z)==='wall')ctx.grid.setState(x,h-1,z,dark);
      if(ctx.grid.kindAt(x,h+1,z)==='wall')ctx.put(x,h+2,z,slab('stone_brick_slab'),1,'support',c);
    }
  }
}
/** The second pass works at three scales: roof composition, façade bays, then authored details. */
export function enrichArchitecture(ctx:DetailContext):void {
  for(const c of ctx.plan.components){
    if(c.kind==='court')continue;
    gableEnds(ctx,c);dormers(ctx,c);bartizans(ctx,c);facades(ctx,c);heraldry(ctx,c);
  }
  for(const o of ctx.plan.openings)frame(ctx,o);
  gatehouses(ctx);
  // Courtyard flags have a deliberate border/grid, not a field of random blocks.
  ctx.grid.forEach((x,y,z,value)=>{
    if(ctx.grid.stateAt(x,y,z))return;
    const kind=ctx.grid.kindAt(x,y,z),m=value&15;
    if(kind==='glass')ctx.grid.setState(x,y,z,glass);
    else if(kind==='ground'&&m===6)ctx.grid.setState(x,y,z,solid(x%8===0||z%8===0?'polished_andesite':'andesite'));
    else if(kind==='wall'&&m===5)ctx.grid.setState(x,y,z,solid('smooth_sandstone'));
    else if(kind==='floor'&&m===2)ctx.grid.setState(x,y,z,solid('spruce_planks'));
    else if(kind==='chimney')ctx.grid.setState(x,y,z,solid('bricks'));
  });
}
