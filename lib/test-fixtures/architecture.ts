import { rectPolygon, type BlockBox, type BuildingComponent, type Plan, type Rect } from '../model.ts';

/** Deliberately small structural fixture, NOT a sample produced by the floor-plan generator. */
export function architectureFixture(): Plan {
  const components: BuildingComponent[] = [
    {id:'hall',name:'Great hall',kind:'hall',bounds:{x:0,z:0,w:28,d:16},baseY:0,storeys:2,topY:12,roof:'gable-x',phase:1,polygon:[]},
    {id:'keep',name:'Roofed keep',kind:'tower',bounds:{x:34,z:0,w:12,d:12},baseY:0,storeys:4,topY:24,roof:'pyramid',phase:1,polygon:[]},
    {id:'tower',name:'Chamfered tower',kind:'tower',bounds:{x:-18,z:16,w:12,d:12},baseY:0,storeys:3,topY:18,roof:'battlement',phase:1,polygon:[]},
  ];
  for (const c of components) c.polygon=rectPolygon(c.bounds);
  components[2].polygon=[{x:-15,z:16},{x:-9,z:16},{x:-6,z:19},{x:-6,z:25},{x:-9,z:28},{x:-15,z:28},{x:-18,z:25},{x:-18,z:19}];
  const blocks: BlockBox[]=[];
  const box=(c:BuildingComponent,r:Rect,y:number,h:number,material:number,kind:BlockBox['kind'])=>blocks.push({...r,y,h,material,kind,componentId:c.id});
  const outline=(c:BuildingComponent,polygon:BuildingComponent['polygon'],y:number,h:number,material:number,kind:BlockBox['kind'])=>{
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],n=Math.max(Math.abs(b.x-a.x),Math.abs(b.z-a.z));
      for(let j=0;j<=n;j++)box(c,{x:Math.round(a.x+(b.x-a.x)*j/n),z:Math.round(a.z+(b.z-a.z)*j/n),w:1,d:1},y,h,material,kind);
    }
  };
  for(const c of components){
    const b=c.bounds;
    box(c,{...b,w:b.w+1,d:b.d+1},-1,1,1,'support');
    box(c,b,0,1,2,'floor');
    outline(c,c.polygon,0,c.topY,1,'wall');
    if(c.polygon.length===4)for(let t=1;t<3;t++){
      box(c,{x:b.x,z:b.z-t,w:b.w+1,d:1},0,c.topY,1,'wall');
      box(c,{x:b.x,z:b.z+b.d+t,w:b.w+1,d:1},0,c.topY,1,'wall');
      box(c,{x:b.x-t,z:b.z,w:1,d:b.d+1},0,c.topY,1,'wall');
      box(c,{x:b.x+b.w+t,z:b.z,w:1,d:b.d+1},0,c.topY,1,'wall');
    }
    if(c.roof==='gable-x')for(let i=-1;i<=b.d+1;i++){
      const rise=Math.min(i+1,b.d+1-i);
      box(c,{x:b.x-1,z:b.z+i,w:b.w+3,d:1},c.topY+rise,1,3,'roof');
      if(rise>0)for(const x of [b.x,b.x+b.w])box(c,{x,z:b.z+i,w:1,d:1},c.topY,rise,1,'roof');
    }
    if(c.roof==='pyramid')for(let i=0;i<=Math.ceil(Math.min(b.w,b.d)/2);i++){
      const r={x:b.x-1+i,z:b.z-1+i,w:b.w+2-2*i,d:b.d+2-2*i};
      outline(c,rectPolygon(r),c.topY+i,1,3,'roof');
    }
    if(c.roof==='battlement'){
      // Mirrors the old bug: square crenellations atop an octagonal shell.
      box(c,b,c.topY,1,1,'roof');
      outline(c,c.polygon,c.topY+1,2,1,'roof');
      for(let x=b.x;x<=b.x+b.w;x+=3)for(const z of [b.z,b.z+b.d])box(c,{x,z,w:2,d:1},c.topY+3,1,1,'roof');
      for(let z=b.z;z<=b.z+b.d;z+=3)for(const x of [b.x,b.x+b.w])box(c,{x,z,w:1,d:2},c.topY+3,1,1,'roof');
    }
  }
  const hall=components[0];
  box(hall,{x:18,z:-2,w:3,d:3},1,4,0,'air');
  box(hall,{x:6,z:-2,w:2,d:3},2,4,4,'glass');
  // A louver shaft is a real cut, not permission to close it with the replacement roof.
  box(hall,{x:12,z:7,w:3,d:3},12,22,0,'air');
  const rooms=components.map(c=>({id:`${c.id}-room`,name:c.name,kind:c.kind==='hall'?'hall' as const:'bedroom' as const,componentId:c.id,
    bounds:c.bounds,polygon:c.polygon,holes:[],floorY:0,ceilingY:c.topY,area:c.bounds.w*c.bounds.d,description:'Test fixture',furniture:[]}));
  const plan={schemaVersion:2,generatorVersion:'2.0',name:'Architectural Detail Fixture',settings:{kind:'castle',family:'tower-cluster',size:128,floors:4,organic:50,courtyard:true,chapel:false,garden:false,cellar:false,essentials:true,seed:'REFERENCE-DETAIL'},family:'tower-cluster',components,rooms,
    floors:[{index:0,name:'Ground floor',elevation:0,rooms,voids:[],roofComponents:[]}],
    openings:[{id:'door',type:'entrance',axis:'z',x:18,y:1,z:0,width:3,height:4,roomIds:['hall-room'],outward:{x:0,z:-1}},
      {id:'window',type:'window',axis:'z',x:6,y:2,z:0,width:2,height:4,roomIds:['hall-room']}],
    stairs:[],chimneys:[],articulation:[],reservations:[],motifs:[],courts:[],routes:[{id:'entry-route',name:'Approach',points:[{x:18,z:-10},{x:18,z:0}],width:3}],
    blocks,walls:blocks.filter(b=>b.kind==='wall'),slabs:blocks.filter(b=>b.kind==='floor'),roofs:blocks.filter(b=>b.kind==='roof'),supports:blocks.filter(b=>b.kind==='support'),
    bounds:{x:-28,z:-16,w:88,d:56},minY:-1,maxY:34,width:72,depth:44,totalArea:736,entry:{x:19,z:0},connections:[],suites:[],validation:{valid:true,issues:[]},navigation:{},composition:{},signature:'FIXTURE'};
  return plan as unknown as Plan;
}
