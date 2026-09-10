'use client';
import { Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { ROOM_COLORS, type Floor, type Plan, type Room, type Point } from '@/lib/model';
import { abut, bayLines } from '@/lib/composition';
import type { BlockLayer } from '@/lib/voxels';

/** The stages a drawing can be asked to show its working for, so a defect can be traced to the one that made it. */
export type Diagnostic='off'|'volumes'|'circulation'|'facade'|'fit';
export const DIAGNOSTICS:{id:Diagnostic;name:string;hint:string}[]=[
  {id:'off',name:'None',hint:'The finished drawing'},
  {id:'volumes',name:'Volumes',hint:'What was composed, which build each range belongs to, how far it stands from the hall, and where each motif has its ends and ports'},
  {id:'circulation',name:'Circulation',hint:'Every doorway, how many you cross to reach a room, and any forced crossing'},
  {id:'facade',name:'Facade bays',hint:'The bay lines each wall was divided into, which took a light, and where the wall steps out of line'},
  {id:'fit',name:'Room fit',hint:'How near each room stands to the proportion and area it is allowed'},
];
export type DrawingOptions={labels:boolean;furniture:boolean;grid:boolean;dimensions:boolean;colors:boolean;diagnostics?:Diagnostic};
// The limits the audit rejects a candidate on, so the overlay shows the same line the generator is held to.
const ASPECT_LIMIT=3.2,AREA_LIMIT=760;
const ORDINARY=new Set(['bedroom','study','service','storage']);
// The builds a composition was raised in, oldest first: the retained core reads heaviest, later work lighter.
const PHASE_FILL=['#3d6f9e33','#3d6f9e22','#3d6f9e14','#3d6f9e0a'];
function Diagnostics({plan,floor,mode}:{plan:Plan;floor:Floor;mode:Diagnostic}){
  const y=floor.elevation;
  if(mode==='volumes'){
    const hall=plan.components.find(c=>c.kind==='hall');
    // Phase 0 is inherited fabric; a composition raised in one campaign has none, and says so rather than
    // numbering a single build as though it followed something.
    const grew=plan.components.some(c=>c.phase===0);
    const depth=new Map<string,number>();
    if(hall){
      depth.set(hall.id,0);const queue=[hall];
      for(let i=0;i<queue.length;i++)for(const o of plan.components)
        if(!depth.has(o.id)&&abut(queue[i].bounds,o.bounds)){depth.set(o.id,depth.get(queue[i].id)!+1);queue.push(o);}
    }
    const halo={paintOrder:'stroke',stroke:'#f4eedd',strokeWidth:.55} as const;
    return <g fontFamily="ui-monospace,monospace" pointerEvents="none">
      {plan.components.map(c=>{
        const b=c.bounds,long=Math.max(b.w,b.d),short=Math.min(b.w,b.d);
        const form=long>=short*1.7?'range':long>=short*1.25?'block':'square';
        const away=depth.get(c.id);
        return <g key={c.id} opacity={c.baseY<=y&&y<c.topY?1:.35}>
          <rect x={b.x} y={b.z} width={b.w} height={b.d} fill={c.kind==='court'?'#4a7fb51a':PHASE_FILL[Math.min(PHASE_FILL.length-1,c.phase)]} stroke="#3d6f9e" strokeWidth=".4" strokeDasharray={c.kind==='court'?'2 1.4':undefined}/>
          <text x={b.x+1} y={b.z+3} fontSize="1.6" fill="#2f5c85" style={halo}>{c.kind}</text>
          <text x={b.x+1} y={b.z+5.2} fontSize="1.3" fill="#5b7f9e" style={halo}>{b.w}×{b.d} · {form} · {c.storeys}s{away===undefined?' · adrift':away?` · ${away} from hall`:' · hall'}</text>
          <text x={b.x+1} y={b.z+7.4} fontSize="1.3" fill="#5b7f9e" style={halo}>{!grew?'single build':c.phase?`build ${c.phase}`:'retained core'}</text>
        </g>;})}
      {plan.components.flatMap((c,i)=>plan.components.slice(i+1).filter(o=>abut(c.bounds,o.bounds)).map(o=>
        <line key={`${c.id}-${o.id}`} x1={c.bounds.x+c.bounds.w/2} y1={c.bounds.z+c.bounds.d/2} x2={o.bounds.x+o.bounds.w/2} y2={o.bounds.z+o.bounds.d/2} stroke="#3d6f9e" strokeWidth=".35" opacity=".5"/>))}
      {/* A motif's two ends are not interchangeable, so the overlay says which is which and what the variant was. */}
      {y===0&&plan.motifs.flatMap(m=>[
        <g key={`${m.id}-hi`}>
          <rect x={m.high.x} y={m.high.z} width={m.high.w} height={m.high.d} fill="#a8632f1c" stroke="#a8632f" strokeWidth=".3" strokeDasharray="1.6 1"/>
          <text x={m.high.x+m.high.w/2} y={m.high.z+m.high.d/2} fontSize="1.5" textAnchor="middle" fill="#8d5226" style={halo}>{m.kind==='hall'?'high end':'inner gate'}</text>
        </g>,
        <g key={`${m.id}-lo`}>
          <rect x={m.low.x} y={m.low.z} width={m.low.w} height={m.low.d} fill="#5c7f4a1c" stroke="#5c7f4a" strokeWidth=".3" strokeDasharray="1.6 1"/>
          <text x={m.low.x+m.low.w/2} y={m.low.z+m.low.d/2} fontSize="1.5" textAnchor="middle" fill="#416032" style={halo}>{m.kind==='hall'?'serving end':'outer gate'}</text>
          <text x={m.low.x+m.low.w/2} y={m.low.z+m.low.d/2+2} fontSize="1.2" textAnchor="middle" fill="#416032" style={halo}>{m.variant}</text>
        </g>,
      ])}
      {y===0&&plan.motifs.flatMap(m=>m.ports.map(port=>{
        const o=plan.openings.find(x=>x.id===port.openingId);
        if(!o)return null;
        const hue=port.role==='service'?'#8a5a2b':port.role==='private'?'#7a5ba8':'#2f7a52';
        return <g key={`${m.id}-${port.openingId}`}>
          <circle cx={o.x+(o.axis==='z'?o.width/2:.5)} cy={o.z+(o.axis==='x'?o.width/2:.5)} r="1.1" fill={`${hue}44`} stroke={hue} strokeWidth=".3"/>
          <text x={o.x+(o.axis==='z'?o.width/2:.5)} y={o.z+(o.axis==='x'?o.width/2:.5)+.45} fontSize="1.1" textAnchor="middle" fill={hue}>{port.role[0].toUpperCase()}</text>
        </g>;}))}
    </g>;
  }
  if(mode==='circulation'){
    const byId=new Map(plan.rooms.map(r=>[r.id,r]));
    const near=new Map(plan.rooms.map(r=>[r.id,[] as string[]]));
    for(const [a,c] of plan.connections){near.get(a)?.push(c);near.get(c)?.push(a);}
    const start=plan.openings.find(o=>o.type==='entrance')?.roomIds[0];
    const away=new Map<string,number>();
    if(start){away.set(start,0);const queue=[start];for(let i=0;i<queue.length;i++)for(const next of near.get(queue[i])!)if(!away.has(next)){away.set(next,away.get(queue[i])!+1);queue.push(next);}}
    const forced=new Set(plan.navigation.transits.map(t=>t.roomId));
    const at=(id:string)=>{const r=byId.get(id);return r?{x:r.bounds.x+r.bounds.w/2,z:r.bounds.z+r.bounds.d/2}:undefined;};
    return <g pointerEvents="none" fontFamily="ui-monospace,monospace">
      {plan.connections.map(([a,c],i)=>{const m=at(a),n=at(c);
        if(!m||!n||byId.get(a)!.floorY!==y||byId.get(c)!.floorY!==y)return null;
        return <line key={i} x1={m.x} y1={m.z} x2={n.x} y2={n.z} stroke="#8a5a2b" strokeWidth=".3" opacity=".65"/>;})}
      {floor.rooms.map(r=>{const c=at(r.id)!;const d=away.get(r.id);
        return <g key={r.id}>
          <circle cx={c.x} cy={c.z} r={forced.has(r.id)?1.6:1} fill={forced.has(r.id)?'#b4472e':r.kind==='circulation'||r.kind==='stairs'||r.kind==='court'?'#6f8f5e':'#c9a55f'} stroke="#4a3b26" strokeWidth=".2"/>
          <text x={c.x} y={c.z+.55} fontSize="1.4" textAnchor="middle" fill="#2c2418">{d??'—'}</text>
        </g>;})}
    </g>;
  }
  if(mode==='facade'){
    const castle=plan.settings.kind==='castle';
    const cut=new Set(plan.openings.filter(o=>o.type==='window').map(o=>`${(o.axis==='z'?o.x:o.z)+Math.floor(o.width/2)}:${o.axis}`));
    return <g pointerEvents="none">
      {plan.components.filter(c=>c.kind!=='court'&&c.baseY<=y&&y<c.topY).flatMap(c=>{
        const b=c.bounds,l=bayLines(c,castle);
        return [
          ...l.x.flatMap(at=>[b.z,b.z+b.d].map((z,i)=>
            <line key={`${c.id}x${at}${i}`} x1={at} y1={z-1.4} x2={at} y2={z+1.4} stroke={cut.has(`${at}:z`)?'#2f7a52':'#b06a3a'} strokeWidth=".45"/>)),
          ...l.z.flatMap(at=>[b.x,b.x+b.w].map((x,i)=>
            <line key={`${c.id}z${at}${i}`} x1={x-1.4} y1={at} x2={x+1.4} y2={at} stroke={cut.has(`${at}:x`)?'#2f7a52':'#b06a3a'} strokeWidth=".45"/>)),
          <rect key={`${c.id}p`} x={b.x+l.pier} y={b.z+l.pier} width={Math.max(0,b.w-2*l.pier)} height={Math.max(0,b.d-2*l.pier)} fill="none" stroke="#b06a3a" strokeWidth=".18" strokeDasharray="1 1.6" opacity=".55"/>,
        ];})}
      {plan.articulation.filter(a=>a.baseY<=y+(a.role==='oriel'||a.role==='jetty'?6:2)&&a.topY>y).map(a=>{
        const b=a.bounds,hue=a.role==='niche'?'#7a5ba8':a.role==='chimney'?'#8a5a2b':a.role==='jetty'?'#8b7f63':'#2f7a52';
        return <g key={a.id}>
          <rect x={b.x} y={b.z} width={b.w} height={b.d} fill={`${hue}1f`} stroke={hue} strokeWidth=".3" strokeDasharray={a.baseY===y||a.baseY-2===y?undefined:'1 1'}/>
          {a.role!=='niche'&&<text x={b.x+b.w/2} y={b.z+b.d+2} fontSize="1.3" textAnchor="middle" fontFamily="ui-monospace,monospace" fill={hue} style={{paintOrder:'stroke',stroke:'#f4eedd',strokeWidth:.55}}>{a.role}</text>}
        </g>;})}
    </g>;
  }
  return <g pointerEvents="none" fontFamily="ui-monospace,monospace">
    {floor.rooms.map(r=>{
      const w=r.bounds.w-1,d=r.bounds.d-1,aspect=Math.max(w,d)/Math.max(1,Math.min(w,d)),area=w*d;
      const ordinary=ORDINARY.has(r.kind);
      const strain=ordinary?Math.max(aspect/ASPECT_LIMIT,area/AREA_LIMIT):0;
      return <g key={r.id}>
        <path d={polygonPath(r.polygon)} fill={strain>=1?'#b4472e55':strain>=.75?'#d99a4a44':strain>=.5?'#c9bb6a33':'#6f8f5e22'}/>
        <text x={r.bounds.x+r.bounds.w/2} y={r.bounds.z+r.bounds.d/2+3.4} fontSize="1.3" textAnchor="middle" fill="#4a3b26" style={{paintOrder:'stroke',stroke:'#f4eedd',strokeWidth:.55}}>{w}×{d} · {aspect.toFixed(1)}:1{ordinary?` · ${Math.round(strain*100)}%`:''}</text>
      </g>;})}
  </g>;
}
/**
 * Where the wall steps out of line, and what it steps out for. A bay is drawn as the room reaching into it,
 * arch and all, because that is what it is; an oriel is drawn again on the storey below as an overhang on its
 * corbels, so a projecting room is never a room floating in mid-air; a niche is the shallow inward case.
 */
function Articulation({plan,y,colors}:{plan:Plan;y:number;colors:boolean}){
  return <g>
    {/* A loggia's outer side is an arcade, so the drawing shows piers standing in an open wall rather than a
        wall with doors punched through it: the walk and the yard it serves are one space at this floor. */}
    {plan.reservations.filter(v=>v.kind==='loggia'&&v.fromY===y&&v.side).map(v=>{
      const b=v.bounds,across=v.side==='n'||v.side==='s';
      const edge=v.side==='n'?b.z:v.side==='s'?b.z+b.d:v.side==='w'?b.x:b.x+b.w;
      const from=across?b.x:b.z,run=across?b.w:b.d;
      const fill=colors?ROOM_COLORS.circulation:'#eee4cd';
      return <g key={v.id}>
        {Array.from({length:Math.max(0,run-1)},(_,k)=>k+1).filter(i=>i%4!==0).map(i=>
          <rect key={i} x={across?from+i:edge} y={across?edge:from+i} width="1" height="1" fill={fill}/>)}
        {Array.from({length:Math.floor(run/4)+1},(_,k)=>k*4).filter(i=>i<=run).map(i=>
          <rect key={`p${i}`} x={across?from+i:edge} y={across?edge:from+i} width="1" height="1" fill="#707566" stroke="#4a4f43" strokeWidth=".14"/>)}
      </g>;})}
    {plan.articulation.map(a=>{
    if(a.role==='chimney')return null;
    const room=plan.rooms.find(r=>a.roomIds.includes(r.id));
    const fill=colors&&room?ROOM_COLORS[room.kind]:'#eee4cd';
    const b=a.bounds;
    if(a.role==='niche')return a.baseY-2===y?<rect key={a.id} x={b.x} y={b.z} width={b.w} height={b.d} fill={fill} stroke="#8e8974" strokeWidth=".12"/>:null;
    // A jettied storey is shown on the floor it oversails, as the line it crosses and the joist ends under it.
    if(a.role==='jetty')return a.baseY===y+6?<g key={a.id} pointerEvents="none">
      <rect x={b.x} y={b.z} width={b.w} height={b.d} fill="#8b7f6318" stroke="#8b7f63" strokeWidth=".22" strokeDasharray="1.2 .9"/>
      {Array.from({length:Math.max(2,Math.floor((a.side==='n'?b.w:b.d)/4))},(_,i)=>{
        const at=(a.side==='n'?b.x:b.z)+2+i*4;
        return <path key={i} d={a.side==='n'?`M${at} ${b.z}v${b.d}`:`M${b.x} ${at}h${b.w}`} stroke="#8b7f63" strokeWidth=".18"/>;})}
    </g>:null;
    if(a.role==='oriel'&&a.baseY===y+6)return <g key={a.id} pointerEvents="none">
      <rect x={b.x} y={b.z} width={b.w} height={b.d} fill="none" stroke="#8b7f63" strokeWidth=".25" strokeDasharray="1.2 .9"/>
      {Array.from({length:3},(_,i)=><path key={i} d={a.side==='n'||a.side==='s'?`M${b.x+1.5+i*(b.w-3)/2} ${b.z}v${b.d}`:`M${b.x} ${b.z+1.5+i*(b.d-3)/2}h${b.w}`} stroke="#8b7f63" strokeWidth=".2"/>)}
      <text x={b.x+b.w/2} y={b.z+b.d/2+.5} fontSize="1.1" textAnchor="middle" fontFamily="Georgia,serif" fontStyle="italic" fill="#8b7f63" style={{paintOrder:'stroke',stroke:'#f5efdf',strokeWidth:.4}}>Oriel over</text>
    </g>;
    if(a.baseY!==y)return null;
    // The arch is painted back into the range so the wall between room and bay reads as open, not as masonry.
    const arch=a.side==='s'?{x:b.x+1,z:b.z-3,w:b.w-2,d:3}:a.side==='n'?{x:b.x+1,z:b.z+b.d,w:b.w-2,d:3}
      :a.side==='e'?{x:b.x-3,z:b.z+1,w:3,d:b.d-2}:{x:b.x+b.w,z:b.z+1,w:3,d:b.d-2};
    // The seat is redrawn here: the room's furniture was laid down before the walls, and the bay covers it.
    const seats=room?room.furniture.filter(f=>f.type==='seat'&&f.x>=b.x&&f.x<=b.x+b.w&&f.z>=b.z&&f.z<=b.z+b.d):[];
    return <g key={a.id}>
      <rect x={b.x+1} y={b.z+1} width={b.w-1} height={b.d-1} fill={fill}/>
      <rect x={arch.x} y={arch.z} width={arch.w} height={arch.d} fill={fill}/>
      {seats.map((f,i)=><g key={i} fill="#f6eedb" stroke="#857b66" strokeWidth=".14">
        <rect x={f.x} y={f.z} width={f.w} height={f.d}/>
        <path d={f.w>f.d?`M${f.x+.3} ${f.z+f.d/2}h${f.w-.6}`:`M${f.x+f.w/2} ${f.z+.3}v${f.d-.6}`} strokeWidth=".22"/>
      </g>)}
    </g>;
  })}</g>;
}
export function preciseSvg(node:ReactNode):ReactNode {return Children.map(node,child=>{if(!isValidElement(child))return child;const el=child as ReactElement<Record<string,unknown>>,props:Record<string,unknown>={};if(typeof el.type==='string')for(const [k,v] of Object.entries(el.props)){if(typeof v==='number'&&Number.isFinite(v))props[k]=Number(v.toFixed(5));else if(typeof v==='string'&&['d','transform','points','viewBox'].includes(k))props[k]=v.replace(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi,n=>String(Number(Number(n).toFixed(5))));}if(el.props.children!==undefined)props.children=preciseSvg(el.props.children as ReactNode);return cloneElement(el,props);});}
const polygonPath=(p:Point[])=>p.length?`M${p.map(v=>`${v.x},${v.z}`).join('L')}Z`:'';
const rectPath=(x:number,z:number,w:number,d:number)=>`M${x} ${z}h${w}v${d}h${-w}Z`;
const lines=(name:string)=>{const words=name.split(' ');return name.length>14&&words.length>1?[words.slice(0,Math.ceil(words.length/2)).join(' '),words.slice(Math.ceil(words.length/2)).join(' ')]:[name];};
const FIXED=new Set(['hearth','oven','well','dais','altar']);
function Furniture({room}:{room:Room}){
  return <g fill="#f6eedb" stroke="#857b66" strokeWidth=".14">{room.furniture.map((f,i)=>{
    const cx=f.x+f.w/2,cz=f.z+f.d/2;
    return <g key={i}>
      <rect x={f.x} y={f.z} width={f.w} height={f.d} fill={FIXED.has(f.type)?'#e6ddc6':'#f6eedb'} strokeWidth={FIXED.has(f.type)?.22:.14}/>
      {f.type==='bed'&&<><rect x={f.x+.3} y={f.z+.3} width={f.w-.6} height=".8" rx=".15"/><path d={`M${f.x} ${f.z+1.5}h${f.w}`}/></>}
      {f.type==='shelf'&&Array.from({length:f.w},(_,k)=><path key={k} d={`M${f.x+k+.4} ${f.z}v${f.d}`}/>)}
      {f.type==='hearth'&&<><path d={`M${f.x+.4} ${f.z+.4}h${f.w-.8}v${f.d-.8}h${-f.w+.8}Z`} fill="#d8ccb2"/><path d={`M${cx-.5} ${f.z+f.d-.7}q.5-1 .5-1.6.4.5.5 1 .3-.4.3-.9.5.7.5 1.5`} fill="none" strokeWidth=".16"/></>}
      {f.type==='oven'&&<><path d={`M${f.x+.4} ${f.z+f.d-.4}v${-f.d+1.2}a${f.w/2-.4} ${f.w/2-.4} 0 0 1 ${f.w-.8} 0v${f.d-1.2}Z`} fill="#d8ccb2"/><path d={`M${cx} ${f.z+f.d-.4}v${-1}`} strokeWidth=".2"/></>}
      {f.type==='well'&&<><circle cx={cx} cy={cz} r={Math.min(f.w,f.d)/2-.3} fill="#c9d3d6"/><circle cx={cx} cy={cz} r={Math.min(f.w,f.d)/2-.9} fill="#8fa6ab"/></>}
      {f.type==='dais'&&<path d={`M${f.x+.5} ${f.z+f.d-.5}h${f.w-1}`} strokeWidth=".2" strokeDasharray=".7 .5"/>}
      {f.type==='seat'&&<path d={f.w>f.d?`M${f.x+.3} ${cz}h${f.w-.6}`:`M${cx} ${f.z+.3}v${f.d-.6}`} strokeWidth=".22"/>}
      {f.type==='altar'&&<path d={`M${cx} ${f.z+.3}v${f.d-.6}M${cx-.8} ${f.z+.9}h1.6`} strokeWidth=".2"/>}
    </g>;
  })}</g>;
}
export function PlanDrawing({plan,floor,options,selected,onSelect,prefix='plan',layer}:{plan:Plan;floor:Floor;options:DrawingOptions;selected?:string;onSelect?:(id:string)=>void;prefix?:string;layer?:BlockLayer}){
  const b=plan.bounds,y=floor.elevation;
  const walls=layer?layer.runs.filter(r=>['wall','chimney'].includes(r.kind)).map(r=>rectPath(r.x,r.z,r.length,1)).join(''):plan.walls.filter(w=>w.y<=y+2&&w.y+w.h>y+2).map(w=>rectPath(w.x,w.z,w.w,w.d)).join('');
  return preciseSvg(<g>
    <defs><pattern id={`${prefix}-grid`} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#a89e86" strokeWidth=".055" opacity=".4"/></pattern><pattern id={`${prefix}-void`} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V2" stroke="#aea185" strokeWidth=".1"/></pattern><pattern id={`${prefix}-wood`} width="3" height="2" patternUnits="userSpaceOnUse"><path d="M0 0H3M1.5 0V2" stroke="#9b8b6c" strokeWidth=".06" opacity=".45"/></pattern></defs>
    {floor.roofComponents.map(id=>{const c=plan.components.find(c=>c.id===id)!;return <g key={id} opacity=".28"><path d={polygonPath(c.polygon)} fill="#929b98" stroke="#636d66" strokeWidth=".3"/><text x={c.bounds.x+c.bounds.w/2} y={c.bounds.z+c.bounds.d/2} textAnchor="middle" fontFamily="Georgia" fontSize="1.3" fill="#364f43">Roof below</text></g>;})}
    {y===0&&plan.blocks.filter(block=>block.kind==='ground').map((r,i)=><rect key={i} x={r.x} y={r.z} width={r.w} height={r.d} fill={r.material===7?'#c0c9a4':'#d8c9aa'} stroke="#95a17b" strokeWidth=".12"/>)}
    {y===0&&plan.courts.map(c=><g key={c.id}>
      {c.yards.map(yard=><g key={yard.name}>
        <rect x={yard.bounds.x} y={yard.bounds.z} width={yard.bounds.w} height={yard.bounds.d} fill={yard.kind==='garden'?'#c6cfa6':'#ded2b6'} stroke="#a89b7c" strokeWidth=".2" strokeDasharray="1.4 1"/>
        <text x={yard.bounds.x+yard.bounds.w/2} y={yard.bounds.z+yard.bounds.d/2} textAnchor="middle" fontFamily="Georgia" fontSize="2.1" fill="#7d7357">{yard.name}</text>
      </g>)}
      {c.well&&<g><circle cx={c.well.x} cy={c.well.z} r="2.1" fill="#9fb3b8" stroke="#5f7782" strokeWidth=".3"/><circle cx={c.well.x} cy={c.well.z} r="1" fill="#4d6068"/><text x={c.well.x} y={c.well.z+4.4} textAnchor="middle" fontFamily="Georgia" fontSize="1.9" fill="#5d7076">Well</text></g>}
      <text x={c.gatehouse.x+c.gatehouse.w/2} y={c.gatehouse.z-1.6} textAnchor="middle" fontFamily="Georgia" fontSize="2.2" fill="#6f7560">Gatehouse</text>
      <text x={c.bounds.x+c.bounds.w*.72} y={c.bounds.z+c.bounds.d*.42} fontSize="2.6" fontFamily="Georgia" fontStyle="italic" fill="#8b957a" textAnchor="middle">{c.name}</text>
    </g>)}
    {floor.voids.map(v=>{
      // A well is too small to carry a caption; its guarded edge and its hatch say what it is.
      const small=v.bounds.w*v.bounds.d<60;
      return <g key={v.id}><path d={polygonPath(v.polygon)+v.holes.map(h=>rectPath(h.x,h.z,h.w,h.d)).join('')} fill={`url(#${prefix}-void)`} fillRule="evenodd" stroke="#aa9c81" strokeWidth={small?.35:.2} strokeDasharray={small?undefined:'1 1'}/>
        {!small&&<text x={v.bounds.x+v.bounds.w/2} y={v.bounds.z+v.bounds.d/2} textAnchor="middle" fontFamily="Georgia" fontSize="1.5" fontStyle="italic" fill="#9a8460">{v.name}<tspan x={v.bounds.x+v.bounds.w/2} dy="2">{v.ceilingY} block ceiling</tspan></text>}</g>;})}
    {floor.rooms.map(r=><g key={r.id}><path d={polygonPath(r.polygon)} fill={options.colors?ROOM_COLORS[r.kind]:'#eee4cd'}/><path d={polygonPath(r.polygon)} fill={`url(#${prefix}-wood)`}/>{options.furniture&&<Furniture room={r}/>}</g>)}
    <path d={walls} fill="#707566"/>
    <Articulation plan={plan} y={y} colors={options.colors}/>
    {plan.openings.filter(o=>o.y<=y+3&&o.y+o.height>y+1).map(o=>{const isX=o.axis==='x',d=o.width;return <g key={o.id}>{!layer&&<rect x={o.x} y={o.z} width={isX?1:d} height={isX?d:1} fill={o.type==='window'?'#b9d5d6':'#ede6d5'}/>}<path d={o.type==='window'?(isX?`M${o.x+.5} ${o.z}v${d}`:`M${o.x} ${o.z+.5}h${d}`):(isX?`M${o.x+.5} ${o.z}h${d}a${d} ${d} 0 0 1 ${-d} ${d}`:`M${o.x} ${o.z+.5}v${d}a${d} ${d} 0 0 0 ${d} ${-d}`)} fill="none" stroke={o.type==='window'?'#597e84':'#8d7c5f'} strokeWidth=".15"/></g>;})}
    {plan.stairs.filter(st=>st.fromY===y||st.toY===y).map(st=>{
      const b=st.bounds,up=st.fromY===y,to=plan.floors.find(f=>f.elevation===(up?st.toY:st.fromY));
      return <g key={st.id} stroke="#616b50" strokeWidth=".13">
        <rect x={b.x+3} y={b.z+3} width="2" height="6" fill="#d6d7c0"/>
        {Array.from({length:7},(_,i)=><path key={i} d={`M${b.x+3} ${b.z+3+i}h2`}/>)}
        <path d={`M${b.x+4} ${b.z+3.4}v5m-0.6-1l.6 1 .6-1`} fill="none" strokeWidth=".22"/>
        <text x={b.x+4} y={b.z+1.9} fontSize="1.35" stroke="none" fill="#4f6146" textAnchor="middle" fontFamily="Georgia,serif" style={{paintOrder:'stroke',stroke:'#f5efdf',strokeWidth:.4}}>
          {st.id.toUpperCase()} {up?'↑':'↓'}<tspan x={b.x+4} dy="1.5" fontSize="1.05" fill="#6d7c5f">{to?to.name:up?'above':'below'}</tspan>
        </text>
      </g>;})}
    {options.grid&&<rect x={b.x} y={b.z} width={b.w} height={b.d} fill={`url(#${prefix}-grid)`} pointerEvents="none"/>}
    {options.diagnostics&&options.diagnostics!=='off'&&<><rect x={b.x} y={b.z} width={b.w} height={b.d} fill="#f4eeddc4" pointerEvents="none"/><Diagnostics plan={plan} floor={floor} mode={options.diagnostics}/></>}
    {(()=>{const named=new Set<string>();return floor.rooms.map(r=>{
      const generic=r.name==='Passage'||r.name==='Cross passage'||r.name==='Landing'||r.name==='Upper landing'||r.name==='Cellar passage';
      const key=`${r.componentId}:${r.name}`;
      const showName=!generic||!named.has(key);
      if(generic)named.add(key);
      const size=r.kind==='circulation'?1.15:r.kind==='hall'?2.3:1.5,cx=r.bounds.x+r.bounds.w/2,cz=r.bounds.z+r.bounds.d/2;return <g key={`label-${r.id}`}><path className="room-hit" data-room-id={r.id} d={polygonPath(r.polygon)} fill={selected===r.id?'#4e7d5033':'transparent'} stroke={selected===r.id?'#3e6d48':'none'} strokeWidth=".45" onClick={()=>onSelect?.(r.id)} tabIndex={onSelect?0:undefined} role={onSelect?'button':undefined} aria-label={`${r.name}, ${r.bounds.w-1} by ${r.bounds.d-1} blocks, Y ${r.floorY}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(r.id);}}}/>{options.labels&&r.kind!=='stairs'&&showName&&<text x={cx} y={cz} fontSize={size} fontFamily="Georgia,serif" textAnchor="middle" fill="#404d3d" style={{paintOrder:'stroke',stroke:'#f5efdf',strokeWidth:.35,pointerEvents:'none'}}>{lines(r.name).map((line,i)=><tspan key={i} x={cx} dy={i?size*1.2:0}>{line}</tspan>)}{options.dimensions&&r.kind!=='circulation'&&<tspan x={cx} dy={size*1.3} fontFamily="sans-serif" fontSize={size*.65} fill="#7e836d">{r.bounds.w-1} × {r.bounds.d-1}</tspan>}</text>}</g>;});})()}
    {options.dimensions&&<g fill="#81906d" stroke="#8e977b" strokeWidth=".12" fontFamily="sans-serif" fontSize="1.5"><path d={`M${b.x+8} ${b.z+3}h${b.w-16}m0-1v2M${b.x+8} ${b.z+2}v2`}/><text x={b.x+b.w/2} y={b.z+1.7} stroke="none" textAnchor="middle">{plan.width} blocks</text><text x={b.x+b.w-3} y={b.z+b.d/2} stroke="none" textAnchor="middle" transform={`rotate(90 ${b.x+b.w-3} ${b.z+b.d/2})`}>{plan.depth} blocks</text></g>}
  </g>);
}
