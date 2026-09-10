import { componentFootprint, insidePolygon, type BlockBox, type BuildingComponent, type Plan, type Point, type Rect } from './model.ts';
import { SparseBlocks, voxelize } from './voxels.ts';
import { blockState, pane, solid, slab, stair, timber, wallPost, opposite, type BlockState, type Facing } from './block-states.ts';

export const DETAIL_VERSION = 2;
/**
 * The stone a build of each kind is made of, commonest first. Two hand-built castles read block by block use
 * between twelve and thirty-five stones, and not as salt and pepper: a neighbouring block is the same one
 * about half the time, where random mixing would be a twelfth. So the stone comes from a patchy field of
 * these, three blocks across and two courses tall. Every name here exists in Java 1.16.5, which is the
 * version the schematic writer claims: a block the client does not know pastes as air.
 */
const STONES: Record<Plan['settings']['kind'], string[]> = {
  castle: ['stone_bricks', 'cracked_stone_bricks', 'andesite', 'stone', 'cobblestone', 'polished_andesite', 'mossy_stone_bricks', 'gravel'],
  manor: ['stone_bricks', 'andesite', 'polished_andesite', 'stone', 'cracked_stone_bricks', 'diorite', 'cobblestone', 'granite'],
  house: ['cobblestone', 'stone', 'andesite', 'mossy_cobblestone', 'stone_bricks', 'granite', 'diorite', 'gravel'],
};
const directions: { dx: number; dz: number; facing: Facing }[] = [
  { dx: 0, dz: -1, facing: 'north' }, { dx: 0, dz: 1, facing: 'south' },
  { dx: -1, dz: 0, facing: 'west' }, { dx: 1, dz: 0, facing: 'east' },
];
const cellKey = (x: number, z: number) => `${x},${z}`;
const within = (r: Rect, x: number, z: number, inset = 0) => x >= r.x + inset && x <= r.x + r.w - inset && z >= r.z + inset && z <= r.z + r.d - inset;
function hash(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
function noise(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** A perimeter in its actual polygon order: chamfered towers must not grow a square fence in mid-air. */
function perimeter(polygon: Point[]): Point[] {
  const result: Point[] = [], seen = new Set<string>();
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
    for (let j = 0; j < steps; j++) {
      const x = Math.round(a.x + (b.x - a.x) * j / steps), z = Math.round(a.z + (b.z - a.z) * j / steps), k = cellKey(x, z);
      if (!seen.has(k)) { seen.add(k); result.push({ x, z }); }
    }
  }
  return result;
}
/** Identify only the old primary roof, not oriels, louvers, interior ceilings or chimney masses. */
function primaryRoof(box: BlockBox, c: BuildingComponent): boolean {
  if (box.kind !== 'roof' || box.componentId !== c.id) return false;
  const b = c.bounds;
  if (c.roof === 'battlement') return box.material === 1 && box.y > c.topY && box.y <= c.topY + 3;
  if (box.material !== 3 || box.h !== 1) return false;
  if (c.roof === 'pyramid') {
    const i = box.y - c.topY, left = b.x - 1 + i, right = b.x + b.w + 1 - i, front = b.z - 1 + i, back = b.z + b.d + 1 - i;
    return i >= 0 && box.w === 1 && box.d === 1 && box.x >= left && box.x <= right && box.z >= front && box.z <= back
      && (box.x === left || box.x === right || box.z === front || box.z === back);
  }
  const alongX = c.roof === 'gable-x', i = alongX ? box.z - b.z : box.x - b.x, span = alongX ? b.d : b.w;
  return i >= -1 && i <= span + 1 && box.y === c.topY + Math.min(i + 1, span + 1 - i)
    && (alongX ? box.x === b.x - 1 && box.w === b.w + 3 && box.d === 1 : box.z === b.z - 1 && box.d === b.d + 3 && box.w === 1);
}

/**
 * Architectural compilation, not a second floor-plan generator.
 * Rooms, openings, stairs, reservations, signature and source boxes are never mutated.
 * Both the viewer worker and whole-building export call this function.
 */
export function buildDetailedModel(plan: Plan): { grid: SparseBlocks; structure: SparseBlocks; minY: number; maxY: number } {
  const structure = voxelize(plan), grid = new SparseBlocks(plan.bounds);
  for (const [k, chunk] of structure.chunks) grid.chunks.set(k, chunk.slice());
  const castle = plan.settings.kind === 'castle', seed = hash(plan.settings.seed);
  const components = new Map(plan.components.map(c => [c.id, c]));
  const shell = (c: BuildingComponent) => (castle ? 3 : 2) + (c.phase === 0 ? 1 : 0);
  const path = new Set<string>();
  for (const route of plan.routes) for (let i = 0; i < route.points.length; i++) {
    const a = route.points[i], b = route.points[Math.min(i + 1, route.points.length - 1)];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
    for (let j = 0; j <= steps; j++) {
      const x = Math.round(a.x + (b.x - a.x) * (steps ? j / steps : 0)), z = Math.round(a.z + (b.z - a.z) * (steps ? j / steps : 0));
      for (let dx = -1; dx <= route.width; dx++) for (let dz = -1; dz <= route.width; dz++) path.add(cellKey(x + dx, z + dz));
    }
  }
  // Spatially index reservations and rooms; testing every room for every roof tile scales badly at 512 blocks.
  type Guard = { bounds: Rect; test: (x: number, y: number, z: number) => boolean };
  const guards = new Map<string, Guard[]>();
  const guard = (g: Guard) => {
    for (let z = Math.floor(g.bounds.z / 16); z <= Math.floor((g.bounds.z + g.bounds.d) / 16); z++)
      for (let x = Math.floor(g.bounds.x / 16); x <= Math.floor((g.bounds.x + g.bounds.w) / 16); x++) {
        const k = cellKey(x, z), list = guards.get(k) ?? []; list.push(g); guards.set(k, list);
      }
  };
  for (const r of plan.rooms) if (r.kind !== 'court') guard({ bounds: r.bounds, test: (x, y, z) =>
    y > r.floorY && y < r.ceilingY && within(r.bounds, x, z, 1) && insidePolygon(x + .5, z + .5, r.polygon)
    && !r.holes.some(h => within(h, x, z)) });
  for (const r of plan.reservations) guard({ bounds: r.bounds, test: (x, y, z) =>
    (r.kind === 'court' ? within(r.bounds, x, z, 3) : y >= r.fromY && y < r.toY && within(r.bounds, x, z, 1))
    && insidePolygon(x + .5, z + .5, r.polygon) });
  // Explicit cuts include hearth louvers and irregular stair/door clearances not expressible as room bounds.
  for (const b of plan.blocks) if (b.kind === 'air' && !b.material) guard({
    bounds: { x: b.x, z: b.z, w: b.w - 1, d: b.d - 1 },
    test: (x, y, z) => y >= b.y && y < b.y + b.h && x >= b.x && x < b.x + b.w
      && z >= b.z && z < b.z + b.d && !structure.get(x, y, z),
  });
  // Kept as their own list as well: a lantern hung in a doorway is worse than a room left dark.
  const doorways: Guard[] = [];
  for (const o of plan.openings) {
    const depth = 8, alongX = o.axis === 'z';
    const bounds = { x: o.x - (alongX ? 0 : depth), z: o.z - (alongX ? depth : 0), w: alongX ? o.width - 1 : depth * 2, d: alongX ? depth * 2 : o.width - 1 };
    const g: Guard = { bounds, test: (x, y, z) => y >= o.y && y < o.y + o.height && within(bounds, x, z) };
    doorways.push(g); guard(g);
  }
  for (const court of plan.courts) {
    const bounds = { x: court.gate.x - 3, z: court.gatehouse.z - 5, w: 6, d: court.gatehouse.d + 10 };
    guard({ bounds, test: (x, y, z) => y >= 0 && y <= 5 && within(bounds, x, z) });
  }
  const protectedAt = (x: number, y: number, z: number) =>
    (y >= 0 && y <= 4 && path.has(cellKey(x, z))) || (guards.get(cellKey(Math.floor(x / 16), Math.floor(z / 16))) ?? []).some(g => g.test(x, y, z));
  const put = (x: number, y: number, z: number, state: BlockState, material: number, kind: BlockBox['kind'], c: BuildingComponent, replaceRoof = false) => {
    if (protectedAt(x, y, z)) return false;
    const old = grid.kindAt(x, y, z);
    if (old !== 'air' && !(replaceRoof && old === 'roof')) return false;
    grid.apply({ x, y, z, w: 1, h: 1, d: 1, material, kind, componentId: c.id, ownerFloor: Math.floor(c.topY / 6) - 1 });
    grid.setState(x, y, z, state); return true;
  };
  // Clear only cells that are STILL roof after the structural replay. An adjoining room always wins.
  for (const b of plan.blocks) {
    const c = components.get(b.componentId); if (!c || !primaryRoof(b, c)) continue;
    for (let y = b.y; y < b.y + b.h; y++) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++)
      if (grid.kindAt(x, y, z) === 'roof' && grid.material(x, y, z) === b.material)
        grid.apply({ x, y, z, w: 1, h: 1, d: 1, material: 0, kind: 'air', componentId: c.id });
  }
  const roofTile = (facing: Facing) => stair('polished_blackstone_brick_stairs', facing);
  const stone = solid('stone_bricks'), dark = solid('polished_blackstone_bricks');
  // Lower roofs first; the taller range owns an intersection. Nothing replaces a structural wall or a room.
  for (const c of [...plan.components].sort((a, b) => a.topY - b.topY || a.id.localeCompare(b.id))) {
    if (c.kind === 'court') continue;
    const b = c.bounds, overhang = c.polygon.length > 4 ? 2 : shell(c) + 1;
    if (c.roof === 'battlement') {
      const inset = c.polygon.length > 4 ? 0 : shell(c) - 1;
      const crown = c.polygon.length > 4 ? c.polygon : [
        { x: b.x - inset, z: b.z - inset }, { x: b.x + b.w + inset, z: b.z - inset },
        { x: b.x + b.w + inset, z: b.z + b.d + inset }, { x: b.x - inset, z: b.z + b.d + inset },
      ];
      const ring = perimeter(crown), ringCells = new Set(ring.map(p => cellKey(p.x, p.z))), count = Math.max(1, Math.round(ring.length / 4));
      for (let z = b.z - inset; z <= b.z + b.d + inset; z++) for (let x = b.x - inset; x <= b.x + b.w + inset; x++)
        if (insidePolygon(x + .5, z + .5, crown) || ringCells.has(cellKey(x, z))) put(x, c.topY, z, stone, 1, 'roof', c, true);
      ring.forEach(({ x, z }, i) => {
        put(x, c.topY + 1, z, stone, 1, 'roof', c, true);
        const merlon = Math.floor(i * count * 4 / ring.length) % 4 < 2;
        if (merlon) {
          put(x, c.topY + 2, z, stone, 1, 'roof', c, true);
          put(x, c.topY + 3, z, stone, 1, 'roof', c, true);
          put(x, c.topY + 4, z, slab('stone_brick_slab'), 1, 'roof', c);
        } else put(x, c.topY + 2, z, slab('stone_brick_slab'), 1, 'roof', c);
        for (const { dx, dz, facing } of directions) {
          if (insidePolygon(x + dx + .5, z + dz + .5, crown)) continue;
          // A projecting crown has a continuous ledge and individually articulated corbels beneath it.
          put(x + dx, c.topY, z + dz, slab('stone_brick_slab', 'top'), 1, 'roof', c);
          if (i % 3 === 0) put(x + dx, c.topY - 1, z + dz, stair('stone_brick_stairs', opposite(facing), 'top'), 1, 'support', c);
        }
      });
      continue;
    }
    if (c.roof === 'pyramid') {
      const left = b.x - overhang, right = b.x + b.w + overhang, front = b.z - overhang, back = b.z + b.d + overhang;
      const chamfer = c.polygon.length > 4 ? Math.max(2, Math.floor(Math.min(b.w, b.d) / 5)) : 0;
      let apex = c.topY;
      for (let z = front; z <= back; z++) for (let x = left; x <= right; x++) {
        const dx = Math.min(x - left, right - x), dz = Math.min(z - front, back - z);
        const distance = chamfer ? Math.min(dx, dz, Math.floor((dx + dz - chamfer) / 2)) : Math.min(dx, dz);
        if (distance < 0) continue;
        const rise = distance + (c.kind === 'tower' ? Math.max(0, distance - 2) : 0);
        const y = c.topY + rise, facing: Facing = dx < dz ? (x < (left + right) / 2 ? 'east' : 'west') : (z < (front + back) / 2 ? 'south' : 'north');
        put(x, y, z, dx === dz ? dark : roofTile(facing), 3, 'roof', c, true);
        if (c.kind === 'tower' && distance > 2) put(x, y - 1, z, dark, 3, 'roof', c, true);
        if (rise === 0) put(x, y - 1, z, slab(castle ? 'stone_brick_slab' : 'spruce_slab', 'top'), castle ? 1 : 2, 'roof', c);
        apex = Math.max(apex, y);
      }
      const x = Math.floor((left + right) / 2), z = Math.floor((front + back) / 2);
      // A finial is capped on a solid, supported ridge block, never suspended above a half slab.
      if (grid.kindAt(x, apex, z) === 'roof') {
        put(x, apex + 1, z, dark, 3, 'roof', c);
        put(x, apex + 2, z, wallPost('polished_blackstone_brick_wall'), 3, 'roof', c);
        put(x, apex + 3, z, slab('polished_blackstone_brick_slab'), 3, 'roof', c);
      }
      continue;
    }
    const alongX = c.roof === 'gable-x';
    const cross0 = (alongX ? b.z : b.x) - overhang, cross1 = (alongX ? b.z + b.d : b.x + b.w) + overhang;
    const along0 = (alongX ? b.x : b.z) - overhang, along1 = (alongX ? b.x + b.w : b.z + b.d) + overhang;
    const ridge = Math.floor((cross0 + cross1) / 2), roofY = (across: number) => c.topY + Math.min(across - cross0, cross1 - across);
    const at = (along: number, across: number) => alongX ? { x: along, z: across } : { x: across, z: along };
    for (let across = cross0; across <= cross1; across++) for (let along = along0; along <= along1; along++) {
      const { x, z } = at(along, across), y = roofY(across);
      const facing: Facing = alongX ? (across <= ridge ? 'south' : 'north') : (across <= ridge ? 'east' : 'west');
      const verge = along === along0 || along === along1;
      const tile = verge ? stair(castle ? 'stone_brick_stairs' : 'spruce_stairs', facing) : roofTile(facing);
      put(x, y, z, tile, verge ? (castle ? 1 : 2) : 3, 'roof', c, true);
      if (across === cross0 || across === cross1)
        put(x, y - 1, z, slab(castle ? 'stone_brick_slab' : 'spruce_slab', 'top'), castle ? 1 : 2, 'roof', c);
      // Gable masonry/boarding is carried by the range's own end wall, not by the outer decorative verge.
      if ((along === (alongX ? b.x : b.z) || along === (alongX ? b.x + b.w : b.z + b.d))
          && across >= (alongX ? b.z : b.x) && across <= (alongX ? b.z + b.d : b.x + b.w))
        for (let yy = c.topY; yy < y; yy++) put(x, yy, z, castle ? stone : solid('spruce_planks'), castle ? 1 : 2, 'roof', c, true);
    }
    for (let along = along0; along <= along1; along++) {
      const { x, z } = at(along, ridge), y = roofY(ridge);
      put(x, y + 1, z, slab('polished_blackstone_brick_slab'), 3, 'roof', c);
      if (along === along0 || along === along1) {
        put(x, y + 1, z, dark, 3, 'roof', c, true);
        put(x, y + 2, z, wallPost('polished_blackstone_brick_wall'), 3, 'roof', c);
      }
    }
  }

  // Texture belongs to masonry courses and coherent patches, not independent confetti on every cube.
  const stones = STONES[plan.settings.kind].map(solid), damp = solid(castle ? 'mossy_stone_bricks' : 'mossy_cobblestone');
  const boards = [solid('dark_oak_planks'), solid('spruce_planks')], flags = [solid('andesite'), solid('cobblestone')];
  grid.forEach((x, y, z, value) => {
    const kind = grid.kindAt(x, y, z), material = value & 15;
    if (grid.stateAt(x, y, z)) return;
    if (material === 4) {
      // A window is a pane. A wall of glass blocks is a greenhouse, and it hides the surround it sits in.
      const sides = {} as Record<Facing, boolean>;
      for (const { dx, dz, facing } of directions) sides[facing] = !!grid.get(x + dx, y, z + dz);
      grid.setState(x, y, z, pane('gray_stained_glass_pane', sides));
    } else if (kind === 'floor') {
      // Only the course you walk on is worth naming, and it is boards upstairs and flags below: you do not
      // lay a stone floor on joists.
      if (grid.get(x, y + 1, z)) return;
      const n = noise(x, y, z, seed ^ 0x51ed270b);
      grid.setState(x, y, z, y > 0 ? boards[n < .18 ? 1 : 0] : flags[n < .35 ? 1 : 0]);
    } else if (material === 1 && (kind === 'wall' || kind === 'support' || kind === 'roof')) {
      if (directions.every(({ dx, dz }) => grid.get(x + dx, y, z + dz))) return;
      // Squaring the sample keeps the commonest stone commonest: a wall of eight stones in even shares is
      // not masonry either.
      const n = noise(Math.floor(x / 3), Math.floor(y / 2), Math.floor(z / 3), seed);
      grid.setState(x, y, z, y <= 1 && n > .82 ? damp : stones[Math.floor(n * n * stones.length)]);
    } else if (material === 2 && kind === 'wall') grid.setState(x, y, z, timber(y % 6 === 0 ? 'x' : 'y'));
  });

  for (const c of plan.components) {
    if (c.kind === 'court' || c.polygon.length > 4) continue;
    // Read the actual outer shell; the structural generator thickens it outward, and later storeys may step back.
    for (let y = Math.max(0, c.baseY); y < c.topY; y++) {
      const f = c.kind === 'tower' || c.kind === 'hall' ? c.bounds : componentFootprint(c, Math.floor(y / 6) * 6, plan.family);
      for (const dir of directions) {
        const alongX = dir.dz !== 0, start = alongX ? f.x : f.z, end = alongX ? f.x + f.w : f.z + f.d;
        const fixed = dir.dz < 0 ? f.z : dir.dz > 0 ? f.z + f.d : dir.dx < 0 ? f.x : f.x + f.w;
        for (let along = start; along <= end; along++) {
          let edge: Point | undefined;
          for (let step = shell(c) + 1; step >= 0; step--) {
            const x = alongX ? along : fixed + dir.dx * step, z = alongX ? fixed + dir.dz * step : along;
            if (structure.kindAt(x, y, z) === 'wall' && !structure.get(x + dir.dx, y, z + dir.dz)) { edge = { x, z }; break; }
          }
          if (!edge) continue;
          const { x, z } = edge, material = grid.material(x, y, z);
          const corner = along - start < 2 || end - along < 2;
          if (material === 1 && corner) grid.setState(x, y, z, solid(y % 2 ? 'polished_andesite' : 'stone_bricks'));
          // String courses sit below floor lines; protected openings interrupt them instead of being bricked up.
          if (y > 0 && y % 6 === 5) put(x + dir.dx, y, z + dir.dz,
            slab(castle || material === 1 ? 'stone_brick_slab' : 'spruce_slab', 'top'), castle || material === 1 ? 1 : 2, 'support', c);
          // A plinth: the lowest course carried one block proud and chamfered back above, so the mass meets
          // the ground on a base rather than on a cut line. A doorway's own clearance interrupts it.
          if (y === 0 && material === 1) {
            put(x + dir.dx, 0, z + dir.dz, solid(castle ? 'cobblestone' : 'stone_bricks'), 1, 'support', c);
            put(x + dir.dx, 1, z + dir.dz, stair('stone_brick_stairs', opposite(dir.facing)), 1, 'support', c);
          }
          // Hall/chapel buttresses are structural rhythms, not one enormous featureless extruded facade.
          if (castle && (c.kind === 'hall' || c.kind === 'chapel') && y < c.topY - 2 && along > start + 2 && along < end - 2 && (along - start) % 8 === 0) {
            const px = x + dir.dx, pz = z + dir.dz;
            if (y === 0) put(px, -1, pz, stone, 1, 'support', c);
            // Do not resume a pier above a doorway, window or protected path and leave it hanging there.
            if (grid.get(px, y - 1, pz)) put(px, y, pz,
              y === c.topY - 3 ? stair('stone_brick_stairs', opposite(dir.facing)) : stone, 1, 'support', c);
          }
        }
      }
    }
  }
  // Recessed lights get sills, jamb dressing and a projecting hood. The opening itself is never narrowed.
  for (const o of plan.openings) {
    if (o.type !== 'window') continue;
    const room = plan.rooms.find(r => r.id === o.roomIds[0]), c = room && components.get(room.componentId); if (!room || !c) continue;
    const alongX = o.axis === 'z', outward = alongX ? (room.bounds.z + room.bounds.d / 2 > o.z ? -1 : 1) : (room.bounds.x + room.bounds.w / 2 > o.x ? -1 : 1);
    const dx = alongX ? 0 : outward, dz = alongX ? outward : 0;
    const facing: Facing = dx < 0 ? 'west' : dx > 0 ? 'east' : dz < 0 ? 'north' : 'south';
    let depth = 0;
    while (depth < shell(c) + 1 && structure.kindAt(o.x + dx * (depth + 1), o.y, o.z + dz * (depth + 1)) === 'glass') depth++;
    const x = o.x + dx * (depth + 1), z = o.z + dz * (depth + 1);
    for (let w = -1; w <= o.width; w++) {
      const xx = x + (alongX ? w : 0), zz = z + (alongX ? 0 : w);
      put(xx, o.y - 1, zz, slab('stone_brick_slab', 'top'), 1, 'support', c);
      put(xx, o.y + o.height, zz, stair('stone_brick_stairs', opposite(facing), 'top'), 1, 'support', c);
      if (w === -1 || w === o.width) for (let y = o.y; y < o.y + o.height; y++)
        if (grid.kindAt(xx - dx, y, zz - dz) === 'wall') grid.setState(xx - dx, y, zz - dz, solid('polished_andesite'));
    }
  }
  // Existing stairs keep their direction, rise, landing and headroom; only the full-cube tread becomes a stair.
  for (const st of plan.stairs) for (let j = 0; j < 6; j++) for (let w = 0; w < 2; w++) {
    const x = st.bounds.x + 3 + w, y = st.fromY + j + 1, z = st.bounds.z + 3 + j;
    if (grid.kindAt(x, y, z) === 'stair') grid.setState(x, y, z, stair('spruce_stairs', 'south'));
  }
  for (const chimney of plan.chimneys) {
    const c = components.get(chimney.componentId); if (!c) continue;
    const b = chimney.bounds, y = chimney.toY;
    for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++)
      put(x, y - 1, z, slab('brick_slab', 'top'), 8, 'chimney', c);
    for (let z = b.z; z < b.z + b.d; z += 2) for (let x = b.x; x < b.x + b.w; x += 2)
      put(x, y, z, wallPost('brick_wall'), 8, 'chimney', c);
  }
  furnish(plan, grid, (x, y, z) => doorways.some(g => g.test(x, y, z)));
  const extent = grid.extent(plan.minY, plan.maxY); grid.bounds = extent.bounds;
  return { grid, structure, minY: extent.minY, maxY: extent.maxY };
}

/**
 * What a fitting is once it is blocks and not a rectangle on a drawing, and a light in every room that has a
 * ceiling to hang one from. This is the difference between a labelled plan and a place: a kitchen with no
 * furnace in it is a room called Kitchen, and a keep with no light in it is a mob farm by the second night.
 *
 * Fittings only name cells the plan already filled, so nothing here can close a route or a doorway that the
 * generator kept clear. Lanterns are the one thing added to empty air, and they keep out of the doorways.
 */
function furnish(plan: Plan, grid: SparseBlocks, doorway: (x: number, y: number, z: number) => boolean) {
  const dress = (x: number, y: number, z: number, state: BlockState) => { if (grid.get(x, y, z)) grid.setState(x, y, z, state); };
  for (const room of plan.rooms) {
    const centre = { x: room.bounds.x + room.bounds.w / 2, z: room.bounds.z + room.bounds.d / 2 };
    for (const f of room.furniture) {
      // A dais is the floor it raises, so it is built a course below the fittings that stand on it.
      const y0 = f.type === 'dais' ? f.y - 1 : f.y, mid = { x: f.x + Math.floor(f.w / 2), z: f.z + Math.floor(f.d / 2) };
      const facing: Facing = Math.abs(f.x - centre.x) > Math.abs(f.z - centre.z)
        ? (f.x < centre.x ? 'east' : 'west') : (f.z < centre.z ? 'south' : 'north');
      const fill = (state: BlockState) => {
        for (let y = y0; y < y0 + f.h; y++) for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) dress(x, y, z, state);
      };
      switch (f.type) {
        // A fire is a fire: brick, and something burning in it, which is where half the light comes from.
        case 'hearth': fill(solid('bricks')); dress(mid.x, y0, mid.z, blockState('campfire', { lit: 'true', facing, signal_fire: 'false', waterlogged: 'false' })); break;
        case 'oven': fill(solid('bricks')); dress(mid.x, y0, mid.z, blockState('furnace', { facing, lit: 'true' })); break;
        case 'forge': fill(solid('polished_blackstone_bricks')); dress(f.x, y0, f.z, blockState('blast_furnace', { facing, lit: 'true' }));
          dress(mid.x, y0, mid.z, blockState('anvil', { facing })); break;
        case 'still': fill(solid('polished_andesite')); dress(mid.x, y0, mid.z, blockState('brewing_stand', { has_bottle_0: 'true', has_bottle_1: 'false', has_bottle_2: 'true' })); break;
        // The essentials a player asked for are read off the room they were programmed into.
        case 'lectern': fill(solid('bookshelf')); dress(mid.x, y0, mid.z, room.name.startsWith('Enchant')
          ? blockState('enchanting_table') : blockState('lectern', { facing, has_book: 'true', powered: 'false' })); break;
        case 'crate': fill(blockState('barrel', { facing: 'up', open: 'false' })); break;
        case 'shelf': fill(solid('bookshelf')); break;
        case 'desk': fill(solid('crafting_table')); dress(f.x, y0, f.z, solid('cartography_table')); break;
        case 'altar': fill(blockState('smooth_stone_slab', { type: 'double', waterlogged: 'false' }));
          dress(mid.x, y0, mid.z, blockState('lantern', { hanging: 'false', waterlogged: 'false' })); break;
        case 'well': fill(blockState('water', { level: '0' }));
          for (const [dx, dz] of [[0, 0], [f.w - 1, 0], [0, f.d - 1], [f.w - 1, f.d - 1]])
            dress(f.x + dx, y0, f.z + dz, wallPost('cobblestone_wall')); break;
        case 'dais': fill(solid('polished_andesite')); break;
        // A bed is two blocks or it is a block that looks like half a bed. The head goes to the wall.
        case 'bed': {
          fill(solid('white_wool'));
          const head: Facing = opposite(facing), along = head === 'north' || head === 'south';
          const step = head === 'north' || head === 'west' ? -1 : 1;
          const foot = { x: mid.x - (along ? 0 : step), z: mid.z - (along ? step : 0) };
          if (grid.get(foot.x, y0, foot.z)) {
            dress(foot.x, y0, foot.z, blockState('red_bed', { facing: head, part: 'foot', occupied: 'false' }));
            dress(mid.x, y0, mid.z, blockState('red_bed', { facing: head, part: 'head', occupied: 'false' }));
          }
          break;
        }
        case 'seat': case 'bench': fill(stair('spruce_stairs', opposite(facing))); break;
        case 'table': fill(slab('spruce_slab', 'top')); break;
      }
    }
    if (room.kind === 'court' || (room.floorY < 0 && room.kind === 'storage')) continue;
    for (let x = room.bounds.x + 2; x < room.bounds.x + room.bounds.w - 1; x += 6)
      for (let z = room.bounds.z + 2; z < room.bounds.z + room.bounds.d - 1; z += 6) {
        const y = Math.min(room.ceilingY, room.floorY + 5);
        // A lantern hangs from a ceiling, in the open, and never in the light of a doorway it would block.
        if (grid.get(x, y, z) || !grid.get(x, y + 1, z) || doorway(x, y, z)) continue;
        if (!insidePolygon(x + .5, z + .5, room.polygon) || room.holes.some(h => within(h, x, z))) continue;
        grid.apply({ x, y, z, w: 1, h: 1, d: 1, material: 9, kind: 'furniture', componentId: room.componentId });
        grid.setState(x, y, z, blockState('lantern', { hanging: 'true', waterlogged: 'false' }));
      }
  }
}
