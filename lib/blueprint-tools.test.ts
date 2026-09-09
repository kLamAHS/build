import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePlan, DEFAULT_SETTINGS } from './generator.ts';
import { registerBlueprintTools } from './blueprint-tools.ts';

test('tool contract updates the shared model and rejects invalid requests without changes',()=>{
 let current=generatePlan(DEFAULT_SETTINGS),level=0;
 const registered=new Map<string,{execute:(input:unknown)=>unknown;annotations:{readOnlyHint:boolean}}>();
 const signals:AbortSignal[]=[];
 const unregister=registerBlueprintTools({registerTool(tool,options){registered.set(tool.name,tool);if(options)signals.push(options.signal)}},{read:()=>current,generate:s=>{current=generatePlan(s)},selectFloor:i=>{level=i}});
 assert.deepEqual([...registered.keys()],['generate_blueprint','read_blueprint','show_blueprint_floor']);
 assert.equal(registered.get('read_blueprint')!.annotations.readOnlyHint,true);
 const result=registered.get('generate_blueprint')!.execute({kind:'manor',size:96,seed:'MY-MANOR',floors:4,cellar:true}) as {settings:{seed:string}};
 assert.equal(result.settings.seed,'MY-MANOR');assert.equal(current.settings.kind,'manor');assert.equal(current.floors.length,5);
 registered.get('show_blueprint_floor')!.execute({index:-1});assert.equal(level,-1);
 const before=JSON.stringify(current);
 for(const input of [{kind:'invalid'},{size:2},{floors:2.5},{cellar:'yes'},{seed:''},{unknown:true},null])assert.throws(()=>registered.get('generate_blueprint')!.execute(input));
 assert.throws(()=>registered.get('show_blueprint_floor')!.execute({index:99}));
 assert.equal(JSON.stringify(current),before);
 unregister();assert.ok(signals.every(s=>s.aborted));
});
