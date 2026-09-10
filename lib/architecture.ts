import { FAMILIES, rectPolygon, intersects, insidePolygon, componentFootprint, type Settings, type Plan, type Rect, type Point, type Room, type RoomKind, type BuildingComponent, type ComponentKind, type Opening, type Suite, type Court, type GenerationResult, type BlockBox } from './model.ts';
import { isCirculation, navigationReport, articulationPoints, HALL_END, IMPROPER_DOORS, ROOM_PRIVACY } from './navigation.ts';
import { auditArchitecture } from './architectural-audit.ts';
import { bayLines, compositionReport } from './composition.ts';

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
const BAND=4,SPUR=4,MIN_ROOM=5;
/** Past this a single rank of rooms off one flank stops being rooms and starts being deep halls. */
const RANK_DEEP=17;
/** A strip shallower than this holds a room's walls and its doorway and nothing a household could use. */
const ROOMY=MIN_ROOM+3;
export type RoomShape='rect'|'canted'|'apse'|'octagon'|'ell'|'dais';
/**
 * How long a room wants to be along its rank, as a multiple of the rank's depth, and how far from square
 * it is allowed to go before it stops being that kind of room at all. A minimum area alone is satisfied by
 * a strip ninety blocks long; these are the upper bounds that stop a pantry absorbing a whole wing.
 */
export const ROOM_FIT:Record<RoomKind,{share:number;aspect:number;max:number}>={
  hall:{share:1.7,aspect:2.6,max:900},court:{share:1.2,aspect:2.2,max:5000},
  gallery:{share:3,aspect:8,max:600},circulation:{share:3,aspect:12,max:600},stairs:{share:.9,aspect:2,max:150},
  sacred:{share:1.8,aspect:3,max:500},
  bedroom:{share:.95,aspect:1.9,max:280},study:{share:1,aspect:2,max:320},service:{share:1.15,aspect:2.1,max:360},storage:{share:.6,aspect:2.2,max:220},
};
/** Corners cut back at forty-five degrees. The straight runs between them still carry the doors. */
function cantedPolygon(b:Rect,cut:number):Point[] {
  const c=Math.max(1,Math.min(cut,Math.floor((b.w-4)/2),Math.floor((b.d-4)/2)));
  if(c<1)return rectPolygon(b);
  return [{x:b.x+c,z:b.z},{x:b.x+b.w-c,z:b.z},{x:b.x+b.w,z:b.z+c},{x:b.x+b.w,z:b.z+b.d-c},
    {x:b.x+b.w-c,z:b.z+b.d},{x:b.x+c,z:b.z+b.d},{x:b.x,z:b.z+b.d-c},{x:b.x,z:b.z+c}];
}
/** One end swept into a stepped half-round, the way a chapel closes on its altar. */
function apsidalPolygon(b:Rect,side:'n'|'s'|'e'|'w'):Point[] {
  const across=side==='e'||side==='w'?b.d:b.w,depth=Math.min(Math.floor(across/2),Math.floor((side==='e'||side==='w'?b.w:b.d)/2));
  if(depth<2||across<6)return rectPolygon(b);
  const radius=depth,steps=Math.max(4,radius*2);
  const arc:Point[]=[];
  for(let i=0;i<=steps;i++){
    const angle=Math.PI*(i/steps)-Math.PI/2,along=Math.round(Math.sin(angle)*(across/2)),out=Math.round(Math.cos(angle)*radius);
    const midAlong=(side==='e'||side==='w'?b.z+b.d/2:b.x+b.w/2);
    if(side==='e')arc.push({x:b.x+b.w-radius+out,z:Math.round(midAlong+along)});
    else if(side==='w')arc.push({x:b.x+radius-out,z:Math.round(midAlong-along)});
    else if(side==='s')arc.push({x:Math.round(midAlong-along),z:b.z+b.d-radius+out});
    else arc.push({x:Math.round(midAlong+along),z:b.z+radius-out});
  }
  if(side==='e')return [{x:b.x,z:b.z},{x:b.x+b.w-radius,z:b.z},...arc,{x:b.x+b.w-radius,z:b.z+b.d},{x:b.x,z:b.z+b.d}];
  if(side==='w')return [{x:b.x+radius,z:b.z+b.d},{x:b.x+b.w,z:b.z+b.d},{x:b.x+b.w,z:b.z},{x:b.x+radius,z:b.z},...arc];
  if(side==='s')return [{x:b.x,z:b.z},{x:b.x+b.w,z:b.z},{x:b.x+b.w,z:b.z+b.d-radius},...arc,{x:b.x,z:b.z+b.d-radius}];
  return [{x:b.x+b.w,z:b.z+b.d},{x:b.x,z:b.z+b.d},{x:b.x,z:b.z+radius},...arc,{x:b.x+b.w,z:b.z+radius}];
}
/** A rectangle with one corner given over to a closet, which keeps its own frontage on the passage. */
function ellPolygon(b:Rect,notch:Rect):Point[] {
  const west=notch.x===b.x,north=notch.z===b.z;
  const nx=west?b.x+notch.w:notch.x,nz=north?b.z+notch.d:notch.z;
  if(west&&north)return [{x:nx,z:b.z},{x:b.x+b.w,z:b.z},{x:b.x+b.w,z:b.z+b.d},{x:b.x,z:b.z+b.d},{x:b.x,z:nz},{x:nx,z:nz}];
  if(!west&&north)return [{x:b.x,z:b.z},{x:nx,z:b.z},{x:nx,z:nz},{x:b.x+b.w,z:nz},{x:b.x+b.w,z:b.z+b.d},{x:b.x,z:b.z+b.d}];
  if(west)return [{x:b.x,z:b.z},{x:b.x+b.w,z:b.z},{x:b.x+b.w,z:b.z+b.d},{x:nx,z:b.z+b.d},{x:nx,z:nz},{x:b.x,z:nz}];
  return [{x:b.x,z:b.z},{x:b.x+b.w,z:b.z},{x:b.x+b.w,z:nz},{x:nx,z:nz},{x:nx,z:b.z+b.d},{x:b.x,z:b.z+b.d}];
}
/**
 * The corners at one end cut back, the way a great hall widens its floor toward the dais. A corner another
 * range stands against is left square: that is where its door has to go, and a splay leaves no wall for one.
 */
export type DaisCorners='both'|'lo'|'hi'|'none';
function daisPolygon(b:Rect,side:'n'|'s'|'e'|'w',corners:DaisCorners='both'):Point[] {
  const across=side==='e'||side==='w'?b.d:b.w;
  const c=Math.max(2,Math.min(Math.floor(across/5),Math.floor((across-4)/2)));
  if(c<2||corners==='none')return rectPolygon(b);
  // `lo` is the corner at the low coordinate along the end wall, `hi` the one at the high coordinate.
  const lo=corners==='both'||corners==='lo',hi=corners==='both'||corners==='hi';
  const x0=b.x,x1=b.x+b.w,z0=b.z,z1=b.z+b.d;
  if(side==='n')return [...(lo?[{x:x0+c,z:z0}]:[{x:x0,z:z0}]),...(hi?[{x:x1-c,z:z0},{x:x1,z:z0+c}]:[{x:x1,z:z0}]),{x:x1,z:z1},{x:x0,z:z1},...(lo?[{x:x0,z:z0+c}]:[])];
  if(side==='s')return [{x:x0,z:z0},{x:x1,z:z0},...(hi?[{x:x1,z:z1-c},{x:x1-c,z:z1}]:[{x:x1,z:z1}]),...(lo?[{x:x0+c,z:z1},{x:x0,z:z1-c}]:[{x:x0,z:z1}])];
  if(side==='e')return [{x:x0,z:z0},...(lo?[{x:x1-c,z:z0},{x:x1,z:z0+c}]:[{x:x1,z:z0}]),...(hi?[{x:x1,z:z1-c},{x:x1-c,z:z1}]:[{x:x1,z:z1}]),{x:x0,z:z1}];
  return [...(lo?[{x:x0+c,z:z0}]:[{x:x0,z:z0}]),{x:x1,z:z0},{x:x1,z:z1},...(hi?[{x:x0+c,z:z1},{x:x0,z:z1-c}]:[{x:x0,z:z1}]),...(lo?[{x:x0,z:z0+c}]:[])];
}
function shapePolygon(b:Rect,shape:RoomShape,side:'n'|'s'|'e'|'w',notch?:Rect,corners?:DaisCorners):Point[] {
  if(shape==='dais')return daisPolygon(b,side,corners);
  if(shape==='ell'&&notch)return ellPolygon(b,notch);
  if(shape==='canted')return cantedPolygon(b,Math.max(2,Math.floor(Math.min(b.w,b.d)/6)));
  if(shape==='octagon')return cantedPolygon(b,Math.floor(Math.min(b.w,b.d)/3));
  if(shape==='apse')return apsidalPolygon(b,side);
  return rectPolygon(b);
}
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
  const reference=s.seed==='HALL-CROSSWING'&&s.kind==='manor'&&family==='crosswing'&&s.size===128;
  const components:BuildingComponent[]=[];
  // Which build a range belongs to. Nothing here simulates history by moving vertices about: a phase is a
  // fact about a volume that the masonry, the roof and the windows are then answerable to.
  //
  // Phase 0 is reserved for inherited fabric: a core that was already standing when the household began
  // building against it. Not every seat grew that way — a formal quadrangle is raised in one campaign, and
  // one raised all at once has no seam, no retained wall and one rhythm across every facade. Such a plan
  // starts at phase 1 and stays there. The choice is taken off the seed rather than the running sequence,
  // so it does not shift the composition a seed already produces.
  const unified=['courtyard-manor','palace'].includes(family)||hash(`${s.seed}:${family}:unified`)%4===0;
  let phase=unified?1:0;
  /** Begin a later build, unless this composition was raised in a single campaign. */
  const build=(n:number)=>{phase=unified?1:n;};
  const small=s.size<80, organic=s.organic/100;
  const hallW=small?16:ri(20,26),hallD=small?22:ri(32,40);
  function add(kind:ComponentKind,name:string,bounds:Rect,storeys:number,parent?:BuildingComponent,roof?:BuildingComponent['roof']) {
    if(components.some(c=>intersects(c.bounds,bounds)))return undefined;
    const chamfer=kind==='tower'?Math.min(4,Math.floor(bounds.w/5)):0;
    const {x,z,w,d}=bounds;
    const polygon=chamfer?[{x:x+chamfer,z},{x:x+w-chamfer,z},{x:x+w,z:z+chamfer},{x:x+w,z:z+d-chamfer},{x:x+w-chamfer,z:z+d},{x:x+chamfer,z:z+d},{x,z:z+d-chamfer},{x,z:z+chamfer}]:rectPolygon(bounds);
    const c:BuildingComponent={id:`c${components.length}`,name,kind,bounds,polygon,baseY:0,storeys,topY:kind==='hall'?Math.min(18,s.floors*6):storeys*6,roof:roof||(kind==='tower'?(s.kind==='castle'&&rng()<.55?'battlement':'pyramid'):(kind==='workshop'&&rng()<.3?'gable-x':w>d?'gable-x':'gable-z')),parentId:parent?.id,phase};
    components.push(c); return c;
  }
  function attach(parent:BuildingComponent,kind:ComponentKind,name:string,side:'n'|'s'|'e'|'w',w:number,d:number,storeys:number,offset?:number) {
    const b=parent.bounds;
    const shift=offset??Math.round((rng()-.5)*organic*8);
    const bounds:Rect=side==='e'?{x:b.x+b.w,z:b.z+Math.floor((b.d-d)/2)+shift,w,d}:side==='w'?{x:b.x-w,z:b.z+Math.floor((b.d-d)/2)+shift,w,d}:side==='n'?{x:b.x+Math.floor((b.w-w)/2)+shift,z:b.z-d,w,d}:{x:b.x+Math.floor((b.w-w)/2)+shift,z:b.z+b.d,w,d};
    return add(kind,name,bounds,Math.max(1,Math.min(s.floors,storeys)),parent);
  }
  let hall:BuildingComponent,domestic:BuildingComponent|undefined,service:BuildingComponent|undefined;
  let gatehouse:BuildingComponent|undefined;
  const quadrangle=family==='courtyard-castle'&&s.size>=128;
  if(quadrangle){
    const span=(share:number,low:number,high:number)=>Math.max(low,Math.min(high,Math.round(s.size*share)));
    const courtW=span(.22,22,56),courtD=span(.24,22,60);
    // A court range is one rank of rooms deep behind its walk. Anything wider stops fronting the yard and
    // starts being a block with a corridor in it, so the budget goes into the court, not into the wing.
    const hallD=Math.max(courtW+6,span(.26,26,72)),wing=Math.min(span(.16,16,26),BAND+1+RANK_DEEP),gateD=span(.13,14,30);
    // Stage B: the court and the way in come first and everything else is set against them.
    add('court','Inner court',{x:0,z:0,w:courtW,d:courtD},1);
    // Stage C: the hall closes the head of the court, its screens end opening onto the yard.
    hall=add('hall','Great hall',{x:0,z:-hallD,w:courtW,d:hallD},1)!;
    domestic=add('domestic','Solar wing',{x:-wing,z:-hallD,w:wing,d:hallD+courtD+gateD},s.floors);
    service=add('service','Kitchen range',{x:courtW,z:-hallD,w:wing,d:hallD+courtD+gateD},Math.min(2,s.floors));
    gatehouse=add('gatehouse','Gatehouse',{x:0,z:courtD,w:courtW,d:gateD},Math.min(2,s.floors));
  }else if(family==='hall-house'){
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
  // The core stands; everything after it is a later build against what was already there.
  build(1);
  // A chapel belongs to the lord's side of the house: off the great chamber or the hall, reached without
  // crossing the kitchens. The service range is a last resort, and even then the chapel keeps its own antechapel.
  if(!small&&s.chapel&&s.kind!=='house'){
    const chapelHosts=[domestic?.kind==='tower'?undefined:domestic,hall,domestic,service].filter(Boolean) as BuildingComponent[];
    outer: for(const c of chapelHosts)for(const side of ['n','e','w','s'] as const){
      const chapel=attach(c,'chapel','Chapel',side,16,24,1,0);
      if(chapel){chapel.parentId=c.id;break outer;}
    }
  }
  const porch=quadrangle?gatehouse:attach(hall,'gatehouse',s.kind==='castle'?'Inner gate':'Entrance porch','s',small?8:12,8,1,0);
  // ---- Stage A. What the estate still has to house once its core stands, and the shape that floor wants.
  // A rectangle of arbitrary size gives every addition the same proportions and the same reading; a lodging
  // range is long and one rank deep because that is what a rank of chambers is, and a service court is a
  // compact block because that is what brewing and baking are.
  const RANGE=BAND+RANK_DEEP+1,BLOCK=2*RANK_DEEP+BAND+2;
  type Need={name:string;kind:ComponentKind;across:number;along:number;storeys:number};
  function programme():Need[]{
    if(reference||small||quadrangle)return [];
    const budget=Math.max(0,s.size-80),needs:Need[]=[],estate=family==='accumulated-estate'||family==='annex-house';
    const push=(count:number,make:(i:number)=>Need)=>{for(let i=0;i<count;i++)needs.push(make(i));};
    const where=(i:number)=>sectors[(i*3+needs.length)%sectors.length];
    push(Math.round(budget/96)+(estate?1:0),i=>({name:`${where(i)} lodgings`,kind:'lodging',across:RANGE,along:ri(34,50),storeys:Math.max(1,Math.min(s.floors,2+i%2))}));
    push(Math.round(budget/128)+(estate?1:0),i=>({name:`${where(i)} service court`,kind:'service',across:BLOCK,along:ri(26,34),storeys:1}));
    push(Math.round(budget/150)+(s.kind==='house'?1:0),i=>({name:`${where(i)} workshops`,kind:'workshop',across:ri(20,26),along:ri(24,32),storeys:1}));
    push(s.kind==='castle'?Math.min(3,Math.round(budget/150)):0,i=>({name:`${where(i)} tower`,kind:'tower',across:ri(18,22),along:ri(18,22),storeys:Math.max(2,s.floors)}));
    push(Math.round(budget/180),i=>({name:`${where(i)} household`,kind:'domestic',across:RANGE,along:ri(28,38),storeys:Math.max(1,Math.min(s.floors,3))}));
    return needs;
  }
  // ---- Stage B/C. How a volume may be set against what is already there. Three moves, each with its own
  // preconditions, rather than one move with a random side: a wing square to its host, a range across an
  // open yard from it, and a range dropped into a gap two masses have already left facing each other.
  const hosts=()=>components.filter(c=>c.kind!=='gatehouse'&&c.kind!=='chapel'&&c.kind!=='court');
  const margin=s.kind==='castle'?64:s.courtyard||family==='courtyard-manor'?40:12;
  const within=(r:Rect)=>{
    let minX=Math.min(0,r.x),maxX=Math.max(0,r.x+r.w),minZ=Math.min(0,r.z),maxZ=Math.max(0,r.z+r.d);
    for(const c of components){
      minX=Math.min(minX,c.bounds.x);maxX=Math.max(maxX,c.bounds.x+c.bounds.w);
      minZ=Math.min(minZ,c.bounds.z);maxZ=Math.max(maxZ,c.bounds.z+c.bounds.d);
    }
    return maxX-minX<=s.size-margin&&maxZ-minZ<=s.size-margin;
  };
  // The ground in front of the door is reserved before anything else is placed on the site. A range built
  // across the approach leaves a house you cannot walk up to, whatever its plan says about being connected.
  const approach=porch?{x:porch.bounds.x-8,z:porch.bounds.z+porch.bounds.d,w:porch.bounds.w+16,d:26}:undefined;
  const free=(r:Rect)=>r.w>0&&r.d>0&&!components.some(c=>intersects(c.bounds,r))&&!(approach&&intersects(approach,r))&&within(r);
  /** Where a volume of this need sits against `parent`: aligned on one end of it, or centred on it. */
  function seat(parent:BuildingComponent,side:'n'|'s'|'e'|'w',need:Need,align:-1|0|1,gap=0):Rect{
    const b=parent.bounds,flat=side==='e'||side==='w';
    const w=flat?need.across:need.along,d=flat?need.along:need.across;
    const slide=(room:number)=>align<0?0:align>0?room:Math.floor(room/2);
    if(side==='e')return {x:b.x+b.w+gap,z:b.z+slide(b.d-d),w,d};
    if(side==='w')return {x:b.x-w-gap,z:b.z+slide(b.d-d),w,d};
    if(side==='n')return {x:b.x+slide(b.w-w),z:b.z-d-gap,w,d};
    return {x:b.x+slide(b.w-w),z:b.z+b.d+gap,w,d};
  }
  /** A wing square to its host, aligned on one of its ends or centred: an L, a T or a stepped range. */
  function opWing(need:Need,parent:BuildingComponent,side:'n'|'s'|'e'|'w',align:-1|0|1){
    const r=seat(parent,side,need,align);
    return free(r)?add(need.kind,need.name,r,need.storeys,parent):undefined;
  }
  /**
   * A second range set off across an open yard, with the yard itself part of the composition rather than
   * whatever is left outside the walls. Only the stretch the two ranges share is paved: the ends stay open,
   * which is where a later range can close the court into a quadrangle.
   */
  function opCourtRange(need:Need,parent:BuildingComponent,side:'n'|'s'|'e'|'w',gap:number){
    const b=parent.bounds,r=seat(parent,side,need,0,gap),flat=side==='e'||side==='w';
    const lo=flat?Math.max(b.z,r.z):Math.max(b.x,r.x),hi=flat?Math.min(b.z+b.d,r.z+r.d):Math.min(b.x+b.w,r.x+r.w);
    if(hi-lo<12)return undefined;
    const yard:Rect=side==='e'?{x:b.x+b.w,z:lo,w:gap,d:hi-lo}:side==='w'?{x:r.x+r.w,z:lo,w:gap,d:hi-lo}
      :side==='n'?{x:lo,z:r.z+r.d,w:hi-lo,d:gap}:{x:lo,z:b.z+b.d,w:hi-lo,d:gap};
    if(!free(r)||!free(yard))return undefined;
    const made=add(need.kind,need.name,r,need.storeys,parent);
    if(made)add('court',`${need.name.split(' ')[0]} yard`,yard,1,parent);
    return made;
  }
  /** A range dropped into a gap two masses already leave facing each other, joining them into one range. */
  function opCross(need:Need){
    const all=hosts();
    for(let i=0;i<all.length;i++)for(let j=0;j<all.length;j++){
      if(i===j)continue;
      const A=all[i].bounds,B=all[j].bounds;
      const gapX=B.x-(A.x+A.w),lapZ=Math.min(A.z+A.d,B.z+B.d)-Math.max(A.z,B.z);
      if(gapX>=12&&gapX<=36&&lapZ>=12){
        const r={x:A.x+A.w,z:Math.max(A.z,B.z),w:gapX,d:Math.min(lapZ,need.along)};
        if(r.d>=12&&free(r))return add(need.kind,need.name,r,need.storeys,all[i]);
      }
      const gapZ=B.z-(A.z+A.d),lapX=Math.min(A.x+A.w,B.x+B.w)-Math.max(A.x,B.x);
      if(gapZ>=12&&gapZ<=36&&lapX>=12){
        const r={x:Math.max(A.x,B.x),z:A.z+A.d,w:Math.min(lapX,need.along),d:gapZ};
        if(r.w>=12&&free(r))return add(need.kind,need.name,r,need.storeys,all[i]);
      }
    }
    return undefined;
  }
  const wanted=programme();
  for(const [order,need] of wanted.entries()){
    // An estate is not raised all at once: each pair of additions belongs to a later build than the last.
    build(Math.min(3,1+Math.floor(order/2)));
    // A cross-range is the strongest move where the composition has already left a gap, so it is offered
    // first; otherwise the seed decides between a wing and a range across a yard.
    let made=rng()<.5?opCross(need):undefined;
    for(let k=0;k<24&&!made;k++){
      const parents=hosts(),parent=parents[Math.floor(rng()*parents.length)];
      const side=(['n','s','e','w'] as const)[Math.floor(rng()*4)];
      const align=([-1,0,1] as const)[Math.floor(rng()*3)];
      const yard=rng()<.34;
      made=yard?opCourtRange(need,parent,side,ri(14,22)):opWing(need,parent,side,align);
    }
  }
  build(3);
  if(family==='keep-bailey'&&!small&&domestic)attach(domestic,'workshop','Garrison range','n',26,34,Math.min(2,s.floors),0);
  if(family==='double-ward'&&!small){const end=[...components].sort((a,b)=>b.bounds.x+b.bounds.w-a.bounds.x-a.bounds.w)[0];attach(end,'gatehouse','Outer ward gate','e',16,14,1,0);}
  // A core is only inherited if something was later built against it. Where the budget allowed nothing else,
  // what stands is simply the one build there ever was, and it is treated as such.
  if(!components.some(c=>c.phase>0))for(const c of components)c.phase=1;
  // Compact budgets keep the same minimum stair and room sizes; optional ranges are omitted.
  const p:Plan={schemaVersion:2,generatorVersion:'2.0',name:reference?'Alderhall Manor':`${pick(names)}${pick(['wick','mere','ford','haven'])} ${s.kind==='castle'?'Castle':s.kind==='manor'?'Manor':'House'}`,settings:s,family,components,rooms:[],floors:[],openings:[],stairs:[],chimneys:[],courts:[],routes:[],blocks:[],walls:[],slabs:[],roofs:[],supports:[],bounds:{x:0,z:0,w:0,d:0},minY:s.cellar?-6:0,maxY:0,width:0,depth:0,totalArea:0,entry:{x:0,z:0},connections:[],suites:[],validation:{valid:true,issues:[]},navigation:{maxDepth:0,meanDepth:0,loops:0,unreachable:[],transits:[],strandedRooms:0,compromises:0,score:0},composition:{volumes:0,reach:0,spread:0,yards:0,hierarchy:0,frontage:0,score:0},signature:''};
  function room(c:BuildingComponent,name:string,kind:RoomKind,bounds:Rect,y:number,ceiling=y+6,shape:RoomShape='rect',shapeSide:'n'|'s'|'e'|'w'='e',notch?:Rect,corners?:DaisCorners){
    const envelope=c.kind==='tower'?c.polygon:rectPolygon(componentFootprint(c,y,family));
    const polygon=shape==='rect'?clipPolygon(envelope,bounds):clipPolygon(shapePolygon(bounds,shape,shapeSide,notch,corners),componentFootprint(c,y,family));
    const r:Room={id:`r${p.rooms.length}`,name,kind,componentId:c.id,bounds,polygon,holes:[],floorY:y,ceilingY:ceiling,area:(bounds.w-1)*(bounds.d-1),description:'',furniture:[]};p.rooms.push(r);return r;
  }
  // Circulation has to reach the walls where ranges meet. Where it does not, the only way to join two wings
  // is a door through somebody's chamber, which is how a kitchen ends up on the route to the chapel.
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
  /**
   * A range far deeper than it is wide is organised along its length: one passage down the flank that faces
   * the rest of the house, with a single rank of rooms behind it. Cut such a range across instead and every
   * room it holds is a strip the length of the wing, which is how a solar ends up sixty blocks long.
   * The grain is a property of the range, so it is settled once and holds for every storey.
   */
  const flankCache=new Map<string,'e'|'w'|'mid'|undefined>();
  function longFlank(c:BuildingComponent):'e'|'w'|'mid'|undefined{
    if(flankCache.has(c.id))return flankCache.get(c.id);
    const b=c.bounds;
    const eligible=c.kind==='domestic'||c.kind==='service'||c.kind==='lodging'||c.kind==='workshop';
    let answer:'e'|'w'|'mid'|undefined;
    // Deep and narrow, or wanted at both ends: either way one cross passage cannot serve the range, and
    // cutting it across leaves strips the length of the wing or a chamber standing in a neighbour's door.
    const ends=junctions(c,0);
    const bothEnds=ends.some(j=>j.side==='n')&&ends.some(j=>j.side==='s');
    if(eligible&&b.w>=17&&b.d>=MIN_ROOM*3+BAND&&(b.d>=b.w*1.7||bothEnds)){
      // A range along a court is walked on the court side, so the yard is what the rooms front and the
      // court's edge reads as an edge. Otherwise a range too deep for one rank takes the gallery down its
      // middle with a rank either side, the way a long service wing works.
      const js=junctions(c,0),onCourt=(side:'e'|'w')=>js.some(j=>j.side===side&&j.other.kind==='court');
      if(onCourt('e'))answer='e';
      else if(onCourt('w'))answer='w';
      else if(b.w-BAND-1>RANK_DEEP&&b.w>=26)answer='mid';
      else{
        let east=0,west=0;
        for(const j of js){if(j.side==='e')east+=j.hi-j.lo;else if(j.side==='w')west+=j.hi-j.lo;}
        answer=east>=west?'e':'w';
      }
    }
    flankCache.set(c.id,answer);
    return answer;
  }
  /**
   * Where a range meets one with a long grain end-on, that rank is capped with a cross passage at the end:
   * all the gallery itself presents there is its own four-block corner, which is a corner, not a threshold.
   */
  const grainCache=new Map<string,{walk:number;caps:Map<'e'|'w',{n:boolean;s:boolean}>}|undefined>();
  function grainOf(c:BuildingComponent){
    if(grainCache.has(c.id))return grainCache.get(c.id);
    const flank=longFlank(c),b=c.bounds;
    let made:{walk:number;caps:Map<'e'|'w',{n:boolean;s:boolean}>}|undefined;
    if(flank){
      const walk=flank==='e'?b.x+b.w-BAND:flank==='w'?b.x:b.x+Math.floor((b.w-BAND)/2);
      const js=junctions(c,0);
      const meets=(lo:number,hi:number,from:number,to:number)=>Math.min(hi,to)-Math.max(lo,from)>=4;
      const sides=([{outer:'e' as const,x:walk+BAND,w:b.x+b.w-walk-BAND},{outer:'w' as const,x:b.x,w:walk-b.x}])
        .filter(r=>r.w>=MIN_ROOM);
      const capped=(r:{x:number;w:number},side:'n'|'s')=>js.some(j=>j.side===side&&meets(j.lo,j.hi,r.x,r.x+r.w));
      made={walk,caps:new Map(sides.map(r=>[r.outer,{n:capped(r,'n'),s:capped(r,'s')}]))};
    }
    grainCache.set(c.id,made);return made;
  }
  /**
   * Whether a range can actually reserve the twelve-block shaft its upper floors would need. A storey with
   * no way up to it is not accommodation; it is rooms nobody can reach, so a range that cannot hold a stair
   * is held to one storey rather than given floors it cannot serve.
   */
  function canStair(c:BuildingComponent){
    const b=c.bounds,g=grainOf(c);
    if(g){
      const take=Math.max(0,...[...g.caps.values()].map(k=>(k.n?SPUR:0)+(k.s?SPUR:0)));
      return b.d-2-take>=13+MIN_ROOM;
    }
    if(b.d<28||b.w<18)return b.w>=16&&b.d>=18;
    return true;
  }
  /** Both neighbours derive the same position from the shared span, so their passages meet in the wall. */
  const spanCentre=(lo:number,hi:number,width:number)=>lo+Math.floor((hi-lo-width)/2);
  /** The areas a strip is left with once a passage has been run out to a shared wall through it. */
  function spurSplit(strip:Rect,axis:'x'|'z',spans:{lo:number;hi:number}[]):{slots:Rect[];spur?:Rect}{
    if(strip.w<MIN_ROOM||strip.d<MIN_ROOM)return {slots:[]};
    const base=axis==='x'?strip.x:strip.z,run=axis==='x'?strip.w:strip.d;
    const part=(at:number,len:number)=>axis==='x'?{...strip,x:at,w:len}:{...strip,z:at,d:len};
    // What is left either side has to be able to hold a room of the strip's own depth, not merely five
    // blocks of it: a slot narrower than that is the strip stood on its side, which is not a room at all.
    const cross=(axis==='x'?strip.d:strip.w)-1;
    const roomy=Math.max(MIN_ROOM,Math.min(MIN_ROOM*2,Math.round(cross/2.2)+1));
    // Proportion first, and where the strip cannot hold both a passage and a room in proportion, the passage
    // wins: a room a little out of square costs less than a neighbour reached through a chamber. Only a
    // little, though — past the audit's own limit the room stops being a room and the candidate is refused.
    const spare=Math.max(MIN_ROOM,Math.ceil(cross/3)+1);
    for(const least of roomy>spare?[roomy,spare]:[roomy]){
    if(run>=least+SPUR)for(const span of spans){
      const ideal=spanCentre(span.lo,span.hi,SPUR);
      // As near the middle of the shared wall as leaves a room either side; failing that, hard against one
      // end of the strip. A passage that reaches nothing is not worth the floor it takes.
      const lo=Math.max(base+least,span.lo),hi=Math.min(base+run-SPUR-least,span.hi-4);
      const options=hi>=lo?[Math.max(lo,Math.min(ideal,hi)),base,base+run-SPUR]:[base,base+run-SPUR];
      for(const at of options){
        const before=at-base,after=base+run-at-SPUR;
        if((before>0&&before<least)||(after>0&&after<least))continue;
        if(Math.min(span.hi,at+SPUR)-Math.max(span.lo,at)<4)continue;
        const slots:Rect[]=[];
        if(before>0)slots.push(part(base,before));
        if(after>0)slots.push(part(at+SPUR,after));
        return {slots,spur:part(at,SPUR)};
      }
    }
    }
    return {slots:[strip]};
  }
  /**
   * Cut one rank of a range into rooms along its length. Each room takes the extent its own use asks for,
   * so a kitchen reads as a kitchen and the larder beside it reads as a larder. Nothing is stretched to
   * fill the range: a remainder too small to stand as a room goes back to the room before it.
   */
  function rankRooms(area:Rect,along:'x'|'z',program:[string,RoomKind][],from:number,used:Map<string,number>){
    const pieces:{rect:Rect;name:string;kind:RoomKind;principal:boolean}[]=[];
    if(area.w<MIN_ROOM||area.d<MIN_ROOM||!program.length)return {pieces,next:from};
    const depth=Math.max(1,(along==='x'?area.d:area.w)-1),run=along==='x'?area.w:area.d;
    let at=along==='x'?area.x:area.z,left=run,index=from;
    while(left>=MIN_ROOM&&index<from+24){
      // Past the end of the programme a long range repeats its lesser rooms, never its principal one.
      const [name,kind]=program[index<program.length?index:1+(index-program.length)%Math.max(1,program.length-1)];
      const fit=ROOM_FIT[kind];
      const want=Math.round(depth*fit.share)+1;
      const least=Math.max(MIN_ROOM,Math.round(depth/fit.aspect)+1);
      // The proportion band decides the shape and the area ceiling decides the size; where a rank is too
      // deep for the type to hold both, staying in proportion wins and the range itself is at fault.
      const most=Math.max(least,Math.min(Math.round(depth*fit.aspect)+1,Math.round(fit.max/depth)+1));
      if(left<least&&pieces.length){
        const last=pieces[pieces.length-1].rect;
        if(along==='x')last.w+=left;else last.d+=left;
        break;
      }
      let length=Math.min(left,Math.max(least,Math.min(want,most,left)));
      if(left-length<least)length=left;
      const seen=(used.get(name)??0)+1;used.set(name,seen);
      pieces.push({
        rect:along==='x'?{...area,x:at,w:length}:{...area,z:at,d:length},
        name:seen>1?`${name} ${seen}`:name,kind,principal:index===0,
      });
      at+=length;left-=length;index++;
    }
    return {pieces,next:index};
  }
  // Where every range's cross passage sits, decided for the whole composition before any room is cut.
  // Two adjoining ranges that each centre their own passage independently miss each other in the shared
  // wall by a block or two, and the only remaining way between them is a door through somebody's chamber.
  const bandOf=(c:BuildingComponent)=>c.bounds.d<28||c.bounds.w<18?5:BAND;
  /** The hall's screens passage, and the gallery above it, sit at one end of the hall's flank. */
  const screensZ=(c:BuildingComponent,y:number)=>{
    const fo=componentFootprint(c,y,family);
    return y===6&&family==='hall-house'?fo.z:fo.z+fo.d-5;
  };
  const passageZ=new Map<string,number>();
  {
    const banded=(c:BuildingComponent)=>c.kind!=='hall'&&c.kind!=='gatehouse'&&c.kind!=='chapel'&&!longFlank(c);
    const top=Math.max(...components.map(c=>c.storeys));
    for(let f=-1;f<top;f++){
      const y=f*6,here=components.filter(c=>banded(c)&&y>=c.baseY&&f<c.storeys);
      // The screens passage is where a household's service doors belong, so it anchors the alignment:
      // a neighbouring range lines its cross passage up with it instead of opening into the hall body.
      const anchors=y===0?components.filter(c=>c.kind==='hall'):[];
      for(const c of anchors)passageZ.set(`${c.id}:${f}`,screensZ(c,y));
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
      const links:{a:BuildingComponent;b:BuildingComponent;lo:number;hi:number;anchored:boolean}[]=[];
      const joinable=[...anchors,...here],isAnchor=(c:BuildingComponent)=>anchors.includes(c);
      for(let i=0;i<joinable.length;i++)for(let j=i+1;j<joinable.length;j++){
        const fa=componentFootprint(joinable[i],y,family),fb=componentFootprint(joinable[j],y,family),side=sharedSide(fa,fb);
        if(side!=='e'&&side!=='w')continue;
        const lo=Math.max(fa.z,fb.z),hi=Math.min(fa.z+fa.d,fb.z+fb.d);
        if(hi-lo<6||(isAnchor(joinable[i])&&isAnchor(joinable[j])))continue;
        links.push({a:joinable[i],b:joinable[j],lo,hi,anchored:isAnchor(joinable[i])||isAnchor(joinable[j])});
      }
      // The screens passage first, then the widest shared wall: the broadest junction is the one worth
      // committing both passages to.
      links.sort((m,n)=>Number(n.anchored)-Number(m.anchored)||(n.hi-n.lo)-(m.hi-m.lo)||m.a.id.localeCompare(n.a.id)||m.b.id.localeCompare(n.b.id));
      const settled=new Set(anchors.map(c=>`${c.id}:${f}`));
      for(const link of links){
        const ka=`${link.a.id}:${f}`,kb=`${link.b.id}:${f}`;
        if(settled.has(ka)&&settled.has(kb))continue;
        const width=Math.max(bandOf(link.a),bandOf(link.b));
        const at=settled.has(ka)?passageZ.get(ka)!:settled.has(kb)?passageZ.get(kb)!:spanCentre(link.lo,link.hi,width);
        if(Math.min(link.hi,at+width)-Math.max(link.lo,at)<4)continue;
        const fits=(c:BuildingComponent)=>{if(isAnchor(c))return true;const {low,high}=limits(c);return high>=low&&at>=low&&at<=high;};
        if(!fits(link.a)||!fits(link.b))continue;
        passageZ.set(ka,at);passageZ.set(kb,at);settled.add(ka);settled.add(kb);
      }
    }
  }
  /** How much of each corner a tower's chamfer takes, and so how much of its wall is not straight. */
  const chamferOf=(c:BuildingComponent)=>c.kind==='tower'?Math.min(4,Math.floor(c.bounds.w/5)):0;
  const stairsIn=(c:BuildingComponent)=>c.storeys>1||(s.cellar&&(c===domestic||c===service)&&c.bounds.w>=18&&c.bounds.d>=30);
  /**
   * What a short range does with its passages, settled once so that the range itself and every neighbour
   * reading its wall get the same answer. A neighbour told the passage is somewhere it is not builds nothing
   * to meet it, and the only way left between the two is a door through whichever chamber is there.
   */
  const shortCache=new Map<string,{bay:number;bands:{z:number;d:number}[];flanks:('e'|'w')[]}>();
  const order=(c:BuildingComponent)=>Number(c.id.slice(1));
  function shortBands(c:BuildingComponent,y:number){
    const key=`${c.id}:${y}`,hit=shortCache.get(key);
    if(hit)return hit;
    const rb=componentFootprint(c,y,family),js=junctions(c,y);
    // A chamfered tower's flank is straight only between its cut corners, so its passage is deep enough
    // to present four blocks of straight wall past the chamfer.
    const band=5+chamferOf(c);
    const bay=stairsIn(c)&&rb.w>=16&&rb.d>=15?9:0;
    const reach=(side:'n'|'s')=>js.filter(j=>j.side===side).reduce((n,j)=>n+j.hi-j.lo,0);
    // A neighbour whose own circulation is already settled — a yard, a hall, a gallery — decides where this
    // range's passage meets it. Between two short ranges the later one settles first and the earlier adapts,
    // so the two are never each waiting on the other.
    const settled=(o:BuildingComponent)=>o.kind==='hall'||o.kind==='gatehouse'||o.kind==='chapel'||o.kind==='court'
      ||!!longFlank(o)||!(o.bounds.d<28||o.bounds.w<18)||order(o)>order(c);
    const flankSpans=()=>js.filter(j=>(j.side==='e'||j.side==='w')&&settled(j.other))
      .sort((m,n)=>(n.hi-n.lo)-(m.hi-m.lo)||m.lo-n.lo||order(m.other)-order(n.other))
      .flatMap(j=>circulationSpans(j.other,y,j.side==='e'?'w':'e')
        .map(sp=>[Math.max(j.lo,sp[0]),Math.min(j.hi,sp[1]),j.side as 'e'|'w'] as [number,number,'e'|'w']))
      .filter(sp=>sp[1]-sp[0]>=4);
    const ends:('n'|'s')[]=reach('n')&&reach('s')&&bay?['n','s']:reach('n')||reach('s')?[reach('n')>=reach('s')?'n':'s']:[];
    const bands:{z:number;d:number}[]=[];
    let area={z:rb.z,d:rb.d};
    for(const end of ends){
      if(area.d-band<ROOMY)break;
      bands.push({z:end==='n'?area.z:area.z+area.d-band,d:band});
      area=end==='n'?{z:area.z+band,d:area.d-band}:{z:area.z,d:area.d-band};
    }
    if(!bands.length){
      const low=area.z,high=area.z+area.d-band;
      const clamp=(at:number)=>Math.max(low,Math.min(at,high));
      let z=clamp(passageZ.get(`${c.id}:${y/6}`)??area.z+Math.floor(area.d/2)-2);
      const aims=flankSpans();
      const fits=(at:number,sp:[number,number,'e'|'w'])=>Math.min(sp[1],at+band)-Math.max(sp[0],at)>=4;
      let aimed=false;
      aim: for(const sp of aims)for(const cand of [clamp(spanCentre(sp[0],sp[1],band)),low,high])if(fits(cand,sp)){z=cand;aimed=true;break aim;}
      // A passage that would leave less than a room's depth behind it takes that ground into itself rather
      // than leaving a strip too narrow to be anything.
      let d=band;
      if(z-area.z<ROOMY){d+=z-area.z;z=area.z;}
      const tail=area.z+area.d-(z+d);
      if(tail>0&&tail<ROOMY)d+=tail;
      if(d>=area.d-ROOMY){z=aimed&&z<=low+Math.floor(area.d/2)?low:high;d=band;}
      bands.push({z,d});
    }
    // A flank neighbour none of these bands reaches would have to be entered through a room. Deepen the
    // band nearest to it until it does, and where the range cannot spare that depth, run a passage down
    // that flank instead — the single-loaded corridor of a real wing.
    const flanks:('e'|'w')[]=[];
    const gaps=(bs:{z:number;d:number}[])=>{
      const out:number[]=[];let at=rb.z;
      for(const b of [...bs].sort((m,n)=>m.z-n.z)){out.push(b.z-at);at=b.z+b.d;}
      out.push(rb.z+rb.d-at);return out;
    };
    const sound=(bs:{z:number;d:number}[])=>bs.every(b=>b.d>=band&&b.d<=band+7)&&gaps(bs).every(g=>g===0||g>=ROOMY);
    for(const sp of flankSpans()){
      if(bands.some(b=>Math.min(sp[1],b.z+b.d)-Math.max(sp[0],b.z)>=4))continue;
      const near=[...bands].sort((m,n)=>Math.abs(m.z-sp[0])-Math.abs(n.z-sp[0]))[0];
      if(!near)continue;
      // Reach down to the span, or up to it: whichever costs the range less depth.
      const down={z:near.z,d:Math.max(near.d,sp[0]+4-near.z)};
      const up={z:Math.min(near.z,sp[1]-4),d:near.z+near.d-Math.min(near.z,sp[1]-4)};
      const meets=(b:{z:number;d:number})=>Math.min(sp[1],b.z+b.d)-Math.max(sp[0],b.z)>=4;
      let joined=false;
      for(const grown of [down,up].sort((m,n)=>m.d-n.d)){
        if(!meets(grown))continue;
        const trial=bands.map(b=>b===near?grown:b);
        if(sound(trial)){bands.splice(0,bands.length,...trial);joined=true;break;}
      }
      if(joined)continue;
      const side=sp[2];
      if(flanks.includes(side))continue;
      if(rb.w-bay-SPUR*(flanks.length+1)>=ROOMY)flanks.push(side);
    }
    const made={bay,bands,flanks};shortCache.set(key,made);return made;
  }
  /** The stretches of a neighbour's east or west wall its own circulation already stands against. */
  function circulationSpans(o:BuildingComponent,y:number,facing:'e'|'w'):[number,number][]{
    if(y<o.baseY||y>=o.topY)return [];
    const fo=componentFootprint(o,y,family);
    // A hall, a gatehouse, a court and a chapel with its antechapel present circulation along their whole flank.
    if(o.kind==='hall'){const at=screensZ(o,y);return y===0||y===6?[[at,at+5]]:[];}
    if(o.kind==='gatehouse'||o.kind==='chapel'||o.kind==='court')return y===0?[[fo.z,fo.z+fo.d]]:[];
    // A range with a long grain offers its whole flank on the side its gallery runs down, and nothing on the other.
    const flank=longFlank(o);
    if(flank)return flank===facing?[[fo.z,fo.z+fo.d]]:[];// 'mid' matches neither, as intended.
    if(o.bounds.d<28||o.bounds.w<18){
      const short=shortBands(o,y),out:[number,number][]=[],ch=chamferOf(o);
      // The stair bay and a flank passage each run the full depth of the range against one of its walls.
      if((short.bay&&facing==='e')||short.flanks.includes(facing))out.push([fo.z,fo.z+fo.d]);
      for(const b of short.bands)out.push([b.z,b.z+b.d]);
      // Only the straight part of a chamfered wall can take a door.
      return out.map(sp=>[Math.max(sp[0],fo.z+ch),Math.min(sp[1],fo.z+fo.d-ch)] as [number,number]).filter(sp=>sp[1]-sp[0]>=4);
    }
    const at=passageZ.get(`${o.id}:${y/6}`);
    return at===undefined?[]:[[at,at+bandOf(o)]];
  }
  // A household has one lord's lodging and one great kitchen. Later ranges of the same kind are the
  // second-rank buildings a real estate accumulates: guest lodgings, a brewhouse, a smithy.
  /** Bind a closet to the chamber it is cut from, so it is entered through it and not off the passage. */
  const suiteLinks:{head:Room;member:Room}[]=[];
  function suiteOf(head:Room,member:Room){
    const suite=p.suites.find(x=>x.headId===head.id)??(()=>{
      const made={id:`u${p.suites.length}`,name:head.name,kind:(head.kind==='bedroom'?'lodging':head.kind==='service'||head.kind==='storage'?'service':'lord') as Suite['kind'],roomIds:[head.id],headId:head.id};
      p.suites.push(made);head.suiteId=made.id;return made;
    })();
    suite.roomIds.push(member.id);member.suiteId=suite.id;
    suiteLinks.push({head,member});
  }
  const rankInKind=new Map<string,number>();
  {
    const seen=new Map<ComponentKind,number>();
    for(const c of components){const n=seen.get(c.kind)??0;rankInKind.set(c.id,n);seen.set(c.kind,n+1);}
  }
  /**
   * What a range of this kind is for, in the order the rooms matter; the first entry is its principal room.
   * An estate does not build the same brewhouse four times: each further range of a kind takes the next
   * trade the household needs, so a second service court is a laundry and dairy rather than a second kitchen.
   */
  const VARIANTS:Partial<Record<ComponentKind,[string,RoomKind][][]>>={
    service:[
      [['Kitchen','service'],['Scullery','service'],['Wet larder','storage'],['Pantry & buttery','storage'],['Larder','storage']],
      [['Brewhouse','service'],['Bakehouse','service'],['Malt house','storage'],['Ale store','storage']],
      [['Laundry','service'],['Drying room','service'],['Soap house','service'],['Linen store','storage']],
      [['Dairy','service'],['Cheese room','storage'],['Salting house','service'],['Meat store','storage']],
      [['Slaughterhouse','service'],['Tallow house','service'],['Hide store','storage'],['Bone store','storage']],
      [['Stable','service'],['Farrier’s shop','service'],['Harness room','storage'],['Fodder store','storage']],
    ],
    workshop:[
      [['Workshop','service'],['Counting room','study'],['Goods store','storage'],['Tool store','storage'],['Drying loft','storage']],
      [['Smithy','service'],['Joiner’s shop','service'],['Timber store','storage'],['Charcoal store','storage']],
      [['Chandlery','service'],['Tannery','service'],['Vat house','storage'],['Wax store','storage']],
      [['Cooperage','service'],['Wheelwright’s shop','service'],['Cart shed','storage'],['Spoke store','storage']],
      [['Weaving shed','service'],['Dye house','service'],['Wool store','storage'],['Cloth store','storage']],
    ],
    lodging:[
      [['Guest chamber','bedroom'],['Lodging hall','service'],['Chamberlain’s room','study'],['Linen room','storage'],['Guest wardrobe','storage']],
      [['Household lodging','bedroom'],['Servants’ hall','service'],['Usher’s room','study'],['Livery store','storage']],
      [['Retainers’ lodging','bedroom'],['Mess room','service'],['Armourer’s room','service'],['Kit store','storage']],
      [['Chaplain’s lodging','bedroom'],['Study','study'],['Almoner’s room','study'],['Book room','storage']],
    ],
    domestic:[
      [['Solar','study'],['Withdrawing room','study'],['Household dining','service'],['Parlour','study'],['Pantry','storage']],
      [['Guest hall','service'],['Steward’s lodging','study'],['Guest parlour','study'],['Household store','storage'],['Linen room','storage']],
      [['Nursery','bedroom'],['Schoolroom','study'],['Nurse’s chamber','bedroom'],['Toy store','storage']],
      [['Music room','study'],['Long parlour','study'],['Card room','study'],['Instrument store','storage']],
    ],
    tower:[
      [['Guardroom','service'],['Watch room','service'],['Steward’s office','study'],['Armoury','storage'],['Muniment room','storage']],
      [['Watch room','service'],['Bowyer’s room','service'],['Signal loft','storage'],['Shot store','storage']],
      [['Treasury','storage'],['Clerk’s room','study'],['Seal room','study'],['Strong room','storage']],
    ],
  };
  /**
   * What a range holds above its ground floor. An upper storey that is bedchambers whatever the range is
   * flattens the hierarchy the composition just built: the lord's own floor, a guest floor and the servants'
   * floor are different accommodation, and a range's second storey is not a copy of its first.
   */
  const UPPER:Partial<Record<ComponentKind,[string,RoomKind][][]>>={
    domestic:[
      [['Great chamber','bedroom'],['Antechamber','study'],['Closet','study'],['Wardrobe','storage']],
      [['Bedchamber','bedroom'],['Dressing room','study'],['Nurse’s chamber','bedroom'],['Linen room','storage']],
      [['Private study','study'],['Muniment closet','storage'],['Bedchamber','bedroom'],['Press','storage']],
    ],
    lodging:[
      [['Guest chamber','bedroom'],['Guest parlour','study'],['Servant’s cot','bedroom'],['Guest wardrobe','storage']],
      [['Upper lodging','bedroom'],['Attic chamber','bedroom'],['Trunk room','storage'],['Press','storage']],
    ],
    service:[
      [['Servants’ lodging','bedroom'],['Maids’ chamber','bedroom'],['Household store','storage'],['Press','storage']],
      [['Grooms’ lodging','bedroom'],['Mess room','service'],['Kit store','storage'],['Boot room','storage']],
    ],
    workshop:[
      [['Drying loft','storage'],['Apprentice’s room','bedroom'],['Pattern store','storage'],['Press','storage']],
      [['Store loft','storage'],['Journeyman’s room','bedroom'],['Sail loft','storage'],['Rope store','storage']],
    ],
  };
  function programFor(c:BuildingComponent,f:number):[string,RoomKind][]{
    if(f<0)return [['Wine cellar','storage'],['Root store','storage'],['Strong room','storage'],['Buttery store','storage'],['Ice store','storage']];
    const rank=rankInKind.get(c.id)??0,variants=VARIANTS[c.kind];
    if(f===0&&variants)return variants[rank%variants.length];
    if(c.kind==='tower'&&f>0)return [[f===c.storeys-1?'Tower chamber':'Solar chamber','bedroom'],['Antechamber','study'],['Wardrobe','storage'],['Guest chamber','bedroom'],['Linen room','storage']];
    if(f===c.storeys-1&&f>1)return [['Gabled bedchamber','bedroom'],['Wardrobe & study','study'],['Bedchamber','bedroom'],['Linen room','storage'],['Private study','study']];
    const above=UPPER[c.kind];
    if(above)return above[(rank+f-1)%above.length];
    return [['Bedchamber','bedroom'],['Guest chamber','bedroom'],['Linen room','storage'],['Nurse’s chamber','bedroom'],['Wardrobe','storage']];
  }
  for(const c of components)if(c.storeys>1&&c.kind!=='hall'&&c.kind!=='court'&&!canStair(c)){c.storeys=1;c.topY=6;}
  for(const c of components){
    const b=c.bounds;
    if(c.kind==='hall'){
      // The dais end is canted back — but it is also the end the private side is entered from, and a range
      // standing against that corner needs straight wall to take its door. Where one does, the hall is square.
      const crowds=(wall:'w'|'e')=>components.some(o=>{
        const g=o.id===c.id?undefined:grainOf(o),ob=o.bounds;
        if(!g||(wall==='w'?ob.x+ob.w!==b.x:b.x+b.w!==ob.x))return false;
        return Math.abs(ob.z-b.z)<=6&&[...g.caps.values()].some(cap=>cap.n);
      });
      const corners:DaisCorners=crowds('w')?(crowds('e')?'none':'hi'):(crowds('e')?'lo':'both');
      room(c,s.kind==='house'?'Hearth hall':'Great hall','hall',{...b,d:b.d-5},0,c.topY,'dais','n',undefined,corners);
      room(c,'Screens passage','circulation',{...b,z:b.z+b.d-5,d:5},0,c.topY);
      if(c.topY>=12){
        const loft=family==='hall-house'?{...b,d:5}:{...b,z:b.z+b.d-5,d:5};
        const reached=components.some(o=>{
          if(o.id===c.id||o.baseY>6||6>=o.topY)return false;
          const f=componentFootprint(o,6,family),side=sharedSide(loft,f);
          if(!side)return false;
          const across=side==='n'||side==='s';
          return (across?Math.min(loft.x+loft.w,f.x+f.w)-Math.max(loft.x,f.x):Math.min(loft.z+loft.d,f.z+f.d)-Math.max(loft.z,f.z))>=4;
        });
        if(reached)room(c,'Minstrels’ gallery','gallery',loft,6,c.topY);
      }
      continue;
    }
    if(c.kind==='court'){room(c,c.name,'court',b,0,0);continue;}
    if(c.kind==='gatehouse'){
      // A gate is a passage a cart fits through with accommodation either side, not one wide empty room.
      const carriage=Math.max(6,Math.min(b.w-2*MIN_ROOM,Math.round(b.w*.3)));
      const guard=Math.floor((b.w-carriage)/2);
      if(quadrangle&&guard>=MIN_ROOM&&b.d>=8){
        room(c,'Gate passage','circulation',{x:b.x+guard,z:b.z,w:b.w-2*guard,d:b.d},0,6);
        const gate:[string,RoomKind][]=[['Gate guard','service'],['Porter’s lodge','study'],['Gate store','storage'],['Watch room','service']];
        const used=new Map<string,number>();let cursor=0;
        for(const side of [{x:b.x,z:b.z,w:guard,d:b.d},{x:b.x+b.w-guard,z:b.z,w:guard,d:b.d}]){
          const cut=rankRooms(side,'z',gate,cursor,used);
          for(const piece of cut.pieces)room(c,piece.name,piece.kind,piece.rect,0,6);
          cursor=cut.next;
        }
      }else room(c,c.name,'circulation',b,0,6);
      continue;
    }
    if(c.kind==='chapel') {
      // An antechapel on the wall the chapel shares with the house gives the household a threshold to
      // enter through, and keeps the sacred room a destination rather than a route to anywhere else.
      const host=components.find(o=>o.id===c.parentId),side=host?sharedSide(b,host.bounds):undefined,depth=5;
      const along=side==='n'||side==='s'?b.d:b.w;
      if(side&&along>=depth+8){
        const ante:Rect=side==='s'?{...b,z:b.z+b.d-depth,d:depth}:side==='n'?{...b,d:depth}:side==='e'?{...b,x:b.x+b.w-depth,w:depth}:{...b,w:depth};
        const nave:Rect=side==='s'?{...b,d:b.d-depth}:side==='n'?{...b,z:b.z+depth,d:b.d-depth}:side==='e'?{...b,w:b.w-depth}:{...b,x:b.x+depth,w:b.w-depth};
        const facing:Record<'n'|'s'|'e'|'w','n'|'s'|'e'|'w'>={n:'s',s:'n',e:'w',w:'e'};
        room(c,'Antechapel','circulation',ante,0,6);
        room(c,'Chapel','sacred',nave,0,6,'apse',facing[side]);
      }else room(c,'Chapel','sacred',b,0,6,'apse','n');
      continue;
    }
    const hasStairs=c.storeys>1||(s.cellar&&(c===domestic||c===service)&&b.w>=18&&b.d>=30);
    const cellar=s.cellar&&(c===domestic||c===service)&&b.w>=18&&b.d>=30;
    if(cellar)c.baseY=-6;
    // A range with a long grain carries its stair inside the rank; a range cut across keeps it in the
    // corner the cross passage leaves. Either way the shaft is fixed once, so every storey lands on it.
    const alongFlank=longFlank(c);
    const grain=grainOf(c);
    const shaftX=alongFlank==='e'?b.x+3:alongFlank?b.x+b.w-10:b.x+b.w-8;
    const stairCap=grain?[...grain.caps].find(([outer])=>outer==='e'?shaftX>=grain.walk+BAND:shaftX+7<=grain.walk)?.[1]:undefined;
    const shaft={x:shaftX,z:b.z+b.d-13-(stairCap?.s?SPUR:0),w:7,d:12};
    const stairRooms:Room[]=[];
    for(let f=cellar?-1:0;f<c.storeys;f++){
      const y=f*6,rb=componentFootprint(c,y,family),program=programFor(c,f);
      if(alongFlank){
        const js=junctions(c,y),gabled=f===c.storeys-1&&f>1,ceiling=gabled?y+4:y+6;
        // One passage down the length of the range, lit from the court or yard whose side it runs on. Its
        // line comes from the range itself, not from the storey: a wall that moved with each floor's inset
        // would carry the rank away from the stair shaft, and the upper floors would lose their stair.
        const walkX=Math.max(rb.x,Math.min(grain!.walk,rb.x+rb.w-BAND));
        const onCourt=alongFlank!=='mid'&&js.some(j=>j.side===alongFlank&&j.other.kind==='court');
        room(c,f<0?'Cellar passage':onCourt?'Court gallery':c.kind==='service'?'Service passage':f===0?'Gallery':'Gallery landing',
          'circulation',{x:walkX,z:rb.z,w:BAND,d:rb.d},y);
        const ranks=([
          {rect:{x:walkX+BAND,z:rb.z,w:rb.x+rb.w-walkX-BAND,d:rb.d},outer:'e' as const},
          {rect:{x:rb.x,z:rb.z,w:walkX-rb.x,d:rb.d},outer:'w' as const},
        ]).filter(r=>r.rect.w>=MIN_ROOM&&r.rect.d>=MIN_ROOM)
          .sort((m,n)=>n.rect.w*n.rect.d-m.rect.w*m.rect.d||m.rect.x-n.rect.x);
        const used=new Map<string,number>(),slots:{rect:Rect;name:string;kind:RoomKind;principal:boolean}[]=[];
        let cursor=0;
        for(const rank of ranks){
          const cap=grain?grain.caps.get(rank.outer)??{n:false,s:false}:{n:false,s:false};
          const takes=(cap.n?SPUR:0)+(cap.s?SPUR:0);
          const capN=cap.n&&rank.rect.d-takes>=MIN_ROOM,capS=cap.s&&rank.rect.d-takes>=MIN_ROOM;
          if(capN)room(c,'Cross passage','circulation',{...rank.rect,d:SPUR},y);
          if(capS)room(c,'Cross passage','circulation',{...rank.rect,z:rank.rect.z+rank.rect.d-SPUR,d:SPUR},y);
          const body:Rect={...rank.rect,z:rank.rect.z+(capN?SPUR:0),d:rank.rect.d-(capN?SPUR:0)-(capS?SPUR:0)};
          const holdsStair=hasStairs&&shaft.x>=body.x&&shaft.x+shaft.w<=body.x+body.w;
          const stairDepth=holdsStair&&body.d>=13+MIN_ROOM?13:0;
          if(stairDepth)stairRooms.push(room(c,'Stair hall','stairs',{...body,z:body.z+body.d-stairDepth,d:stairDepth},y));
          // The outer flank still has to be reached where another range meets it, so a cross spur is cut
          // through the rank rather than a door through whichever chamber lands against that wall.
          // Aim the spur at the neighbour's own circulation, so the two passages meet in the shared wall
          // instead of the spur landing opposite somebody's chamber.
          const facing=rank.outer==='e'?'w':'e';
          const aimed=js.filter(j=>j.side===rank.outer).map(j=>{
            for(const span of circulationSpans(j.other,y,facing)){
              const lo=Math.max(j.lo,span[0]),hi=Math.min(j.hi,span[1]);
              if(hi-lo>=4)return {lo,hi};
            }
            return {lo:j.lo,hi:j.hi};
          });
          const cut=spurSplit({...body,d:body.d-stairDepth},'z',aimed);
          if(cut.spur)room(c,'Passage','circulation',cut.spur,y);
          for(const area of cut.slots.filter(a=>a.w>=MIN_ROOM&&a.d>=MIN_ROOM).sort((m,n)=>n.w*n.d-m.w*m.d||m.z-n.z)){
            const made=rankRooms(area,'z',program,cursor,used);
            slots.push(...made.pieces);cursor=made.next;
          }
        }
        const head=slots[0],closetDepth=5,closetWidth=head?Math.min(7,Math.floor(head.rect.d/3)):0;
        const roomy=!!head&&closetWidth>=MIN_ROOM&&head.rect.d>=closetWidth+MIN_ROOM*2&&head.rect.w>=closetDepth+MIN_ROOM+2;
        // The closet is cut from the corner furthest from the gallery, so it is reached across its chamber.
        const outerOfHead=head&&head.rect.x>walkX?'e':'w';
        const notch:Rect|undefined=roomy?{
          x:outerOfHead==='e'?head.rect.x+head.rect.w-closetDepth:head.rect.x,
          z:f%2===0?head.rect.z:head.rect.z+head.rect.d-closetWidth,
          w:closetDepth,d:closetWidth,
        }:undefined;
        let chamber:Room|undefined;
        for(const slot of slots){
          const shape:RoomShape=slot.principal&&notch?'ell':slot.principal&&slot.rect.w>=14&&slot.rect.d>=14?'canted':'rect';
          const made=room(c,slot.name,slot.kind,slot.rect,y,ceiling,shape,'e',notch);
          if(slot.principal)chamber=made;
        }
        if(notch&&chamber){
          const [name,kind]=[...program].reverse().find(([,k])=>k==='storage')??program[program.length-1];
          const seen=(used.get(name)??0)+1;
          suiteOf(chamber,room(c,seen>1?`${name} ${seen}`:name,kind,notch,y,ceiling));
        }
        continue;
      }
      if(b.d<28||b.w<18){
        const gabled=f===c.storeys-1&&f>1,{bay,bands,flanks}=shortBands(c,y);
        // A stair stands at one end of a short range and the passages run into it, so its upper floors are
        // reached from the range itself and its two ends are joined without crossing a room between them.
        if(bay)stairRooms.push(room(c,'Stair hall','stairs',{x:rb.x+rb.w-bay,z:rb.z,w:bay,d:rb.d},y));
        const named=f<0?'Cellar passage':c.kind==='tower'?'Guard passage':c.kind==='service'||c.kind==='workshop'?'Service passage':'Cross passage';
        const wide=rb.w-bay,cuts=[...bands].sort((m,n)=>m.z-n.z),parts:Rect[]=[];
        const west=flanks.includes('w')?SPUR:0,east=flanks.includes('e')?SPUR:0;
        for(const side of flanks)room(c,'Passage','circulation',{x:side==='w'?rb.x:rb.x+wide-SPUR,z:rb.z,w:SPUR,d:rb.d},y);
        const roomX=rb.x+west,roomW=wide-west-east;
        let at=rb.z;
        for(const cut of cuts){
          if(cut.z-at>=MIN_ROOM)parts.push({x:roomX,z:at,w:roomW,d:cut.z-at});
          room(c,named,'circulation',{x:roomX,z:cut.z,w:roomW,d:cut.d},y);
          at=cut.z+cut.d;
        }
        if(rb.z+rb.d-at>=MIN_ROOM)parts.push({x:roomX,z:at,w:roomW,d:rb.z+rb.d-at});
        const used=new Map<string,number>();let cursor=0;
        for(const part of parts.filter(a=>a.w>=MIN_ROOM&&a.d>=MIN_ROOM).sort((m,n)=>n.w*n.d-m.w*m.d||m.z-n.z)){
          const cut=rankRooms(part,'x',program,cursor,used);
          for(const piece of cut.pieces)room(c,piece.name,piece.kind,piece.rect,y,gabled?y+4:y+6);
          cursor=cut.next;
        }
        continue;
      }
      const js=junctions(c,y),band=BAND;
      const cx=rb.x+Math.floor(rb.w*(f%2===0?.56:.43))+ri(-1,1);
      const cz=passageZ.get(`${c.id}:${f}`)??Math.min(rb.z+Math.floor(rb.d/2),b.z+b.d-17);
      room(c,f<0?'Cellar passage':f===0?'Cross passage':f===c.storeys-1&&f>1?'Upper landing':'Landing','circulation',{x:rb.x,z:cz,w:rb.w,d:band},y);
      // Only a stair earns a reservation. Carving the same corner out of a range that has no stair leaves
      // its strip a different length from its neighbour's, and then the two ranges' spurs miss in the wall.
      const sx=hasStairs?shaft.x:rb.x+rb.w;
      const northStrip:Rect={x:rb.x,z:rb.z,w:rb.w,d:cz-rb.z};
      const southDepth=rb.z+rb.d-cz-band;
      const stairRect:Rect={x:sx,z:cz+band,w:rb.x+rb.w-sx,d:southDepth};
      const southStrip:Rect={x:rb.x,z:cz+band,w:sx-rb.x,d:southDepth};
      // A range adjoining this one part-way along its flank cannot be reached from the cross passage.
      // Those get a passage down the side of the range instead — the single-loaded corridor of a real wing.
      const passagesMeet=(j:{side:'n'|'s'|'e'|'w';lo:number;hi:number;other:BuildingComponent})=>
        circulationSpans(j.other,y,j.side==='e'?'w':'e')
          .some(span=>Math.min(j.hi,span[1],cz+band)-Math.max(j.lo,span[0],cz)>=4);
      // Both neighbours run this same test against the same passage positions, so when a flank is needed
      // each of them builds one and the two meet along the wall they share.
      const chamfered=c.polygon.length>4;
      const needsFlank=(strip:Rect,wall:'e'|'w')=>!chamfered&&strip.d>=MIN_ROOM&&js.some(j=>j.side===wall&&!passagesMeet(j)&&Math.min(j.hi,strip.z+strip.d)-Math.max(j.lo,strip.z)>=6);
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
      const north=spurSplit(northFlank.area,'x',js.filter(j=>j.side==='n'));
      const south=spurSplit(southFlank.area,'x',js.filter(j=>j.side==='s'));
      void cx;
      // A passage running out to the shared wall, so the neighbouring range is entered from circulation.
      for(const hall of [...northFlank.halls,...southFlank.halls])room(c,'Passage','circulation',hall,y);
      if(north.spur)room(c,'Passage','circulation',north.spur,y);
      if(south.spur)room(c,'Passage','circulation',south.spur,y);
      const gabled=f===c.storeys-1&&f>1;
      // The room the range is for comes first and takes the extent its own use needs; the lesser rooms
      // follow along the rank. Nothing is handed the whole of a strip merely for being the largest leftover.
      const areas=[...north.slots.map(rect=>({rect,passage:'s' as const})),...south.slots.map(rect=>({rect,passage:'n' as const}))]
        .filter(a=>a.rect.w>=MIN_ROOM&&a.rect.d>=MIN_ROOM)
        .sort((m,n)=>n.rect.w*n.rect.d-m.rect.w*m.rect.d||m.rect.x-n.rect.x||m.rect.z-n.rect.z);
      const slots:{rect:Rect;passage:'n'|'s';principal:boolean;name:string;kind:RoomKind}[]=[];
      {
        const used=new Map<string,number>();
        let cursor=0;
        for(const area of areas){
          const cut=rankRooms(area.rect,'x',program,cursor,used);
          for(const piece of cut.pieces)slots.push({...piece,passage:area.passage});
          cursor=cut.next;
        }
      }
      const head=slots[0];
      const closetDepth=5,closetWidth=head?Math.min(7,Math.floor(head.rect.w/3)):0;
      const roomy=head&&closetWidth>=MIN_ROOM&&head.rect.w>=closetWidth+MIN_ROOM*2&&head.rect.d>=closetDepth+MIN_ROOM+2&&c.kind!=='tower';
      const notch:Rect|undefined=roomy?{
        x:f%2===0?head.rect.x:head.rect.x+head.rect.w-closetWidth,
        z:head.passage==='s'?head.rect.z:head.rect.z+head.rect.d-closetDepth,
        w:closetWidth,d:closetDepth,
      }:undefined;
      let chamber:Room|undefined;
      for(const slot of slots){
        const shape:RoomShape=c.kind==='tower'?'rect'
          :slot.principal&&notch?'ell'
          :slot.principal&&slot.rect.w>=14&&slot.rect.d>=14?'canted':'rect';
        const made=room(c,slot.name,slot.kind,slot.rect,y,gabled?y+4:y+6,shape,'e',notch);
        if(slot.principal)chamber=made;
      }
      if(notch&&chamber){
        const [name,kind]=[...program].reverse().find(([,k])=>k==='storage')??program[program.length-1];
        const closet=room(c,name,kind,notch,y,gabled?y+4:y+6);
        suiteOf(chamber,closet);
      }
      if(hasStairs)stairRooms.push(room(c,'Stair hall','stairs',stairRect,y));
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
  for(const {head,member} of suiteLinks){
    const n=member.bounds,h=head.bounds;
    const edges:{axis:'x'|'z';fixed:number;lo:number;hi:number}[]=[
      {axis:'z' as const,fixed:n.z===h.z?n.z+n.d:n.z,lo:n.x,hi:n.x+n.w},
      {axis:'x' as const,fixed:n.x===h.x?n.x+n.w:n.x,lo:n.z,hi:n.z+n.d},
    ].sort((m,q)=>(q.hi-q.lo)-(m.hi-m.lo));
    for(const edge of edges){
      if(edge.hi-edge.lo<4)continue;
      const positions=Array.from({length:edge.hi-edge.lo-3},(_,i)=>edge.lo+1+i)
        .sort((m,q)=>Math.abs(m-(edge.lo+edge.hi)/2+1)-Math.abs(q-(edge.lo+edge.hi)/2+1));
      const side=(r:Room,pos:number,near:boolean)=>{
        const rect=edge.axis==='x'?{x:near?edge.fixed+1:edge.fixed-2,z:pos,w:2,d:2}:{x:pos,z:near?edge.fixed+1:edge.fixed-2,w:2,d:2};
        for(let dx=0;dx<2;dx++)for(let dz=0;dz<2;dz++){
          if(!insidePolygon(rect.x+dx+.5,rect.z+dz+.5,r.polygon))return false;
          if(boundaryCells(r).has(`${rect.x+dx},${rect.z+dz}`))return false;
        }
        return true;
      };
      const pos=positions.find(pos=>(side(head,pos,true)&&side(member,pos,false))||(side(head,pos,false)&&side(member,pos,true)));
      if(pos===undefined)continue;
      candidates.push({a:head,b:member,axis:edge.axis,fixed:edge.fixed,pos,span:edge.hi-edge.lo,priority:0});
      break;
    }
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
  const suiteMember=new Set(suiteLinks.map(l=>l.member.id));
  /** A room in a suite is reached through its chamber; a door from it onto the passage is never cut. */
  const strayFromSuite=(e:typeof candidates[number])=>(suiteMember.has(e.a.id)&&isCirculation(e.b))||(suiteMember.has(e.b.id)&&isCirculation(e.a));
  const wide=(m:typeof candidates[number],n:typeof candidates[number])=>n.span-m.span||m.a.id.localeCompare(n.a.id)||m.b.id.localeCompare(n.b.id);
  const open=(e:typeof candidates[number])=>e.priority>=0&&!strayFromSuite(e);
  const chapelRooms=new Set(p.rooms.filter(r=>components.find(c=>c.id===r.componentId)?.kind==='chapel').map(r=>r.id));
  // The hall has two doors and they are at its ends: the screens at the service end, and the door to the
  // private side at the dais. A door cut into the middle of its flank is a shortcut through the room the
  // whole house is built round, and it is what turns a great hall into a wide corridor.
  const throughHall=(e:typeof candidates[number])=>{
    const hall=e.a.kind==='hall'?e.a:e.b.kind==='hall'?e.b:undefined;
    if(!hall||(hall===e.a?e.b:e.a).componentId===hall.componentId)return false;
    const b=hall.bounds,along:'x'|'z'=b.d>=b.w?'z':'x';
    // A door in an end wall is at an end by construction; one in a flank has to be near one.
    if((along==='z')===(e.axis==='z'))return false;
    const lo=along==='z'?b.z:b.x,len=along==='z'?b.d:b.w;
    return e.pos>lo+HALL_END&&e.pos<lo+len-HALL_END-1;
  };
  const improper=(e:typeof candidates[number])=>(IMPROPER_DOORS[e.a.kind]??[]).includes(e.b.kind)||(IMPROPER_DOORS[e.b.kind]??[]).includes(e.a.kind)
    ||throughHall(e)
    ||(chapelRooms.has(e.a.id)&&!chapelRooms.has(e.b.id)&&!isCirculation(e.b))
    ||(chapelRooms.has(e.b.id)&&!chapelRooms.has(e.a.id)&&!isCirculation(e.a));
  const proper=(e:typeof candidates[number])=>open(e)&&!improper(e);
  /** A second door onto circulation turns a private chamber into a shortcut somebody will take. */
  const crowds=(e:typeof candidates[number])=>[e.a,e.b].some(r=>{
    const other=r===e.a?e.b:e.a;
    return ROOM_PRIVACY[r.kind]>=5&&isCirculation(other)&&toCirculation.get(r.id)!>0;
  });
  const discreet=(e:typeof candidates[number])=>proper(e)&&!crowds(e);
  // 1. The circulation skeleton: passages, stairs, galleries and the hall joined into one network.
  const spine=candidates.filter(e=>proper(e)&&isCirculation(e.a)&&isCirculation(e.b)).sort(wide);
  for(const edge of spine)if(find(edge.a.id)!==find(edge.b.id))cut(edge);
  // 1b. A suite is joined first: the closet takes its door from the chamber it was cut from.
  for(const link of suiteLinks){
    const edge=candidates.find(e=>open(e)&&((e.a.id===link.head.id&&e.b.id===link.member.id)||(e.b.id===link.head.id&&e.a.id===link.member.id)));
    if(edge){cut(edge);continue;}
    suiteMember.delete(link.member.id);
    const suite=p.suites.find(u=>u.id===link.member.suiteId);
    if(suite){suite.roomIds=suite.roomIds.filter(id=>id!==link.member.id);if(suite.roomIds.length<2)p.suites=p.suites.filter(u=>u!==suite);}
    link.member.suiteId=undefined;
  }
  // 2. Every other room gets its own door onto that network, so no chamber is ever a corridor. The hall
  //    counts as circulation to cross, but not as a doorway for the kitchens, so proper doors go first.
  const onto=(e:typeof candidates[number])=>isCirculation(e.a)!==isCirculation(e.b)&&!suiteMember.has(e.a.id)&&!suiteMember.has(e.b.id);
  for(const only of [proper,open])for(const edge of candidates.filter(e=>only(e)&&onto(e)).sort(wide)){
    const chamber=isCirculation(edge.a)?edge.b:edge.a;
    if(toCirculation.get(chamber.id)!)continue;
    cut(edge);
  }
  // 3. Anything still cut off is joined by the least objectionable door left. A route forced through a
  //    steward's office is a compromise; the same route through a bedchamber is not one worth making.
  const intrusion=(e:typeof candidates[number])=>(isCirculation(e.a)?0:ROOM_PRIVACY[e.a.kind])+(isCirculation(e.b)?0:ROOM_PRIVACY[e.b.kind]);
  const byIntrusion=(m:typeof candidates[number],n:typeof candidates[number])=>intrusion(m)-intrusion(n)||wide(m,n);
  for(const only of [discreet,proper,open])for(const edge of candidates.filter(only).sort(byIntrusion)){
    if(only===discreet&&crowds(edge))continue;
    if(find(edge.a.id)!==find(edge.b.id))cut(edge);
  }
  // 4. Doors a designer would add between rooms that already have their own entrance: a kitchen into its
  //    pantry, a solar into the withdrawing room. Both sides keep an independent way in, so neither becomes a route.
  const PAIRED:Record<string,string[]>={Kitchen:['Pantry & buttery','Scullery','Larder','Wet larder','Bread oven'],Solar:['Withdrawing room','Parlour'],Bedchamber:['Wardrobe','Wardrobe & study','Linen room'],'Gabled bedchamber':['Wardrobe & study'],Workshop:['Goods store','Tool store','Counting room'],Guardroom:['Armoury','Watch room'],'Tower chamber':['Wardrobe','Antechamber'],'Solar chamber':['Wardrobe','Antechamber']};
  const paired=(m:Room,n:Room)=>(PAIRED[m.name]??[]).includes(n.name)||(PAIRED[n.name]??[]).includes(m.name);
  for(const edge of candidates.filter(e=>discreet(e)&&paired(e.a,e.b)).sort(wide)){
    if(!crowds(edge)&&toCirculation.get(edge.a.id)!&&toCirculation.get(edge.b.id)!)cut(edge);
  }
  // 5. Loop closure. A plan whose doors form a bare tree forces one route to everywhere; a real house
  //    lets you come back a different way. Extra passage-to-passage doors are added where the walk is longest.
  const ring=candidates.filter(e=>proper(e)&&isCirculation(e.a)&&isCirculation(e.b)).sort(wide);
  {
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
    let closed=0;
    for(const edge of ring){
      if(between(edge.a.id,edge.b.id)<4)continue;
      cut(edge);closed++;neighbours.get(edge.a.id)!.push(edge.b.id);neighbours.get(edge.b.id)!.push(edge.a.id);
    }
    if(!closed){
      // A small house may have no second stretch of passage to close a ring with. Rather than leave one
      // route to everywhere, take the least intrusive door between two rooms that are already far apart.
      const chord=ring.find(open)
        ??candidates.filter(e=>discreet(e)&&!crowds(e)&&between(e.a.id,e.b.id)>=3).sort(byIntrusion)[0]
        ??candidates.filter(e=>proper(e)&&between(e.a.id,e.b.id)>=3).sort(byIntrusion)[0];
      if(chord)cut(chord);
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
        const reaches=(e:typeof candidates[number])=>e.a.id!==id&&e.b.id!==id&&stranded.has(e.a.id)!==stranded.has(e.b.id);
        const relief=candidates.filter(e=>discreet(e)&&!crowds(e)&&reaches(e)).sort(byIntrusion)[0]
          ??candidates.filter(e=>proper(e)&&reaches(e)).sort(byIntrusion)[0]
          ??candidates.filter(e=>open(e)&&reaches(e)).sort(byIntrusion)[0];
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
  const joined=new Set(p.connections.flat());
  for(const stray of p.rooms.filter(r=>r.kind==='gallery'&&!joined.has(r.id)))p.rooms=p.rooms.filter(r=>r!==stray);
  for(const r of p.rooms){
    const b=r.bounds;
    r.description=r.kind==='hall'?`The primary household hall rises ${r.ceilingY-r.floorY} blocks, with an open volume above and a screens passage at the service end.`:r.kind==='stairs'?'Reserved stair hall: two-block flights, three-block headroom and landings at each occupied level.':r.kind==='bedroom'?'A private chamber entered from a landing; household routes do not pass through it.':r.kind==='gallery'?'A partial timber gallery overlooking the hall. The central volume remains open to below.':`${r.name} in the ${components.find(c=>c.id===r.componentId)!.name.toLowerCase()}, connected to the household circulation.`;
    const generous=r.kind==='hall'||r.kind==='gallery'||r.kind==='sacred';
    // The points a household actually has to reach inside this room, and whether a two-block route still
    // joins them once a piece is in place. Moving furniture off a doorway is no good if it walls off a door.
    const ports:Point[]=[];
    for(const o of p.openings.filter(o=>o.type!=='window'&&o.roomIds.includes(r.id))){
      const near=o.axis==='x'?{x:o.x+1,z:o.z}:{x:o.x,z:o.z+1},far=o.axis==='x'?{x:o.x-2,z:o.z}:{x:o.x,z:o.z-2};
      ports.push(insidePolygon(near.x+1,near.z+1,r.polygon)?near:far);
    }
    for(const st of p.stairs.filter(st=>st.roomIds.includes(r.id)))ports.push(st.landings[r.floorY===st.fromY?0:1]);
    const routesSurvive=(extra:Rect)=>{
      if(ports.length<2)return true;
      const rb=r.bounds,blocked=[...r.furniture,extra];
      const walkable=(px:number,pz:number)=>{
        if(px<=rb.x||pz<=rb.z||px+1>=rb.x+rb.w||pz+1>=rb.z+rb.d)return false;
        for(let dx=0;dx<2;dx++)for(let dz=0;dz<2;dz++){
          if(!insidePolygon(px+dx+.5,pz+dz+.5,r.polygon))return false;
          if(blocked.some(f=>px+dx>=f.x&&px+dx<f.x+f.w&&pz+dz>=f.z&&pz+dz<f.z+f.d))return false;
        }
        return true;
      };
      if(ports.some(pt=>!walkable(pt.x,pt.z)))return false;
      const seen=new Set([`${ports[0].x},${ports[0].z}`]),queue=[ports[0]];
      for(let i=0;i<queue.length;i++)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]] as const){
        const nx=queue[i].x+dx,nz=queue[i].z+dz,k=`${nx},${nz}`;
        if(seen.has(k)||!walkable(nx,nz))continue;
        seen.add(k);queue.push({x:nx,z:nz});
      }
      return ports.every(pt=>seen.has(`${pt.x},${pt.z}`));
    };
    const approaches=p.openings.filter(o=>o.type!=='window'&&o.roomIds.includes(r.id)).map(o=>{
      if(generous)return o.axis==='x'?{x:o.x-3,z:o.z-1,w:7,d:o.width+2}:{x:o.x-1,z:o.z-3,w:o.width+2,d:7};
      const inward=o.axis==='x'
        ?insidePolygon(o.x+1.5,o.z+.5,r.polygon)
        :insidePolygon(o.x+.5,o.z+1.5,r.polygon);
      if(o.axis==='x')return {x:inward?o.x:o.x-3,z:o.z-1,w:4,d:o.width+2};
      return {x:o.x-1,z:inward?o.z:o.z-3,w:o.width+2,d:4};
    });
    const addFurniture=(type:Room['furniture'][number]['type'],x:number,z:number,w:number,d:number,h=1)=>{
      if(w<=0||d<=0)return;
      const b=r.bounds;
      const fits=(at:Point)=>{
        const box={...at,w,d};
        if(at.x<=b.x||at.z<=b.z||at.x+w>=b.x+b.w||at.z+d>=b.z+b.d)return false;
        for(const [cx,cz] of [[at.x+.5,at.z+.5],[at.x+w-.5,at.z+.5],[at.x+.5,at.z+d-.5],[at.x+w-.5,at.z+d-.5]])
          if(!insidePolygon(cx,cz,r.polygon))return false;
        return !r.furniture.some(f=>intersects(f,box))&&!approaches.some(a=>intersects(a,box));
      };
      const tried:Point[]=[];
      if(fits({x,z}))tried.push({x,z});
      if(!generous)for(let px=b.x+1;px+w<b.x+b.w;px++)for(let pz=b.z+1;pz+d<b.z+b.d;pz++)if(fits({x:px,z:pz}))tried.push({x:px,z:pz});
      tried.sort((m,n)=>(Math.abs(m.x-x)+Math.abs(m.z-z))-(Math.abs(n.x-x)+Math.abs(n.z-z))||m.x-n.x||m.z-n.z);
      for(const at of tried.slice(0,8)){
        if(!routesSurvive({...at,w,d}))continue;
        r.furniture.push({type,...at,w,d,y:r.floorY+1,h,material:9});break;
      }
    };
    if(r.kind==='hall'){
      const mid=b.x+Math.floor(b.w/2),high=b.z+2,length=Math.max(6,b.d-14);
      addFurniture('dais',b.x+3,high,Math.max(6,b.w-6),3);
      addFurniture('table',mid-Math.floor(Math.max(4,b.w-12)/2),high+1,Math.max(4,b.w-12),1);
      addFurniture('hearth',mid-1,high+6,2,2,1);
      const bench=(x:number)=>{addFurniture('table',x,high+9,2,length);addFurniture('bench',x-1,high+9,1,length);addFurniture('bench',x+2,high+9,1,length);};
      bench(b.x+4);
      if(b.w>=18)bench(b.x+b.w-6);
    }
    else if(r.kind==='bedroom'){addFurniture('bed',b.x+2,b.z+2,Math.min(3,b.w-3),Math.min(4,b.d-3));addFurniture('shelf',b.x+b.w-2,b.z+2,1,Math.min(3,b.d-3),2);}
    else if(r.kind==='service'){
      const cooking=r.name==='Kitchen'||r.name==='Bakehouse'||r.name==='Brewhouse';
      if(cooking&&b.w>=9&&b.d>=9){
        addFurniture('hearth',b.x+2,b.z+2,Math.min(5,b.w-5),2,2);
        addFurniture('oven',b.x+b.w-4,b.z+2,2,3,2);
        addFurniture('table',b.x+3,b.z+Math.floor(b.d/2),Math.max(3,Math.min(6,b.w-6)),2);
      }else{
        addFurniture('table',b.x+2,b.z+2,Math.min(4,b.w-4),2);
        if(b.d>9)addFurniture('hearth',b.x+2,b.z+b.d-3,3,1,2);
      }
    }
    else if(r.kind==='study'){addFurniture('desk',b.x+2,b.z+2,3,2);addFurniture('shelf',b.x+2,b.z+b.d-2,Math.max(2,b.w-4),1,2);}
    else if(r.kind==='storage'){addFurniture('shelf',b.x+2,b.z+2,Math.max(2,b.w-4),1,2);if(b.d>8)addFurniture('shelf',b.x+2,b.z+b.d-2,Math.max(2,b.w-4),1,2);}
    else if(r.kind==='court'){
      addFurniture('well',b.x+Math.floor(b.w/2)-1,b.z+Math.floor(b.d*.62),3,3,2);
    }
    else if(r.kind==='sacred'){addFurniture('altar',b.x+5,b.z+3,Math.max(3,b.w-10),2);for(let z=b.z+8;z<b.z+b.d-3;z+=3){addFurniture('bench',b.x+2,z,4,1);addFurniture('bench',b.x+b.w-6,z,4,1);}}
  }
  for(const y of [...new Set(p.rooms.map(r=>r.floorY))].sort((a,b)=>a-b)){
    const voids=components.filter(c=>c.kind==='hall'&&y>0&&y<c.topY).map(c=>({id:`void-${c.id}-${y}`,name:'Open to hall below',bounds:c.bounds,polygon:c.polygon,holes:p.rooms.filter(r=>r.componentId===c.id&&r.floorY===y).map(r=>r.bounds),floorY:y,ceilingY:c.topY}));
    // The floor a stair comes up through is a hole in the storey above it, and a hole is a void: it is
    // drawn as one and annotated as one rather than left as an unexplained gap in the boards.
    for(const st of p.stairs.filter(st=>st.toY===y)){
      const well={x:st.bounds.x+3,z:st.bounds.z+3,w:2,d:6};
      voids.push({id:`well-${st.id}`,name:'Open to the stair below',bounds:well,polygon:rectPolygon(well),holes:[],floorY:y,ceilingY:y+6});
    }
    p.floors.push({index:y/6,name:y<0?'Cellar':y===0?'Ground floor':y===6?'First floor':y===12?'Second floor':`Floor ${y/6+1}`,elevation:y,rooms:p.rooms.filter(r=>r.floorY===y),voids,roofComponents:components.filter(c=>c.topY<=y).map(c=>c.id)});
  }
  if(!small&&!quadrangle&&(s.kind==='castle'||s.courtyard||['courtyard-manor','palace','double-ward'].includes(family))){
    const x=Math.min(...components.map(c=>c.bounds.x))-10,z=Math.min(...components.map(c=>c.bounds.z))-10,right=Math.max(...components.map(c=>c.bounds.x+c.bounds.w))+10,bottom=Math.max(...components.map(c=>c.bounds.z+c.bounds.d))+(family==='keep-bailey'?30:14);
    const thickness=s.kind==='castle'?3:2;
    const gate={x:p.entry.x,z:bottom};
    // A gatehouse straddles the curtain, with a passage through its middle and a guard chamber either side.
    const gatehouse:Rect={x:gate.x-7,z:bottom-4,w:15,d:thickness+8};
    const court:Court={id:'inner-court',name:s.kind==='castle'?'Inner bailey':'Walled court',bounds:{x,z,w:right-x,d:bottom-z},gate,wallHeight:s.kind==='castle'?6:3,thickness,gatehouse,yards:[]};
    // The yard does the household's outdoor work: the horses, the deliveries, and the water it draws.
    const southOf=Math.max(...components.map(c=>c.bounds.z+c.bounds.d)),westOf=Math.min(...components.map(c=>c.bounds.x));
    const yardTop=southOf+4,yardRoom=bottom-6-yardTop;
    if(yardRoom>=14){
      court.yards.push({name:'Stable range',kind:'stable',bounds:{x:x+4,z:yardTop,w:Math.min(26,Math.max(12,Math.floor((right-x)/4))),d:12}});
      court.yards.push({name:'Service yard',kind:'service',bounds:{x:right-4-Math.min(30,Math.max(14,Math.floor((right-x)/3))),z:yardTop,w:Math.min(30,Math.max(14,Math.floor((right-x)/3))),d:Math.min(20,yardRoom)}});
      court.well={x:Math.round((westOf+p.entry.x)/2),z:yardTop+5};
    }
    p.courts.push(court);
    if(family==='double-ward'){
      const width=Math.max(54,Math.min(120,court.bounds.w-14));
      const outerBottom=bottom+38+ri(0,12),outerX=Math.max(x+4,Math.min(right-width-4,p.entry.x-Math.floor(width/2)));
      p.courts.push({id:'outer-court',name:'Outer ward',bounds:{x:outerX,z:bottom,w:width,d:outerBottom-bottom},gate:{x:p.entry.x,z:outerBottom},wallHeight:6,thickness,gatehouse:{x:p.entry.x-7,z:outerBottom-4,w:15,d:thickness+8},yards:[{name:'Muster yard',kind:'muster',bounds:{x:outerX+5,z:bottom+6,w:Math.max(12,width-10),d:Math.max(10,outerBottom-bottom-14)}}]});
      p.courts[1].gate.z=p.courts[1].bounds.z+p.courts[1].bounds.d;
    }
    // The path starts clear of the wall the door is cut through, not inside its thickness.
    const mass=s.kind==='castle'?3:2;
    const outward=entranceOpening.outward!;
    const entryStart={x:entranceOpening.x+(outward.x>0?mass:outward.x<0?-mass-1:0),z:entranceOpening.z+(outward.z>0?mass:outward.z<0?-mass-1:0)};
    // A yard is ground, not a building: the path from the gate may cross one.
    // A range's outside walls stand two or three blocks proud of its floor, so the path keeps that clear.
    const route=findOutdoorRoute(entryStart,{x:court.gate.x-1,z:court.gate.z-2},court.bounds,
      components.filter(c=>c.kind!=='court').map(c=>({x:c.bounds.x-mass+1,z:c.bounds.z-mass+1,w:c.bounds.w+2*(mass-1),d:c.bounds.d+2*(mass-1)})));
    if(route)p.routes.push({id:'entry-route',name:'Gate to screens passage',points:route,width:2});
    if(p.courts[1])p.routes.push({id:'ward-route',name:'Inner to outer gate',points:[{x:p.entry.x-1,z:bottom-1},{x:p.entry.x-1,z:p.courts[1].gate.z+2}],width:2});
  }
  buildGeometry(p);
  // One pass, no spread: a large composition reaches six figures of blocks, and spreading that into an
  // argument list makes whether the plan builds at all depend on the host's stack rather than on the seed.
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity,lowY=Infinity,highY=-Infinity;
  for(const b of p.blocks){
    if(b.x<minX)minX=b.x;if(b.z<minZ)minZ=b.z;
    if(b.x+b.w>maxX)maxX=b.x+b.w;if(b.z+b.d>maxZ)maxZ=b.z+b.d;
    if(b.y<lowY)lowY=b.y;if(b.y+b.h>highY)highY=b.y+b.h;
  }
  p.bounds={x:minX-8,z:minZ-8,w:maxX-minX+16,d:maxZ-minZ+16};p.width=maxX-minX;p.depth=maxZ-minZ;p.maxY=highY-1;p.minY=lowY;p.totalArea=p.rooms.reduce((a,r)=>a+r.area,0);
  p.signature=hash(JSON.stringify(components.map(c=>[c.kind,c.bounds.w,c.bounds.d,c.parentId,c.storeys,c.bounds.x,c.bounds.z]))).toString(16);
  p.navigation=navigationReport(p);
  p.composition=compositionReport(p);
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
  // How much masonry a range carries, and whether an upper storey is framed instead. Both answer to the phase
  // a range was built in, so a retained core reads as the older, heavier build it is.
  const shell=p.settings.kind==='castle'?3:2;
  const shellOf=(c:BuildingComponent)=>c.phase===0?shell+1:shell;
  const framed=(c:BuildingComponent,y:number)=>y>=6&&p.settings.kind!=='castle'&&c.phase>0;
  for(const c of p.components){
    if(c.kind==='court')continue;
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
  for(const r of p.rooms)if(r.kind!=='court')polygonFill(clipPolygon(r.polygon,interior(r.bounds)),r.floorY+1,r.ceilingY-r.floorY-1,0,'air',r.componentId);
  for(const r of p.rooms){
    if(r.kind==='court'){polygonFill(r.polygon,-1,1,6,'ground',r.componentId);continue;}
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
      const r=componentFootprint(c,y,p.family),timber=framed(c,y);
      outline(rectPolygon(r),y,6,timber?5:1,'wall',c.id);
      if(timber){
        outline(rectPolygon(r),y,1,2,'wall',c.id);
        for(let x=r.x;x<=r.x+r.w;x+=5){box({x,z:r.z,w:1,d:1},y,6,2,'wall',c.id);box({x,z:r.z+r.d,w:1,d:1},y,6,2,'wall',c.id);}
        for(let z=r.z;z<=r.z+r.d;z+=5){box({x:r.x,z,w:1,d:1},y,6,2,'wall',c.id);box({x:r.x+r.w,z,w:1,d:1},y,6,2,'wall',c.id);}
      }
    }
  }
  // ---- Wall mass. A wall that is one block thick whatever it carries reads as a line, not as masonry, and
  // the drawing has to fake the difference with a heavier stroke. An outside wall is given its real thickness
  // here — three blocks for a castle, two otherwise, one more again on a retained core — and it is taken
  // outward, so a room keeps the floor it was cut with and a wall two ranges share stays one wall between
  // them rather than becoming two.
  /** The bands of wall a range actually carries: one tall shell for a hall or tower, one per storey elsewhere. */
  const wallBands=(c:BuildingComponent):[Rect,number,number][]=>{
    if(c.kind==='hall'||c.kind==='tower')return [[c.bounds,c.baseY,c.topY-c.baseY]];
    const out:[Rect,number,number][]=[];
    for(let y=c.baseY;y<c.topY;y+=6)out.push([componentFootprint(c,y,p.family),y,6]);
    return out;
  };
  /** Whether this cell is open ground: not inside any range, and not inside a yard a range is entered from. */
  const openGround=(x:number,z:number)=>!p.components.some(o=>x>=o.bounds.x&&x<o.bounds.x+o.bounds.w&&z>=o.bounds.z&&z<o.bounds.z+o.bounds.d);
  const thickened=new Set<string>();
  for(const c of p.components){
    // A chamfered tower has no straight face to thicken outward; its shell keeps the polygon it was cut with.
    if(c.kind==='court'||c.polygon.length>4)continue;
    for(const [f,y,h] of wallBands(c)){
      const timber=c.kind!=='hall'&&c.kind!=='tower'&&framed(c,y);
      // An upper storey in timber is a lighter frame than the masonry below it.
      const depth=timber?shellOf(c)-1:shellOf(c);
      if(depth<2)continue;
      for(const [side,along,from,to] of [
        ['n',f.z,f.x,f.x+f.w],['s',f.z+f.d,f.x,f.x+f.w],
        ['w',f.x,f.z,f.z+f.d],['e',f.x+f.w,f.z,f.z+f.d],
      ] as const){
        const across=side==='n'||side==='s',outward=side==='n'||side==='w'?-1:1;
        for(let at=from;at<=to;at++)for(let step=1;step<depth;step++){
          const x=across?at:along+outward*step,z=across?along+outward*step:at;
          if(!openGround(x,z))continue;
          box({x,z,w:1,d:1},y,h,timber?5:1,'wall',c.id);
          thickened.add(`${x},${z}`);
        }
      }
    }
  }
  // ---- Facades. A wall is divided into bays before anything is cut into it, and the same bay lines serve
  // every storey of a range, so an upper window stands over the one below rather than wherever a room on
  // that floor happened to end. What a bay gets depends on what is behind it: a hall takes a tall light, a
  // store a slit, a chapel a lancet; a hearth, a stair or a doorway takes none.
  const doorCells=new Set<string>();
  for(const o of p.openings){
    if(o.type==='window')continue;
    for(let w=-1;w<=o.width;w++)doorCells.add(`${o.x+(o.axis==='z'?w:0)},${o.z+(o.axis==='x'?w:0)}`);
  }
  /** What each kind of room asks of its wall: how wide a light, how tall, and how high off the floor. */
  const LIGHT:Partial<Record<RoomKind,{width:number;height:number;sill:number}>>={
    hall:{width:2,height:4,sill:2},sacred:{width:2,height:4,sill:2},gallery:{width:2,height:2,sill:2},
    study:{width:2,height:2,sill:2},bedroom:{width:2,height:2,sill:2},service:{width:2,height:2,sill:2},
    circulation:{width:1,height:2,sill:2},storage:{width:1,height:2,sill:3},
  };
  const roomsAt=new Map<number,Room[]>();
  for(const r of p.rooms)roomsAt.set(r.floorY,[...(roomsAt.get(r.floorY)??[]),r]);
  // A room's bounds reject almost every point before the polygon test, and a clipped polygon never leaves
  // its bounds, so the cheap test is a safe filter for the expensive one.
  const holds=(r:Room,x:number,z:number)=>x>r.bounds.x&&x<r.bounds.x+r.bounds.w&&z>r.bounds.z&&z<r.bounds.z+r.bounds.d&&insidePolygon(x,z,r.polygon);
  const tall=p.rooms.filter(r=>r.ceilingY-r.floorY>6);
  const lit=new Set<string>();
  for(const c of p.components){
    if(c.kind==='court')continue;
    const levels=[...new Set(p.rooms.filter(r=>r.componentId===c.id&&r.floorY>=0).map(r=>r.floorY))].sort((m,n)=>m-n);
    const lines=bayLines(c,p.settings.kind==='castle'),pier=lines.pier;
    /** Cut one light into this wall at this point, if everything behind and beside it allows one. */
    const place=(side:'n'|'s'|'e'|'w',at:number,y:number,narrow=false)=>{
      const across=side==='n'||side==='s',axis=across?'z':'x';
      const fo=componentFootprint(c,y,p.family);
      const fixed=side==='n'?fo.z:side==='s'?fo.z+fo.d:side==='w'?fo.x:fo.x+fo.w;
      const inward=side==='n'||side==='w'?1:-1;
      const sample=(along:number,step:number)=>across?{x:along+.5,z:fixed+step}:{x:fixed+step,z:along+.5};
      const level=roomsAt.get(y)??[];
      const inner=sample(at,inward>0?1.5:-.5);
      const room=level.find(r=>r.componentId===c.id&&holds(r,inner.x,inner.z));
      const wants=room&&LIGHT[room.kind];
      if(!room||!wants)return false;
      // A wall a block thicker than its neighbours' was not glazed like them: in a retained core every light
      // but the showpiece ones is a single opening deep in its embrasure.
      const asked=c.phase===0&&room.kind!=='hall'&&room.kind!=='sacred'?{...wants,width:1}:wants;
      // A wall with no room for a pier either side of a full light still takes a single-block one.
      const light=narrow?{...asked,width:1}:asked;
      const start=at-Math.floor(light.width/2);
      // A pier either side: every cell of the light and one beyond it belongs to the one room behind.
      for(let w=-1;w<=light.width;w++){
        const cell=sample(start+w,inward>0?1.5:-.5);
        if(!holds(room,cell.x,cell.z))return false;
      }
      // The other side has to be open ground at this level, and nothing may already occupy the wall.
      const outer=sample(at,inward>0?-.5:.5);
      if(level.some(o=>o.id!==room.id&&holds(o,outer.x,outer.z)))return false;
      if(tall.some(o=>o.floorY<y&&o.ceilingY>y&&holds(o,outer.x,outer.z)))return false;
      const cells=Array.from({length:light.width},(_,w)=>across?`${start+w},${fixed}`:`${fixed},${start+w}`);
      if(cells.some(k=>doorCells.has(k)))return false;
      // A hearth or an oven standing against this wall is a mass of masonry, not a place for a window.
      const mass={x:across?start-1:fixed-1,z:across?fixed-1:start-1,w:across?light.width+2:3,d:across?3:light.width+2};
      if(room.furniture.some(fu=>(fu.type==='hearth'||fu.type==='oven')&&intersects(fu,mass)))return false;
      const x=across?start:fixed,z=across?fixed:start;
      p.openings.push({id:`w${p.openings.length}`,type:'window',axis,x,z,y:y+light.sill,width:light.width,height:light.height,roomIds:[room.id]});
      // A hall carried through two storeys takes a second tier of light above the first.
      if(room.ceilingY-room.floorY>=12)p.openings.push({id:`w${p.openings.length}`,type:'window',axis,x,z,y:y+light.sill+6,width:light.width,height:light.height,roomIds:[room.id]});
      lit.add(room.id);
      return true;
    };
    for(const side of ['n','s','e','w'] as const){
      for(const at of (side==='n'||side==='s'?lines.x:lines.z))for(const y of levels)place(side,at,y);
    }
    // Where the bay rhythm and the rooms behind it disagree, they are repaired together: a room the rhythm
    // misses, but which has a wall of its own to the outside, takes its light on its own centre line.
    for(const y of levels){
      const fo=componentFootprint(c,y,p.family);
      for(const r of (roomsAt.get(y)??[])){
        if(r.componentId!==c.id||lit.has(r.id)||!LIGHT[r.kind])continue;
        for(const side of ['s','e','n','w'] as const){
          const across=side==='n'||side==='s',rb=r.bounds;
          const edge=side==='n'?fo.z:side==='s'?fo.z+fo.d:side==='w'?fo.x:fo.x+fo.w;
          if((side==='n'?rb.z:side==='s'?rb.z+rb.d:side==='w'?rb.x:rb.x+rb.w)!==edge)continue;
          const lo=across?rb.x:rb.z,hi=across?rb.x+rb.w:rb.z+rb.d,mid=Math.floor((lo+hi)/2);
          // Off the rhythm but still on the wall's own grid, so a repaired light stands over the storeys
          // below it rather than wherever this floor's rooms happen to divide.
          const from=across?c.bounds.x:c.bounds.z,to=across?c.bounds.x+c.bounds.w:c.bounds.z+c.bounds.d,grid:number[]=[];
          for(let at=from+pier;at<=to-pier;at+=3)if(at>lo&&at<hi)grid.push(at);
          grid.sort((m,n)=>Math.abs(m-mid)-Math.abs(n-mid)||m-n);
          const spots=[...grid,mid];
          if(spots.some(at=>place(side,at,y))||spots.some(at=>place(side,at,y,true)))break;
        }
      }
    }
  }
  // An opening is cut through the whole thickness of its wall: a door becomes a passage and a window a
  // reveal, rather than a hole in the inner face with masonry still standing behind it.
  const jamb=(o:Opening,step:number)=>Array.from({length:o.width},(_,w)=>o.axis==='x'?{x:o.x+step,z:o.z+w}:{x:o.x+w,z:o.z+step});
  for(const o of p.openings){
    const material=o.type==='window'?4:0,kind=o.type==='window'?'glass':'air' as const;
    const id=p.rooms.find(r=>r.id===o.roomIds[0])!.componentId;
    box({x:o.x,z:o.z,w:o.axis==='x'?1:o.width,d:o.axis==='z'?1:o.width},o.y,o.height,material,kind,id);
    for(const dir of [1,-1])for(let step=dir;Math.abs(step)<shell;step+=dir){
      const cells=jamb(o,step);
      if(!cells.every(c=>thickened.has(`${c.x},${c.z}`)))break;
      for(const c of cells)box({x:c.x,z:c.z,w:1,d:1},o.y,o.height,material,kind,id);
    }
  }
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
    // A stack belongs over a fire. Where a hearth or an oven backs onto an outside wall, the flue rises
    // against that wall and in line with it; only a range whose fires are all internal takes a stack on the
    // first free corner instead.
    const stacks:Rect[]=[];
    for(const f of p.rooms.filter(r=>r.componentId===c.id&&r.floorY===0).flatMap(r=>r.furniture.filter(fu=>fu.type==='hearth'||fu.type==='oven'))){
      if(f.x<=b.x+2)stacks.push({x:b.x-2,z:f.z,w:2,d:Math.max(2,f.d)});
      else if(f.x+f.w>=b.x+b.w-2)stacks.push({x:b.x+b.w+1,z:f.z,w:2,d:Math.max(2,f.d)});
      else if(f.z<=b.z+2)stacks.push({x:f.x,z:b.z-2,w:Math.max(2,f.w),d:2});
      else if(f.z+f.d>=b.z+b.d-2)stacks.push({x:f.x,z:b.z+b.d+1,w:Math.max(2,f.w),d:2});
    }
    const sides=[{x:b.x-2,z:b.z+3,w:2,d:3},{x:b.x+b.w+1,z:b.z+3,w:2,d:3},{x:b.x+3,z:b.z-2,w:3,d:2},{x:b.x+3,z:b.z+b.d+1,w:3,d:2}];
    const chimney=[...stacks,...sides].find(r=>!p.components.some(other=>intersects(other.bounds,r)));
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
    for(let t=0;t<court.thickness;t++)outline(rectPolygon({x:b.x+t,z:b.z+t,w:b.w-2*t,d:b.d-2*t}),0,h+1,1,'wall',court.id);
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
    const g=court.gatehouse,passage={x:court.gate.x-2,z:g.z,w:5,d:g.d};
    outline(rectPolygon(g),0,h+3,1,'wall',court.id);
    polygonFill(rectPolygon(g),-1,1,6,'ground',court.id);
    for(const dx of [-2,3])outline(rectPolygon({x:court.gate.x+dx,z:g.z,w:1,d:g.d}),0,h+3,1,'wall',court.id);
    box(passage,0,5,0,'air',court.id);
    box({x:passage.x,z:passage.z-4,w:passage.w,d:passage.d+8},-1,1,6,'ground',court.id);
    for(const side of [g.x,g.x+g.w-5]){
      box({x:side+1,z:g.z+1,w:4,d:g.d-2},1,4,0,'air',court.id);
      box({x:side+1,z:g.z+1,w:4,d:g.d-2},0,1,1,'floor',court.id);
    }
    box({x:g.x,z:g.z,w:g.w,d:g.d},h+3,1,3,'roof',court.id);
    for(const cx of [g.x,g.x+g.w-2])box({x:cx,z:g.z-1,w:2,d:2},0,h+5,1,'wall',court.id);
    for(const yard of court.yards)box(yard.bounds,-1,1,yard.kind==='garden'?7:6,'ground',court.id);
    if(court.well){
      const w=court.well;
      outline(rectPolygon({x:w.x-2,z:w.z-2,w:4,d:4}),0,2,1,'wall',court.id);
      box({x:w.x-1,z:w.z-1,w:2,d:2},-2,2,0,'air',court.id);
    }
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
 * Validity first, then how the thing walks, then how it stands. A forced crossing is the defect this
 * generator exists to avoid, so navigation carries twice the weight of composition; but between two plans
 * that both walk, the one that is a building rather than a chain of sheds wins.
 */
export const rank=(p:Plan)=>p.navigation.score*2+p.composition.score;
/**
 * How many compositions a seed is worth trying. Each further candidate buys less than the one before it:
 * across a 144-setting survey the fifth is worth a point of rank and the eighth barely half of one, against
 * a full composition apiece — and a large site costs more per candidate, so it is allowed fewer.
 */
export const candidateCount=(settings:Settings)=>settings.size>320?3:5;
/**
 * Compose every candidate the seed is worth and keep the best of them, rather than the first that merely
 * stands up. The attempt count is fixed per size so the result stays a pure function of the settings.
 */
export function tryGenerate(settings:Settings):GenerationResult {
  let reason='The composition could not be connected.';
  const budget=candidateCount(settings),cap=8,candidates:Plan[]=[],audited=new Map<Plan,string[]>();
  // Rank on what is cheap to know, and pay for the built check on the best of them in turn. Voxelising
  // every candidate to audit it costs more than composing them all, and tells us nothing about the losers.
  const best=()=>{
    for(const plan of [...candidates].sort((a,b)=>rank(b)-rank(a))){
      let issues=audited.get(plan);
      if(!issues){issues=auditArchitecture(plan);audited.set(plan,issues);}
      if(!issues.length)return plan;
      reason=issues.join(' ');
    }
    return undefined;
  };
  for(let attempt=0;attempt<cap;attempt++){
    let plan:Plan;
    try{plan=generateCandidate(settings,attempt);}catch(error){return {ok:false,error:error instanceof Error?error.message:'Invalid settings.'};}
    if(!plan.validation.valid){reason=plan.validation.issues.join(' ');continue;}
    candidates.push(plan);
    if(attempt+1<budget)continue;
    // The ordinary budget is enough once something both builds and walks without a forced crossing. A seed
    // that has not produced one yet is worth more compositions than a seed that has.
    const chosen=best();
    if(chosen&&!chosen.navigation.transits.length)return {ok:true,plan:chosen};
  }
  const chosen=best();
  if(chosen)return {ok:true,plan:chosen};
  return {ok:false,error:`Could not make a buildable composition: ${reason} Try a different seed or a larger footprint. Your previous build is retained.`};
}
export function generatePlan(settings:Settings):Plan {const result=tryGenerate(settings);if(!result.ok)throw new Error(result.error);return result.plan;}
