export type BuildKind='castle'|'manor'|'house';
export type Family='auto'|'crosswing'|'tower-residence'|'courtyard-manor'|'accumulated-estate'|'keep-bailey'|'tower-cluster'|'palace'|'double-ward'|'courtyard-castle'|'hall-house'|'merchant-house'|'annex-house';
export type Settings={kind:BuildKind;family:Family;size:number;floors:number;organic:number;courtyard:boolean;chapel:boolean;garden:boolean;cellar:boolean;seed:string};
export type Point={x:number;z:number};
export type Rect=Point & {w:number;d:number};
export type RoomKind='hall'|'bedroom'|'service'|'sacred'|'storage'|'study'|'circulation'|'stairs'|'gallery'|'court';
export type ComponentKind='hall'|'domestic'|'service'|'tower'|'chapel'|'gatehouse'|'workshop'|'lodging'|'court';
export type Furniture=Rect & {y:number;h:number;type:'table'|'bench'|'bed'|'shelf'|'hearth'|'desk'|'altar'|'oven'|'well'|'dais'|'seat';material:number};
export type Room={id:string;name:string;kind:RoomKind;componentId:string;suiteId?:string;bounds:Rect;polygon:Point[];holes:Rect[];floorY:number;ceilingY:number;area:number;description:string;furniture:Furniture[]};
/** Rooms that belong to one occupant and are entered as a set: a chamber with its own wardrobe or garderobe. */
export type Suite={id:string;name:string;kind:'lodging'|'lord'|'service'|'gate';roomIds:string[];headId:string};
export type BuildingComponent={id:string;name:string;kind:ComponentKind;bounds:Rect;polygon:Point[];baseY:number;storeys:number;topY:number;roof:'gable-x'|'gable-z'|'pyramid'|'battlement';parentId?:string;phase:number};
export type Opening={id:string;type:'door'|'window'|'entrance';axis:'x'|'z';x:number;y:number;z:number;width:number;height:number;roomIds:string[];outward?:Point};
export type Stair={id:string;componentId:string;roomIds:string[];bounds:Rect;fromY:number;toY:number;width:number;headroom:number;landings:Rect[]};
export type Void={id:string;name:string;bounds:Rect;polygon:Point[];holes:Rect[];floorY:number;ceilingY:number;kind:ReservationKind};
/**
 * A volume the storeys owe each other, settled before any floor is divided so that an upper plan inherits
 * it rather than discovering it. The three conditions are kept apart because they are not the same thing:
 * a court is open exterior for its whole height, a hall is interior volume with no floor carried across it,
 * and a stair well is the hole one storey leaves in the next. Nothing may be built in a reservation except
 * what it names as its own exception — a gallery may overlook a hall; a chamber may not be dropped into it.
 */
export type ReservationKind='hall'|'stair'|'court';
export type Reservation={id:string;kind:ReservationKind;name:string;componentId:string;bounds:Rect;polygon:Point[];fromY:number;toY:number;open:'interior'|'exterior';reason:string};
export type Floor={index:number;name:string;elevation:number;rooms:Room[];voids:Void[];roofComponents:string[]};
export type BlockKind='wall'|'floor'|'roof'|'stair'|'support'|'furniture'|'ground'|'glass'|'chimney'|'air';
export type BlockBox={x:number;y:number;z:number;w:number;h:number;d:number;material:number;kind:BlockKind;componentId:string;ownerFloor?:number};
export type Chimney={bounds:Rect;fromY:number;toY:number;componentId:string};
/**
 * Every place a wall does something other than run straight from corner to corner, and the reason it does.
 * A bay steps out to light and seat a principal room; an oriel is the same thing carried on corbels over
 * open ground; a chimney is the mass of a fire taken outside; a niche is the inward case, a recess cut into
 * a wall thick enough to give one away; a jetty is a whole upper storey oversailing the one below on its
 * joists. The role is recorded so the effect it promises can be checked:
 * a bay that never opens into its room, or a niche that breaks through its wall, is a defect and not a
 * decoration. Whole projecting volumes — a tower, a chapel end, a gatehouse porch — carry their role in
 * `ComponentKind` instead, and are not repeated here.
 */
export type ArticulationRole='bay'|'oriel'|'chimney'|'niche'|'jetty';
export type Articulation={id:string;role:ArticulationRole;componentId:string;roomIds:string[];bounds:Rect;side:'n'|'s'|'e'|'w';baseY:number;topY:number;reason:string};
export type Yard={name:string;bounds:Rect;kind:'stable'|'service'|'garden'|'muster'};
export type Court={id:string;name:string;bounds:Rect;gate:Point;wallHeight:number;thickness:number;gatehouse:Rect;well?:Point;yards:Yard[]};
export type Route={id:string;name:string;points:Point[];width:number};
export type Transit={roomId:string;name:string;kind:RoomKind;floorY:number;strands:string[]};
/** How the finished plan actually walks: forced crossings, route length and alternative routes. */
export type Navigation={maxDepth:number;meanDepth:number;loops:number;unreachable:string[];transits:Transit[];strandedRooms:number;compromises:number;score:number};
export type { Composition } from './composition.ts';
export type Plan={schemaVersion:2;generatorVersion:'2.0';name:string;settings:Settings;family:Family;components:BuildingComponent[];rooms:Room[];floors:Floor[];openings:Opening[];stairs:Stair[];chimneys:Chimney[];articulation:Articulation[];reservations:Reservation[];courts:Court[];routes:Route[];blocks:BlockBox[];walls:BlockBox[];slabs:BlockBox[];roofs:BlockBox[];supports:BlockBox[];bounds:Rect;minY:number;maxY:number;width:number;depth:number;totalArea:number;entry:Point;connections:[string,string][];suites:Suite[];validation:{valid:boolean;issues:string[]};navigation:Navigation;composition:import('./composition.ts').Composition;signature:string};
export type BuildingPlanV2=Plan;
export type GenerationResult={ok:true;plan:Plan}|{ok:false;error:string};
export const FAMILIES:Record<BuildKind,{id:Family;name:string;description:string}[]>={
 manor:[{id:'crosswing',name:'Hall & crosswings',description:'A tall hall between domestic and service ranges.'},{id:'tower-residence',name:'Tower residence',description:'A residential tower with a hall and lower annexes.'},{id:'courtyard-manor',name:'Courtyard manor',description:'A rich residence grown around an intimate court.'},{id:'accumulated-estate',name:'Accumulated estate',description:'Connected households, halls and successive additions.'}],
 castle:[{id:'courtyard-castle',name:'Courtyard castle',description:'Ranges set round a central court, entered through a gatehouse.'},{id:'keep-bailey',name:'Keep & bailey',description:'A dominant keep, domestic buildings and a defended yard.'},{id:'tower-cluster',name:'Clustered towers',description:'Unequal towers connected by residential ranges.'},{id:'palace',name:'Courtyard palace',description:'A grand hall, apartments and a chapel around a court.'},{id:'double-ward',name:'Inner & outer wards',description:'Two linked compounds with separate gatehouses.'}],
 house:[{id:'hall-house',name:'Hall house',description:'A hearth hall, service end and private chambers.'},{id:'merchant-house',name:'Merchant house',description:'A workshop beneath private rooms and a jettied upper storey.'},{id:'annex-house',name:'Expanded house',description:'An older house extended with workshops and smaller annexes.'}]
};
export const DEFAULT_SETTINGS:Settings={kind:'manor',family:'crosswing',size:128,floors:3,organic:65,courtyard:false,chapel:true,garden:true,cellar:true,seed:'HALL-CROSSWING'};
export const ROOM_COLORS:Record<RoomKind,string>={hall:'#e9d8b4',bedroom:'#d9e1d0',service:'#e6cbb4',sacred:'#ded2e7',storage:'#dcd6c5',study:'#cadfdd',circulation:'#ede6d5',stairs:'#cbd1be',gallery:'#e2d8c4',court:'#dfd9c2'};
export const ROOM_GROUPS:Record<RoomKind,string>={hall:'Gathering',bedroom:'Private chambers',service:'Service',sacred:'Chapel',storage:'Storage',study:'Study',circulation:'Circulation',stairs:'Stairway',gallery:'Open gallery',court:'Open court'};
export const MATERIALS=[{id:0,name:'Air',color:'#ffffff'},{id:1,name:'Masonry',color:'#969a8d'},{id:2,name:'Timber',color:'#987348'},{id:3,name:'Slate roof',color:'#485c62'},{id:4,name:'Glass',color:'#aacace'},{id:5,name:'Plaster',color:'#e4d7b9'},{id:6,name:'Paving',color:'#bbad8e'},{id:7,name:'Garden',color:'#789263'},{id:8,name:'Hearth',color:'#65544a'},{id:9,name:'Furnishings',color:'#b89c69'}];
export const rectPolygon=(r:Rect):Point[]=>[{x:r.x,z:r.z},{x:r.x+r.w,z:r.z},{x:r.x+r.w,z:r.z+r.d},{x:r.x,z:r.z+r.d}];
export function insidePolygon(x:number,z:number,p:Point[]){let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
export function insideRoom(r:Room,x:number,z:number){return insidePolygon(x+.5,z+.5,r.polygon)&&!r.holes.some(h=>x>=h.x&&x<=h.x+h.w&&z>=h.z&&z<=h.z+h.d);}
export const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.z<b.z+b.d&&a.z+a.d>b.z;
export function componentFootprint(c:BuildingComponent,y:number,family:Family):Rect {
 const b=c.bounds,f=y/6;
 if(family==='merchant-house'&&c.id==='c0'&&f===1)return {x:b.x-1,z:b.z-1,w:b.w+1,d:b.d+1};
 const inset=f>=2&&c.kind!=='tower'&&c.kind!=='hall'?Math.min(2,f-1):0;
 return {x:b.x+inset,z:b.z+inset,w:b.w-inset,d:b.d-inset};
}
