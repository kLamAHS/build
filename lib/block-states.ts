/** Block states are shared by the mesh compiler and the schematic writer. No render-only ornament. */
export type Facing = 'north' | 'south' | 'east' | 'west';
export type Half = 'bottom' | 'top';
export type StateBox = readonly [number, number, number, number, number, number];
export type BlockState = {
  key: string;
  name: string;
  properties: Readonly<Record<string, string>>;
  color: string;
  /** Quarter-block occupancy, x + 4 * (z + 4 * y). Undefined means a full cube. */
  occupancy?: Uint8Array;
};

// All states used by this compiler exist in Java 1.16.5 (the writer's existing data version).
export const BASE_BLOCKS: Record<number, string> = {
  1: 'minecraft:stone_bricks', 2: 'minecraft:oak_planks', 3: 'minecraft:gray_terracotta',
  4: 'minecraft:glass', 5: 'minecraft:white_terracotta', 6: 'minecraft:cobblestone',
  7: 'minecraft:grass_block', 8: 'minecraft:bricks', 9: 'minecraft:oak_log',
};
const COLORS: Record<string, string> = {
  stone_bricks: '#96988e', cracked_stone_bricks: '#85897f', mossy_stone_bricks: '#828c76',
  stone: '#898d87', andesite: '#a4a59a', polished_andesite: '#b3b5a9', cobblestone: '#7d847a',
  mossy_cobblestone: '#77836c', granite: '#9a6b58', diorite: '#bdbdbe', gravel: '#8a8283',
  stone_brick_stairs: '#a0a396', stone_brick_slab: '#aeb1a2', stone_brick_wall: '#949b8e',
  polished_blackstone_bricks: '#424c52', polished_blackstone_brick_stairs: '#424c52',
  polished_blackstone_brick_slab: '#4c575d', polished_blackstone_brick_wall: '#454e53',
  spruce_planks: '#856342', spruce_stairs: '#795837', spruce_slab: '#96734c',
  stripped_spruce_log: '#715538', spruce_fence: '#695033', oak_planks: '#a18454',
  dark_oak_planks: '#4a3319', smooth_stone_slab: '#a5a5a5', cobblestone_wall: '#7d847a',
  glass: '#aacace', gray_stained_glass_pane: '#8d9fa3', bricks: '#856755', brick_slab: '#96725c', brick_wall: '#89664f',
  // Fittings. A room is a place you can use, and the colour is what tells you so at a glance.
  campfire: '#c8762c', lantern: '#f0c164', furnace: '#7b7b7b', blast_furnace: '#6d6d6d', anvil: '#4a4a4c',
  brewing_stand: '#a08a63', lectern: '#8a6c3f', enchanting_table: '#912f2f', bookshelf: '#79613b',
  barrel: '#836440', crafting_table: '#7b5a35', cartography_table: '#6d5539', white_wool: '#e9ecec',
  red_bed: '#a02b2b', water: '#3f5fc0', grass_block: '#789263', coarse_dirt: '#8a5f3e',
};
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
function occupied(boxes: readonly StateBox[]): Uint8Array {
  const cells = new Uint8Array(64);
  for (const [x, y, z, w, h, d] of boxes) {
    for (let yy = y * 4; yy < (y + h) * 4; yy++)
      for (let zz = z * 4; zz < (z + d) * 4; zz++)
        for (let xx = x * 4; xx < (x + w) * 4; xx++) cells[xx + 4 * (zz + 4 * yy)] = 1;
  }
  return cells;
}
function define(name: string, properties: Record<string, string> = {}, boxes?: readonly StateBox[]): BlockState {
  const key = stateKey(name, properties);
  let value = cache.get(key);
  if (!value) {
    value = { key, name: key.split('[')[0], properties: Object.freeze({ ...properties }),
      color: COLORS[name.replace('minecraft:', '')] ?? '#96988e',
      ...(boxes ? { occupancy: occupied(boxes) } : {}) };
    cache.set(key, value);
  }
  return value;
}
export const solid = (name: string) => define(name);
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
/** Any other vanilla state, given outright: the fittings a furnished room is actually made of. */
export const blockState = (name: string, properties: Record<string, string> = {}) => define(name, properties);
/**
 * A window pane rather than a cube of glass, with its connections stated so the export does not depend on
 * what the client decides to join to. Quarter-block occupancy cannot describe a pane two sixteenths thick,
 * so the mesh shows the thinnest post and arms it can: a cross or a line, which is what a pane reads as.
 */
export function pane(name: string, sides: Record<Facing, boolean>): BlockState {
  const boxes: StateBox[] = [[.25, 0, .25, .5, 1, .5]];
  if (sides.north) boxes.push([.25, 0, 0, .5, 1, .25]);
  if (sides.south) boxes.push([.25, 0, .75, .5, 1, .25]);
  if (sides.west) boxes.push([0, 0, .25, .25, 1, .5]);
  if (sides.east) boxes.push([.75, 0, .25, .25, 1, .5]);
  return define(name, { north: String(sides.north), south: String(sides.south), east: String(sides.east),
    west: String(sides.west), waterlogged: 'false' }, boxes);
}
/** Isolated masonry finial. Connections are explicit so export does not depend on client defaults. */
export function wallPost(name = 'stone_brick_wall'): BlockState {
  return define(name, { east: 'none', north: 'none', south: 'none', west: 'none', up: 'true', waterlogged: 'false' },
    [[.25, 0, .25, .5, 1, .5]]);
}
export const opposite = (f: Facing): Facing => ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[f];
