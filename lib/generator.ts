export type BuildKind = 'castle' | 'manor' | 'house';
export type RoomKind = 'hall' | 'bedroom' | 'service' | 'sacred' | 'storage' | 'study' | 'gate';
export type Settings = { kind: BuildKind; size: number; floors: number; organic: number; courtyard: boolean; chapel: boolean; garden: boolean; cellar: boolean; seed: string };
export type Point = { x: number; y: number };
export type Room = { id: string; name: string; kind: RoomKind; x: number; y: number; w: number; h: number; wing: number; area: number; description: string };
export type Wing = { id: number; start: Point; end: Point; angle: number; length: number; depth: number; rooms: Room[] };
export type Tower = { id: string; center: Point; radius: number; round: boolean; openings: number[]; name: string };
export type Floor = { index: number; name: string; wings: Wing[]; rooms: Room[]; towers: Tower[] };
export type Plan = { name: string; settings: Settings; floors: Floor[]; bounds: { x: number; y: number; w: number; h: number }; vertices: Point[]; totalArea: number; width: number; depth: number; entry: Point; entryAngle: number };

export const DEFAULT_SETTINGS: Settings = { kind: 'castle', size: 128, floors: 3, organic: 65, courtyard: true, chapel: true, garden: true, cellar: false, seed: 'RAVEN-2847' };
export const ROOM_COLORS: Record<RoomKind, string> = { hall: '#e8dfc7', bedroom: '#dce2d7', service: '#eadbc9', sacred: '#e0dce6', storage: '#ddd9cd', study: '#d4e0df', gate: '#dfdaca' };
export const ROOM_GROUPS: Record<RoomKind, string> = { hall: 'Gathering', bedroom: 'Living quarters', service: 'Service', sacred: 'Sacred', storage: 'Storage', study: 'Study', gate: 'Circulation' };
function randomFor(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, 1 | h); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const programs: Record<string, [string, RoomKind][]> = {
  ground: [['Great Hall','hall'],['Kitchen','service'],['Pantry','storage'],['Guardroom','storage'],['Armory','storage'],['Guest Chamber','bedroom'],['Steward’s Office','study'],['Dining Hall','hall'],['Scullery','service'],['Library','study'],['Servants’ Quarters','bedroom'],['Store Room','storage']],
  upper: [['Solar','hall'],['Lord’s Chamber','bedroom'],['Lady’s Chamber','bedroom'],['Library','study'],['Guest Chamber','bedroom'],['Council Room','hall'],['Scribe’s Study','study'],['Linen Store','storage'],['Retainers’ Quarters','bedroom'],['Gallery','hall']],
  top: [['Map Room','study'],['Watch Quarters','bedroom'],['Observatory','study'],['Archive','storage'],['Private Chamber','bedroom'],['Tapestry Room','hall'],['Herbalist’s Study','study'],['Wardrobe','storage']],
  cellar: [['Wine Cellar','storage'],['Root Cellar','storage'],['Provision Store','storage'],['Brewhouse','service'],['Cold Store','storage'],['Workshop','service']],
  house: [['Hearth Hall','hall'],['Kitchen','service'],['Bedchamber','bedroom'],['Larder','storage'],['Workshop','service'],['Study','study']],
};
const descriptions: Record<RoomKind,string> = {
  hall: 'A generous gathering room with a central table, benches, and space for a hearth. Its doorway opens onto the shared passage.',
  bedroom: 'A private chamber with a bed, storage chest, and space for a small writing table. Accessible from the shared passage.',
  service: 'A working room with preparation counters and storage. Leave the centre clear for circulation between work areas.',
  sacred: 'A quiet chapel with an altar and rows of pews. Keep the central aisle clear from the passage to the altar.',
  storage: 'A practical storage room with shelving and chests arranged around an open aisle.',
  study: 'A quiet room with shelving, a writing desk, and a reading table. A window brings light into the work area.',
  gate: 'The entrance connects the exterior approach to the inner court through the shared passage. The portcullis sits at the outer wall.',
};
export function generatePlan(settings: Settings): Plan {
  const s = { ...settings, size: Math.min(192, Math.max(48, Number(settings.size)||128)), floors: Math.min(5,Math.max(1,Math.round(settings.floors)||1)), organic: Math.min(100,Math.max(0,Number(settings.organic)||0)), seed: settings.seed.trim().slice(0,64)||'RAVEN-2847' };
  const rnd = randomFor(s.seed);
  const o = s.organic / 100;
  const bases = s.kind === 'castle' ? s.size<120 ? [[22,24],[80,24],[80,78],[22,78]] : [[21,24],[57,18],[84,29],[91,57],[74,81],[38,83],[18,62]] : s.kind === 'manor' ? [[22,63],[25,25],[69,22],[81,60]] : [[28,35],[70,35],[70,68]];
  const k = s.size / (s.kind === 'castle' ? 94 : s.kind === 'manor' ? 79 : 65);
  const vertices = bases.map(([x,y])=>({x:(x+(rnd()-.5)*9*o)*k,y:(y+(rnd()-.5)*9*o)*k}));
  const count = s.kind === 'castle' && s.courtyard ? vertices.length : vertices.length-1;
  const shortest = Math.min(...Array.from({length:count},(_,i)=>Math.hypot(vertices[(i+1)%vertices.length].x-vertices[i].x,vertices[(i+1)%vertices.length].y-vertices[i].y)));
  // Reserve two tower clearances and at least 9.4 units for the shortest wing.
  const towerRatio = s.kind==='castle' ? .69 : .45;
  const depth = Math.min((s.kind === 'castle' ? 16 : s.kind === 'manor' ? 17 : 16) * Math.max(.7,Math.min(1.35,k)), (shortest-10.6)/(towerRatio*2));
  const radius = depth*towerRatio;
  const clearance = radius+.6;
  const specs = Array.from({length:count},(_,i)=>{
    const start=vertices[i],end=vertices[(i+1)%vertices.length];
    const length=Math.hypot(end.x-start.x,end.y-start.y),angle=Math.atan2(end.y-start.y,end.x-start.x);
    const usable=length-clearance*2;
    const roomCount=Math.max(1,Math.floor(usable/(s.kind==='house'?8:10)));
    const weights=Array.from({length:roomCount},()=>.85+rnd()*.3);
    if(i===0) weights[0]=1.7;
    return {id:i,start,end,length,angle,depth,weights};
  });
  let gateWing = 0;
  for (let i=1;i<specs.length;i++) if((specs[i].start.y+specs[i].end.y)/2>(specs[gateWing].start.y+specs[gateWing].end.y)/2) gateWing=i;
  const floors: Floor[]=[];
  for(let f=s.cellar?-1:0;f<s.floors;f++){
    let roomNo=0;
    const seen:Record<string,number>={};
    const program=programs[f<0?'cellar':s.kind==='house'&&f===0?'house':f===0?'ground':f===1?'upper':'top'];
    const wings=specs.map(spec=>{
      let cursor=clearance;
      const sum=spec.weights.reduce((a,b)=>a+b,0);
      const rooms=spec.weights.map((weight,j)=>{
        const w=(spec.length-clearance*2)*weight/sum;
        let [name,kind]=program[roomNo%program.length];
        if(s.chapel&&s.kind!=='house'&&spec.id===Math.min(2,count-1)&&j===0&&f===0){name='Chapel';kind='sacred';}
        if(spec.id===gateWing&&j===Math.floor(spec.weights.length/2)&&f===0){name=s.kind==='castle'?'Gatehouse':'Entrance Hall';kind='gate';}
        if(s.kind==='manor'&&name==='Great Hall') name='Banquet Hall';
        seen[name]=(seen[name]||0)+1;
        if(seen[name]>1) name+=` ${seen[name]}`;
        const room:Room={id:`${f}-${spec.id}-${j}`,name,kind,x:cursor+.35,y:-depth/2+.7,w:w-.7,h:depth-4.3,wing:spec.id,area:Math.round((w-.7)*(depth-4.3)),description:descriptions[kind]};
        cursor+=w;roomNo++;return room;
      });
      return {...spec,rooms};
    });
    const towers=vertices.map((center,i)=>{
      const openings:number[]=[];
      const offset=Math.asin((depth/2-1.9)/radius);
      if(i<count)openings.push(specs[i].angle+offset);
      const previous=(i-1+vertices.length)%vertices.length;
      if(previous<count)openings.push(specs[previous].angle+Math.PI-offset);
      return {id:`tower-${i}`,center,radius,round:s.kind==='castle',openings,name:s.kind==='castle'?['West Tower','North Tower','Dawn Tower','East Tower','South Tower','Raven Tower','Watch Tower'][i]:i===1?'Main Stair':'Landing'};
    });
    floors.push({index:f,name:f<0?'Cellar':f===0?'Ground floor':f===1?'First floor':f===2?'Second floor':f===3?'Third floor':'Fourth floor',wings,rooms:wings.flatMap(w=>w.rooms),towers});
  }
  const minX=Math.min(...vertices.map(v=>v.x))-radius,maxX=Math.max(...vertices.map(v=>v.x))+radius,minY=Math.min(...vertices.map(v=>v.y))-radius,maxY=Math.max(...vertices.map(v=>v.y))+radius;
  const gate=specs[gateWing],groom=floors.find(f=>f.index===0)!.wings[gateWing].rooms.find(r=>r.kind==='gate')!;
  const gx=groom.x+groom.w/2,gy=-depth/2;
  const entry={x:gate.start.x+Math.cos(gate.angle)*gx-Math.sin(gate.angle)*gy,y:gate.start.y+Math.sin(gate.angle)*gx+Math.cos(gate.angle)*gy};
  const names=['Ravenwatch','Briarwick','Thornhaven','Eldermere','Ashenford','Wyrmwood','Hollowmere','Greyhaven','Oakenshield','Windrest'];
  const prefix=s.seed===DEFAULT_SETTINGS.seed?'Ravenwatch':names[Math.floor(rnd()*names.length)];
  return {name:`${prefix} ${s.kind==='castle'?'Castle':s.kind==='manor'?'Manor':'House'}`,settings:s,floors,vertices,totalArea:floors.reduce((a,f)=>a+f.rooms.reduce((b,r)=>b+r.area,0),0),width:Math.round(maxX-minX),depth:Math.round(maxY-minY),bounds:{x:minX-12,y:minY-14,w:maxX-minX+24,h:maxY-minY+36},entry,entryAngle:gate.angle-Math.PI/2};
}
export function newSeed(){return `KEEP-${Math.random().toString(36).slice(2,7).toUpperCase()}`;}
export function roomWorld(room:Room,wing:Wing):Point{return {x:wing.start.x+Math.cos(wing.angle)*(room.x+room.w/2)-Math.sin(wing.angle)*(room.y+room.h/2),y:wing.start.y+Math.sin(wing.angle)*(room.x+room.w/2)+Math.cos(wing.angle)*(room.y+room.h/2)};}
