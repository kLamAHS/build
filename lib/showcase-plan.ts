import { SparseBlocks } from './voxels.ts';
import { rectPolygon, insidePolygon, componentFootprint, type Plan, type BuildingComponent, type BlockBox, type Rect, type Room, type Opening, type Stair, type Furniture, type Point } from './model.ts';

/**
 * An authored reference composition for inspecting the architectural compiler at castle scale.
 * It is deliberately NOT passed off as output from architecture.ts's candidate search.
 * All walls, storeys, doors and stair cuts are real Plan geometry, not a render-only shell.
 */
export function crownwardPlan():Plan {
  const definitions:[string,BuildingComponent['kind'],number,number,number,number,number,BuildingComponent['roof'],boolean?][]=[
    ['Crown Keep','tower',-1,-3,20,20,42,'pyramid'],
    ['West Solar','tower',-26,-3,14,14,30,'battlement'],
    ['Astronomer Tower','tower',27,-4,12,14,36,'pyramid'],
    ['Great Hall','hall',-9,17,36,18,18,'gable-x'],
    ['West Apartments','domestic',-26,11,17,37,18,'gable-z'],
    ['Chapel of the Crown','chapel',27,10,16,31,24,'gable-z'],
    ['Kitchen Range','service',-26,48,17,12,12,'gable-x'],
    ['East Guest Range','lodging',27,45,20,12,18,'gable-x'],
    ['Gate Watch','tower',-13,61,12,12,24,'battlement'],
    ['Gate Spire','tower',25,60,12,12,30,'pyramid'],
    ['West Curtain Tower','tower',-44,57,10,12,12,'battlement',true],
    ['East Curtain Tower','tower',54,55,10,12,18,'battlement',true],
  ];
  const components:BuildingComponent[]=definitions.map(([name,kind,x,z,w,d,topY,roof,octagon],i)=>{
    const b={x,z,w,d},t=3;
    return{id:`ref-${i}`,name,kind,bounds:b,polygon:octagon?[{x:x+t,z},{x:x+w-t,z},{x:x+w,z:z+t},{x:x+w,z:z+d-t},{x:x+w-t,z:z+d},{x:x+t,z:z+d},{x,z:z+d-t},{x,z:z+t}]:rectPolygon(b),baseY:0,storeys:topY/6,topY,roof,phase:1};
  });
  const blocks:BlockBox[]=[],rooms:Room[]=[],openings:Opening[]=[],stairs:Stair[]=[],connections:[string,string][]=[];
  const box=(r:Rect,y:number,h:number,material:number,kind:BlockBox['kind'],id='site')=>{if(r.w>0&&r.d>0&&h>0)blocks.push({...r,y,h,material,kind,componentId:id});};
  const line=(poly:Point[],y:number,h:number,m:number,kind:BlockBox['kind'],id:string)=>{
    for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],steps=Math.max(Math.abs(a.x-b.x),Math.abs(a.z-b.z));for(let j=0;j<=steps;j++)box({x:Math.round(a.x+(b.x-a.x)*j/Math.max(1,steps)),z:Math.round(a.z+(b.z-a.z)*j/Math.max(1,steps)),w:1,d:1},y,h,m,kind,id);}
  };
  const fill=(poly:Point[],y:number,h:number,m:number,kind:BlockBox['kind'],id:string)=>{
    const minX=Math.min(...poly.map(p=>p.x)),maxX=Math.max(...poly.map(p=>p.x)),minZ=Math.min(...poly.map(p=>p.z)),maxZ=Math.max(...poly.map(p=>p.z));
    for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++)if(insidePolygon(x+.5,z+.5,poly))box({x,z,w:1,d:1},y,h,m,kind,id);
  };
  // Terraced, chamfered retaining podium. The approach stair descends to the lowest course.
  for(let y=-6;y<-1;y++){
    const inset=y<=-5?0:y<=-3?1:2,x=-49+inset,z=-21+inset,w=118-inset*2,d=105-inset*2,t=8;
    fill([{x:x+t,z},{x:x+w-t,z},{x:x+w,z:z+t},{x:x+w,z:z+d-t},{x:x+w-t,z:z+d},{x:x+t,z:z+d},{x,z:z+d-t},{x,z:z+t}],y,1,y===-2?6:1,'ground','site');
  }
  box({x:-43,z:-15,w:107,d:84},-1,1,6,'ground');
  for(let j=0;j<5;j++)box({x:5-j,z:81+j,w:11+j*2,d:1},-6,5-j,1,'stair');
  for(const c of components){
    const b=c.bounds;
    fill(c.polygon,-1,1,1,'support',c.id);
    const levels=c.kind==='hall'?[0]:Array.from({length:c.storeys},(_,i)=>i*6);
    for(const y of levels){
      const r=c.kind==='hall'||c.kind==='tower'?b:componentFootprint(c,y,'tower-cluster'),poly=c.polygon.length>4?c.polygon:rectPolygon(r),ceiling=c.kind==='hall'?c.topY:y+6;
      fill(poly,y,1,2,'floor',c.id);line(poly,y,ceiling-y,1,'wall',c.id);
      if(poly.length===4)for(let t=1;t<3;t++){
        box({x:r.x,z:r.z-t,w:r.w+1,d:1},y,ceiling-y,1,'wall',c.id);box({x:r.x,z:r.z+r.d+t,w:r.w+1,d:1},y,ceiling-y,1,'wall',c.id);
        box({x:r.x-t,z:r.z,w:1,d:r.d+1},y,ceiling-y,1,'wall',c.id);box({x:r.x+r.w+t,z:r.z,w:1,d:r.d+1},y,ceiling-y,1,'wall',c.id);
      }
      const kind:Room['kind']=c.kind==='hall'?'hall':c.kind==='chapel'?'sacred':c.kind==='service'?'service':y===0?'circulation':'bedroom';
      const room:Room={id:`${c.id}-f${y/6}`,name:`${c.name} ${y?`level ${y/6+1}`:'ground'}`,kind,componentId:c.id,bounds:r,polygon:poly,holes:[],floorY:y,ceilingY:ceiling,area:(r.w-1)*(r.d-1),description:'Crownward reference composition',furniture:[]};
      rooms.push(room);
      if(y)connections.push([`${c.id}-f${y/6-1}`,room.id]);else connections.push(['reference-court',room.id]);
      const furniture=(x:number,z:number,w:number,d:number,h:number,type:Furniture['type'])=>room.furniture.push({x,z,w,d,y:y+1,h,type,material:9});
      if(c.kind==='hall'){
        for(const z of [r.z+5,r.z+11]){furniture(r.x+8,z,12,2,2,'table');furniture(r.x+8,z-2,12,1,1,'bench');furniture(r.x+8,z+3,12,1,1,'bench');}
        furniture(r.x+r.w-6,r.z+6,3,5,2,'hearth');
      }else if(c.kind==='chapel'){furniture(r.x+6,r.z+r.d-7,5,3,2,'altar');for(let z=r.z+6;z<r.z+r.d-7;z+=4)furniture(r.x+10,z,3,1,1,'bench');}
      else if(y){furniture(r.x+r.w-5,r.z+3,3,3,1,'bed');furniture(r.x+r.w-3,r.z+r.d-5,2,3,3,'shelf');}
      else if(c.kind==='service'){furniture(r.x+r.w-5,r.z+3,3,3,2,'oven');furniture(r.x+r.w-5,r.z+r.d-5,3,2,2,'crate');}
      // Storey-aligned apertures; shared walls are not treated as exterior window walls.
      for(const side of ['n','s','w','e'] as const){
        const ax=side==='n'||side==='s',length=ax?r.w:r.d,from=ax?r.x:r.z;
        for(let a=from+4;a<from+length-2;a+=7){
          const x=ax?a:side==='w'?r.x:r.x+r.w,z=ax?(side==='n'?r.z:r.z+r.d):a,ox=side==='w'?-1:side==='e'?1:0,oz=side==='n'?-1:side==='s'?1:0;
          if(components.some(o=>o.id!==c.id&&o.topY>y+2&&insidePolygon(x+ox*2+.5,z+oz*2+.5,o.polygon)))continue;
          const width=c.kind==='hall'||c.kind==='chapel'?3:2,height=c.kind==='hall'?5:3;
          openings.push({id:`rw${openings.length}`,type:'window',axis:ax?'z':'x',x,z,y:y+2,width,height,roomIds:[room.id]});
          if(c.kind==='hall')openings.push({id:`rw${openings.length}`,type:'window',axis:ax?'z':'x',x,z,y:y+10,width,height:4,roomIds:[room.id]});
        }
      }
      if(y+6<c.topY&&c.kind!=='hall')stairs.push({id:`rs${stairs.length}`,componentId:c.id,roomIds:[room.id,`${c.id}-f${y/6+1}`],bounds:{x:r.x+1,z:r.z+1,w:8,d:10},fromY:y,toY:y+6,width:2,headroom:3,landings:[{x:r.x+4,z:r.z+10,w:2,d:2}]});
    }
    const doorX=b.x+Math.floor(b.w/2)-1;
    openings.push({id:`rd${openings.length}`,type:c.kind==='hall'?'entrance':'door',axis:'z',x:doorX,z:b.z+b.d,y:1,width:3,height:4,roomIds:[`${c.id}-f0`,'reference-court'],outward:{x:0,z:1}});
    if(c.roof==='gable-x'||c.roof==='gable-z'){
      const ax=c.roof==='gable-x',span=ax?b.d:b.w;
      for(let i=-1;i<=span+1;i++){const rise=Math.min(i+1,span+1-i);box(ax?{x:b.x-1,z:b.z+i,w:b.w+3,d:1}:{x:b.x+i,z:b.z-1,w:1,d:b.d+3},c.topY+rise,1,3,'roof',c.id);
        if(rise>0)for(const end of [0,ax?b.w:b.d])box(ax?{x:b.x+end,z:b.z+i,w:1,d:1}:{x:b.x+i,z:b.z+end,w:1,d:1},c.topY,rise,1,'roof',c.id);}
    }else if(c.roof==='pyramid'){
      for(let i=0;i<=Math.ceil(Math.min(b.w,b.d)/2);i++){const r={x:b.x-1+i,z:b.z-1+i,w:b.w+2-2*i,d:b.d+2-2*i};if(r.w>=0&&r.d>=0)line(rectPolygon(r),c.topY+i,1,3,'roof',c.id);}
    }else{
      fill(c.polygon,c.topY,1,1,'roof',c.id);line(c.polygon,c.topY+1,2,1,'roof',c.id);
      for(let x=b.x;x<=b.x+b.w;x+=3)for(const z of [b.z,b.z+b.d])box({x,z,w:2,d:1},c.topY+3,1,1,'roof',c.id);
      for(let z=b.z;z<=b.z+b.d;z+=3)for(const x of [b.x,b.x+b.w])box({x,z,w:1,d:2},c.topY+3,1,1,'roof',c.id);
    }
  }
  // Reassert walls after adjacent roof shells, then cut the actual apertures through their full depth.
  const shellGrid=new SparseBlocks({x:-52,z:-24,w:126,d:118});for(const b of blocks)shellGrid.apply(b);
  for(const o of openings){
    const ax=o.axis==='z',r={x:o.x-(ax?0:3),z:o.z-(ax?3:0),w:ax?o.width:7,d:ax?7:o.width};
    const id=rooms.find(r=>r.id===o.roomIds[0])!.componentId;
    if(o.type==='window'){for(let y=o.y;y<o.y+o.height;y++)for(let z=r.z;z<r.z+r.d;z++)for(let x=r.x;x<r.x+r.w;x++)if(shellGrid.kindAt(x,y,z)==='wall')box({x,z,w:1,d:1},y,1,4,'glass',id);}
    else box(r,o.y,o.height,0,'air',id);
  }
  for(const st of stairs){
    const b=st.bounds;box({x:b.x+3,z:b.z+3,w:2,d:6},st.toY,1,0,'air',st.componentId);
    for(let j=0;j<6;j++){box({x:b.x+5,z:b.z+3+j,w:1,d:1},st.fromY+1,j+1,2,'support',st.componentId);box({x:b.x+3,z:b.z+3+j,w:2,d:1},st.fromY+j+1,1,2,'stair',st.componentId);box({x:b.x+3,z:b.z+3+j,w:2,d:1},st.fromY+j+2,3,0,'air',st.componentId);}
  }
  for(const r of rooms)for(const f of r.furniture)box(f,f.y,f.h,f.material,'furniture',r.componentId);
  const yard={x:-8,z:36,w:34,d:24},courtRoom:Room={id:'reference-court',name:'Inner court',kind:'court',componentId:'court',bounds:yard,polygon:rectPolygon(yard),holes:[],floorY:0,ceilingY:80,area:816,description:'Open inner court',furniture:[]};rooms.push(courtRoom);
  const court={id:'outer-ward',name:'Crownward ward',bounds:{x:-44,z:-16,w:108,d:84},gate:{x:11,z:68},wallHeight:6,thickness:2,gatehouse:{x:0,z:63,w:22,d:12},well:{x:20,z:44},yards:[{name:'Herb garden',bounds:{x:-38,z:23,w:8,d:20},kind:'garden' as const}]};
  for(let t=0;t<2;t++)line(rectPolygon({x:court.bounds.x+t,z:court.bounds.z+t,w:court.bounds.w-2*t,d:court.bounds.d-2*t}),0,7,1,'wall',court.id);
  for(let x=-44;x<=64;x+=3)for(const z of [-16,68])box({x,z,w:2,d:1},7,1,1,'wall',court.id);
  for(let z=-16;z<=68;z+=3)for(const x of [-44,64])box({x,z,w:1,d:2},7,1,1,'wall',court.id);
  for(let t=1;t<=2;t++)line(rectPolygon({x:-44+t,z:-16+t,w:108-2*t,d:84-2*t}),6,1,1,'floor',court.id);
  line(rectPolygon(court.gatehouse),0,9,1,'wall',court.id);box(court.gatehouse,9,1,3,'roof',court.id);
  box({x:9,z:60,w:5,d:19},0,6,0,'air',court.id);box({x:8,z:35,w:7,d:47},-1,1,6,'ground');
  // Well, formal beds and outer retaining piers are structural site objects, not painted into the preview.
  line(rectPolygon({x:18,z:42,w:4,d:4}),0,2,1,'wall','site');box({x:19,z:43,w:2,d:2},-2,2,0,'air');
  for(const z of [25,32,39]){box({x:-39,z,w:8,d:4},-1,1,7,'ground');line(rectPolygon({x:-39,z,w:8,d:4}),0,1,1,'support','site');}
  for(let z=-13;z<64;z+=10)for(const x of [-45,64]){box({x,z,w:2,d:2},-6,10,1,'support');box({x:x-1,z:z-1,w:4,d:4},-6,1,1,'support');}
  for(const [x,z,id] of [[-28,51,'ref-6'],[46,50,'ref-7']] as const)box({x,z,w:2,d:3},0,26,8,'chimney',id);
  const raw={minY:Math.min(...blocks.map(b=>b.y)),maxY:Math.max(...blocks.map(b=>b.y+b.h-1))};
  const floors=Array.from({length:7},(_,i)=>({index:i,name:i===0?'Ground court':`Level ${i+1}`,elevation:i*6,rooms:rooms.filter(r=>r.floorY===i*6),voids:[],roofComponents:components.filter(c=>Math.floor(c.topY/6)-1===i).map(c=>c.id)}));
  return{schemaVersion:2,generatorVersion:'2.0',name:'Crownward Citadel',settings:{kind:'castle',family:'tower-cluster',size:256,floors:7,organic:55,courtyard:true,chapel:true,garden:true,cellar:false,essentials:true,seed:'CROWNWARD-REFERENCE-02'},family:'tower-cluster',components,rooms,floors,openings,stairs,chimneys:[{bounds:{x:-28,z:51,w:2,d:3},fromY:0,toY:26,componentId:'ref-6'},{bounds:{x:46,z:50,w:2,d:3},fromY:0,toY:26,componentId:'ref-7'}],articulation:[],reservations:[{id:'ref-court',kind:'court',name:'Open inner court',componentId:'court',bounds:yard,polygon:rectPolygon(yard),fromY:0,toY:90,open:'exterior',reason:'Keep the court open'}],motifs:[],courts:[court],routes:[{id:'entry-route',name:'Gate to great hall',points:[{x:10,z:85},{x:10,z:35}],width:3}],blocks,walls:blocks.filter(b=>b.kind==='wall'),slabs:blocks.filter(b=>b.kind==='floor'),roofs:blocks.filter(b=>b.kind==='roof'),supports:blocks.filter(b=>b.kind==='support'),bounds:{x:-52,z:-24,w:126,d:118},...raw,width:118,depth:112,totalArea:rooms.reduce((n,r)=>n+r.area,0),entry:{x:10,z:85},connections,suites:[],validation:{valid:false,issues:['Authored reference composition; not ranked or certified by architecture.ts.']},navigation:{maxDepth:0,meanDepth:0,loops:0,unreachable:[],transits:[],strandedRooms:0,compromises:0,score:0},composition:{} as Plan['composition'],signature:'CROWNWARD-REFERENCE-02'};
}
