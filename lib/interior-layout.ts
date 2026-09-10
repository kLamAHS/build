import { insideRoom } from './model.ts';
import type { DetailContext } from './detail-context.ts';
import { clearCell, openingTunnel, tunnelCells, type Repair } from './building-repairs.ts';
import { bodyClear, type Vec3 } from './walkability.ts';
import type { StairAssembly } from './interior-stairs.ts';

export type InteriorLayout = { routes: Map<string, Set<string>>; staircases: StairAssembly[]; disconnected: { roomId: string; point: Vec3 }[];
  reserved: (x: number, y: number, z: number) => boolean; };
const key = (x: number, z: number) => `${x},${z}`;
/**
 * Take out the old fitting volumes before anything is measured against them: a stale cuboid standing in a
 * yard is what stops a doorway's step being built, and it is not the fitting anyone will end up with. A dais
 * laid in the floor course remains a floor, and a yard is bounded by the sky rather than by a `ceilingY`.
 */
export function stripOldFittings(ctx: DetailContext, repairs: Repair[]): void {
  const { plan, grid } = ctx;
  let removed = 0;
  grid.forEach((x, y, z) => { if (grid.kindAt(x, y, z) === 'furniture' && plan.rooms.some(r => y > r.floorY && (r.kind === 'court' || y < r.ceilingY) && insideRoom(r, x, z))) { clearCell(grid, x, y, z, 'interiors'); removed++; } });
  if (removed) repairs.push({ kind: 'fitting-replacement', id: 'interiors', cells: removed, message: 'Removed the old cuboid fittings before rebuilding room-scale furniture' });
}
/** Reserve actual paths between doors, landings and each room's usable centre BEFORE placing furniture. */
export function planInteriors(ctx: DetailContext, staircases: StairAssembly[], repairs: Repair[]): InteriorLayout {
  const { plan, grid } = ctx, routes = new Map<string, Set<string>>(), disconnected: InteriorLayout['disconnected'] = [];
  // The way in and out of a doorway is reserved as far as its threshold reaches, and two cells past that,
  // so no fitting can be dropped in front of the only door out of a range.
  const approach = new Set<string>();
  for (const o of plan.openings) {
    const t = openingTunnel(plan, o);
    // A doorway keeps its own height, the threshold course under it and two cells past its reveal. A light
    // keeps only its reveal: what hangs above a lintel, or in front of a window, is in nobody's way.
    tunnelCells(o.type === 'window' ? t : { ...t, outer: t.outer + 2 },
      (x, y, z) => { approach.add(`${x},${y},${z}`); if (o.type !== 'window') approach.add(`${x},${y - 1},${z}`); });
  }
  const routeByY = new Map<number, Set<string>>();
  for (const room of plan.rooms) {
    if (room.kind === 'court') continue;
    const b = room.bounds, w = b.w + 1, d = b.d + 1, valid = new Uint8Array(w * d), fitting = new Uint8Array(w * d);
    const index = (x: number, z: number) => (z - b.z) * w + x - b.x;
    const point = (i: number) => ({ x: b.x + i % w, z: b.z + Math.floor(i / w) });
    for (let z = b.z + 1; z < b.z + b.d; z++) for (let x = b.x + 1; x < b.x + b.w; x++) {
      if (!insideRoom(room, x, z) || !grid.get(x, room.floorY, z) || !bodyClear(grid, x + .5, room.floorY + 1, z + .5)) continue;
      valid[index(x, z)] = 1;
      if (room.furniture.some(f => x >= f.x && x < f.x + f.w && z >= f.z && z < f.z + f.d)) fitting[index(x, z)] = 1;
    }
    const nearest = (p: Vec3) => { let at = -1, best = Infinity;
      for (let i = 0; i < valid.length; i++) if (valid[i]) { const q = point(i), score = Math.hypot(q.x + .5 - p.x, q.z + .5 - p.z) + (fitting[i] ? .1 : 0); if (score < best) { best = score; at = i; } }
      return at;
    };
    const anchorPoints: Vec3[] = [];
    for (const o of plan.openings) if (o.type !== 'window' && o.roomIds.includes(room.id) && o.y >= room.floorY && o.y < room.ceilingY) anchorPoints.push({ x: o.x + (o.axis === 'z' ? o.width / 2 : .5), z: o.z + (o.axis === 'x' ? o.width / 2 : .5), y: room.floorY + 1 });
    for (const a of staircases) if (a.componentId === room.componentId) {
      if (a.fromY === room.floorY) anchorPoints.push(a.lower);
      if (a.toY === room.floorY) anchorPoints.push(a.upper);
    }
    const centre = nearest({ x: b.x + b.w / 2, z: b.z + b.d / 2, y: room.floorY + 1 }), reserved = new Set<string>();
    if (centre >= 0) reserved.add(key(point(centre).x, point(centre).z));
    for (const anchor of anchorPoints) {
      const start = nearest(anchor);
      if (start < 0 || centre < 0) { disconnected.push({ roomId: room.id, point: anchor }); continue; }
      const search = (avoidFittings: boolean) => {
        const prev = new Int32Array(valid.length).fill(-1), queue = new Int32Array(valid.length); let head = 0, tail = 0; prev[start] = start; queue[tail++] = start;
        while (head < tail) { const i = queue[head++]; if (i === centre) break; const p = point(i);
          for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            const x = p.x + dx, z = p.z + dz; if (x <= b.x || x >= b.x + b.w || z <= b.z || z >= b.z + b.d) continue;
            const n = index(x, z); if (prev[n] >= 0 || !valid[n] || (avoidFittings && fitting[n] && n !== centre)) continue;
            prev[n] = i; queue[tail++] = n;
          }
        } return prev[centre] >= 0 ? prev : undefined;
      };
      const prev = search(true) ?? search(false);
      if (!prev) { disconnected.push({ roomId: room.id, point: anchor }); continue; }
      for (let i = centre; ; i = prev[i]) {
        const p = point(i); reserved.add(key(p.x, p.z));
        // Widen to two blocks wherever the room permits it, without moving a wall.
        for (const [dx, dz] of [[1, 0], [0, 1]]) { const xx = p.x + dx, zz = p.z + dz, n = index(xx, zz);
          if (xx < b.x + b.w && zz < b.z + b.d && valid[n] && !fitting[n]) { reserved.add(key(xx, zz)); break; }
        }
        if (i === start) break;
      }
    }
    routes.set(room.id, reserved);
    const atY = routeByY.get(room.floorY) ?? new Set<string>(); for (const k of reserved) atY.add(k); routeByY.set(room.floorY, atY);
  }
  const reserved = (x: number, y: number, z: number) => {
    for (const [floor, cells] of routeByY) if (y > floor && y <= floor + 3 && cells.has(key(x, z))) return true;
    if (staircases.some(a => x >= a.bounds.x && x < a.bounds.x + a.bounds.w && z >= a.bounds.z && z < a.bounds.z + a.bounds.d && y > a.fromY && y <= a.toY + 3)) return true;
    return approach.has(`${x},${y},${z}`);
  };
  void repairs;
  return { routes, staircases, disconnected, reserved };
}
