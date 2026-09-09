'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Castle, House, Building2, Sparkles, Shuffle, ArrowUpRight, Download, ChevronDown, ChevronRight, Minus, Plus, Layers3, Ruler, DoorOpen, Grid2X2, Armchair, Tags, Maximize, Compass, BookOpen, X, Check, SlidersHorizontal, Sprout, Church, SquareDashed, Warehouse, MousePointer2, FileImage, FileJson, Map, ScanLine } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_SETTINGS, generatePlan, newSeed, ROOM_COLORS, ROOM_GROUPS, type BuildKind, type Settings } from '@/lib/generator';
import { PlanDrawing, type DrawingOptions } from '@/components/plan-drawing';
import { getModelContext, registerBlueprintTools } from '@/lib/blueprint-tools';

const initialPlan=generatePlan(DEFAULT_SETTINGS);
const icons={castle:Castle,manor:Building2,house:House};
function saveFile(content:Blob,name:string){const url=URL.createObjectURL(content);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}

export default function Home(){
  const [settings,setSettings]=useState<Settings>(DEFAULT_SETTINGS);
  const [plan,setPlan]=useState(initialPlan);
  const [level,setLevel]=useState(0);
  const [selected,setSelected]=useState(initialPlan.floors[0].rooms[0].id);
  const [options,setOptions]=useState<DrawingOptions>({labels:true,furniture:true,grid:false,dimensions:true,colors:true});
  const [view,setView]=useState('plan');
  const [zoom,setZoom]=useState(1);
  const [pan,setPan]=useState({x:0,y:0});
  const [dialog,setDialog]=useState<'help'|'export'|'rooms'|null>(null);
  const [notice,setNotice]=useState('');
  const [unit,setUnit]=useState('blocks');
  const [mobileSettings,setMobileSettings]=useState(false);
  const [exporting,setExporting]=useState(false);
  const drag=useRef<{x:number;y:number;px:number;py:number}|null>(null);
  const live=useRef({plan,generate,selectFloor:(index:number)=>{switchFloor(index);setView('plan')}});
  live.current={plan,generate,selectFloor:(index:number)=>{switchFloor(index);setView('plan')}};
  useEffect(()=>{const context=getModelContext();if(!context)return;return registerBlueprintTools(context,{read:()=>live.current.plan,generate:s=>flushSync(()=>live.current.generate(s)),selectFloor:i=>flushSync(()=>live.current.selectFloor(i))});},[]);
  const floor=plan.floors.find(f=>f.index===level)||plan.floors[0];
  const room=floor.rooms.find(r=>r.id===selected);
  const dirty=JSON.stringify(settings)!==JSON.stringify(plan.settings);
  const b=plan.bounds;
  const unitShort=unit==='blocks'?'blocks':unit==='metres'?'m':'ft';
  const update=(patch:Partial<Settings>)=>setSettings(s=>({...s,...patch}));
  function flash(message:string){setNotice(message);}
  useEffect(()=>{if(!notice)return;const id=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(id)},[notice]);
  function generate(next=settings){const generated=generatePlan(next);setPlan(generated);setSettings(generated.settings);setLevel(0);setSelected(generated.floors.find(f=>f.index===0)!.rooms[0].id);setZoom(1);setPan({x:0,y:0});setMobileSettings(false);flash(`${generated.name} is ready to explore.`);}
  function switchFloor(value:string|number){const f=plan.floors.find(f=>f.index===Number(value));if(f){setLevel(f.index);setSelected(f.rooms[0].id)}}
  async function exportPlan(format:'svg'|'png'|'json'|'all'){
    setExporting(true);
    try{
      const slug=plan.name.toLowerCase().replaceAll(' ','-');
      if(format==='json')saveFile(new Blob([JSON.stringify({...plan,unit},null,2)],{type:'application/json'}),`${slug}.json`);
      else if(format==='all'){
        const pages=plan.floors.map((f,i)=>{const el=document.getElementById(`export-floor-${f.index}`)!.cloneNode(true) as SVGSVGElement;el.setAttribute('y',String(i*1100));el.setAttribute('width','1400');el.setAttribute('height','1100');return new XMLSerializer().serializeToString(el)}).join('');
        saveFile(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${1100*plan.floors.length}">${pages}</svg>`],{type:'image/svg+xml'}),`${slug}-all-floors.svg`);
      }else{
        const source=document.getElementById(`export-floor-${floor.index}`);
        if(!source)throw new Error('The plan is still loading. Try again.');
        const copy=source.cloneNode(true) as SVGSVGElement;copy.removeAttribute('id');copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
        const svg=new XMLSerializer().serializeToString(copy);
        if(format==='svg')saveFile(new Blob([svg],{type:'image/svg+xml'}),`${slug}-${floor.name.replaceAll(' ','-')}.svg`);
        else{
          const data=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
          try{const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Could not render this plan. Use SVG instead.'));img.src=data;});const canvas=document.createElement('canvas');canvas.width=2800;canvas.height=2200;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export is unavailable. Use SVG instead.');ctx.drawImage(img,0,0,2800,2200);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not save the image. Use SVG instead.');saveFile(blob,`${slug}-${floor.name.replaceAll(' ','-')}.png`);}finally{URL.revokeObjectURL(data)}
        }
      }
      flash('Your plan has been exported.');setDialog(null);
    }catch(error){flash(error instanceof Error?error.message:'Export failed. Please try again.')}finally{setExporting(false)}
  }
  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="Keepwright home"><span className="brand-mark"><Castle size={25} strokeWidth={1.6}/></span><span>keepwright<span className="brand-period">.</span></span></a>
      <nav className="top-nav" aria-label="Main navigation"><span className="nav-active"><SquareDashed size={16}/>Build studio</span><button onClick={()=>setDialog('help')}><BookOpen size={16}/>Field guide</button></nav>
      <div className="header-right"><span className="private-label"><span/> Your imagination. Your blueprint.</span><button className="button button-outline" onClick={()=>setDialog('export')}><Download size={16}/>Export plan<ChevronDown size={14}/></button></div>
    </header>
    <div className="studio-layout">
      <aside className={`settings-panel ${mobileSettings?'mobile-open':''}`} aria-label="Build settings">
        <div className="settings-heading"><div><span className="eyebrow">THE FOUNDATION</span><h2>Build settings</h2></div><button className="icon-button mobile-close" aria-label="Close settings" onClick={()=>setMobileSettings(false)}><X size={18}/></button><SlidersHorizontal className="heading-icon" size={19}/></div>
        <div className="settings-body">
          <section className="setting-section"><label className="field-title" id="kind-label">Building type</label>
            <RadioGroup className="build-types" value={settings.kind} onValueChange={v=>update({kind:v as BuildKind,size:v==='house'?64:v==='manor'?96:128})} aria-labelledby="kind-label">
              {(['castle','manor','house'] as const).map(kind=>{const Icon=icons[kind];return <label key={kind} className={`type-card ${settings.kind===kind?'chosen':''}`}><RadioGroupItem value={kind} className="type-radio"/><Icon size={27} strokeWidth={1.25}/><span>{kind[0].toUpperCase()+kind.slice(1)}</span>{settings.kind===kind&&<Check size={11} className="type-check"/>}</label>})}
            </RadioGroup>
          </section>
          <section className="setting-section"><div className="field-row"><label className="field-title" id="size-label">Build scale</label><span className="value-badge">{settings.size<88?'Compact':settings.size<150?'Grand':'Epic'}</span></div>
            <Slider aria-labelledby="size-label" value={[settings.size]} min={48} max={192} step={8} onValueChange={v=>update({size:Array.isArray(v)?v[0]:v})} className="setting-slider"/>
            <div className="range-labels"><span>Small homestead</span><span>Sprawling estate</span></div>
            <div className="footprint-readout"><Ruler size={16}/><span>About <strong>{settings.size} {unitShort}</strong> across</span></div>
          </section>
          <section className="setting-section floor-setting"><div><span className="field-title">Above-ground floors</span><p className="field-hint">Connected by stairways</p></div><div className="stepper"><button aria-label="Fewer floors" disabled={settings.floors<=1} onClick={()=>update({floors:settings.floors-1})}><Minus size={14}/></button><output>{settings.floors}</output><button aria-label="More floors" disabled={settings.floors>=5} onClick={()=>update({floors:settings.floors+1})}><Plus size={14}/></button></div></section>
          <section className="setting-section"><div className="field-row"><label className="field-title" id="organic-label">Organic character</label><span className="numeric-value">{settings.organic}%</span></div><Slider aria-labelledby="organic-label" value={[settings.organic]} min={0} max={100} step={5} onValueChange={v=>update({organic:Array.isArray(v)?v[0]:v})} className="setting-slider"/><div className="range-labels"><span>Orderly</span><span>Winding & irregular</span></div></section>
          <section className="setting-section feature-section"><span className="field-title">Make room for</span>{([{key:'courtyard',label:'Enclosed courtyard',icon:SquareDashed,disabled:settings.kind!=='castle'},{key:'chapel',label:'Chapel',icon:Church,disabled:settings.kind==='house'},{key:'garden',label:'Kitchen garden',icon:Sprout},{key:'cellar',label:'Cellar level',icon:Warehouse}] as const).map(item=><div className={`feature-row ${'disabled' in item&&item.disabled?'disabled':''}`} key={item.key}><label htmlFor={item.key}><item.icon size={16} strokeWidth={1.5}/>{item.label}</label><Switch id={item.key} checked={settings[item.key]} disabled={'disabled' in item&&item.disabled} onCheckedChange={checked=>update({[item.key]:checked})}/></div>)}</section>
          <section className="setting-section seed-section"><div className="field-row"><label htmlFor="seed" className="field-title">World seed</label><button className="text-button" onClick={()=>update({seed:newSeed()})}><Shuffle size={13}/>Randomize</button></div><div className="seed-input"><span>#</span><input id="seed" value={settings.seed} maxLength={64} onChange={e=>update({seed:e.target.value})} onKeyDown={e=>{if(e.key==='Enter')generate()}}/></div><p className="field-hint">Same seed. Same settings. Same build.</p></section>
        </div>
        <div className="generate-footer"><button className="button generate-button" onClick={()=>generate()}><Sparkles size={17}/>{dirty?'Generate new build':'Generate build'}<ArrowUpRight size={17}/></button><button className="surprise-button" onClick={()=>generate({...settings,seed:newSeed()})}><Shuffle size={13}/>Or, surprise me</button></div>
      </aside>
      <main className="workspace">
        <div className="workspace-heading"><div><div className="eyebrow breadcrumb">BUILD STUDIO <ChevronRight size={11}/> YOUR BLUEPRINT</div><h1>{plan.name}<span className="draft-badge">PROCEDURAL</span></h1><p>A little irregular. A lot of possibility.</p></div><button className="button button-outline settings-mobile-toggle" onClick={()=>setMobileSettings(true)}><SlidersHorizontal size={16}/>Settings</button><div className="seed-display"><span>WORLD SEED</span><code>{plan.settings.seed}</code></div></div>
        <div className="plan-summary"><span><Ruler size={15}/><strong>{plan.width} × {plan.depth}</strong> {unitShort}</span><i/><span><Layers3 size={15}/><strong>{plan.floors.length}</strong> floors</span><i/><span><DoorOpen size={15}/><strong>{plan.floors.reduce((n,f)=>n+f.rooms.length,0)}</strong> rooms</span><i/><span><Castle size={15}/><strong>{plan.settings.kind==='castle'?floor.towers.length:1}</strong> {plan.settings.kind==='castle'?'stair towers':'stairway'}</span><span className="status-label"><span/>{dirty?'Settings changed — generate to apply':'Ready to build'}</span></div>
        <Tabs value={view} onValueChange={v=>{setView(String(v));setZoom(1);setPan({x:0,y:0})}} className="plan-workspace">
          <div className="plan-toolbar"><TabsList className="view-tabs"><TabsTrigger value="plan"><Map size={15}/>Floor plan</TabsTrigger><TabsTrigger value="stack"><Layers3 size={15}/>Floor stack</TabsTrigger></TabsList><div className="drawing-tools">{([{key:'grid',label:'Grid',icon:Grid2X2},{key:'labels',label:'Labels',icon:Tags},{key:'furniture',label:'Furniture',icon:Armchair},{key:'dimensions',label:'Dimensions',icon:Ruler}] as const).map(tool=><button key={tool.key} title={tool.label} aria-label={`Toggle ${tool.label.toLowerCase()}`} aria-pressed={options[tool.key]} className={`tool-button ${options[tool.key]?'active':''}`} onClick={()=>setOptions(o=>({...o,[tool.key]:!o[tool.key]}))}><tool.icon size={16}/><span>{tool.label}</span></button>)}<span className="tool-divider"/><button className={`tool-button ${options.colors?'active':''}`} title="Room colors" aria-label="Toggle room colors" aria-pressed={options.colors} onClick={()=>setOptions(o=>({...o,colors:!o.colors}))}><span className="color-wheel"/></button></div></div>
          <TabsContent value="plan" className="canvas-panel">
            <div className="canvas-top"><Select value={String(floor.index)} onValueChange={v=>{if(v!==null)switchFloor(v)}}><SelectTrigger className="floor-picker" aria-label="Select floor"><Layers3 size={15}/><SelectValue>{floor.name}</SelectValue></SelectTrigger><SelectContent>{[...plan.floors].reverse().map(f=><SelectItem key={f.index} value={String(f.index)}>{f.name}</SelectItem>)}</SelectContent></Select><div className="compass"><span>N</span><Compass size={32} strokeWidth={.9}/></div></div>
            <svg className="floor-svg" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} aria-label={`${plan.name}, ${floor.name}. Select a room for details.`} onPointerDown={e=>{if((e.target as Element).classList.contains('room-hit'))return;drag.current={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(!drag.current)return;const rect=e.currentTarget.getBoundingClientRect();const scale=Math.max(b.w/rect.width,b.h/rect.height);setPan({x:drag.current.px+(e.clientX-drag.current.x)*scale,y:drag.current.py+(e.clientY-drag.current.y)*scale})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}><g transform={`translate(${pan.x} ${pan.y}) translate(${b.x+b.w/2} ${b.y+b.h/2}) scale(${zoom}) translate(${-b.x-b.w/2} ${-b.y-b.h/2})`}><PlanDrawing plan={plan} floor={floor} options={options} selected={selected} onSelect={setSelected}/></g></svg>
            <div className="canvas-bottom"><div className="scale-key"><Ruler size={16}/><span>1 unit = 1 {unitShort} · {options.grid?'Grid: 2 units':'Grid hidden'}</span></div><div className="zoom-controls"><button aria-label="Zoom out" disabled={zoom<=.7} onClick={()=>setZoom(z=>Math.max(.7,z-.2))}><Minus size={15}/></button><output>{Math.round(zoom*100)}%</output><button aria-label="Zoom in" disabled={zoom>=3} onClick={()=>setZoom(z=>Math.min(3,z+.2))}><Plus size={15}/></button><i/><button aria-label="Fit plan to view" title="Fit to view" onClick={()=>{setZoom(1);setPan({x:0,y:0})}}><Maximize size={15}/></button></div></div>
            <span className="drawing-credit">KEEPWRIGHT <span> / </span> {floor.name.toUpperCase()}</span>
          </TabsContent>
          <TabsContent value="stack" className="stack-panel"><div className="stack-heading"><Layers3 size={20}/><div><h3>Every level, connected.</h3><p>Stair locations align across all floors. Select a level to explore it.</p></div></div><div className="floor-stack">{[...plan.floors].reverse().map(f=><button key={f.index} onClick={()=>{switchFloor(f.index);setView('plan')}} className="stack-card"><div><span>{f.index<0?'B':String(f.index).padStart(2,'0')}</span><strong>{f.name}</strong><small>{f.rooms.length} rooms</small><ArrowUpRight size={16}/></div><svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} aria-label={f.name}><PlanDrawing plan={plan} floor={f} options={{...options,dimensions:false,labels:false}} prefix={`stack-${f.index}`}/></svg></button>)}</div></TabsContent>
          <div className="plan-bottom-bar"><span><MousePointer2 size={13}/>Select a room to explore · Drag to pan</span><button onClick={()=>setDialog('rooms')}>Room directory <span>{floor.rooms.length}</span><ArrowUpRight size={14}/></button></div>
        </Tabs>
        <div className="room-detail" aria-live="polite">{room?<><span className="room-swatch" style={{background:ROOM_COLORS[room.kind]}}><DoorOpen size={20} strokeWidth={1.3}/></span><div className="room-detail-title"><span className="eyebrow">{ROOM_GROUPS[room.kind]}</span><h3>{room.name}</h3></div><div className="room-dimensions"><strong>{room.w.toFixed(1)} × {room.h.toFixed(1)}</strong><span>{unitShort} · {room.area} sq. {unitShort}</span></div><p>{room.description}</p></>:<p>Select a room on the plan to see its dimensions and purpose.</p>}</div>
        <footer className="workspace-footer"><span><ScanLine size={13}/> Made for worldbuilders, one room at a time.</span><div><button className="mobile-guide" onClick={()=>setDialog('help')}>Field guide</button><span>Drawing units</span><Select value={unit} onValueChange={v=>{if(v)setUnit(v)}}><SelectTrigger aria-label="Drawing units" className="unit-picker"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="blocks">Blocks</SelectItem><SelectItem value="metres">Metres</SelectItem><SelectItem value="feet">Feet</SelectItem></SelectContent></Select></div></footer>
      </main>
    </div>
    {notice&&<div className="toast" role="status"><Check size={17}/>{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={14}/></button></div>}
    <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null)}}><DialogContent className={`studio-dialog ${dialog==='rooms'?'directory-dialog':''}`}><DialogHeader><DialogTitle>{dialog==='help'?'A field guide to your next build':dialog==='export'?'Take your blueprint with you':'Room directory'}</DialogTitle><DialogDescription>{dialog==='help'?'Start with a shape. Make it your own.':dialog==='export'?`${plan.name} · ${floor.name}`:`${floor.name} · ${floor.rooms.length} rooms · ${unitShort}`}</DialogDescription></DialogHeader>
      {dialog==='help'&&<div className="guide-content"><ol><li><strong>Set the foundation.</strong> Choose a building, scale, and number of floors. Organic character adds bends and asymmetry to the footprint.</li><li><strong>Generate your layout.</strong> Each seed creates a repeatable plan. “Surprise me” generates a fresh seed using your current settings.</li><li><strong>Explore the rooms.</strong> Switch floors, select rooms, or open the directory. Doors connect rooms to a shared passage and aligned stairs.</li><li><strong>Bring it into your world.</strong> Export an image, a scalable SVG, all floors, or the complete plan data.</li></ol><div className="guide-note"><Ruler size={18}/><p>Units set the scale of your world: one plan unit becomes one block, metre, or foot. Changing this label does not convert measurements. These are creative build plans; room dimensions are approximate and can be rounded to your building grid.</p></div></div>}
      {dialog==='export'&&<div className="export-options">{([{format:'png',icon:FileImage,title:'High-resolution image',text:'PNG · 2800 × 2200 · current floor'},{format:'svg',icon:Map,title:'Scalable floor plan',text:'SVG · editable linework · current floor'},{format:'all',icon:Layers3,title:'Complete floor set',text:`SVG · all ${plan.floors.length} floors in one drawing`},{format:'json',icon:FileJson,title:'Build data & seed',text:'JSON · geometry, rooms, dimensions, and settings'}] as const).map(item=><button disabled={exporting} key={item.format} onClick={()=>exportPlan(item.format)}><item.icon size={24} strokeWidth={1.4}/><span><strong>{item.title}</strong><small>{item.text}</small></span><Download size={17}/></button>)}{exporting&&<p role="status">Preparing your blueprint…</p>}</div>}
      {dialog==='rooms'&&<div className="room-directory">{floor.rooms.map(r=><button key={r.id} className={selected===r.id?'selected':''} onClick={()=>{setSelected(r.id);setView('plan');setDialog(null)}}><span className="directory-dot" style={{background:ROOM_COLORS[r.kind]}}/><span><strong>{r.name}</strong><small>{ROOM_GROUPS[r.kind]}</small></span><span>{r.w.toFixed(1)} × {r.h.toFixed(1)}<small>{r.area} sq. {unitShort}</small></span><ArrowUpRight size={15}/></button>)}</div>}
    </DialogContent></Dialog>
    <div className="export-drawings" aria-hidden="true">{plan.floors.map(f=><svg key={f.index} id={`export-floor-${f.index}`} xmlns="http://www.w3.org/2000/svg" width="1400" height="1100" viewBox={`${b.x} ${b.y-8} ${b.w} ${b.h+16}`}><rect x={b.x} y={b.y-8} width={b.w} height={b.h+16} fill="#f4f1e5"/><text x={b.x+6} y={b.y-1} fontFamily="Georgia,serif" fontSize="3.5" fill="#354a38">{plan.name} — {f.name}</text><PlanDrawing plan={plan} floor={f} options={options} prefix={`export-${f.index}`}/><text x={b.x+6} y={b.y+b.h+4} fontFamily="Arial,sans-serif" fontSize="1.5" fill="#626e59">KEEPWRIGHT · Seed {plan.settings.seed} · 1 unit = 1 {unit==='blocks'?'block':unit==='metres'?'metre':'foot'} · {plan.width} × {plan.depth} · {f.rooms.length} rooms</text></svg>)}</div>
  </div>;
}
