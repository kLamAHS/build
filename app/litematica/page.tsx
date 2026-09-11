'use client';
import { useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { Castle } from 'lucide-react';
import { LitematicaExport } from '@/components/litematica-export';
import { MAX_JSON_BYTES, parseOutlinePlan, type OutlinePlan } from '@/lib/litematica-outlines';

/**
 * The same outline export, for a building you saved rather than the one on screen — a plan exported months
 * ago, or one somebody sent you. Nothing leaves the browser: the file is read, checked and written back out
 * here. Only the studio's own "Complete building · JSON" carries the block geometry an outline needs.
 */
export default function LitematicaPage(){
  const [opened,setOpened]=useState<{plan:OutlinePlan;id:number}|null>(null),[failure,setFailure]=useState(''),[reading,setReading]=useState(false);
  const request=useRef(0);
  async function open(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0],id=++request.current;
    setOpened(null);setFailure('');
    if(!file){setReading(false);return;}
    setReading(true);
    try {
      if(file.size>MAX_JSON_BYTES)throw new Error('That file is larger than 64 MiB. A building JSON is a fraction of that.');
      const plan=parseOutlinePlan(JSON.parse(await file.text()));
      if(id===request.current)setOpened({plan,id});
    } catch(error){
      if(id===request.current)setFailure(error instanceof SyntaxError?'That file is not JSON. Export “Complete building · JSON” from the studio.'
        :error instanceof Error?error.message:'That file could not be read.');
    } finally {if(id===request.current)setReading(false);}
  }
  return <main className="litematica-page">
    <Link className="brand" href="/" aria-label="Keepwright home"><span className="brand-mark"><Castle size={25} strokeWidth={1.6}/></span><span>keepwright<span className="brand-period">.</span></span></Link>
    <h1>A building you saved, on the ground in your world.</h1>
    <p>In the studio choose <strong>Export → Complete building · JSON</strong>, then open that file here to take its wall lines into Minecraft. The file is read in this tab and never uploaded.</p>
    <label className="litematica-drop">Open a Keepwright building
      <input type="file" accept=".json,application/json" onChange={event=>void open(event)}/>
    </label>
    {reading&&<output>Reading the building…</output>}
    {failure&&<p className="litematica-error" role="alert">{failure}</p>}
    {opened&&<><h2>{opened.plan.name} · {opened.plan.floors.length} floor{opened.plan.floors.length===1?'':'s'}</h2>
      <LitematicaExport key={opened.id} plan={opened.plan}/></>}
  </main>;
}
