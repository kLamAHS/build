import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessGraph, articulationPoints, isCirculation, navigationReport, routeToRoom, transitViolations } from './navigation.ts';
import { generatePlan } from './architecture.ts';
import { DEFAULT_SETTINGS, type Plan } from './model.ts';

const seeded=(seed:number)=>{let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};};
const graphOf=(adjacency:Map<string,string[]>,entry:string)=>({adjacency,depth:new Map<string,number>(),entry,unreachable:[]});

/** Remove each room in turn and see which others lose their route. Slow, obvious, and hard to get wrong. */
function byBruteForce(adjacency:Map<string,string[]>,entry:string){
  const reach=(skip:string|null)=>{
    const seen=new Set<string>();
    if(entry===skip)return seen;
    seen.add(entry);const queue=[entry];
    for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i])!)if(next!==skip&&!seen.has(next)){seen.add(next);queue.push(next);}
    return seen;
  };
  const base=reach(null),cuts=new Map<string,string[]>();
  for(const room of adjacency.keys()){
    if(room===entry||!base.has(room))continue;
    const left=reach(room),lost=[...base].filter(other=>other!==room&&!left.has(other));
    if(lost.length)cuts.set(room,lost.sort());
  }
  return cuts;
}

test('articulation points agree with brute force on 400 graphs, including repeated doors and self-loops',()=>{
  for(let seed=1;seed<=400;seed++){
    const random=seeded(seed),count=2+Math.floor(random()*11);
    const ids=Array.from({length:count},(_,i)=>`r${i}`),adjacency=new Map(ids.map(id=>[id,[] as string[]]));
    const edges:[string,string][]=[];
    for(let i=1;i<count;i++)edges.push([ids[i],ids[Math.floor(random()*i)]]);
    for(let k=Math.floor(random()*count);k>0;k--)edges.push([ids[Math.floor(random()*count)],ids[Math.floor(random()*count)]]);
    for(const [a,b] of edges){adjacency.get(a)!.push(b);adjacency.get(b)!.push(a);}
    const found=articulationPoints(graphOf(adjacency,ids[0])),expected=byBruteForce(adjacency,ids[0]);
    assert.deepEqual([...found.keys()].sort(),[...expected.keys()].sort(),`seed ${seed}: ${JSON.stringify(edges)}`);
    for(const [room,lost] of expected)assert.deepEqual([...found.get(room)!].sort(),lost,`seed ${seed}: rooms stranded by ${room}`);
  }
});

test('the entrance is never called a forced crossing, since every route crosses it',()=>{
  // porch -> two wings that share nothing else. Closing the porch parts them, but you always enter through it.
  const adjacency=new Map([['porch',['westA','eastA']],['westA',['porch','westB']],['westB',['westA']],['eastA',['porch']]]);
  assert.deepEqual([...articulationPoints(graphOf(adjacency,'porch')).keys()],['westA']);
});

test('a room with no doors at all is reported unreachable rather than silently dropped',()=>{
  const plan=generatePlan(DEFAULT_SETTINGS);
  const orphan={...plan,rooms:[...plan.rooms,{...plan.rooms[0],id:'orphan',name:'Sealed room'}]} as Plan;
  const graph=accessGraph(orphan);
  assert.deepEqual(graph.unreachable,['orphan']);
  assert.deepEqual(routeToRoom(orphan,'orphan',graph),[]);
});

test('the report on the reference manor matches what the plan carries, and the walk starts at the entrance',()=>{
  const plan=generatePlan(DEFAULT_SETTINGS);
  assert.deepEqual(navigationReport(plan),plan.navigation);
  assert.deepEqual(transitViolations(plan),[]);
  const entry=plan.openings.find(o=>o.type==='entrance')!.roomIds[0];
  for(const room of plan.rooms){
    const walk=routeToRoom(plan,room.id);
    assert.equal(walk[0]?.id,entry,`${room.name} does not start its walk at the entrance`);
    assert.equal(walk[walk.length-1]?.id,room.id);
    assert.equal(walk.length-1,plan.navigation.maxDepth>=0?accessGraph(plan).depth.get(room.id):0,`${room.name}: the walk is not the shortest route`);
  }
  assert.ok(plan.rooms.filter(isCirculation).length>0);
});
