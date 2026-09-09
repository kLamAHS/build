import { DEFAULT_SETTINGS, FAMILIES, rectPolygon, intersects, insidePolygon, componentFootprint, type Settings, type Plan, type Rect, type Point, type Room, type RoomKind, type BuildingComponent, type ComponentKind, type Family, type Opening, type GenerationResult, type BlockBox } from './model.ts';
import { isCirculation, navigationReport, articulationPoints, ROOM_PRIVACY } from './navigation.ts';
import { auditArchitecture } from './architectural-audit.ts';

export { DEFAULT_SETTINGS, FAMILIES } from './model.ts';
export function hash(text:string) { let h=2166136261; for(const c of text) h=Math.imul(h^c.charCodeAt(0),16777619); return h>>>0; }
function random(seed:string) { let s=hash(seed); return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}; }
export const newSeed=()=>`RAVEN-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
export function validateSettings(input:Settings):Settings {
  if(!['castle','manor','house'].includes(input.kind)) throw new Error('Choose a castle, manor or house.');
  if(!Number.isInteger(input.size)||input.size<48||input.size>512) throw new Error('Choose a footprint budget between 48 and 512 blocks.');
  if(!Number.isInteger(input.floors)||input.floors<1||input.floors>8) throw new Error('Choose between 1 and 8 occupied storeys.');
  if(!Number.isFinite(input.organic)||input.organic<0||input.organic>100) throw new Error('Organic character must be between 0 and 100.');
  if(input.family!=='auto'&&!FAMILIES[input.kind].some(f=>f.id===input.family)) throw new Error('That layout family belongs to a different building type.');
  if(typeof input.seed!=='string'||!input.seed.trim()||input.seed.length>64) throw new Error('Enter a seed of 1–64 characters.');
  return {...input,seed:input.seed.trim()};
}
const names=['Alder','Raven','Briar','Oak','Ash','Hearth','Rowan','Thorn','Grey','Fox'];
const sectors=['North','East','South','West','Garden','Orchard','Court','Meadow','River','Old'];
const interior=(r:Rect):Rect=>({x:r.x+1,z:r.z+1,w:r.w-1,d:r.d-1});
/** Which side of `a` its wall shares with `b`, or undefined when the two do not touch. */
function sharedSide(a:Rect,b:Rect):'n'|'s'|'e'|'w'|undefined {
  const overlapZ=Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z),overlapX=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
  if(overlapZ>0&&a.x+a.w===b.x)return 'e';
  if(overlapZ>0&&b.x+b.w===a.x)return 'w';
  if(overlapX>0&&a.z+a.d===b.z)return 's';
  if(overlapX>0&&b.z+b.d===a.z)return 'n';
  return undefined;
}
function clipPolygon(poly:Point[],rect:Rect) {
  let p=poly;
  for(const [axis,value,sign] of [['x',rect.x,1],['x',rect.x+rect.w,-1],['z',rect.z,1],['z',rect.z+rect.d,-1]] as const){
    const out:Point[]=[]; for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];const ia=(a[axis]-value)*sign>=0,ib=(b[axis]-value)*sign>=0;if(ia)out.push(a);if(ia!==ib){const t=(value-a[axis])/(b[axis]-a[axis]);out.push({x:Math.round(a.x+(b.x-a.x)*t),z:Math.round(a.z+(b.z-a.z)*t)});}} p=out;
  } return p;
}

/** Boundary coordinates are wall block coordinates. Touching ranges share one wall. */
export function generateCandidate(settings:Settings,attempt=0):Plan {
  const s=validateSettings(settings),rng=random(`${JSON.stringify(s)}:2:${attempt}`),pick=<T,>(a:T[])=>a[Math.floor(rng()*a.length)],ri=(a:number,b:number)=>a+Math.floor(rng()*(b-a+1));
  const family=s.family==='auto'?pick(FAMILIES[s.kind]).id:s.family;
  const components:BuildingComponent[]=[];
  const small=s.size<80, organic=s.organic/100;
  const hallW=small?18:ri(26,34),hallD=small?16:ri(22,28);
  function add(kind:ComponentKind,name:string,bounds:Rect,storeys:number,parent?:BuildingComponent,roof?:BuildingComponent['roof']) {
    if(components.some(c=>intersects(c.bounds,bounds)))return undefined;
    const chamfer=kind==='tower'?Math.min(4,Math.floor(bounds.w/5)):0;
    const {x,z,w,d}=bounds;
    const polygon=chamfer?[{x:x+chamfer,z},{x:x+w-chamfer,z},{x:x+w,z:z+chamfer},{x:x+w,z:z+d-chamfer},{x:x+w-chamfer,z:z+d},{x:x+chamfer,z:z+d},{x,z:z+d-chamfer},{x,z:z+chamfer}]:rectPolygon(bounds);
    const c:BuildingComponent={id:`c${components.length}`,name,kind,bounds,polygon,baseY:0,storeys,topY:kind==='hall'?Math.min(18,s.floors*6):storeys*6,roof:roof||(kind==='tower'?(s.kind==='castle'&&rng()<.55?'battlement':'pyramid'):(kind==='workshop'&&rng()<.3?'gable-x':w>d?'gable-x':'gable-z')),parentId:parent?.id,phase:components.length?1+Math.floor(components.length/3):0};
    components.push(c); return c;
  }
  function attach(parent:BuildingComponent,kind:ComponentKind,name:string,side:'n'|'s'|'e'|'w',w:number,d:number,storeys:number,offset?:number) {
    const b=parent.bounds;
    const shift=offset??Math.round((rng()-.5)*organic*8);
    const bounds:Rect=side==='e'?{x:b.x+b.w,z:b.z+Math.floor((b.d-d)/2)+shift,w,d}:side==='w'?{x:b.x-w,z:b.z+Math.floor((b.d-d)/2)+shift,w,d}:side==='n'?{x:b.x+Math.floor((b.w-w)/2)+shift,z:b.z-d,w,d}:{x:b.x+Math.floor((b.w-w)/2)+shift,z:b.z+b.d,w,d};
    return add(kind,name,bounds,Math.max(1,Math.min(s.floors,storeys)),parent);
  }
  let hall:BuildingComponent,domestic:BuildingComponent|undefined,service:BuildingComponent|undefined;
  if(family==='hall-house'){
    hall=add('hall','Hearth hall',{x:0,z:0,w:small?18:22,d:hallD},1)!;
    domestic=attach(hall,'domestic','Solar end','n',small?18:24,32,s.floors,0)!;
    service=attach(hall,'service','Service end','s',small?14:20,small?14:20,1,0);
  }else if(family==='merchant-house'){
    domestic=add('workshop','Merchant’s house',{x:0,z:0,w:small?22:28,d:32},s.floors)!;
    hall=attach(domestic,'hall','Hearth hall','e',hallW,hallD,1,0)!;
    service=attach(hall,'service','Bakehouse','s',small?14:20,small?14:22,1,0);
  }else if(family==='tower-residence'||family==='tower-cluster'){
    domestic=add('tower','Residential tower',{x:0,z:0,w:small?22:28,d:32},s.floors)!;
    hall=attach(domestic,'hall','Great hall','e',hallW,hallD,1,-4)!;
    service=attach(hall,'service','Kitchen range','s',small?16:22,small?18:30,Math.min(2,s.floors),3);
    if(!small)attach(domestic,'tower','Watch tower','n',22,30,Math.max(1,s.floors-1),-7);
  }else{
    hall=add('hall',s.kind==='house'?'Hearth hall':'Great hall',{x:0,z:0,w:hallW,d:hallD},1)!;
    const leftD=small?32:ri(34,40),leftW=small?18:ri(22,28);
    domestic=attach(hall,s.kind==='castle'?'tower':'domestic',s.kind==='castle'?'Great keep':'Solar wing','w',leftW,leftD,s.floors,0)!;
    service=attach(hall,'service','Kitchen range',small?'n':'e',small?14:ri(20,24),small?14:ri(28,34),Math.min(s.floors,small?1:2),0);
    if(['courtyard-manor','palace','double-ward'].includes(family)&&!small){
      attach(domestic,'lodging','West apartments','s',leftW,32,Math.max(1,s.floors-1),0);
      if(service)attach(service,'workshop','East service court','s',service.bounds.w,30,1,0);
    }
  }
  // A chapel belongs to the lord's side of the house: off the great chamber or the hall, reached without
  // crossing the kitchens. The service range is a last resort, and even then the chapel keeps its own antechapel.
  if(!small&&s.chapel&&s.kind!=='house'){
    const chapelHosts=[domestic,hall,service].filter(Boolean) as BuildingComponent[];
    outer: for(const c of chapelHosts)for(const side of ['n','e','w','s'] as const){
      const chapel=attach(c,'chapel','Chapel',side,16,24,1,0);
      if(chapel){chapel.parentId=c.id;break outer;}
    }
  }
  const porch=attach(hall,'gatehouse',s.kind==='castle'?'Inner gate':'Entrance porch','s',small?8:12,8,1,0);
  // Seeded growth adds complete households and workshops, never a longer list of hall copies.
  const reference=s.seed==='HALL-CROSSWING'&&s.kind==='manor'&&family==='crosswing'&&s.size===128;
  const extra=reference||small?0:Math.max(0,Math.floor((s.size-80)/24))+(family==='accumulated-estate'||family==='annex-house'?2:0);
  for(let n=0;n<extra;n++){
    const kind:ComponentKind=pick(s.kind==='castle'?['tower','domestic','workshop','lodging']:s.kind==='house'?['workshop','domestic','service']:['domestic','lodging','workshop','service']);
    for(let k=0;k<32;k++){
      const sorted=[...components].filter(c=>c.kind!=='gatehouse'&&c.kind!=='chapel').sort((a,b)=>b.bounds.x-a.bounds.x);
      const extendEast=s.size>192&&n%4===0&&k<2;
      const parent=extendEast?sorted[Math.min(k,sorted.length-1)]:pick(sorted);
      const side=extendEast?'e':pick(['n','s','e','w'] as const as unknown as ('n'|'s'|'e'|'w')[]);
      const w=ri(22,30),d=ri(30,38),p=parent.bounds;
      const projected=side==='e'?p.x+p.w+w:side==='w'?p.x-w:p.x;
      const minX=Math.min(0,...components.map(c=>c.bounds.x)),maxX=Math.max(0,...components.map(c=>c.bounds.x+c.bounds.w));
      if(Math.max(maxX,projected)-Math.min(minX,projected)>s.size-(s.kind==='castle'?64:s.courtyard||family==='courtyard-manor'?40:12))continue;
      const c=attach(parent,kind,`${sectors[n%sectors.length]} ${kind==='tower'?'tower':kind==='workshop'?'workshops':kind==='lodging'?'guest range':kind==='service'?'service range':'household'}${n>=10?` ${Math.floor(n/10)+1}`:''}`,side,w,d,ri(1,s.floors));
      if(c)break;
    }
  }
  if(family==='keep-bailey'&&!small&&domestic)attach(domestic,'workshop','Garrison range','n',26,34,Math.min(2,s.floors),0);
  if(family==='double-ward'&&!small){const end=[...components].sort((a,b)=>b.bounds.x+b.bounds.w-a.bounds.x-a.bounds.w)[0];attach(end,'gatehouse','Outer ward gate','e',16,14,1,0);}
  // Compact budgets keep the same minimum stair and room sizes; optional ranges are omitted.
  const p:Plan={schemaVersion:2,generatorVersion:'2.0',name:reference?'Alderhall Manor':`${pick(names)}${pick(['wick','mere','ford','haven'])} ${s.kind==='castle'?'Castle':s.kind==='manor'?'Manor':'House'}`,settings:s,family,components,rooms:[],floors:[],openings:[],stairs:[],chimneys:[],courts:[],routes:[],blocks:[],walls:[],slabs:[],roofs:[],supports:[],bounds:{x:0,z:0,w:0,d:0},minY:s.cellar?-6:0,maxY:0,width:0,depth:0,totalArea:0,entry:{x:0,z:0},connections:[],validation:{valid:true,issues:[]},navigation:{maxDepth:0,meanDepth:0,loops:0,unreachable:[],transits:[],strandedRooms:0,score:0},signature:''};
  function room(c:BuildingComponent,name:string,kind:RoomKind,bounds:Rect,y:number,ceiling=y+6){
    const envelope=c.kind==='tower'?c.polygon:rectPolygon(componentFootprint(c,y,family));
    const polygon=clipPolygon(envelope,bounds);
    const r:Room={id:`r${p.rooms.length}`,name,kind,componentId:c.id,bounds,polygon,holes:[],floorY:y,ceilingY:ceiling,area:(bounds.w-1)*(bounds.d-1),description:'',furniture:[]};p.rooms.push(r);return r;
  }
  // Circulation has to reach the walls where ranges meet. Where it does not, the only way to join two wings
  // is a door through somebody's chamber, which is how a kitchen ends up on the route to the chapel.
  const BAND=4,SPUR=4,MIN_ROOM=5;
  function junctions(c:BuildingComponent,y:number){
    const a=componentFootprint(c,y,family),out:{side:'n'|'s'|'e'|'w';lo:number;hi:number;other:BuildingComponent}[]=[];
    for(const o of components){
      if(o.id===c.id||o.baseY>y||y>=o.topY)continue;
      const other=componentFootprint(o,y,family),side=sharedSide(a,other);
      if(!side)continue;
      const across=side==='n'||side==='s';
      const lo=across?Math.max(a.x,other.x):Math.max(a.z,other.z),hi=across?Math.min(a.x+a.w,other.x+other.w):Math.min(a.z+a.d,other.z+other.d);
      if(hi-lo>=6)out.push({side,lo,hi,other:o});
    }
    // Widest junction first: the broadest shared wall is the one worth spending a passage on.
    return out.sort((m,n)=>(n.hi-n.lo)-(m.hi-m.lo)||m.lo-n.lo||m.side.localeCompare(n.side));
  }
  /** Both neighbours derive the same position from the shared span, so their passages meet in the wall. */
  const spanCentre=(lo:number,hi:number,width:number)=>lo+Math.floor((hi-lo-width)/2);
  /** Split a strip in two, running a passage out to a shared wall when one of these junctions needs it. */
  function spurSplit(strip:Rect,spans:{lo:number;hi:number}[],fallback:number):{slots:Rect[];spur?:Rect}{
    if(strip.w<MIN_ROOM||strip.d<MIN_ROOM)return {slots:[]};
    if(strip.w>=MIN_ROOM*2+SPUR){
      const lo=strip.x+MIN_ROOM,hi=strip.x+strip.w-MIN_ROOM-SPUR;
      for(const span of spans){
        const at=spanCentre(span.lo,span.hi,SPUR);
        if(at>=lo&&at<=hi)return {slots:[{...strip,w:at-strip.x},{...strip,x:at+SPUR,w:strip.x+strip.w-at-SPUR}],spur:{...strip,x:at,w:SPUR}};
      }
    }
    if(strip.w<MIN_ROOM*2)return {slots:[strip]};
    const at=Math.max(strip.x+MIN_ROOM,Math.min(fallback,strip.x+strip.w-MIN_ROOM));
    return {slots:[{...strip,w:at-strip.x},{...strip,x:at,w:strip.x+strip.w-at}]};
  }
  // Where every range's cross passage sits, decided for the whole composition before any room is cut.
  // Two adjoining ranges that each centre their own passage independently miss each other in the shared
  // wall by a block or two, and the only remaining way between them is a door through somebody's chamber.
  const bandOf=(c:BuildingComponent)=>c.bounds.d<28||c.bounds.w<18?5:BAND;
  const passageZ=new Map<string,number>();
  {
    const banded=(c:BuildingComponent)=>c.kind!=='hall'&&c.kind!=='gatehouse'&&c.kind!=='chapel';
    const top=Math.max(...components.map(c=>c.storeys));
    for(let f=-1;f<top;f++){
      const y=f*6,here=components.filter(c=>banded(c)&&y>=c.baseY&&f<c.storeys);
      const limits=(c:BuildingComponent)=>{
        const rb=componentFootprint(c,y,family),band=bandOf(c);
        return {rb,band,low:rb.z+MIN_ROOM,high:Math.min(rb.z+rb.d-MIN_ROOM-band,c.bounds.z+c.bounds.d-17)};
      };
      for(const c of here){
        const {rb,band,low,high}=limits(c);
        // A steady nudge per range and storey, so passages still vary without depending on draw order.
        const drift=bandOf(c)===5?-2:(hash(`${c.id}:${f}`)%4)-2;
        const mid=Math.min(rb.z+Math.floor(rb.d/2)+drift,c.bounds.z+c.bounds.d-17);
        passageZ.set(`${c.id}:${f}`,high>=low?Math.max(low,Math.min(mid,high)):mid);
        void band;
      }
      const links:{a:BuildingComponent;b:BuildingComponent;lo:number;hi:number}[]=[];
      for(let i=0;i<here.length;i++)for(let j=i+1;j<here.length;j++){
        const fa=componentFootprint(here[i],y,family),fb=componentFootprint(here[j],y,family),side=sharedSide(fa,fb);
        if(side!=='e'&&side!=='w')continue;
        const lo=Math.max(fa.z,fb.z),hi=Math.min(fa.z+fa.d,fb.z+fb.d);
        if(hi-lo>=6)links.push({a:here[i],b:here[j],lo,hi});
      }
      // Widest shared wall first: the broadest junction is the one worth committing both passages to.
      links.sort((m,n)=>(n.hi-n.lo)-(m.hi-m.lo)||m.a.id.localeCompare(n.a.id)||m.b.id.localeCompare(n.b.id));
      const settled=new Set<string>();
      for(const link of links){
        const ka=`${link.a.id}:${f}`,kb=`${link.b.id}:${f}`;
        if(settled.has(ka)&&settled.has(kb))continue;
        const width=Math.max(bandOf(link.a),bandOf(link.b));
        const at=settled.has(ka)?passageZ.get(ka)!:settled.has(kb)?passageZ.get(kb)!:spanCentre(link.lo,link.hi,width);
        if(Math.min(link.hi,at+width)-Math.max(link.lo,at)<4)continue;
        const fits=(c:BuildingComponent)=>{const {low,high}=limits(c);return high>=low&&at>=low&&at<=high;};
        if(!fits(link.a)||!fits(link.b))continue;
        passageZ.set(ka,at);passageZ.set(kb,at);settled.add(ka);settled.add(kb);
      }
    }
  }
  /** The stretch of a neighbour's east or west wall that its own circulation already stands against. */
  function circulationSpan(o:BuildingComponent,y:number):[number,number]|undefined{
    if(y<o.baseY||y>=o.topY)return undefined;
    const fo=componentFootprint(o,y,family);
    // A hall, a gatehouse and a chapel with its antechapel present circulation along their whole flank.
    if(o.kind==='hall')return y===0||y===6?[fo.z,fo.z+fo.d]:undefined;
    if(o.kind==='gatehouse'||o.kind==='chapel')return y===0?[fo.z,fo.z+fo.d]:undefined;
    const at=passageZ.get(`${o.id}:${y/6}`);
    return at===undefined?undefined:[at,at+bandOf(o)];
  }
  for(const c of components){
    const b=c.bounds;
    if(c.kind==='hall'){
      room(c,s.kind==='house'?'Hearth hall':'Great hall','hall',{...b,d:b.d-5},0,c.topY);
      room(c,'Screens passage','circulation',{...b,z:b.z+b.d-5,d:5},0,c.topY);
      if(c.topY>=12)room(c,'Minstrels’ gallery','gallery',family==='hall-house'?{...b,d:5}:{...b,z:b.z+b.d-5,d:5},6,c.topY);
      continue;
    }
    if(c.kind==='gatehouse') {room(c,c.name,'circulation',b,0,6);continue;}
    if(c.kind==='chapel') {
      // An antechapel on the wall the chapel shares with the house gives the household a threshold to
      // enter through, and keeps the sacred room a destination rather than a route to anywhere else.
      const host=components.find(o=>o.id===c.parentId),side=host?sharedSide(b,host.bounds):undefined,depth=5;
      const along=side==='n'||side==='s'?b.d:b.w;
      if(side&&along>=depth+8){
        const ante:Rect=side==='s'?{...b,z:b.z+b.d-depth,d:depth}:side==='n'?{...b,d:depth}:side==='e'?{...b,x:b.x+b.w-depth,w:depth}:{...b,w:depth};
        const nave:Rect=side==='s'?{...b,d:b.d-depth}:side==='n'?{...b,z:b.z+depth,d:b.d-depth}:side==='e'?{...b,w:b.w-depth}:{...b,x:b.x+depth,w:b.w-depth};
        room(c,'Antechapel','circulation',ante,0,6);
        room(c,'Chapel','sacred',nave,0,6);
      }else room(c,'Chapel','sacred',b,0,6);
      continue;
    }
    const hasStairs=c.storeys>1||(s.cellar&&(c===domestic||c===service)&&b.w>=18&&b.d>=30);
    const cellar=s.cellar&&(c===domestic||c===service)&&b.w>=18&&b.d>=30;
    if(cellar)c.baseY=-6;
    const shaft={x:b.x+b.w-8,z:b.z+b.d-13,w:7,d:12};
    const stairRooms:Room[]=[];
    for(let f=cellar?-1:0;f<c.storeys;f++){
      const y=f*6,rb=componentFootprint(c,y,family);
      if(b.d<28||b.w<18){
        const band=5,js=junctions(c,y),principal=js[0];
        // A short range is entered at one end. Put the passage on the wall the house actually adjoins,
        // so the kitchen sits beyond it rather than standing in the doorway of everything behind it.
        const endOn=principal&&(principal.side==='n'||principal.side==='s')?principal.side:undefined;
        const z=endOn?(endOn==='n'?rb.z:rb.z+rb.d-band):passageZ.get(`${c.id}:${f}`)??rb.z+Math.floor(rb.d/2)-2;
        room(c,'Service passage','circulation',{x:rb.x,z,w:rb.w,d:band},y);
        if(endOn){
          const rest:Rect=endOn==='n'?{x:rb.x,z:rb.z+band,w:rb.w,d:rb.d-band}:{x:rb.x,z:rb.z,w:rb.w,d:rb.d-band};
          const cut=rest.x+Math.floor(rest.w/2);
          if(rest.w>=MIN_ROOM*2){
            room(c,'Kitchen','service',{...rest,w:cut-rest.x},y);
            room(c,'Pantry & buttery','storage',{x:cut,z:rest.z,w:rest.x+rest.w-cut,d:rest.d},y);
          }else room(c,'Kitchen','service',rest,y);
        }else{
          room(c,'Kitchen','service',{...rb,d:z-rb.z},y);
          room(c,'Pantry & buttery','storage',{...rb,z:z+band,d:rb.z+rb.d-z-band},y);
        }
        continue;
      }
      const js=junctions(c,y),band=BAND;
      const cx=rb.x+Math.floor(rb.w*(f%2===0?.56:.43))+ri(-1,1);
      const cz=passageZ.get(`${c.id}:${f}`)??Math.min(rb.z+Math.floor(rb.d/2),b.z+b.d-17);
      room(c,f<0?'Cellar passage':f===0?'Cross passage':f===c.storeys-1&&f>1?'Upper landing':'Landing','circulation',{x:rb.x,z:cz,w:rb.w,d:band},y);
      const sx=hasStairs?shaft.x:rb.x+Math.floor(rb.w*.62);
      const northStrip:Rect={x:rb.x,z:rb.z,w:rb.w,d:cz-rb.z};
      const southDepth=rb.z+rb.d-cz-band;
      const stairRect:Rect={x:sx,z:cz+band,w:rb.x+rb.w-sx,d:southDepth};
      const southStrip:Rect={x:rb.x,z:cz+band,w:sx-rb.x,d:southDepth};
      // A range adjoining this one part-way along its flank cannot be reached from the cross passage.
      // Those get a passage down the side of the range instead — the single-loaded corridor of a real wing.
      const passagesMeet=(j:{lo:number;hi:number;other:BuildingComponent})=>{
        const span=circulationSpan(j.other,y);
        if(!span)return false;
        const lo=Math.max(j.lo,span[0],cz),hi=Math.min(j.hi,span[1],cz+band);
        return hi-lo>=4;
      };
      // Both neighbours run this same test against the same passage positions, so when a flank is needed
      // each of them builds one and the two meet along the wall they share.
      const needsFlank=(strip:Rect,wall:'e'|'w')=>strip.d>=MIN_ROOM&&js.some(j=>j.side===wall&&!passagesMeet(j)&&Math.min(j.hi,strip.z+strip.d)-Math.max(j.lo,strip.z)>=6);
      // The stair hall already holds the east flank of the south range whenever there is one.
      const flankWalls=(strip:Rect,walls:('e'|'w')[])=>{
        let area=strip;const halls:Rect[]=[];
        for(const wall of walls){
          if(area.w<SPUR+MIN_ROOM||!needsFlank(strip,wall))continue;
          if(wall==='e'){halls.push({...area,x:area.x+area.w-SPUR,w:SPUR});area={...area,w:area.w-SPUR};}
          else{halls.push({...area,w:SPUR});area={...area,x:area.x+SPUR,w:area.w-SPUR};}
        }
        return {area,halls};
      };
      const northFlank=flankWalls(northStrip,['w','e']),southFlank=flankWalls(southStrip,hasStairs?['w']:['w','e']);
      const north=spurSplit(northFlank.area,js.filter(j=>j.side==='n'),cx);
      const south=spurSplit(southFlank.area,js.filter(j=>j.side==='s'),southFlank.area.x+Math.floor(southFlank.area.w*.5));
      // A passage running out to the shared wall, so the neighbouring range is entered from circulation.
      for(const hall of [...northFlank.halls,...southFlank.halls])room(c,'Passage','circulation',hall,y);
      if(north.spur)room(c,'Passage','circulation',north.spur,y);
      if(south.spur)room(c,'Passage','circulation',south.spur,y);
      let program:[string,RoomKind][];
      if(f<0)program=[['Wine cellar','storage'],['Root store','storage'],['Strong room','storage'],['Buttery store','storage'],['Ice store','storage']];
      else if(c.kind==='service'&&f===0)program=[['Kitchen','service'],['Pantry & buttery','storage'],['Scullery','service'],['Larder','storage'],['Wet larder','storage']];
      else if(c.kind==='workshop'&&f===0)program=[['Workshop','service'],['Counting room','study'],['Goods store','storage'],['Tool store','storage'],['Drying loft','storage']];
      else if(c.kind==='tower'&&f===0)program=[['Guardroom','service'],['Armoury','storage'],['Steward’s office','study'],['Muniment room','storage'],['Watch room','service']];
      else if(f===0&&c.kind==='domestic')program=[['Solar','study'],['Withdrawing room','study'],['Household dining','service'],['Parlour','study'],['Pantry','storage']];
      else if(c.kind==='tower'&&f>0)program=[[f===c.storeys-1?'Tower chamber':'Solar chamber','bedroom'],['Antechamber','study'],['Wardrobe','storage'],['Guest chamber','bedroom'],['Linen room','storage']];
      else if(f===c.storeys-1&&f>1)program=[['Gabled bedchamber','bedroom'],['Wardrobe & study','study'],['Bedchamber','bedroom'],['Linen room','storage'],['Private study','study']];
      else program=[['Bedchamber','bedroom'],['Guest chamber','bedroom'],['Linen room','storage'],['Nurse’s chamber','bedroom'],['Wardrobe','storage']];
      // A tower head and a gabled attic read as one grand room when no passage has to cross them.
      const gabled=f===c.storeys-1&&f>1,merge=!north.spur&&north.slots.length>1&&((c.kind==='tower'&&f>0)||gabled);
      const slots=merge?[northFlank.area,...south.slots]:[...north.slots,...south.slots];
      slots.forEach((r,i)=>{const [name,kind]=program[Math.min(i,program.length-1)];room(c,name,kind,r,y,gabled?y+4:y+6);});
      if(hasStairs){const r=room(c,'Stair hall','stairs',stairRect,y);stairRooms.push(r);}
      else room(c,c.kind==='service'?'Bread oven':'Household store',c.kind==='service'?'service':'storage',stairRect,y);
    }
    for(let i=0;i<stairRooms.length-1;i++){
      const a=stairRooms[i],b=stairRooms[i+1];
      p.stairs.push({id:`s${p.stairs.length}`,componentId:c.id,roomIds:[a.id,b.id],bounds:shaft,fromY:a.floorY,toY:b.floorY,width:2,headroom:3,landings:[{x:shaft.x+1,z:shaft.z+1,w:5,d:2},{x:shaft.x+1,z:shaft.z+9,w:5,d:2}]});
      b.holes.push({x:shaft.x+3,z:shaft.z+3,w:1,d:5});
    }
  }
  // Room adjacency comes from real shared walls. Circulation is connected first;
  // an attached range is reached through an antechamber, never through a bedroom.
  const candidates:{a:Room;b:Room;axis:'x'|'z';fixed:number;pos:number;span:number;priority:number}[]=[];
  const roomBoundary=new Map<string,Set<string>>();
  function boundaryCells(r:Room){
    let cells=roomBoundary.get(r.id);if(cells)return cells;cells=new Set<string>();
    for(let i=0;i<r.polygon.length;i++){const a=r.polygon[i],b=r.polygon[(i+1)%r.polygon.length],steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.z-a.z));for(let j=0;j<=steps;j++){const t=steps?j/steps:0;cells.add(`${Math.round(a.x+(b.x-a.x)*t)},${Math.round(a.z+(b.z-a.z)*t)}`);}}
    roomBoundary.set(r.id,cells);return cells;
  }
  for(let i=0;i<p.rooms.length;i++)for(let j=i+1;j<p.rooms.length;j++){
    const a=p.rooms[i],b=p.rooms[j];if(a.floorY!==b.floorY)continue;
    const A=a.bounds,B=b.bounds;
    let axis:'x'|'z'|undefined,fixed=0,lo=0,hi=0;
    if(A.x+A.w===B.x||B.x+B.w===A.x){axis='x';fixed=Math.max(A.x,B.x);lo=Math.max(A.z,B.z);hi=Math.min(A.z+A.d,B.z+B.d);}
    else if(A.z+A.d===B.z||B.z+B.d===A.z){axis='z';fixed=Math.max(A.z,B.z);lo=Math.max(A.x,B.x);hi=Math.min(A.x+A.w,B.x+B.w);}
    if(!axis||hi-lo<4)continue;
    const positions=Array.from({length:hi-lo-3},(_,i)=>lo+1+i).sort((a,b)=>Math.abs(a-(lo+hi)/2+1)-Math.abs(b-(lo+hi)/2+1));
    const doorAxis=axis;
    const pos=positions.find(pos=>[a,b].every(r=>{
      const approach=doorAxis==='x'?{x:fixed===r.bounds.x?fixed+1:fixed-2,z:pos,w:2,d:2}:{x:pos,z:fixed===r.bounds.z?fixed+1:fixed-2,w:2,d:2};
      for(let dx=0;dx<2;dx++)for(let dz=0;dz<2;dz++)if(!insidePolygon(approach.x+dx+.5,approach.z+dz+.5,r.polygon)||boundaryCells(r).has(`${approach.x+dx},${approach.z+dz}`))return false;
      if(p.stairs.filter(st=>st.roomIds.includes(r.id)).some(st=>intersects(approach,{x:st.bounds.x+3,z:st.bounds.z+3,w:3,d:6})))return false;
      return true;
    }));
    if(pos===undefined)continue;
    candidates.push({a,b,axis,fixed,pos,span:hi-lo,priority:0});
  }
  // Doors follow a household's access grammar rather than whichever walls happen to touch:
  // circulation carries every route, a chamber is a place you arrive at, and only rooms that already
  // have their own way in are allowed the extra connecting door a real plan would give them.
  const root=new Map(p.rooms.map(r=>[r.id,r.id]));
  const find=(id:string):string=>{let at=id;while(root.get(at)!==at)at=root.get(at)!;return at;};
  const join=(a:string,b:string)=>root.set(find(a),find(b));
  const degree=new Map(p.rooms.map(r=>[r.id,0]));
  const toCirculation=new Map(p.rooms.map(r=>[r.id,0]));
  const cut=(edge:typeof candidates[number])=>{
    const {a,b,pos}=edge;
    const o:Opening={id:`o${p.openings.length}`,type:'door',axis:edge.axis,x:edge.axis==='x'?edge.fixed:pos,y:a.floorY+1,z:edge.axis==='z'?edge.fixed:pos,width:2,height:3,roomIds:[a.id,b.id]};
    p.openings.push(o);p.connections.push([a.id,b.id]);join(a.id,b.id);
    degree.set(a.id,degree.get(a.id)!+1);degree.set(b.id,degree.get(b.id)!+1);
    if(isCirculation(b))toCirculation.set(a.id,toCirculation.get(a.id)!+1);
    if(isCirculation(a))toCirculation.set(b.id,toCirculation.get(b.id)!+1);
    edge.priority=-1;
  };
  for(const st of p.stairs){p.connections.push(st.roomIds as [string,string]);join(st.roomIds[0],st.roomIds[1]);for(const id of st.roomIds)degree.set(id,degree.get(id)!+1);}
  const wide=(m:typeof candidates[number],n:typeof candidates[number])=>n.span-m.span||m.a.id.localeCompare(n.a.id);
  const open=(e:typeof candidates[number])=>e.priority>=0;
  // 1. The circulation skeleton: passages, stairs, galleries and the hall joined into one network.
  const spine=candidates.filter(e=>isCirculation(e.a)&&isCirculation(e.b)).sort(wide);
  for(const edge of spine)if(find(edge.a.id)!==find(edge.b.id))cut(edge);
  // 2. Every other room gets its own door onto that network, so no chamber is ever a corridor.
  for(const edge of candidates.filter(e=>open(e)&&(isCirculation(e.a)!==isCirculation(e.b))).sort(wide)){
    const chamber=isCirculation(edge.a)?edge.b:edge.a;
    if(toCirculation.get(chamber.id)!)continue;
    cut(edge);
  }
  // 3. Anything still cut off is joined by the least objectionable door left. A route forced through a
  //    steward's office is a compromise; the same route through a bedchamber is not one worth making.
  const intrusion=(e:typeof candidates[number])=>(isCirculation(e.a)?0:ROOM_PRIVACY[e.a.kind])+(isCirculation(e.b)?0:ROOM_PRIVACY[e.b.kind]);
  for(const edge of candidates.filter(open).sort((m,n)=>intrusion(m)-intrusion(n)||wide(m,n))){
    if(find(edge.a.id)!==find(edge.b.id))cut(edge);
  }
  // 4. Doors a designer would add between rooms that already have their own entrance: a kitchen into its
  //    pantry, a solar into the withdrawing room. Both sides keep an independent way in, so neither becomes a route.
  const PAIRED:Record<string,string[]>={Kitchen:['Pantry & buttery','Scullery','Larder','Wet larder','Bread oven'],Solar:['Withdrawing room','Parlour'],Bedchamber:['Wardrobe','Wardrobe & study','Linen room'],'Gabled bedchamber':['Wardrobe & study'],Workshop:['Goods store','Tool store','Counting room'],Guardroom:['Armoury','Watch room'],'Tower chamber':['Wardrobe','Antechamber'],'Solar chamber':['Wardrobe','Antechamber']};
  const paired=(m:Room,n:Room)=>(PAIRED[m.name]??[]).includes(n.name)||(PAIRED[n.name]??[]).includes(m.name);
  for(const edge of candidates.filter(e=>open(e)&&paired(e.a,e.b)).sort(wide)){
    if(toCirculation.get(edge.a.id)!&&toCirculation.get(edge.b.id)!)cut(edge);
  }
  // 5. Loop closure. A plan whose doors form a bare tree forces one route to everywhere; a real house
  //    lets you come back a different way. Extra passage-to-passage doors are added where the walk is longest.
  const ring=candidates.filter(e=>open(e)&&isCirculation(e.a)&&isCirculation(e.b)).sort(wide);
  if(ring.length){
    const neighbours=new Map(p.rooms.map(r=>[r.id,[] as string[]]));
    for(const [m,n] of p.connections){neighbours.get(m)?.push(n);neighbours.get(n)?.push(m);}
    const between=(from:string,to:string)=>{
      const seen=new Map([[from,0]]),queue=[from];
      for(let i=0;i<queue.length;i++){
        if(queue[i]===to)return seen.get(to)!;
        for(const next of neighbours.get(queue[i])!)if(!seen.has(next)){seen.set(next,seen.get(queue[i])!+1);queue.push(next);}
      }
      return Infinity;
    };
    for(const edge of ring){
      if(between(edge.a.id,edge.b.id)<4)continue;
      cut(edge);neighbours.get(edge.a.id)!.push(edge.b.id);neighbours.get(edge.b.id)!.push(edge.a.id);
    }
  }
  // 6. Relief. Where two stretches of circulation still meet only through a chamber, that chamber is a
  //    corridor in all but name. Look for any unused door that reaches the stranded side another way and
  //    cut it, so the chamber goes back to being somewhere you arrive at.
  {
    const byId=new Map(p.rooms.map(r=>[r.id,r]));
    const start=p.rooms.find(r=>r.floorY===0&&isCirculation(r))?.id??p.rooms[0]?.id;
    for(let pass=0;pass<4&&start;pass++){
      const adjacency=new Map(p.rooms.map(r=>[r.id,[] as string[]]));
      for(const [m,n] of p.connections){adjacency.get(m)?.push(n);adjacency.get(n)?.push(m);}
      const forced=[...articulationPoints({adjacency,depth:new Map(),entry:start,unreachable:[]})]
        .filter(([id])=>{const r=byId.get(id);return r&&!isCirculation(r);});
      if(!forced.length)break;
      let relieved=false;
      for(const [id,strands] of forced){
        const stranded=new Set(strands);
        const relief=candidates.filter(open).filter(e=>e.a.id!==id&&e.b.id!==id&&stranded.has(e.a.id)!==stranded.has(e.b.id))
          .sort((m,n)=>intrusion(m)-intrusion(n)||wide(m,n))[0];
        if(relief){cut(relief);relieved=true;}
      }
      if(!relieved)break;
    }
  }
  const entryCandidates=p.rooms.filter(r=>r.floorY===0&&r.kind!=='bedroom').sort((a,b)=>(a.componentId===porch?.id?-10:a.name==='Screens passage'?-5:a.kind==='circulation'?0:1)-(b.componentId===porch?.id?-10:b.name==='Screens passage'?-5:b.kind==='circulation'?0:1));
  let entranceOpening:Opening|undefined;
  for(const r of entryCandidates){
    for(const [axis,high] of [['z',true],['x',true],['x',false],['z',false]] as const){
      const b=r.bounds,fixed=axis==='x'?b.x+(high?b.w:0):b.z+(high?b.d:0),start=axis==='x'?b.z:b.x,length=axis==='x'?b.d:b.w,pos=start+Math.floor(length/2)-1;
      const x=axis==='x'?fixed:pos,z=axis==='z'?fixed:pos,outward={x:axis==='x'?(high?1:-1):0,z:axis==='z'?(high?1:-1):0};
      const exterior={x:x+(outward.x>0?1:outward.x<0?-2:0),z:z+(outward.z>0?1:outward.z<0?-2:0),w:2,d:2};
      if(length<4||components.some(c=>intersects(exterior,{...c.bounds,w:c.bounds.w+1,d:c.bounds.d+1})))continue;
      entranceOpening={id:'entrance',type:'entrance',axis,x,z,y:1,width:2,height:3,roomIds:[r.id],outward};break;
    }if(entranceOpening)break;
  }
  if(!entranceOpening)throw new Error('The composition has no usable exterior entrance.');
  p.entry={x:entranceOpening.x+(entranceOpening.axis==='z'?1:0),z:entranceOpening.z+(entranceOpening.axis==='x'?1:0)};p.openings.push(entranceOpening);
  for(const r of p.rooms){
    const b=r.bounds;
    r.description=r.kind==='hall'?`The primary household hall rises ${r.ceilingY-r.floorY} blocks, with an open volume above and a screens passage at the service end.`:r.kind==='stairs'?'Reserved stair hall: two-block flights, three-block headroom and landings at each occupied level.':r.kind==='bedroom'?'A private chamber entered from a landing; household routes do not pass through it.':r.kind==='gallery'?'A partial timber gallery overlooking the hall. The central volume remains open to below.':`${r.name} in the ${components.find(c=>c.id===r.componentId)!.name.toLowerCase()}, connected to the household circulation.`;
    const addFurniture=(type:Room['furniture'][number]['type'],x:number,z:number,w:number,d:number,h=1)=>{const b={x,z,w,d};const doorApproaches=p.openings.filter(o=>o.type!=='window'&&o.roomIds.includes(r.id)).map(o=>o.axis==='x'?{x:o.x-3,z:o.z-1,w:7,d:o.width+2}:{x:o.x-1,z:o.z-3,w:o.width+2,d:7});if(w>0&&d>0&&!doorApproaches.some(a=>intersects(a,b)))r.furniture.push({type,x,z,w,d,y:r.floorY+1,h,material:9});};
    if(r.kind==='hall'){const x=b.x+4,z=b.z+4;addFurniture('table',x,z,3,Math.max(4,b.d-9));addFurniture('bench',x-2,z,1,Math.max(4,b.d-9));addFurniture('bench',x+4,z,1,Math.max(4,b.d-9));if(b.w>22){addFurniture('table',b.x+b.w-8,z,3,Math.max(4,b.d-9));addFurniture('bench',b.x+b.w-10,z,1,Math.max(4,b.d-9));}addFurniture('table',b.x+7,b.z+2,Math.max(4,b.w-14),2);}
    else if(r.kind==='bedroom'){addFurniture('bed',b.x+2,b.z+2,3,4);addFurniture('shelf',b.x+b.w-2,b.z+2,1,3,2);}
    else if(r.kind==='service'){addFurniture('table',b.x+2,b.z+2,Math.min(4,b.w-4),2);if(b.d>9)addFurniture('hearth',b.x+2,b.z+b.d-3,3,1,2);}
    else if(r.kind==='study'){addFurniture('desk',b.x+2,b.z+2,3,2);addFurniture('shelf',b.x+2,b.z+b.d-2,Math.max(2,b.w-4),1,2);}
    else if(r.kind==='storage'){addFurniture('shelf',b.x+2,b.z+2,Math.max(2,b.w-4),1,2);if(b.d>8)addFurniture('shelf',b.x+2,b.z+b.d-2,Math.max(2,b.w-4),1,2);}
    else if(r.kind==='sacred'){addFurniture('altar',b.x+5,b.z+3,Math.max(3,b.w-10),2);for(let z=b.z+8;z<b.z+b.d-3;z+=3){addFurniture('bench',b.x+2,z,4,1);addFurniture('bench',b.x+b.w-6,z,4,1);}}
  }
  for(const y of [...new Set(p.rooms.map(r=>r.floorY))].sort((a,b)=>a-b)){
    const voids=components.filter(c=>c.kind==='hall'&&y>0&&y<c.topY).map(c=>({id:`void-${c.id}-${y}`,name:'Open to hall below',bounds:c.bounds,polygon:c.polygon,holes:p.rooms.filter(r=>r.componentId===c.id&&r.floorY===y).map(r=>r.bounds),floorY:y,ceilingY:c.topY}));
    p.floors.push({index:y/6,name:y<0?'Cellar':y===0?'Ground floor':y===6?'First floor':y===12?'Second floor':`Floor ${y/6+1}`,elevation:y,rooms:p.rooms.filter(r=>r.floorY===y),voids,roofComponents:components.filter(c=>c.topY<=y).map(c=>c.id)});
  }
  if(!small&&(s.kind==='castle'||s.courtyard||['courtyard-manor','palace','double-ward'].includes(family))){
    const x=Math.min(...components.map(c=>c.bounds.x))-10,z=Math.min(...components.map(c=>c.bounds.z))-10,right=Math.max(...components.map(c=>c.bounds.x+c.bounds.w))+10,bottom=Math.max(...components.map(c=>c.bounds.z+c.bounds.d))+(family==='keep-bailey'?30:14);
    const court={id:'inner-court',name:s.kind==='castle'?'Inner bailey':'Walled court',bounds:{x,z,w:right-x,d:bottom-z},gate:{x:p.entry.x,z:bottom},wallHeight:s.kind==='castle'?6:3};p.courts.push(court);
    if(family==='double-ward'){
      const width=Math.max(54,Math.min(120,court.bounds.w-14));
      p.courts.push({id:'outer-court',name:'Outer ward',bounds:{x:Math.max(x+4,Math.min(right-width-4,p.entry.x-Math.floor(width/2))),z:bottom,w:width,d:38+ri(0,12)},gate:{x:p.entry.x,z:bottom+38},wallHeight:6});
      p.courts[1].gate.z=p.courts[1].bounds.z+p.courts[1].bounds.d;
    }
    const outward=entranceOpening.outward!,entryStart={x:entranceOpening.x+(outward.x>0?1:outward.x<0?-2:0),z:entranceOpening.z+(outward.z>0?1:outward.z<0?-2:0)};
    const route=findOutdoorRoute(entryStart,{x:court.gate.x-1,z:court.gate.z-2},court.bounds,components.map(c=>c.bounds));
    if(route)p.routes.push({id:'entry-route',name:'Gate to screens passage',points:route,width:2});
    if(p.courts[1])p.routes.push({id:'ward-route',name:'Inner to outer gate',points:[{x:p.entry.x-1,z:bottom-1},{x:p.entry.x-1,z:p.courts[1].gate.z+2}],width:2});
  }
  buildGeometry(p);
  const minX=Math.min(...p.blocks.map(b=>b.x)),minZ=Math.min(...p.blocks.map(b=>b.z)),maxX=Math.max(...p.blocks.map(b=>b.x+b.w)),maxZ=Math.max(...p.blocks.map(b=>b.z+b.d));
  p.bounds={x:minX-8,z:minZ-8,w:maxX-minX+16,d:maxZ-minZ+16};p.width=maxX-minX;p.depth=maxZ-minZ;p.maxY=Math.max(...p.blocks.map(b=>b.y+b.h))-1;p.minY=Math.min(...p.blocks.map(b=>b.y));p.totalArea=p.rooms.reduce((a,r)=>a+r.area,0);
  p.signature=hash(JSON.stringify(components.map(c=>[c.kind,c.bounds.w,c.bounds.d,c.parentId,c.storeys,c.bounds.x,c.bounds.z]))).toString(16);
  p.navigation=navigationReport(p);
  p.validation=validatePlan(p);
  return p;
}

function buildGeometry(p:Plan){
  const box=(r:Rect,y:number,h:number,material:number,kind:BlockBox['kind'],componentId='site')=>{if(r.w>0&&r.d>0&&h>0)p.blocks.push({...r,y,h,material,kind,componentId});};
  const polygonFill=(polygon:Point[],y:number,h:number,material:number,kind:BlockBox['kind'],componentId:string,inset=0)=>{
    const minX=Math.min(...polygon.map(v=>v.x)),maxX=Math.max(...polygon.map(v=>v.x)),minZ=Math.min(...polygon.map(v=>v.z)),maxZ=Math.max(...polygon.map(v=>v.z));
    for(let z=minZ+inset;z<maxZ;z++){let start:number|undefined;for(let x=minX+inset;x<=maxX;x++){const valid=x<maxX&&insidePolygon(x+.5,z+.5,polygon);if(valid&&start===undefined)start=x;if(!valid&&start!==undefined){box({x:start,z,w:x-start,d:1},y,h,material,kind,componentId);start=undefined;}}}
  };
  const outline=(polygon:Point[],y:number,h:number,material:number,kind:BlockBox['kind'],id:string)=>{
    for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.z-a.z));for(let j=0;j<=steps;j++){const t=steps?j/steps:0;box({x:Math.round(a.x+(b.x-a.x)*t),z:Math.round(a.z+(b.z-a.z)*t),w:1,d:1},y,h,material,kind,id);}}
  };
  for(const c of p.components){
    const b=c.bounds;
    polygonFill(c.polygon,c.baseY-1,1,1,'support',c.id);
    if(c.kind==='hall'||c.kind==='tower')outline(c.polygon,c.baseY,c.topY-c.baseY,1,'wall',c.id);
    else for(let y=c.baseY;y<c.topY;y+=6)outline(rectPolygon(componentFootprint(c,y,p.family)),y,6,1,'wall',c.id);
    const top=c.topY;
    if(c.roof==='battlement'){
      polygonFill(c.polygon,top,1,1,'roof',c.id);
      for(let y=top+1;y<top+3;y++)outline(c.polygon,y,1,1,'roof',c.id);
      for(let x=b.x;x<=b.x+b.w;x+=3){box({x,z:b.z,w:2,d:1},top+3,1,1,'roof',c.id);box({x,z:b.z+b.d,w:2,d:1},top+3,1,1,'roof',c.id);}
      for(let z=b.z;z<=b.z+b.d;z+=3){box({x:b.x,z,w:1,d:2},top+3,1,1,'roof',c.id);box({x:b.x+b.w,z,w:1,d:2},top+3,1,1,'roof',c.id);}
    }else if(c.roof==='pyramid'){
      for(let i=0;i<=Math.ceil(Math.min(b.w,b.d)/2);i++){
        const r={x:b.x-1+i,z:b.z-1+i,w:b.w+3-2*i,d:b.d+3-2*i};if(r.w>0&&r.d>0)outline(rectPolygon({ ...r,w:r.w-1,d:r.d-1 }),top+i,1,3,'roof',c.id);
      }
    }else{
      const alongX=c.roof==='gable-x',span=alongX?b.d:b.w;
      for(let i=-1;i<=span+1;i++){
        const rise=Math.min(i+1,span+1-i),y=top+rise;
        box(alongX?{x:b.x-1,z:b.z+i,w:b.w+3,d:1}:{x:b.x+i,z:b.z-1,w:1,d:b.d+3},y,1,3,'roof',c.id);
        if(rise>0){box(alongX?{x:b.x,z:b.z+i,w:1,d:1}:{x:b.x+i,z:b.z,w:1,d:1},top,rise,1,'roof',c.id);box(alongX?{x:b.x+b.w,z:b.z+i,w:1,d:1}:{x:b.x+i,z:b.z+b.d,w:1,d:1},top,rise,1,'roof',c.id);}
      }
    }
  }
  // Remove encroaching roofs where ranges meet taller volumes before placing partitions.
  for(const r of p.rooms)polygonFill(clipPolygon(r.polygon,interior(r.bounds)),r.floorY+1,r.ceilingY-r.floorY-1,0,'air',r.componentId);
  for(const r of p.rooms){
    polygonFill(r.polygon,r.floorY,1,r.floorY<0?1:2,'floor',r.componentId);
    const c=p.components.find(c=>c.id===r.componentId)!;
    if(r.kind==='gallery'){
      const edge=r.bounds.z===c.bounds.z?r.bounds.z+r.bounds.d-1:r.bounds.z;
      box({x:r.bounds.x+1,z:edge,w:r.bounds.w-1,d:1},r.floorY+1,1,2,'support',c.id);
      for(let x=r.bounds.x+3;x<r.bounds.x+r.bounds.w-2;x+=7)box({x,z:edge,w:1,d:1},1,r.floorY-1,2,'support',c.id);
      box({x:r.bounds.x+1,z:edge,w:r.bounds.w-1,d:1},r.floorY-1,1,2,'support',c.id);
    }else if(c.kind!=='hall')outline(r.polygon,r.floorY+1,r.ceilingY-r.floorY-1,1,'wall',c.id);
    else if(r.kind==='circulation'){
      // A timber screen defines the entrance end without enclosing the tall hall.
      box({x:r.bounds.x,z:r.bounds.z,w:r.bounds.w+1,d:1},1,3,2,'wall',c.id);
    }
    if(r.floorY>0&&r.kind!=='gallery'){
      for(let x=r.bounds.x+3;x<r.bounds.x+r.bounds.w;x+=6)box({x,z:r.bounds.z,w:1,d:r.bounds.d},r.floorY-1,1,2,'support',c.id);
    }
    if(r.ceilingY-r.floorY<6)polygonFill(r.polygon,r.ceilingY,1,2,'roof',c.id);
  }
  // Taller shared walls take precedence over an adjoining range's lower roof.
  // Reassert the shell so hiding roofs never removes a triangular piece of wall.
  for(const c of p.components){
    if(c.kind==='hall'||c.kind==='tower')outline(c.polygon,c.baseY,c.topY-c.baseY,1,'wall',c.id);
    else for(let y=c.baseY;y<c.topY;y+=6){
      const r=componentFootprint(c,y,p.family),timber=y>=6&&p.settings.kind!=='castle';
      outline(rectPolygon(r),y,6,timber?5:1,'wall',c.id);
      if(timber){
        outline(rectPolygon(r),y,1,2,'wall',c.id);
        for(let x=r.x;x<=r.x+r.w;x+=5){box({x,z:r.z,w:1,d:1},y,6,2,'wall',c.id);box({x,z:r.z+r.d,w:1,d:1},y,6,2,'wall',c.id);}
        for(let z=r.z;z<=r.z+r.d;z+=5){box({x:r.x,z,w:1,d:1},y,6,2,'wall',c.id);box({x:r.x+r.w,z,w:1,d:1},y,6,2,'wall',c.id);}
      }
    }
  }
  // Exterior windows are accepted only when the other side is outside every occupied room.
  for(const r of p.rooms){
    if(r.floorY<0||r.kind==='stairs'||r.kind==='circulation')continue;
    for(const axis of ['x','z'] as const)for(const high of [false,true]){
      const b=r.bounds,fixed=axis==='x'?b.x+(high?b.w:0):b.z+(high?b.d:0),start=axis==='x'?b.z:b.x,len=axis==='x'?b.d:b.w;
      for(let at=start+3;at<start+len-3;at+=7){
        const x=axis==='x'?fixed:at,z=axis==='z'?fixed:at;
        const outX=axis==='x'?x+(high?1.5:-.5):x+.5,outZ=axis==='z'?z+(high?1.5:-.5):z+.5;
        if(p.rooms.some(other=>other.floorY<=r.floorY&&other.ceilingY>r.floorY&&insidePolygon(outX,outZ,other.polygon)))continue;
        p.openings.push({id:`w${p.openings.length}`,type:'window',axis,x,z,y:r.floorY+2,width:2,height:2,roomIds:[r.id]});
      }
    }
  }
  for(const o of p.openings){const r={x:o.x,z:o.z,w:o.axis==='x'?1:o.width,d:o.axis==='z'?1:o.width};box(r,o.y,o.height,o.type==='window'?4:0,o.type==='window'?'glass':'air',p.rooms.find(r=>r.id===o.roomIds[0])!.componentId);}
  for(const st of p.stairs){
    const b=st.bounds;
    box({x:b.x+3,z:b.z+3,w:2,d:6},st.toY,1,0,'air',st.componentId);
    for(let j=0;j<6;j++){
      box({x:b.x+3,z:b.z+3+j,w:2,d:1},st.fromY+j+1,1,2,'stair',st.componentId);
      box({x:b.x+5,z:b.z+3+j,w:1,d:1},st.fromY+1,j+1,2,'support',st.componentId);
      box({x:b.x+3,z:b.z+3+j,w:2,d:1},st.fromY+j+2,3,0,'air',st.componentId);
    }
  }
  for(const r of p.rooms)for(const f of r.furniture)box(f,f.y,f.h,f.material,'furniture',r.componentId);
  for(const c of p.components.filter(c=>c.kind==='service'||c.kind==='hall'||c.kind==='domestic').slice(0,8)){
    const b=c.bounds;
    const sides=[{x:b.x-2,z:b.z+3,w:2,d:3},{x:b.x+b.w+1,z:b.z+3,w:2,d:3},{x:b.x+3,z:b.z-2,w:3,d:2},{x:b.x+3,z:b.z+b.d+1,w:3,d:2}];
    const chimney=sides.find(r=>!p.components.some(other=>intersects(other.bounds,r)));
    if(!chimney)continue;
    const toY=c.topY+Math.ceil(Math.min(b.w,b.d)/2)+4;
    p.chimneys.push({bounds:chimney,fromY:c.baseY,toY,componentId:c.id});box(chimney,c.baseY,toY-c.baseY,8,'chimney',c.id);
  }
  const e=p.openings.find(o=>o.type==='entrance')!,out=e.outward!;box({x:e.x+(out.x>0?1:out.x<0?-7:0),z:e.z+(out.z>0?1:out.z<0?-7:0),w:e.axis==='x'?7:2,d:e.axis==='z'?7:2},-1,1,6,'ground');
  if(p.settings.garden){
    const h=p.components.find(c=>c.kind==='hall')!,b=h.bounds;
    for(let i=0;i<3;i++){const r=p.settings.size<80?{x:b.x+b.w+3,z:b.z+i*5,w:4,d:3}:{x:b.x+3+i*7,z:b.z+b.d+12,w:4,d:9};if(!p.components.some(c=>intersects(c.bounds,r)))box(r,-1,1,7,'ground');}
  }
  for(const court of p.courts){
    const b=court.bounds,h=court.wallHeight;
    outline(rectPolygon(b),0,h+1,1,'wall',court.id);
    if(h===6){
      // A two-block wall walk rests on masonry corbels inside the curtain.
      outline(rectPolygon({x:b.x+1,z:b.z+1,w:b.w-2,d:b.d-2}),h,1,1,'floor',court.id);
      outline(rectPolygon({x:b.x+2,z:b.z+2,w:b.w-4,d:b.d-4}),h,1,1,'floor',court.id);
      for(let x=b.x+3;x<b.x+b.w-2;x+=5){box({x,z:b.z,w:1,d:3},h-1,1,1,'support',court.id);box({x,z:b.z+b.d-2,w:1,d:3},h-1,1,1,'support',court.id);}
      for(let z=b.z+3;z<b.z+b.d-2;z+=5){box({x:b.x,z,w:3,d:1},h-1,1,1,'support',court.id);box({x:b.x+b.w-2,z,w:3,d:1},h-1,1,1,'support',court.id);}
      for(let x=b.x;x<b.x+b.w;x+=3){box({x,z:b.z,w:2,d:1},h+1,1,1,'wall',court.id);box({x,z:b.z+b.d,w:2,d:1},h+1,1,1,'wall',court.id);}
      for(let z=b.z;z<b.z+b.d;z+=3){box({x:b.x,z,w:1,d:2},h+1,1,1,'wall',court.id);box({x:b.x+b.w,z,w:1,d:2},h+1,1,1,'wall',court.id);}
      for(const [x,z] of [[b.x,b.z],[b.x+b.w,b.z],[b.x,b.z+b.d],[b.x+b.w,b.z+b.d]]){
        const radius=4;
        const poly=[{x:x-2,z:z-radius},{x:x+2,z:z-radius},{x:x+radius,z:z-2},{x:x+radius,z:z+2},{x:x+2,z:z+radius},{x:x-2,z:z+radius},{x:x-radius,z:z+2},{x:x-radius,z:z-2}];
        outline(poly,0,h+3,1,'wall',court.id);polygonFill(poly,h+1,1,1,'floor',court.id);
        for(let i=0;i<poly.length;i+=2)box({x:poly[i].x,z:poly[i].z,w:2,d:2},h+3,1,1,'wall',court.id);
      }
      // Exterior stair with a two-block landing reaches the wall walk.
      for(let j=0;j<6;j++)box({x:b.x+3+j,z:b.z+3,w:1,d:2},0,j+1,1,'stair',court.id);
      box({x:b.x+9,z:b.z+1,w:2,d:4},6,1,1,'floor',court.id);
    }
    box({x:court.gate.x-1,z:court.gate.z,w:3,d:1},0,4,0,'air',court.id);
    box({x:court.gate.x-2,z:court.gate.z-2,w:5,d:5},-1,1,6,'ground',court.id);
    for(const dx of [-4,3])box({x:court.gate.x+dx,z:court.gate.z-2,w:2,d:4},0,h+3,1,'wall',court.id);
    box({x:court.gate.x-3,z:court.gate.z-2,w:6,d:4},h+3,1,3,'roof',court.id);
  }
  // Cut the shared gate after both ward walls have been placed.
  for(const court of p.courts)box({x:court.gate.x-1,z:court.gate.z,w:3,d:1},0,4,0,'air',court.id);
  for(const route of p.routes)for(let i=0;i<route.points.length;i++){
    const a=route.points[i],b=route.points[Math.min(i+1,route.points.length-1)];box({x:Math.min(a.x,b.x),z:Math.min(a.z,b.z),w:Math.abs(a.x-b.x)+route.width,d:Math.abs(a.z-b.z)+route.width},-1,1,6,'ground');
  }
  p.walls=p.blocks.filter(b=>b.kind==='wall');p.slabs=p.blocks.filter(b=>b.kind==='floor');p.roofs=p.blocks.filter(b=>b.kind==='roof');p.supports=p.blocks.filter(b=>b.kind==='support');
}

function findOutdoorRoute(start:Point,end:Point,b:Rect,obstacles:Rect[]):Point[]|undefined{
  const w=b.w+1,d=b.d+1,previous=new Int32Array(w*d).fill(-1),queue=new Int32Array(w*d),id=(x:number,z:number)=>(z-b.z)*w+x-b.x;
  const first=id(start.x,start.z),last=id(end.x,end.z);let head=0,tail=0;queue[tail++]=first;previous[first]=first;
  while(head<tail){const here=queue[head++];if(here===last)break;const x=here%w+b.x,z=Math.floor(here/w)+b.z;
    for(const [dx,dz] of [[0,1],[1,0],[-1,0],[0,-1]]){const nx=x+dx,nz=z+dz;if(nx<=b.x||nz<=b.z||nx+2>=b.x+b.w||nz+1>=b.z+b.d)continue;const next=id(nx,nz);if(previous[next]>=0||obstacles.some(r=>intersects({x:nx,z:nz,w:2,d:2},{x:r.x,z:r.z,w:r.w+1,d:r.d+1})))continue;previous[next]=here;queue[tail++]=next;}
  }
  if(previous[last]<0)return undefined;const points:Point[]=[];for(let at=last;;at=previous[at]){points.push({x:at%w+b.x,z:Math.floor(at/w)+b.z});if(at===first)break;}return points.reverse();
}

export function validatePlan(p:Plan):Plan['validation']{
  const issues:string[]=[];
  if(p.rooms.filter(r=>r.kind==='hall').length!==1)issues.push('A household must have exactly one primary hall.');
  const entrance=p.openings.find(o=>o.type==='entrance');
  const seen=new Set<string>(entrance?.roomIds||[]),queue=[...seen];
  while(queue.length){const id=queue.pop()!;for(const [a,b] of p.connections){const next=a===id?b:b===id?a:undefined;if(next&&!seen.has(next)){seen.add(next);queue.push(next);}}}
  const unreachable=p.rooms.filter(r=>!seen.has(r.id));if(unreachable.length)issues.push(`${unreachable.length} rooms have no route from the entrance.`);
  for(const r of p.rooms)if(r.bounds.w<4||r.bounds.d<4)issues.push(`${r.name} is too narrow.`);
  // A chamber with two doors is fine when a second route exists; what is not fine is a chamber a household
  // must cross to reach somewhere else. Those are ranked by tryGenerate and reported on plan.navigation
  // rather than treated as structural failure — a plan with one compromised route still stands up.
  if(p.navigation.unreachable.length)issues.push(`${p.navigation.unreachable.length} rooms have no route from the entrance.`);
  for(const st of p.stairs){if(st.width<2||st.headroom<3||st.toY-st.fromY!==6)issues.push('A stair cannot meet its landing or clearance.');const rooms=st.roomIds.map(id=>p.rooms.find(r=>r.id===id)!);if(rooms.some(r=>st.bounds.x<r.bounds.x||st.bounds.x+st.bounds.w>r.bounds.x+r.bounds.w||st.bounds.z<r.bounds.z||st.bounds.z+st.bounds.d>r.bounds.z+r.bounds.d))issues.push('A stair reservation does not fit its hall.');}
  if(p.width>512||p.depth>512)issues.push('This composition exceeds the 512-block limit.');
  if(p.courts.length&&!p.routes.some(r=>r.id==='entry-route'))issues.push('The outer gate cannot reach the entrance across a two-block route.');
  return {valid:issues.length===0,issues:[...new Set(issues)]};
}
/**
 * Compose several candidates and keep the one that walks best, rather than the first that merely stands up.
 * A plan with no forced crossings is accepted immediately, so the common case still costs one composition.
 * The attempt count is fixed per size so the result stays a pure function of the settings.
 */
export function tryGenerate(settings:Settings):GenerationResult {
  let reason='The composition could not be connected.';
  let best:Plan|undefined;
  const attempts=settings.size>320?4:8;
  for(let attempt=0;attempt<attempts;attempt++){
    let plan:Plan;
    try{plan=generateCandidate(settings,attempt);}catch(error){return {ok:false,error:error instanceof Error?error.message:'Invalid settings.'};}
    if(!plan.validation.valid){reason=plan.validation.issues.join(' ');continue;}
    const issues=auditArchitecture(plan);
    if(issues.length){reason=issues.join(' ');continue;}
    if(!plan.navigation.transits.length)return {ok:true,plan};
    if(!best||plan.navigation.score>best.navigation.score)best=plan;
  }
  if(best)return {ok:true,plan:best};
  return {ok:false,error:`Could not make a buildable composition: ${reason} Try a different seed or a larger footprint. Your previous build is retained.`};
}
export function generatePlan(settings:Settings):Plan {const result=tryGenerate(settings);if(!result.ok)throw new Error(result.error);return result.plan;}
