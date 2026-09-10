/** Block states are shared by the mesh compiler and the schematic writer. No render-only ornament. */
export type Facing = 'north' | 'south' | 'east' | 'west';
export type Half = 'bottom' | 'top';
export type StateBox = readonly [number, number, number, number, number, number];
export type BlockState = {
  key: string;
  name: string;
  properties: Readonly<Record<string, string>>;
  color: string;
  emissive?: string;
  resolution?: number;
  /** Occupancy at `resolution` subdivisions per axis. Undefined means a full cube. */
  occupancy?: Uint8Array;
  /** The exact boxes the occupancy was rasterised from, for collision rather than for drawing. */
  boxes?: readonly StateBox[];
};

// All states used by this compiler exist in Java 1.16.5 (the writer's existing data version).
export const BASE_BLOCKS: Record<number, string> = {
  1: 'minecraft:stone_bricks', 2: 'minecraft:oak_planks', 3: 'minecraft:gray_terracotta',
  4: 'minecraft:glass', 5: 'minecraft:white_terracotta', 6: 'minecraft:cobblestone',
  7: 'minecraft:grass_block', 8: 'minecraft:bricks', 9: 'minecraft:oak_log',
};
const COLORS: Record<string, string> = {
  stone_bricks: '#a8aaa2', cracked_stone_bricks: '#999c94', mossy_stone_bricks: '#8d9786',
  stone: '#979c98', andesite: '#9da39e', polished_andesite: '#c0c1b5', cobblestone: '#878f88',
  stone_brick_stairs: '#b6b7a9', stone_brick_slab: '#c1c2b3', stone_brick_wall: '#aeb3aa',
  polished_blackstone_bricks: '#424c52', polished_blackstone_brick_stairs: '#424c52',
  polished_blackstone_brick_slab: '#4c575d', polished_blackstone_brick_wall: '#454e53',
  spruce_planks: '#856342', spruce_stairs: '#795837', spruce_slab: '#96734c',
  stripped_spruce_log: '#715538', spruce_fence: '#695033', oak_planks: '#a18454',
  glass: '#9bb4b4', gray_stained_glass: '#4a6668', gray_stained_glass_pane: '#4a6668', bricks: '#856755', brick_slab: '#96725c', brick_wall: '#89664f',
};
Object.assign(COLORS,{
  glowstone:'#d5b46e', chiseled_stone_bricks:'#b0b4a7', smooth_stone:'#c4c5ba', smooth_stone_slab:'#c4c5ba',
  smooth_sandstone:'#d2c4a2', smooth_sandstone_stairs:'#d2c4a2', smooth_sandstone_slab:'#d2c4a2',
  cut_sandstone:'#c9ba97', sandstone_wall:'#c9ba97', chiseled_sandstone:'#cfbf99',
  blackstone:'#353f43', polished_blackstone:'#404a4b', polished_blackstone_slab:'#475356',
  polished_blackstone_stairs:'#475356', gold_block:'#c5a45c', iron_bars:'#5b6764',
  red_wool:'#843c3b', white_wool:'#d3cdbe', black_wool:'#323737', red_carpet:'#843c3b',
  dark_oak_planks:'#665340', dark_oak_slab:'#6d5944', dark_oak_fence:'#624b36',
  oak_log:'#766042', oak_leaves:'#697b4a', spruce_leaves:'#547155', grass_block:'#6f835b',
  dirt:'#6b5945', coarse_dirt:'#756047', gravel:'#92978b', mossy_cobblestone:'#80907a',
  lantern:'#eac27b', chain:'#626766', water:'#628e95', bookshelf:'#826948',
  barrel:'#8d6c46', crafting_table:'#907650', furnace:'#737d7b', red_bed:'#843c3b',
  campfire:'#b88549', blast_furnace:'#6d7370', anvil:'#505855', brewing_stand:'#776c4b', enchanting_table:'#514958', lectern:'#98754b',
  dark_oak_stairs:'#6d5944', brick_stairs:'#96725c', spruce_trapdoor:'#7a5c39', flower_pot:'#8d5a42',
});
const cache = new Map<string, BlockState>();
export function stateKey(name: string, properties: Readonly<Record<string, string>> = {}): string {
  const id = name.includes(':') ? name : `minecraft:${name}`;
  const entries = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b));
  return id + (entries.length ? `[${entries.map(([k, v]) => `${k}=${v}`).join(',')}]` : '');
}
/** Parse a canonical state, keeping Properties separate from Name in NBT. */
export function parseBlockState(key: string): { name: string; properties: Record<string, string> } {
  const match = /^([a-z0-9_]+:[a-z0-9_/]+)(?:\[([a-z0-9_=,]+)\])?$/.exec(key);
  if (!match) throw new Error(`Invalid block state: ${key}`);
  const properties: Record<string, string> = {};
  if (match[2]) for (const pair of match[2].split(',')) {
    const parts = pair.split('=');
    if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] in properties)
      throw new Error(`Invalid block properties: ${key}`);
    properties[parts[0]] = parts[1];
  }
  return { name: match[1], properties };
}
function occupied(boxes: readonly StateBox[], resolution = 4): Uint8Array {
  const cells = new Uint8Array(resolution ** 3);
  for (const [x, y, z, w, h, d] of boxes) {
    for (let yy = y * resolution; yy < (y + h) * resolution; yy++)
      for (let zz = z * resolution; zz < (z + d) * resolution; zz++)
        for (let xx = x * resolution; xx < (x + w) * resolution; xx++) cells[xx + resolution * (zz + resolution * yy)] = 1;
  }
  return cells;
}
function define(name: string, properties: Record<string, string> = {}, boxes?: readonly StateBox[], resolution = 4, emissive?: string): BlockState {
  const key = stateKey(name, properties);
  let value = cache.get(key);
  if (!value) {
    value = { key, name: key.split('[')[0], properties: Object.freeze({ ...properties }),
      color: COLORS[name.replace('minecraft:', '')] ?? '#96988e',
      ...(boxes ? { occupancy: occupied(boxes, resolution), resolution, boxes } : {}), ...(emissive ? {emissive} : {}) };
    cache.set(key, value);
  }
  return value;
}
export const solid = (name: string) => define(name, {}, undefined, 4, name==='glowstone'?'#c5934c':undefined);
export const timber = (axis: 'x' | 'y' | 'z' = 'y') => define('stripped_spruce_log', { axis });
export function slab(name: string, half: Half = 'bottom'): BlockState {
  return define(name, { type: half, waterlogged: 'false' }, [[0, half === 'top' ? .5 : 0, 0, 1, .5, 1]]);
}
/** Facing is the HIGH half of a Minecraft stair, not the direction its low face points. */
export function stair(name: string, facing: Facing, half: Half = 'bottom'): BlockState {
  const upper: StateBox = facing === 'east' ? [.5, .5, 0, .5, .5, 1]
    : facing === 'west' ? [0, .5, 0, .5, .5, 1]
    : facing === 'south' ? [0, .5, .5, 1, .5, .5] : [0, .5, 0, 1, .5, .5];
  const boxes: StateBox[] = [[0, 0, 0, 1, .5, 1], upper];
  const transformed = half === 'top'
    ? boxes.map(([x, y, z, w, h, d]) => [x, 1 - y - h, z, w, h, d] as StateBox) : boxes;
  return define(name, { facing, half, shape: 'straight', waterlogged: 'false' }, transformed);
}
/** Isolated masonry finial. Connections are explicit so export does not depend on client defaults. */
export function wallPost(name = 'stone_brick_wall'): BlockState {
  return define(name, { east: 'none', north: 'none', south: 'none', west: 'none', up: 'true', waterlogged: 'false' },
    [[.25, 0, .25, .5, 1, .5]]);
}
export const opposite = (f: Facing): Facing => ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[f];

/** Thin glazing and metalwork use sixteenth-block occupancy; stairs keep the cheaper quarter grid. */
export function pane(name = 'gray_stained_glass_pane', axis: 'x'|'z' = 'x'): BlockState {
  return define(name,{north:axis==='z'?'true':'false',south:axis==='z'?'true':'false',east:axis==='x'?'true':'false',west:axis==='x'?'true':'false',waterlogged:'false'},
    axis==='x'?[[0,0,.4375,1,1,.125]]:[[.4375,0,0,.125,1,1]],16);
}
export function fence(name = 'spruce_fence', axis?: 'x'|'z'): BlockState {
  const props={north:axis==='z'?'true':'false',south:axis==='z'?'true':'false',east:axis==='x'?'true':'false',west:axis==='x'?'true':'false',waterlogged:'false'};
  const boxes:StateBox[]=[[.375,0,.375,.25,1,.25]];
  if(axis==='x')boxes.push([0,.375,.4375,1,.125,.125],[0,.75,.4375,1,.125,.125]);
  if(axis==='z')boxes.push([.4375,.375,0,.125,.125,1],[.4375,.75,0,.125,.125,1]);
  return define(name,props,boxes,16);
}
export function lantern(hanging = true):BlockState {
  return define('lantern',{hanging:String(hanging),waterlogged:'false'},
    hanging?[[.25,.25,.25,.5,.5,.5],[.375,.75,.375,.25,.25,.25]]:[[.25,0,.25,.5,.625,.5],[.375,.625,.375,.25,.25,.25]],8,'#e2a64d');
}
// A chain has no axis before 1.17, and this file's whole claim is that its states exist in the version the
// schematic declares. Vertical is the default anyway, which is the only way these are ever hung.
export function chain():BlockState {return define('chain',{waterlogged:'false'},[[.4375,0,.4375,.125,1,.125]],16);}
export const leaves=()=>define('oak_leaves',{distance:'1',persistent:'true'});
export const carpet=()=>define('red_carpet',{},[[0,0,0,1,.0625,1]],16);
export function bed(facing:Facing,part:'head'|'foot') {return define('red_bed',{facing,part,occupied:'false'},[[0,0,0,1,.5625,1]],16);}
export const barrel=()=>define('barrel',{facing:'up',open:'false'});

/**
 * A trapdoor: a table top when it is closed at the top of its cell, a headboard or a shutter when it is open
 * against one face. Three sixteenths thick either way, which is why it is not a slab.
 */
export function trapdoor(name='spruce_trapdoor',facing:Facing='north',half:Half='top',open=false):BlockState {
  const box:StateBox=open?(facing==='north'?[0,0,0,1,1,.1875]:facing==='south'?[0,0,.8125,1,1,.1875]
    :facing==='west'?[0,0,0,.1875,1,1]:[.8125,0,0,.1875,1,1]):half==='top'?[0,.8125,0,1,.1875,1]:[0,0,0,1,.1875,1];
  return define(name,{facing,half,open:String(open),powered:'false',waterlogged:'false'},[box],16);
}
export const flowerpot=()=>define('flower_pot',{},[[.3125,0,.3125,.375,.375,.375]],16);

/** Decorative/stateful fitting models. Texture-only details remain the game client's responsibility. */
export function campfire(facing:Facing):BlockState {
  return define('campfire',{facing,lit:'true',signal_fire:'false',waterlogged:'false'},[[.0625,0,.0625,.875,.4375,.875]],16,'#d9893c');
}
export const machine=(name:'furnace'|'blast_furnace',facing:Facing)=>define(name,{facing,lit:'false'});
export function brewingStand():BlockState {
  return define('brewing_stand',{has_bottle_0:'false',has_bottle_1:'false',has_bottle_2:'false'},[[.125,0,.125,.75,.125,.75],[.4375,.125,.4375,.125,.75,.125]],16);
}
export const enchantingTable=()=>define('enchanting_table',{},[[0,0,0,1,.75,1]],4);
export function lectern(facing:Facing):BlockState {
  return define('lectern',{facing,has_book:'false',powered:'false'},[[0,0,0,1,.125,1],[.25,.125,.25,.5,.625,.5],[0,.75,0,1,.25,1]],8);
}
export function anvil(facing:Facing):BlockState {
  const b:StateBox[]=[[.125,0,.125,.75,.25,.75],[.25,.25,.25,.5,.5,.5],[0,.75,.125,1,.25,.75]];
  return define('anvil',{facing},facing==='north'||facing==='south'?b:b.map(([x,y,z,w,h,d])=>[z,y,x,d,h,w] as StateBox),8);
}
