import { type Navigation, type Opening, type Plan, type Room, type RoomKind, type Transit } from './model.ts';

/** Rooms a household may cross to reach somewhere else. Everything else is a destination, not a route. */
export const CIRCULATION_KINDS:readonly RoomKind[]=['circulation','stairs','gallery','hall','court'];
export const isCirculation=(r:Room)=>CIRCULATION_KINDS.includes(r.kind);
/** How private a room is. A route forced through a steward's office is a compromise; a bedchamber is not. */
export const ROOM_PRIVACY:Record<RoomKind,number>={court:0,circulation:0,stairs:0,hall:1,gallery:1,sacred:2,study:3,service:3,storage:4,bedroom:5};

/**
 * Doors a household would not have cut. Service reaches the hall through the screens passage rather than
 * through the hall body; nothing opens off a chapel but its antechapel; a bedchamber is not a back door.
 * The generator uses this to decide which doors to cut; the report uses it to count the ones it had to.
 */
export const IMPROPER_DOORS:Partial<Record<RoomKind,RoomKind[]>>={
  hall:['service','storage','bedroom'],sacred:['service','storage','bedroom','study'],
  bedroom:['service','bedroom','sacred','hall'],service:['hall','sacred','bedroom'],
  storage:['hall','sacred'],study:['sacred'],
};
/** How far along a hall's own axis a door may sit before it is a shortcut through the room, not a threshold. */
export const HALL_END=7;

/**
 * The doors in a finished plan that the access grammar would not have chosen — cut only because nothing
 * else reached. A plan needing several of them is connected but compromised, and the ranker should say so.
 */
export function improperDoors(plan:Plan):Opening[] {
  const byId=new Map(plan.rooms.map(r=>[r.id,r]));
  const kindOf=new Map(plan.components.map(c=>[c.id,c.kind]));
  const sacred=new Set(plan.rooms.filter(r=>kindOf.get(r.componentId)==='chapel').map(r=>r.id));
  const out:Opening[]=[];
  for(const o of plan.openings){
    if(o.type==='window'||o.roomIds.length<2)continue;
    const a=byId.get(o.roomIds[0]),b=byId.get(o.roomIds[1]);
    if(!a||!b)continue;
    const bad=(IMPROPER_DOORS[a.kind]??[]).includes(b.kind)||(IMPROPER_DOORS[b.kind]??[]).includes(a.kind)
      ||(sacred.has(a.id)!==sacred.has(b.id)&&!isCirculation(sacred.has(a.id)?b:a));
    if(bad){out.push(o);continue;}
    // A door into the middle of the hall's flank is a second route through the room the house is built round.
    const hall=a.kind==='hall'?a:b.kind==='hall'?b:undefined;
    if(!hall)continue;
    const other=hall===a?b:a;
    if(other.componentId===hall.componentId)continue;
    const r=hall.bounds,along:'x'|'z'=r.d>=r.w?'z':'x';
    const lo=along==='z'?r.z:r.x,len=along==='z'?r.d:r.w,at=along==='z'?o.z:o.x;
    // A service door beside the dais puts the household's dinner through its private end, which is the one
    // thing a screens passage exists to prevent. Where the grammar was forced into one, it is a compromise.
    const serving=kindOf.get(other.componentId);
    if((serving==='service'||serving==='workshop')&&at<lo+Math.round(len/2)){out.push(o);continue;}
    if((along==='z')===(o.axis==='z'))continue;
    if(at>lo+HALL_END&&at<lo+len-HALL_END-1)out.push(o);
  }
  return out;
}

export type AccessGraph={adjacency:Map<string,string[]>;depth:Map<string,number>;entry:string|undefined;unreachable:string[]};

/** Rooms joined by doors and stair flights, with the number of doors crossed from the entrance. */
export function accessGraph(plan:Plan):AccessGraph {
  const adjacency=new Map<string,string[]>(plan.rooms.map(r=>[r.id,[]]));
  for(const [a,b] of plan.connections){
    if(a===b||!adjacency.has(a)||!adjacency.has(b))continue;
    if(!adjacency.get(a)!.includes(b))adjacency.get(a)!.push(b);
    if(!adjacency.get(b)!.includes(a))adjacency.get(b)!.push(a);
  }
  const entry=plan.openings.find(o=>o.type==='entrance')?.roomIds[0],depth=new Map<string,number>();
  if(entry!==undefined&&adjacency.has(entry)){
    depth.set(entry,0);const queue=[entry];
    for(let cursor=0;cursor<queue.length;cursor++)for(const next of adjacency.get(queue[cursor])!){
      if(depth.has(next))continue;depth.set(next,depth.get(queue[cursor])!+1);queue.push(next);
    }
  }
  return {adjacency,depth,entry,unreachable:plan.rooms.filter(r=>!depth.has(r.id)).map(r=>r.id)};
}

/**
 * Rooms whose closure strands another room — the honest reading of "you have to walk through it".
 * A chamber with two doors is not a defect while a second route exists, which is what loops are for.
 * The entrance is left out: it is on every route into the building, so naming it says nothing.
 * Iterative Hopcroft–Tarjan: recursion would overflow on a five-hundred-room castle.
 */
export function articulationPoints(graph:AccessGraph):Map<string,string[]> {
  const cuts=new Map<string,string[]>(),{adjacency,entry}=graph;
  if(entry===undefined||!adjacency.has(entry))return cuts;
  const discovery=new Map<string,number>(),low=new Map<string,number>(),parent=new Map<string,string|null>(),subtree=new Map<string,string[]>();
  const stack=[{id:entry,index:0}];let timer=0;
  discovery.set(entry,timer);low.set(entry,timer++);parent.set(entry,null);
  while(stack.length){
    const frame=stack[stack.length-1],neighbours=adjacency.get(frame.id)!;
    if(frame.index<neighbours.length){
      const next=neighbours[frame.index++];
      if(next===parent.get(frame.id))continue;
      if(discovery.has(next)){low.set(frame.id,Math.min(low.get(frame.id)!,discovery.get(next)!));continue;}
      parent.set(next,frame.id);discovery.set(next,timer);low.set(next,timer++);stack.push({id:next,index:0});
      continue;
    }
    stack.pop();
    const up=parent.get(frame.id);
    if(up==null)continue;
    low.set(up,Math.min(low.get(up)!,low.get(frame.id)!));
    // Everything discovered beneath this child stays behind it when `up` closes.
    const branch=[frame.id,...(subtree.get(frame.id)??[])];
    subtree.set(up,[...(subtree.get(up)??[]),...branch]);
    if(up!==entry&&low.get(frame.id)!>=discovery.get(up)!)cuts.set(up,[...(cuts.get(up)??[]),...branch]);
  }
  return cuts;
}

/** Rooms that are not circulation and yet carry other rooms' only route. These are the layout's defects. */
export function transitViolations(plan:Plan,graph=accessGraph(plan)):Transit[] {
  const byId=new Map(plan.rooms.map(r=>[r.id,r])),violations:Transit[]=[];
  const suiteOf=new Map<string,Plan['suites'][number]>();
  for(const suite of plan.suites)for(const id of suite.roomIds)suiteOf.set(id,suite);
  for(const [id,strands] of articulationPoints(graph)){
    const room=byId.get(id);
    if(!room||isCirculation(room))continue;
    const suite=suiteOf.get(id);
    if(suite&&suite.headId===id&&strands.every(s=>suite.roomIds.includes(s)))continue;
    violations.push({roomId:id,name:room.name,kind:room.kind,floorY:room.floorY,strands});
  }
  return violations.sort((a,b)=>b.strands.length-a.strands.length||a.roomId.localeCompare(b.roomId));
}

/** How the finished plan actually walks. 100 is no forced crossings, shallow routes and a way back round. */
export function navigationReport(plan:Plan):Navigation {
  const graph=accessGraph(plan),transits=transitViolations(plan,graph),depths=[...graph.depth.values()];
  const compromises=improperDoors(plan).length;
  const maxDepth=depths.length?Math.max(...depths):0;
  const meanDepth=depths.length?depths.reduce((a,b)=>a+b,0)/depths.length:0;
  const doorways=new Set(plan.connections.map(([a,b])=>a<b?`${a}|${b}`:`${b}|${a}`)).size;
  const loops=doorways-plan.rooms.length+1;
  const stranded=new Set(transits.flatMap(t=>t.strands));
  // A forced crossing is the defect this generator exists to avoid, so it dominates the score.
  const crossings=Math.min(60,transits.length*12+stranded.size*2);
  const reach=Math.min(25,Math.max(0,maxDepth-6)*2.5);
  const alternatives=Math.min(15,Math.max(0,loops)*3);
  // A door the grammar would not have cut is a compromise, not a defect: the plan works, but a household
  // is walking through somewhere it would not have opened.
  const grudging=Math.min(12,compromises*4);
  const score=Math.max(0,Math.round(85-crossings-reach-grudging-graph.unreachable.length*10+alternatives));
  return {maxDepth,meanDepth:Number(meanDepth.toFixed(2)),loops,unreachable:graph.unreachable,transits,strandedRooms:stranded.size,compromises,score};
}

/** The door-by-door walk from the entrance to one room, for the plan's room inspector. */
export function routeToRoom(plan:Plan,roomId:string,graph=accessGraph(plan)):Room[] {
  const byId=new Map(plan.rooms.map(r=>[r.id,r]));
  if(graph.entry===undefined||!graph.depth.has(roomId))return [];
  const route:Room[]=[];
  for(let here=roomId;here!==graph.entry;){
    const room=byId.get(here);
    if(!room)break;
    route.push(room);
    const back=graph.adjacency.get(here)!.filter(n=>graph.depth.get(n)===graph.depth.get(here)!-1);
    const step=back.sort((m,n)=>(ROOM_PRIVACY[byId.get(m)?.kind??'circulation']-ROOM_PRIVACY[byId.get(n)?.kind??'circulation'])||m.localeCompare(n))[0];
    if(step===undefined)break;
    here=step;
  }
  const start=byId.get(graph.entry);
  if(start)route.push(start);
  return route.reverse();
}
