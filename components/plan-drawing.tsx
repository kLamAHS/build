'use client';
import { Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import type { Floor, Plan, Room } from '@/lib/generator';
import { ROOM_COLORS, roomWorld } from '@/lib/generator';

export type DrawingOptions = { labels:boolean; furniture:boolean; grid:boolean; dimensions:boolean; colors:boolean };
type Props={plan:Plan;floor:Floor;options:DrawingOptions;selected?:string;onSelect?:(id:string)=>void;prefix?:string};
// Transcendental math can vary in its final decimal between Worker and browser
// engines. Architectural coordinates need five decimals, not machine precision.
export function preciseSvg(node:ReactNode):ReactNode {
  return Children.map(node,child=>{
    if(!isValidElement(child))return child;
    const element=child as ReactElement<Record<string,unknown>>;
    const props:Record<string,unknown>={};
    if(typeof element.type==='string')for(const [key,value] of Object.entries(element.props)){
      if(typeof value==='number'&&Number.isFinite(value))props[key]=Number(value.toFixed(5));
      else if(typeof value==='string'&&['d','transform','points','viewBox'].includes(key))props[key]=value.replace(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi,n=>String(Number(Number(n).toFixed(5))));
    }
    if(element.props.children!==undefined)props.children=preciseSvg(element.props.children as ReactNode);
    return cloneElement(element,props);
  });
}
function Furnishings({room}:{room:Room}){
  const sx=Math.min(1,room.w/8),sy=Math.min(1,room.h/10);
  return <g transform={`translate(${room.x} ${room.y}) scale(${sx} ${sy})`}><FurnitureSymbols room={{...room,x:0,y:0,w:room.w/sx,h:room.h/sy}}/></g>;
}
function FurnitureSymbols({room:r}:{room:Room}){
  const x=r.x,y=r.y,w=r.w,h=r.h;
  const line='#8e8979',fill='#f7f1df';
  const common={stroke:line,strokeWidth:.18,fill};
  const bed=(bx:number,by:number)=><g><rect x={bx} y={by} width={2.7} height={4.2} {...common}/><rect x={bx+.2} y={by+.2} width={2.3} height={.9} rx={.18} {...common}/><path d={`M${bx},${by+1.5}h2.7 M${bx+.15},${by+1.8}v2.2`} fill="none" stroke={line} strokeWidth={.14}/></g>;
  if(r.kind==='bedroom')return <g>{bed(x+1,y+1.2)}{w>12&&bed(x+w-3.7,y+1.2)}<rect x={x+w-3.5} y={y+h-2.4} width={2.5} height={1} {...common}/><rect x={x+1} y={y+h-2.5} width={2.6} height={1.5} {...common}/></g>;
  if(r.kind==='hall')return <g>{[0,...(w>19?[1]:[])].map(i=>{const bx=x+w/2-1.5+(w>19?(i-.5)*7:0);return <g key={i}><rect x={bx} y={y+2.2} width={3} height={h-4.5} rx={.3} {...common}/><rect x={bx-1.2} y={y+2.5} width={.65} height={h-5.1} {...common}/><rect x={bx+3.5} y={y+2.5} width={.65} height={h-5.1} {...common}/></g>})}<rect x={x+w/2-2} y={y+.2} width={4} height={.8} {...common}/></g>;
  if(r.kind==='sacred')return <g><rect x={x+w/2-2} y={y+1} width={4} height={1.4} {...common}/>{Array.from({length:Math.max(1,Math.floor((h-5)/1.5))},(_,i)=><g key={i}><rect x={x+1} y={y+4+i*1.5} width={w/2-2} height={.55} {...common}/><rect x={x+w/2+1} y={y+4+i*1.5} width={w/2-2} height={.55} {...common}/></g>)}</g>;
  if(r.kind==='storage')return <g>{Array.from({length:Math.floor((w-2)/2)},(_,i)=><rect key={i} x={x+1+i*2} y={y+1} width={1.5} height={1.1} {...common}/>)}{[0,1,2].map(i=><g key={i}><circle cx={x+1.8} cy={y+4+i*1.6} r={.65} {...common}/><path d={`M${x+1.35},${y+4+i*1.6}h.9`} stroke={line} strokeWidth={.14}/></g>)}<rect x={x+w-1.9} y={y+3} width={1} height={h-5} {...common}/></g>;
  if(r.kind==='service')return <g><path d={`M${x+1},${y+h-2}V${y+1}H${x+w-1}v1.4H${x+2.4}v${h-4.4}Z`} {...common}/>{[0,1,2].map(i=><circle key={i} cx={x+w-2.2-i*1.4} cy={y+1.7} r={.42} {...common}/>)}<rect x={x+w/2-1.3} y={y+h/2-1.4} width={2.6} height={3} {...common}/></g>;
  if(r.kind==='study')return <g><rect x={x+1} y={y+1} width={w-2} height={1.1} {...common}/>{Array.from({length:Math.floor(w-2)},(_,i)=><path key={i} d={`M${x+1.5+i},${y+1}v1.1`} stroke={line} strokeWidth={.12}/>)}<rect x={x+w/2-1.6} y={y+h/2-1.1} width={3.2} height={2.2} {...common}/><rect x={x+w/2-.5} y={y+h/2+1.3} width={1} height={1} {...common}/></g>;
  return <g stroke={line} strokeWidth={.18}>{[0,1,2,3,4].map(i=><path key={i} d={`M${x+w/2-1.5+i*.75},${y+.4}v1.5`}/>)}</g>;
}
function RoomLabel({room,plan,floor}:{room:Room;plan:Plan;floor:Floor}){
  const c=roomWorld(room,floor.wings[room.wing]);
  const words=room.name.split(' ');const lines=words.length>1?[words.slice(0,-1).join(' '),words.at(-1)!]:words;
  const size=Math.max(1.6,Math.min(2.1,plan.bounds.w/88));
  return preciseSvg(<text x={c.x} y={c.y} fontFamily="Georgia,serif" fontSize={size} textAnchor="middle" fill="#464b3e" style={{paintOrder:'stroke',stroke:'#f4f0e3',strokeWidth:.65,strokeLinejoin:'round',pointerEvents:'none'}}>{lines.map((line,i)=><tspan key={i} x={c.x} dy={i===0?-(lines.length-1)*size*.5:size*1.12}>{line}</tspan>)}</text>);
}
export function PlanDrawing({plan,floor,options,selected,onSelect,prefix='plan'}:Props){
  const b=plan.bounds,verts=plan.vertices;
  const cx=verts.reduce((a,v)=>a+v.x,0)/verts.length,cy=verts.reduce((a,v)=>a+v.y,0)/verts.length;
  const top=b.y+10,left=b.x+12,right=b.x+b.w-12,bottom=b.y+b.h-23;
  return preciseSvg(<g>
    <defs>
      <pattern id={`${prefix}-grid`} width="2" height="2" patternUnits="userSpaceOnUse"><path d="M2 0H0V2" fill="none" stroke="#a79e86" strokeWidth=".06" opacity=".28"/></pattern>
      <pattern id={`${prefix}-stone`} width="2" height="1.2" patternUnits="userSpaceOnUse"><path d="M0 0h2M0 1.2h2M1 0v1.2" stroke="#8f8e7d" strokeWidth=".07" opacity=".4"/></pattern>
      <pattern id={`${prefix}-wood`} width="2.4" height="1.5" patternUnits="userSpaceOnUse"><path d="M0 0h2.4M1.2 0v1.5" stroke="#b4a787" strokeWidth=".06" opacity=".5"/></pattern>
      <pattern id={`${prefix}-grass`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M1 1l.2-.5.2.5M3 3l.2-.5.2.5" stroke="#87947a" strokeWidth=".1" opacity=".4"/></pattern>
    </defs>
    {options.grid&&<rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${prefix}-grid)`}/>}
    {floor.index===0&&<g transform={`translate(${plan.entry.x} ${plan.entry.y}) rotate(${plan.entryAngle*180/Math.PI})`}><path d="M0 -2.1H12V2.1H0" fill="#d8d0b8" stroke="#b3aa92" strokeWidth=".2"/><path d="M2 -2v4m2 -4v4m2 -4v4m2 -4v4m2 -4v4" stroke="#b3aa92" strokeWidth=".14"/></g>}
    <polygon points={verts.map(v=>`${v.x},${v.y}`).join(' ')} fill={options.colors&&plan.settings.garden?'#e2e5d4':'#ece7d6'} opacity={floor.index<0?.35:1}/>
    {plan.settings.garden&&floor.index>=0&&<g><polygon points={verts.map(v=>`${v.x},${v.y}`).join(' ')} fill={`url(#${prefix}-grass)`}/>{[-1,1].map(dx=>[-1,1].map(dy=><g key={`${dx}${dy}`} transform={`translate(${cx+dx*10} ${cy+dy*8})`}><rect x="-5" y="-3" width="10" height="6" rx="1.8" fill="#c6d0b3" stroke="#95a183" strokeWidth=".3"/><rect x="-4.1" y="-2.2" width="8.2" height="4.4" rx="1.1" fill="none" stroke="#9baa87" strokeWidth=".3"/><path d="M-2 -1v2m2 -2v2m2 -2v2" stroke="#9baa87" strokeWidth=".2"/></g>))}</g>}
    {floor.index>=0&&<g><circle cx={cx} cy={cy} r="3.6" fill="#dad8c5" stroke="#868a79" strokeWidth=".3"/><circle cx={cx} cy={cy} r="2.8" fill="#b9cdd0" stroke="#879b9b" strokeWidth=".22"/><circle cx={cx} cy={cy} r=".9" fill="#e8e4d5" stroke="#879b9b" strokeWidth=".2"/>{options.labels&&<text x={cx} y={cy+18} textAnchor="middle" fontFamily="Georgia,serif" fontStyle="italic" fill="#7a806d" fontSize="2.8">{plan.settings.kind==='castle'?(plan.settings.courtyard?'Inner courtyard':'Open bailey'):plan.settings.garden?'Kitchen garden':'Forecourt'}</text>}</g>}
    {floor.wings.map(wing=><g key={wing.id} transform={`translate(${wing.start.x} ${wing.start.y}) rotate(${wing.angle*180/Math.PI})`}>
      <rect x={0} y={-wing.depth/2} width={wing.length} height={wing.depth} fill="#b9b5a1" stroke="#666b5b" strokeWidth=".45"/>
      <rect x={0} y={-wing.depth/2+.6} width={wing.length} height={wing.depth-1.2} fill="#f0ead8"/>
      <rect x={0} y={wing.depth/2-3.5} width={wing.length} height={2.9} fill={`url(#${prefix}-stone)`}/>
      {wing.rooms.map(r=><g key={r.id}>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={selected===r.id?'#bfceb9':options.colors?ROOM_COLORS[r.kind]:'#f1ebdc'} stroke={selected===r.id?'#3f6a48':'#787b69'} strokeWidth={selected===r.id?.5:.32}/>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${prefix}-wood)`} style={{pointerEvents:'none'}}/>
        {options.furniture&&<Furnishings room={r}/>}
        <path d={`M${r.x+r.w/2-1},${r.y+r.h}h2`} stroke="#f0ead8" strokeWidth=".75"/>
        <path d={`M${r.x+r.w/2-1},${r.y+r.h}v-2a2 2 0 0 1 2 2`} fill="none" stroke="#797d68" strokeWidth=".16"/>
        {Array.from({length:Math.max(1,Math.floor(r.w/5))},(_,i)=>{const wx=r.x+(i+1)*r.w/(Math.max(1,Math.floor(r.w/5))+1);return <g key={i}><path d={`M${wx-.8},${-wing.depth/2+.3}h1.6`} stroke="#f5f1e4" strokeWidth="1"/><path d={`M${wx-.8},${-wing.depth/2}h1.6m-1.6 .55h1.6`} stroke="#717c71" strokeWidth=".12"/></g>})}
        {r.kind==='gate'&&<g><path d={`M${r.x+r.w/2-1.4},${-wing.depth/2+.2}h2.8M${r.x+r.w/2-1.4},${wing.depth/2-.2}h2.8`} stroke="#f0ead8" strokeWidth="1.1"/><path d={`M${r.x+r.w/2-1.4},${-wing.depth/2-1.2}v1.5m2.8 -1.5v1.5`} stroke="#656b59" strokeWidth=".2"/></g>}
        {onSelect&&<rect role="button" tabIndex={0} aria-label={`${r.name}, ${r.area} square units`} aria-pressed={selected===r.id} className="room-hit" x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" onClick={()=>onSelect(r.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(r.id)}}}><title>{`${r.name} · ${Math.round(r.w)} × ${Math.round(r.h)}`}</title></rect>}
      </g>)}
    </g>)}
    {floor.towers.map((t,i)=><g key={t.id} transform={`translate(${t.center.x} ${t.center.y})`}>
      {t.round?<><circle r={t.radius} fill="#b9b5a1" stroke="#666b5b" strokeWidth=".45"/><circle r={t.radius-.7} fill="#e6e0cd" stroke="#787b69" strokeWidth=".2"/></>:<rect x={-t.radius/.9} y={-t.radius/.9} width={t.radius*2/.9} height={t.radius*2/.9} fill="#e6e0cd" stroke="#666b5b" strokeWidth=".45"/>}
      {t.round?t.openings.map((a,j)=><g key={j} transform={`rotate(${a*180/Math.PI})`}><path d={`M${t.radius-1.8} 0h2.5`} stroke="#e6e0cd" strokeWidth="3.2"/></g>):floor.wings.filter(w=>w.start===t.center||w.end===t.center).map(w=>{
        const outgoing=w.start===t.center,a=w.angle+(outgoing?0:Math.PI),offset=(w.depth/2-1.9)*(outgoing?1:-1),half=t.radius/.9;
        const dx=Math.cos(a),dy=Math.sin(a),px=-dy*offset,py=dx*offset;
        const tx=Math.abs(dx)<.0001?Infinity:(Math.sign(dx)*half-px)/dx,ty=Math.abs(dy)<.0001?Infinity:(Math.sign(dy)*half-py)/dy,d=Math.min(tx,ty);
        return <g key={w.id} transform={`rotate(${a*180/Math.PI})`}><path d={`M${d-1.2} ${offset}h2.4`} stroke="#e6e0cd" strokeWidth="3.2"/></g>;
      })}
      {(t.round||i===1)&&<g><circle r={t.radius*.49} fill="#f0ead9" stroke="#8c8a75" strokeWidth=".25"/>{Array.from({length:17},(_,j)=>{const a=j/18*Math.PI*2;return <path key={j} d={`M${Math.cos(a)*.65} ${Math.sin(a)*.65}L${Math.cos(a)*t.radius*.49} ${Math.sin(a)*t.radius*.49}`} stroke="#93917b" strokeWidth=".18"/>})}<circle r=".65" fill="#aaa992"/><path d={`M${t.radius*.33} 0a${t.radius*.33} ${t.radius*.33} 0 1 1 -${t.radius*.33} -${t.radius*.33}`} fill="none" stroke="#6e7963" strokeWidth=".2"/><path d={`M-.8 ${-t.radius*.33-.4}l.8 .4-.7 .5`} fill="none" stroke="#6e7963" strokeWidth=".2"/></g>}
      {options.labels&&<text y={t.radius*.72} textAnchor="middle" fontFamily="Georgia,serif" fontSize={1.65} fill="#5b6554">{t.name}</text>}
    </g>)}
    {options.labels&&floor.rooms.map(r=><RoomLabel key={r.id} room={r} floor={floor} plan={plan}/>)}
    {options.dimensions&&<g stroke="#858a75" strokeWidth=".14" fill="#737b65" fontFamily="Arial,sans-serif" fontSize="1.8">
      <path d={`M${left} ${top-3}H${right}M${left} ${top-4}v2m${right-left} -2v2 M${right+5} ${top+4}V${bottom}m-1 0h2m-2 ${top+4-bottom}h2`} fill="none"/>
      <text x={(left+right)/2} y={top-4.3} textAnchor="middle" stroke="none">{plan.width} units</text><text transform={`translate(${right+7.5},${(top+4+bottom)/2}) rotate(90)`} textAnchor="middle" stroke="none">{plan.depth} units</text>
    </g>}
  </g>);
}
