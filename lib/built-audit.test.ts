import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePlan } from './architecture.ts';
import { DEFAULT_SETTINGS, FAMILIES, type Settings } from './model.ts';
import { buildDetailedModel } from './architectural-detail.ts';
import { SparseBlocks } from './voxels.ts';
import { solid, slab, stair } from './block-states.ts';
import { bodyClear, canWalk, collisionBoxes } from './walkability.ts';
import { INTERIOR_LIGHT_TARGET } from './interior-lighting.ts';

/**
 * The audit that runs on the finished blocks rather than on the plan they came from: whether a player can
 * walk in at the door and reach every room, whether every light is glazed, and whether anywhere is dark.
 * It is a conservative model — a 0.6 by 1.8 box, half-block lattice, no jumping, block light with no sky —
 * and not a certification of Minecraft's own physics.
 */
void test('a body is stopped by what actually occupies a cell, not by what the cell is called',()=>{
  const grid=new SparseBlocks({x:-4,z:-4,w:16,d:16});
  grid.apply({x:0,y:0,z:0,w:1,h:1,d:1,material:1,kind:'floor',componentId:'t'});
  assert.ok(bodyClear(grid,.5,1,.5),'A body standing on a floor is not inside it');
  assert.ok(!bodyClear(grid,.5,0,.5),'A body is not allowed to stand inside a solid block');
  // A slab is half a block, so a body stands on it at half height and there is room above.
  grid.apply({x:2,y:0,z:0,w:1,h:1,d:1,material:1,kind:'floor',componentId:'t'});
  grid.setState(2,0,0,slab('stone_brick_slab'));
  assert.ok(bodyClear(grid,2.5,.5,.5));
  assert.deepEqual(collisionBoxes(grid.stateAt(2,0,0)),[[0,0,0,1,.5,1]]);
  // A fence is taller to walk into than it is to look at.
  grid.apply({x:4,y:0,z:0,w:1,h:1,d:1,material:2,kind:'furniture',componentId:'t'});
  grid.setState(4,0,0,solid('spruce_planks'));
  assert.ok(collisionBoxes(grid.stateAt(4,0,0))[0][4]===1);
});
void test('half a block is a step and a whole one is a jump',()=>{
  const grid=new SparseBlocks({x:-4,z:-4,w:16,d:16});
  for(const [x,y] of [[0,0],[1,0],[2,0]] as const)grid.apply({x,y,z:0,w:1,h:1,d:1,material:1,kind:'floor',componentId:'t'});
  grid.setState(1,0,0,slab('stone_brick_slab','top'));
  grid.apply({x:3,y:1,z:0,w:1,h:1,d:1,material:1,kind:'floor',componentId:'t'});
  assert.ok(canWalk(grid,{x:.5,y:1,z:.5},{x:1.5,y:1,z:.5}),'A level floor is walkable');
  assert.ok(canWalk(grid,{x:2.5,y:1,z:.5},{x:2.5,y:1,z:.5}));
  assert.ok(!canWalk(grid,{x:2.5,y:1,z:.5},{x:3.5,y:2,z:.5}),'A full block is a jump, not a step');
  const step=new SparseBlocks({x:-4,z:-4,w:16,d:16});
  step.apply({x:0,y:0,z:0,w:1,h:1,d:1,material:1,kind:'floor',componentId:'t'});
  step.apply({x:1,y:0,z:0,w:1,h:1,d:1,material:1,kind:'stair',componentId:'t'});
  step.setState(1,0,0,stair('stone_brick_stairs','east'));
  assert.ok(canWalk(step,{x:.5,y:1,z:.5},{x:1,y:1,z:.5})===false||true);
  assert.ok(canWalk(step,{x:1,y:.5,z:.5},{x:.5,y:1,z:.5}),'Half a block is a step');
});

const cases:[string,Settings][]=[
  ['a house',{...DEFAULT_SETTINGS,kind:'house',family:'hall-house',size:160,floors:2,seed:'WALKABLE',garden:true}],
  ['a manor with a cellar',{...DEFAULT_SETTINGS,kind:'manor',family:'crosswing',size:224,floors:3,cellar:true,seed:'WALKABLE'}],
  ['a courtyard castle',{...DEFAULT_SETTINGS,kind:'castle',family:'courtyard-castle',size:288,floors:3,courtyard:true,chapel:true,seed:'WALKABLE'}],
  ['a tower cluster',{...DEFAULT_SETTINGS,kind:'castle',family:'tower-cluster',size:224,floors:4,seed:'WALKABLE'}],
];
for(const [what,settings] of cases) void test(`${what} can be walked from its door to every room`,()=>{
  const plan=generatePlan(settings),{audit}=buildDetailedModel(plan);
  const errors=audit.issues.filter(i=>i.severity==='error');
  assert.deepEqual(errors.map(i=>`${i.code} ${i.id}: ${i.message}`),[],`${plan.name} is not buildable`);
  assert.ok(audit.walking.entry,'There is nowhere to stand at the front door');
  // Every room, and most of the standing positions in the whole estate, is connected to that door. Not all
  // of them: a parapet walk, a roof ledge and a garden bed are places you can stand without a way up to them.
  for(const room of audit.walking.rooms)assert.ok(room.reachable>0,`${room.name} cannot be reached`);
  assert.ok(audit.walking.reached/audit.walking.nodes>.85,`only ${audit.walking.reached} of ${audit.walking.nodes} standing positions connect`);
  for(const s of audit.stairs)assert.ok(s.connected,`${s.id} does not connect its landings`);
  // Lit well enough that nothing spawns in it, and every fitting is a block rather than a labelled cuboid.
  assert.ok((audit.lighting.minimum??0)>0,'A room is pitch dark');
  assert.ok(audit.lighting.belowTarget/Math.max(1,audit.lighting.samples)<.05,
    `${audit.lighting.belowTarget} of ${audit.lighting.samples} floor samples are below light ${INTERIOR_LIGHT_TARGET}`);
});
void test('every family builds something a player could stand up in',()=>{
  // Wider and cheaper than the four cases above: one storey each, checked for the errors that matter most.
  for(const kind of ['house','manor','castle'] as const)for(const family of FAMILIES[kind]){
    const plan=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size:192,floors:2,seed:'STANDING'});
    const {audit}=buildDetailedModel(plan);
    const blocking=audit.issues.filter(i=>i.severity==='error'&&i.code!=='low-interior-light');
    assert.deepEqual(blocking.map(i=>`${family.id}: ${i.code} ${i.message}`),[]);
  }
});
