import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePlan, tryGenerate } from './architecture.ts';
import { DEFAULT_SETTINGS } from './model.ts';
import { registerBlueprintTools, validateSettings } from './blueprint-tools.ts';

test('agent tools await generation and report versions, elevations and failures',async()=>{
 let plan=generatePlan(DEFAULT_SETTINGS),floor=0,layer=0;const tools=new Map<string,{execute:(input:unknown)=>unknown}>();
 const cleanup=registerBlueprintTools({registerTool:t=>{tools.set(t.name,t);}}, {read:()=>plan,generate:async settings=>{await Promise.resolve();const result=tryGenerate(settings);if(result.ok)plan=result.plan;return result;},selectFloor:i=>{floor=i;},selectLayer:y=>{layer=y;}});
 assert.equal(tools.size,4);
 const result=await tools.get('generate_blueprint')!.execute({kind:'house',family:'merchant-house',size:128,seed:'MERCHANT'}) as {schemaVersion:number;family:string;ok:boolean};assert.equal(result.ok,true);assert.equal(result.family,'merchant-house');assert.equal(result.schemaVersion,2);
 tools.get('show_blueprint_floor')!.execute({index:1});assert.equal(floor,1);tools.get('show_block_layer')!.execute({y:7});assert.equal(layer,7);
 assert.throws(()=>tools.get('show_block_layer')!.execute({y:1000}));assert.throws(()=>validateSettings({size:513},DEFAULT_SETTINGS));assert.throws(()=>validateSettings({seed:''},DEFAULT_SETTINGS));cleanup();
});
