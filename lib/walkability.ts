import { insidePolygon, type Plan, type Room } from './model.ts';
import type { SparseBlocks } from './voxels.ts';
import type { BlockState, StateBox } from './block-states.ts';

export type Vec3 = { x: number; y: number; z: number };
export type WalkNode = Vec3 & { id: number };
export type WalkGraph = { nodes: WalkNode[]; columns: Map<string, number[]>; reached: Uint8Array; root: number; truncated: boolean };
export const WALKING = Object.freeze({ width: .6, height: 1.8, step: .6, lattice: .5 });
const EPS = 1e-5;
const CUBE: readonly StateBox[] = [[0, 0, 0, 1, 1, 1]];
const collisionCache = new Map<string, readonly StateBox[]>();

/** Physical contact, not exposed mesh faces. Fence/wall collision is taller than its rendered post. */
export function collisionBoxes(state?: BlockState): readonly StateBox[] {
  if (!state) return CUBE;
  const cached = collisionCache.get(state.key); if (cached) return cached;
  let boxes: readonly StateBox[];
  if (state.name.endsWith('_carpet')) boxes = [[0, 0, 0, 1, .0625, 1]];
  else if (/:(water|lava|air)$/.test(state.name)) boxes = [];
  else if (state.name.endsWith('_fence') || state.name.endsWith('_wall')) {
    // Conservatively extend each post/rail footprint to its collision height.
    boxes = (state.boxes ?? CUBE).map(([x, , z, w, , d]) => [x, 0, z, w, 1.5, d] as StateBox);
  } else if (state.boxes) boxes = state.boxes;
  else if (state.occupancy) {
    const n = state.resolution ?? 4, out: StateBox[] = [];
    for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
      let start = -1;
      for (let x = 0; x <= n; x++) {
        const filled = x < n && state.occupancy[x + n * (z + n * y)];
        if (filled && start < 0) start = x;
        if (!filled && start >= 0) { out.push([start / n, y / n, z / n, (x - start) / n, 1 / n, 1 / n]); start = -1; }
      }
    }
    boxes = out;
  } else boxes = CUBE;
  collisionCache.set(state.key, boxes); return boxes;
}
export function bodyClear(grid: SparseBlocks, x: number, feet: number, z: number, width = WALKING.width, height = WALKING.height): boolean {
  const r = width / 2, x0 = x - r + EPS, x1 = x + r - EPS, z0 = z - r + EPS, z1 = z + r - EPS;
  const y0 = feet + EPS, y1 = feet + height - EPS;
  for (let by = Math.floor(y0) - 1; by <= Math.floor(y1); by++) for (let bz = Math.floor(z0); bz <= Math.floor(z1); bz++) for (let bx = Math.floor(x0); bx <= Math.floor(x1); bx++) {
    if (!grid.get(bx, by, bz)) continue;
    for (const [ox, oy, oz, w, h, d] of collisionBoxes(grid.stateAt(bx, by, bz)))
      if (bx + ox < x1 && bx + ox + w > x0 && bz + oz < z1 && bz + oz + d > z0 && by + oy < y1 && by + oy + h > y0) return false;
  }
  return true;
}
function supported(grid: SparseBlocks, x: number, feet: number, z: number): boolean {
  // Require support under the centre, not an unrelated block at the edge of the player's bounding box.
  for (let by = Math.floor(feet + EPS) - 2; by <= Math.floor(feet); by++) for (let bz = Math.floor(z - EPS); bz <= Math.floor(z + EPS); bz++) for (let bx = Math.floor(x - EPS); bx <= Math.floor(x + EPS); bx++) {
    if (!grid.get(bx, by, bz)) continue;
    for (const [ox, oy, oz, w, h, d] of collisionBoxes(grid.stateAt(bx, by, bz)))
      if (Math.abs(by + oy + h - feet) < EPS && x >= bx + ox - EPS && x <= bx + ox + w + EPS && z >= bz + oz - EPS && z <= bz + oz + d + EPS) return true;
  }
  return false;
}
const columnKey = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
export function canWalk(grid: SparseBlocks, a: Vec3, b: Vec3): boolean {
  if (Math.abs(a.y - b.y) > WALKING.step + EPS) return false;
  // Lift, sweep horizontally, then settle. No jumping, flying, diagonal corner cutting or dropping down a shaft.
  const high = Math.max(a.y, b.y);
  for (const t of [0, .5, 1]) if (!bodyClear(grid, a.x + (b.x - a.x) * t, high, a.z + (b.z - a.z) * t)) return false;
  return true;
}
/**
 * Where a room's own floor plane is, by column. A three-block wall with a doorway through its outer face
 * leaves masonry standing at floor level a course further in, and you walk over that as readily as over a
 * board: a rule that only counts cells labelled `floor` reads it as a cliff and cuts the room off.
 */
function floorPlanes(plan: Plan): Map<string, number[]> {
  const planes = new Map<string, number[]>();
  for (const r of plan.rooms) for (let z = r.bounds.z; z <= r.bounds.z + r.bounds.d; z++) for (let x = r.bounds.x; x <= r.bounds.x + r.bounds.w; x++) {
    if (!insidePolygon(x + .5, z + .5, r.polygon)) continue;
    const k = `${x},${z}`, list = planes.get(k);
    if (!list) planes.set(k, [r.floorY]); else if (!list.includes(r.floorY)) list.push(r.floorY);
  }
  return planes;
}
function floorSupport(grid: SparseBlocks, plan: Plan, planes: Map<string, number[]>, x: number, y: number, z: number): boolean {
  const kind = grid.kindAt(x, y, z), state = grid.stateAt(x, y, z);
  if (/:(water|lava|campfire)$/.test(state?.name ?? '')) return false;
  if (kind === 'floor' || kind === 'stair' || kind === 'ground' || state?.name.endsWith('_carpet')) return true;
  if ((kind === 'wall' || kind === 'support' || kind === 'chimney') && planes.get(`${x},${z}`)?.includes(y)) return true;
  return kind === 'roof' && plan.components.some(c => c.roof === 'battlement' && y === c.topY && insidePolygon(x + .5, z + .5, c.polygon));
}
export function walkGraph(plan: Plan, grid: SparseBlocks, maxNodes = 1_000_000): WalkGraph {
  const nodes: WalkNode[] = [], columns = new Map<string, number[]>(), tested = new Set<string>(); let truncated = false;
  const planes = floorPlanes(plan);
  grid.forEach((x, y, z) => {
    if (truncated || !floorSupport(grid, plan, planes, x, y, z)) return;
    const tops = [...new Set(collisionBoxes(grid.stateAt(x, y, z)).map(b => y + b[1] + b[4]))];
    for (const feet of tops) for (const dz of [0, .5, 1]) for (const dx of [0, .5, 1]) {
      const xx = x + dx, zz = z + dz, k = `${xx * 2},${Math.round(feet * 16)},${zz * 2}`;
      if (tested.has(k)) continue; tested.add(k);
      if (!supported(grid, xx, feet, zz) || !bodyClear(grid, xx, feet, zz)) continue;
      if (nodes.length >= maxNodes) { truncated = true; return; }
      const id = nodes.length; nodes.push({ id, x: xx, y: feet, z: zz });
      const ck = columnKey(xx, zz), list = columns.get(ck) ?? []; list.push(id); columns.set(ck, list);
    }
  });
  // Start at the door itself. `plan.entry` is where the approach begins, which in an authored composition can
  // be fifty blocks away and six courses below the threshold — a place to arrive at, not one to set off from.
  const entrance = plan.openings.find(o => o.type === 'entrance');
  const at = entrance
    ? { x: entrance.x + (entrance.axis === 'z' ? entrance.width / 2 : .5), z: entrance.z + (entrance.axis === 'x' ? entrance.width / 2 : .5), y: entrance.y }
    : { x: plan.entry.x, z: plan.entry.z, y: 1 };
  let root = -1, distance = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - at.x, n.z - at.z);
    if (d > 4 || n.y > at.y + .1 || n.y < Math.max(plan.minY, at.y - 1.5)) continue;
    const score = d + Math.abs(n.y - at.y) * .08;
    if (score < distance) { distance = score; root = n.id; }
  }
  const reached = new Uint8Array(nodes.length), graph: WalkGraph = { nodes, columns, reached, root, truncated };
  if (root >= 0) floodWalk(grid, graph, root, reached);
  return graph;
}
export function floodWalk(grid: SparseBlocks, graph: WalkGraph, start: number, seen: Uint8Array, allowed: (n: WalkNode) => boolean = () => true): void {
  const queue = new Int32Array(graph.nodes.length); let head = 0, tail = 0; queue[tail++] = start; seen[start] = 1;
  while (head < tail) {
    const a = graph.nodes[queue[head++]];
    for (const [dx, dz] of [[.5, 0], [-.5, 0], [0, .5], [0, -.5]]) for (const id of graph.columns.get(columnKey(a.x + dx, a.z + dz)) ?? []) {
      if (seen[id]) continue; const b = graph.nodes[id];
      if (allowed(b) && canWalk(grid, a, b)) { seen[id] = 1; queue[tail++] = id; }
    }
  }
}
export function inRoomAtFloor(room: Room, n: Vec3): boolean {
  return n.y >= room.floorY + (room.kind === 'court' ? 0 : 1) - EPS && n.y <= room.floorY + 1.6 && n.x > room.bounds.x + .3 && n.x < room.bounds.x + room.bounds.w - .3
    && n.z > room.bounds.z + .3 && n.z < room.bounds.z + room.bounds.d - .3 && insidePolygon(n.x, n.z, room.polygon)
    && !room.holes.some(h => n.x >= h.x && n.x <= h.x + h.w + 1 && n.z >= h.z && n.z <= h.z + h.d + 1);
}
export function nearestNode(graph: WalkGraph, point: Vec3, distance = 1.5): number {
  let found = -1, best = Infinity;
  for (const n of graph.nodes) { const d = Math.hypot(n.x - point.x, n.z - point.z);
    if (d <= distance && Math.abs(n.y - point.y) <= .6 && d < best) { best = d; found = n.id; }
  } return found;
}
