'use client';
import { useMemo, useState } from 'react';
import { Download, TriangleAlert } from 'lucide-react';
import { buildOutlines, DEFAULT_OUTLINE_OPTIONS, OUTLINE_MATERIALS, outlineFile, type OutlineOptions, type OutlinePlan } from '@/lib/litematica-outlines';

/**
 * The outline export, with the file previewed before it is written: how many markers, how big the schematic
 * is and what will be in it, because the one thing worse than a schematic you cannot build from is finding
 * that out after loading it. It takes a live plan or one read back off disk — both are the same shape.
 */
export function LitematicaExport({plan,floorIndex}:{plan:OutlinePlan;floorIndex?:number}){
  const [options,setOptions]=useState<OutlineOptions>({...DEFAULT_OUTLINE_OPTIONS,floor:floorIndex??'all'});
  const [busy,setBusy]=useState(false),[done,setDone]=useState(''),[failure,setFailure]=useState('');
  const preview=useMemo(()=>{
    try {return {result:buildOutlines(plan,options),error:''};}
    catch(error){return {result:null,error:error instanceof Error?error.message:'This outline could not be prepared.'};}
  },[plan,options]);
  function update(patch:Partial<OutlineOptions>){setOptions(o=>({...o,...patch}));setFailure('');setDone('');}
  async function download(){
    if(busy||!preview.result)return;
    setBusy(true);setFailure('');setDone('');
    try {
      const {bytes,filename,result}=await outlineFile(plan,options);
      const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/octet-stream'})),a=document.createElement('a');
      a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
      setDone(`${filename} · ${result.blocks.toLocaleString()} markers.`);
    } catch(error){setFailure(error instanceof Error?error.message:'The outline export failed.');}
    finally {setBusy(false);}
  }
  const r=preview.result;
  return <div className="litematica-panel">
    <fieldset disabled={busy}>
      <label>Floors<select value={String(options.floor)} onChange={e=>update({floor:e.target.value==='all'?'all':Number(e.target.value)})}>
        <option value="all">Every floor, each at its own elevation</option>
        {[...plan.floors].sort((a,b)=>b.elevation-a.elevation).map(f=><option key={f.index} value={f.index}>{f.name} · Y {f.elevation}</option>)}
      </select></label>
      <div className="litematica-columns">
        <label>Scale<select value={options.scale} onChange={e=>update({scale:Number(e.target.value)})}>
          {[1,2,3,4].map(n=><option key={n} value={n}>{n}× · one block becomes {n} × {n}</option>)}
        </select></label>
        <label>Marker height<select value={options.height} onChange={e=>update({height:Number(e.target.value)})}>
          {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} block{n===1?' · flat on the ground':'s high'}</option>)}
        </select></label>
      </div>
      <label>Marker block<select value={options.material} disabled={options.colorByFloor} onChange={e=>update({material:e.target.value})}>
        {OUTLINE_MATERIALS.map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select></label>
      <label className="litematica-check"><input type="checkbox" checked={options.colorByFloor} onChange={e=>update({colorByFloor:e.target.checked})}/>A different wool for every floor</label>
      <label className="litematica-check"><input type="checkbox" checked={options.includeStairs} onChange={e=>update({includeStairs:e.target.checked})}/>Mark the stairs in gold</label>
    </fieldset>
    {r&&<div className="litematica-summary" aria-live="polite">
      <strong>{r.blocks.toLocaleString()} markers</strong>
      <span>{r.width} × {r.height} × {r.depth} blocks · {r.regions.length} region{r.regions.length===1?'':'s'}</span>
      <span>{options.floor==='all'?'Y 0 is the ground datum and the cellar stays below it. Storey spacing is never scaled.':'This floor starts at Y 0, aligned in X and Z with every other floor.'}</span>
    </div>}
    {(failure||preview.error)&&<p className="litematica-note litematica-error" role="alert">{failure||preview.error}</p>}
    {r?.warnings.map(w=><p className="litematica-note litematica-warning" key={w}><TriangleAlert size={15}/>{w}</p>)}
    <button className="button litematica-download" type="button" disabled={busy||!r} onClick={()=>void download()}><Download size={16}/>{busy?'Writing the schematic…':'Download the outline'}</button>
    {done&&<output className="litematica-note">{done}</output>}
    <p className="litematica-note">The cut is taken at each floor plus two, the height the plan is drawn at, so a doorway is a gap you can walk through. Walls, posts, chimneys and window lines are marked; roofs, floors, furniture and ground are not. Extra height repeats the outline rather than raising real walls.</p>
    <p className="litematica-note">Put the file in your Minecraft instance’s <code>schematics</code> folder, open <strong>Load Schematics</strong> in Litematica and create a placement to build against. Pasting a region in creative writes its air as well, which will cut into whatever is already there.</p>
  </div>;
}
