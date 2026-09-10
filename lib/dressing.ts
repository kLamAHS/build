import { type Furniture, type Plan, type Room } from './model.ts';
import { voxelize, type SparseBlocks } from './voxels.ts';

/**
 * Dressing a build, which is the difference between a massing model and something worth pasting into a
 * world. The generator settles what stands where; this settles what it is made of.
 *
 * The rules come from reading two hand-built castles block by block. Three things separate them from what a
 * generator produces on its own, and all three are here:
 *
 *  - **The stone is never one stone.** Between twelve and thirty-five stone blocks are in use, and they are
 *    not salt-and-pepper: a neighbouring block is the same one about half the time, where random mixing
 *    would be three to eight per cent. So the stone comes from a patchy field — a few blocks of one stone,
 *    then a few of another — with a little weathering scattered on top.
 *  - **A fifth of every block placed is trim.** Stairs are seven to fourteen per cent of the blocks in those
 *    builds and slabs another eight to thirteen, concentrated in courses: a plinth, a string course at each
 *    storey, a corbel table under the parapet, and roofs made of stairs rather than of cubes.
 *  - **They are lit.** A hundred and fifty lanterns in a building thirty-seven blocks across. A build with no
 *    light in it is a mob farm.
 */

export type BlockState={name:string;props?:Record<string,string>};
export type Dressed={size:{x:number;y:number;z:number};palette:BlockState[];cells:Uint16Array;lights:number};

/** A deduplicating palette. Index 0 is always air, because that is what an empty cell is. */
class Palette {
  readonly states:BlockState[]=[{name:'minecraft:air'}];
  private index=new Map<string,number>([['minecraft:air',0]]);
  of(name:string,props?:Record<string,string>){
    const key=props?`${name}[${Object.entries(props).map(([k,v])=>`${k}=${v}`).join(',')}]`:name;
    let at=this.index.get(key);
    if(at===undefined){at=this.states.length;this.states.push({name,props});this.index.set(key,at);}
    return at;
  }
}

/** A hash of three coordinates and a seed, for a field that is the same every time the same plan is dressed. */
function noise(seed:number,x:number,y:number,z:number){
  let h=seed^0x9e3779b9;
  for(const v of [x,y,z]){h=Math.imul(h^(v+0x9e3779b9),0x85ebca6b);h^=h>>>13;}
  return (Math.imul(h,0xc2b2ae35)>>>0)/4294967296;
}

/**
 * The stones a building of each kind is made of, commonest first, and what a weathered one looks like. A
 * castle is tuff and deepslate and hard grey; a house is the cobble and stone of the fields round it.
 */
const STONE:Record<Plan['settings']['kind'],string[]>={
  castle:['tuff','tuff_bricks','stone_bricks','andesite','cobbled_deepslate','deepslate_bricks','cobblestone','polished_tuff'],
  manor:['stone_bricks','tuff_bricks','andesite','polished_andesite','tuff','cobblestone','calcite','diorite'],
  house:['cobblestone','stone_bricks','andesite','tuff','granite','stone','mossy_cobblestone','tuff_bricks'],
};
const WEATHERED:Record<string,string>={
  stone_bricks:'cracked_stone_bricks',deepslate_bricks:'cracked_deepslate_bricks',
  cobblestone:'mossy_cobblestone',tuff_bricks:'chiseled_tuff_bricks',stone:'andesite',
};
/** Which of those have a matching stair and slab, for the courses that need one. */
const TRIMMABLE=new Set(['tuff','tuff_bricks','stone_bricks','andesite','cobbled_deepslate','deepslate_bricks','cobblestone','polished_tuff','polished_andesite','granite','diorite','calcite','mossy_cobblestone']);
const trimOf=(stone:string)=>TRIMMABLE.has(stone)?stone:'stone_bricks';

const SIDES=[{x:0,z:-1,facing:'north'},{x:0,z:1,facing:'south'},{x:-1,z:0,facing:'west'},{x:1,z:0,facing:'east'}] as const;
const away=(facing:string)=>facing==='north'?'south':facing==='south'?'north':facing==='east'?'west':'east';

export function dress(plan:Plan,grid:SparseBlocks=voxelize(plan)):Dressed {
  const b=plan.bounds,low=plan.minY,size={x:b.w,y:plan.maxY-low+1,z:b.d};
  const palette=new Palette();
  const cells=new Uint16Array(size.x*size.y*size.z);
  const at=(x:number,y:number,z:number)=>(y*size.z+z)*size.x+x;
  const put=(x:number,y:number,z:number,name:string,props?:Record<string,string>)=>{
    if(x<0||z<0||y<0||x>=size.x||y>=size.y||z>=size.z)return;
    cells[at(x,y,z)]=palette.of(`minecraft:${name}`,props);
  };
  let seed=2166136261;
  for(let i=0;i<plan.settings.seed.length;i++)seed=Math.imul(seed^plan.settings.seed.charCodeAt(i),16777619)>>>0;
  const stones=STONE[plan.settings.kind];
  const world=(x:number,y:number,z:number)=>({x:b.x+x,y:low+y,z:b.z+z});
  const kindAt=(x:number,y:number,z:number)=>{const w=world(x,y,z);return grid.kindAt(w.x,w.y,w.z);};
  const filled=(x:number,y:number,z:number)=>{const w=world(x,y,z);return grid.material(w.x,w.y,w.z)!==0;};
  // Ground a range stands on, so an outward-facing wall can be told from a wall two rooms share.
  const built=plan.components.filter(c=>c.kind!=='court').map(c=>c.bounds);
  const indoors=(x:number,z:number)=>built.some(r=>b.x+x>=r.x&&b.x+x<r.x+r.w&&b.z+z>=r.z&&b.z+z<r.z+r.d);
  /** The stone of this cell: one patch of three blocks takes one stone, and a little of it is weathered. */
  const stoneAt=(x:number,y:number,z:number)=>{
    const w=world(x,y,z);
    const pick=stones[Math.floor(noise(seed,Math.floor(w.x/2),Math.floor(w.y/2),Math.floor(w.z/2))*stones.length)%stones.length];
    return noise(seed+7,w.x,w.y,w.z)<0.12?WEATHERED[pick]??pick:pick;
  };
  // Corners read as quoins: the same stone all the way up, which is what tells the eye where the mass ends.
  const corner=(x:number,z:number)=>built.some(r=>(b.x+x===r.x||b.x+x===r.x+r.w-1)&&(b.z+z===r.z||b.z+z===r.z+r.d-1));
  const quoin=plan.settings.kind==='house'?'stone_bricks':'polished_andesite';

  for(let y=0;y<size.y;y++)for(let z=0;z<size.z;z++)for(let x=0;x<size.x;x++){
    if(!filled(x,y,z))continue;
    const kind=kindAt(x,y,z),w=world(x,y,z);
    if(kind==='glass'){
      // A light is a pane, not a wall of glass: it reads as a window from both sides and lets the frame show.
      const props:Record<string,string>={waterlogged:'false'};
      for(const side of SIDES)props[side.facing]=filled(x+side.x,y,z+side.z)?'true':'false';
      put(x,y,z,'gray_stained_glass_pane',props);continue;
    }
    if(kind==='ground'){
      const material=grid.material(w.x,w.y,w.z);
      put(x,y,z,material===7?'grass_block':material===6?'gravel':'coarse_dirt',material===7?{snowy:'false'}:undefined);continue;
    }
    if(kind==='roof'){
      // A roof of cubes is a staircase drawn as a box. Where the roof drops away on one side and not the
      // other, that is a pitch, and a pitch is built out of stairs facing up it.
      const down=SIDES.filter(s=>kindAt(x+s.x,y-1,z+s.z)==='roof'&&!filled(x+s.x,y,z+s.z));
      const stone=plan.settings.kind==='house'?'cobblestone':'deepslate_tiles';
      if(down.length===1)put(x,y,z,`${stone==='cobblestone'?'cobblestone':'deepslate_tile'}_stairs`,{facing:away(down[0].facing),half:'bottom',shape:'straight',waterlogged:'false'});
      else if(!filled(x,y+1,z)&&down.length>1)put(x,y,z,`${stone==='cobblestone'?'cobblestone':'deepslate_tile'}_slab`,{type:'bottom',waterlogged:'false'});
      else put(x,y,z,stone);
      continue;
    }
    if(kind==='chimney'){put(x,y,z,noise(seed+3,w.x,w.y,w.z)<0.2?'cracked_stone_bricks':'bricks');continue;}
    if(kind==='support'){
      // Joists and corbels are timber, and timber has a grain: the log lies along whatever it spans.
      const alongX=filled(x-1,y,z)||filled(x+1,y,z),alongZ=filled(x,y,z-1)||filled(x,y,z+1);
      put(x,y,z,'stripped_spruce_log',{axis:alongX&&!alongZ?'x':alongZ&&!alongX?'z':'y'});continue;
    }
    if(kind==='floor'){
      // Boards upstairs, flags on the ground: you do not lay a stone floor on joists.
      if(w.y>0)put(x,y,z,noise(seed+11,w.x,w.y,w.z)<0.15?'spruce_planks':'dark_oak_planks');
      else put(x,y,z,noise(seed+11,w.x,w.y,w.z)<0.3?'cobblestone':'andesite');
      continue;
    }
    if(kind==='stair'){put(x,y,z,'stone_brick_stairs',{facing:'north',half:'bottom',shape:'straight',waterlogged:'false'});continue;}
    // Everything else is wall.
    const stone=corner(x,z)&&kind==='wall'?quoin:stoneAt(x,y,z);
    put(x,y,z,stone);
    // A string course at each storey line, projecting one block into the air outside. This is the single
    // thing that most separates a wall from a box: a horizontal line the eye can measure the storeys by.
    if(kind==='wall'&&w.y>0&&w.y%6===5)for(const side of SIDES){
      const nx=x+side.x,nz=z+side.z;
      if(filled(nx,y,nz)||indoors(nx,nz)||nx<0||nz<0||nx>=size.x||nz>=size.z)continue;
      if(!filled(nx,y-1,nz))put(nx,y,nz,`${trimOf(stone)}_slab`,{type:'top',waterlogged:'false'});
    }
    // A corbel table under the eaves: the course a parapet would stand on, projecting one block, which is
    // what stops a wall meeting a roof as two flat planes butted together.
    if(kind==='wall'&&!filled(x,y+1,z))for(const side of SIDES){
      const nx=x+side.x,nz=z+side.z;
      if(filled(nx,y,nz)||indoors(nx,nz)||nx<0||nz<0||nx>=size.x||nz>=size.z)continue;
      put(nx,y,nz,`${trimOf(stone)}_slab`,{type:'top',waterlogged:'false'});
    }
    // A plinth: the lowest course carried one block proud, chamfered back with a course of stairs above it.
    if(kind==='wall'&&w.y===0)for(const side of SIDES){
      const nx=x+side.x,nz=z+side.z;
      if(filled(nx,y,nz)||indoors(nx,nz)||nx<0||nz<0||nx>=size.x||nz>=size.z)continue;
      put(nx,y,nz,plan.settings.kind==='castle'?'cobbled_deepslate':'cobblestone');
      put(nx,y+1,nz,`${trimOf(stone)}_stairs`,{facing:side.facing,half:'top',shape:'straight',waterlogged:'false'});
    }
  }
  const lights=fittings(plan,palette,cells,size,at,put,seed);
  return {size,palette:palette.states,cells,lights};
}

/** What each fitting actually is, once it is a block and not a rectangle on a drawing. */
function fittings(plan:Plan,palette:Palette,cells:Uint16Array,size:Dressed['size'],
  at:(x:number,y:number,z:number)=>number,put:(x:number,y:number,z:number,n:string,p?:Record<string,string>)=>void,seed:number){
  const b=plan.bounds,low=plan.minY;
  const local=(f:Furniture)=>({x:f.x-b.x,y:f.y-low,z:f.z-b.z});
  const facingOf=(f:Furniture,r:Room)=>{
    const cx=r.bounds.x+r.bounds.w/2,cz=r.bounds.z+r.bounds.d/2;
    return Math.abs(f.x-cx)>Math.abs(f.z-cz)?(f.x<cx?'east':'west'):(f.z<cz?'south':'north');
  };
  let lights=0;
  for(const room of plan.rooms){
    for(const f of room.furniture){
      const o=local(f),facing=facingOf(f,room);
      const fill=(name:string,props?:Record<string,string>)=>{
        for(let dx=0;dx<f.w;dx++)for(let dz=0;dz<f.d;dz++)for(let dy=0;dy<f.h;dy++)put(o.x+dx,o.y+dy,o.z+dz,name,props);
      };
      const mid={x:o.x+Math.floor(f.w/2),z:o.z+Math.floor(f.d/2)};
      switch(f.type){
        // A fire is a fire: brick, and something burning in it, which is also where half the light comes from.
        case 'hearth':fill('bricks');put(mid.x,o.y,mid.z,'campfire',{lit:'true',facing,signal_fire:'false',waterlogged:'false'});lights++;break;
        case 'oven':fill('bricks');put(mid.x,o.y,mid.z,'furnace',{facing,lit:'true'});lights++;break;
        case 'forge':fill('deepslate_bricks');put(o.x,o.y,o.z,'blast_furnace',{facing,lit:'true'});put(mid.x,o.y,mid.z,'anvil',{facing});lights++;break;
        case 'still':fill('polished_tuff');put(mid.x,o.y,mid.z,'brewing_stand',{has_bottle_0:'true',has_bottle_1:'false',has_bottle_2:'true'});break;
        case 'lectern':fill('bookshelf');put(mid.x,o.y,mid.z,room.name.startsWith('Enchant')?'enchanting_table':'lectern',room.name.startsWith('Enchant')?undefined:{facing,has_book:'true',powered:'false'});break;
        case 'crate':fill('barrel',{facing:'up',open:'false'});break;
        case 'shelf':fill(seedy(seed,f)?'chiseled_bookshelf':'bookshelf',seedy(seed,f)?{facing,slot_0_occupied:'true',slot_1_occupied:'true',slot_2_occupied:'false',slot_3_occupied:'true',slot_4_occupied:'false',slot_5_occupied:'true'}:undefined);break;
        case 'desk':fill('crafting_table');put(o.x,o.y,o.z,'cartography_table');break;
        case 'altar':fill('smooth_stone_slab',{type:'double',waterlogged:'false'});put(mid.x,o.y,mid.z,'candle',{candles:'3',lit:'true',waterlogged:'false'});lights++;break;
        case 'well':fill('water',{level:'0'});for(const [dx,dz] of [[0,0],[f.w-1,0],[0,f.d-1],[f.w-1,f.d-1]])put(o.x+dx,o.y,o.z+dz,'cobblestone_wall',{up:'true',north:'none',south:'none',east:'none',west:'none',waterlogged:'false'});break;
        case 'dais':fill('polished_andesite');break;
        case 'bed':fill('white_wool');put(mid.x,o.y,mid.z,'red_bed',{facing,part:'head',occupied:'false'});break;
        case 'seat':case 'bench':fill('spruce_stairs',{facing,half:'bottom',shape:'straight',waterlogged:'false'});break;
        case 'table':fill('spruce_slab',{type:'top',waterlogged:'false'});break;
      }
    }
    // And a light in every room, hung where there is a ceiling to hang it from. A castle you cannot see
    // inside is a castle full of monsters by the second night.
    if(room.kind==='court'||room.floorY<0&&room.kind==='storage')continue;
    for(let x=room.bounds.x+2;x<room.bounds.x+room.bounds.w-1;x+=6)for(let z=room.bounds.z+2;z<room.bounds.z+room.bounds.d-1;z+=6){
      const lx=x-b.x,lz=z-b.z,ly=Math.min(room.ceilingY,room.floorY+5)-low;
      if(lx<0||lz<0||lx>=size.x||lz>=size.z||ly<1||ly>=size.y)continue;
      if(cells[at(lx,ly,lz)]||!cells[at(lx,ly+1,lz)])continue;
      put(lx,ly,lz,'lantern',{hanging:'true',waterlogged:'false'});lights++;
    }
  }
  void palette;
  return lights;
}
const seedy=(seed:number,f:Furniture)=>noise(seed+19,f.x,f.y,f.z)<0.4;
