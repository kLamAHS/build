import { DEFAULT_SETTINGS, type Settings, type Plan } from './generator.ts';

type Tool = {name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown};
type ModelContext = {registerTool:(tool:Tool,options?:{signal:AbortSignal})=>void|Promise<void>};
export type BlueprintBridge = {read:()=>Plan;generate:(settings:Settings)=>void;selectFloor:(index:number)=>void};
export function validateSettings(input:unknown,base:Settings):Settings {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected a settings object.');
  const record=input as Record<string,unknown>;
  for(const key of Object.keys(record))if(!(key in DEFAULT_SETTINGS))throw new Error(`Unknown setting: ${key}`);
  if(record.kind!==undefined&&!['castle','manor','house'].includes(String(record.kind)))throw new Error('Choose castle, manor, or house.');
  for(const [key,min,max] of [['size',48,192],['floors',1,5],['organic',0,100]] as const){const v=record[key];if(v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(key==='floors'&&!Number.isInteger(v))))throw new Error(`${key} must be between ${min} and ${max}.`)}
  for(const key of ['courtyard','chapel','garden','cellar'] as const)if(record[key]!==undefined&&typeof record[key]!=='boolean')throw new Error(`${key} must be true or false.`);
  if(record.seed!==undefined&&(typeof record.seed!=='string'||!record.seed.trim()||record.seed.length>64))throw new Error('Use a nonempty seed of up to 64 characters.');
  return {...base,...record} as Settings;
}
export function summarizePlan(plan:Plan){return {name:plan.name,settings:plan.settings,width:plan.width,depth:plan.depth,floors:plan.floors.map(f=>({index:f.index,name:f.name,rooms:f.rooms.map(r=>({id:r.id,name:r.name,width:Number(r.w.toFixed(1)),depth:Number(r.h.toFixed(1)),area:r.area}))}))};}
export function registerBlueprintTools(context:ModelContext,bridge:BlueprintBridge){
  const lifecycle=new AbortController();
  const tools:Tool[]=[{
    name:'generate_blueprint',title:'Generate medieval blueprint',description:'Generate and display a castle, manor, or house using a seed and optional settings. Replaces the current blueprint.',
    inputSchema:{type:'object',properties:{kind:{type:'string',enum:['castle','manor','house']},size:{type:'number',minimum:48,maximum:192},floors:{type:'integer',minimum:1,maximum:5},organic:{type:'number',minimum:0,maximum:100},seed:{type:'string',minLength:1,maxLength:64},courtyard:{type:'boolean'},chapel:{type:'boolean'},garden:{type:'boolean'},cellar:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){const settings=validateSettings(input,bridge.read().settings);bridge.generate(settings);return summarizePlan(bridge.read());}
  },{
    name:'read_blueprint',title:'Read current blueprint',description:'Read the current blueprint settings, floor list, room names, and dimensions.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('No arguments are accepted.');return summarizePlan(bridge.read());}
  },{
    name:'show_blueprint_floor',title:'Show blueprint floor',description:'Open an existing floor in the floor-plan view.',inputSchema:{type:'object',properties:{index:{type:'integer',minimum:-1,maximum:4}},required:['index'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){const record=input as {index?:unknown};if(!record||typeof record!=='object'||Object.keys(record).some(k=>k!=='index')||typeof record.index!=='number'||!Number.isInteger(record.index))throw new Error('Supply one integer floor index.');const f=bridge.read().floors.find(f=>f.index===record.index);if(!f)throw new Error('That floor does not exist.');bridge.selectFloor(f.index);return {index:f.index,name:f.name,rooms:f.rooms.length};}
  }];
  for(const tool of tools){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* The drawing remains available when a browser does not support tools. */}}
  return ()=>lifecycle.abort();
}
export function getModelContext(){return typeof document==='undefined'?undefined:(document as Document & {modelContext?:ModelContext}).modelContext;}
