import { insideRoom, type Plan, type Room } from './model.ts';
import { chain, lantern, type BlockState } from './block-states.ts';
import type { SparseBlocks } from './voxels.ts';
import type { DetailContext } from './detail-context.ts';
import type { InteriorLayout } from './interior-layout.ts';
import { bodyClear } from './walkability.ts';
import { setCell } from './building-repairs.ts';

export const INTERIOR_LIGHT_TARGET = 8;
/** A lamp hangs from anything solid across its underside — a stair, a lower slab — but not from a pane. */
function solidUnderside(state?: BlockState): boolean {
  if (!state?.occupancy) return true;
  const n = state.resolution ?? 4;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (!state.occupancy[x + n * z]) return false;
  return true;
}
export type LightField = { at: (x: number, y: number, z: number) => number; sources: number };
export function emittedLight(grid: SparseBlocks, x: number, y: number, z: number): number {
  const s = grid.stateAt(x, y, z); if (!s) return 0;
  if (s.name === 'minecraft:lantern' || s.name === 'minecraft:glowstone') return 15;
  if (s.name === 'minecraft:campfire' && s.properties.lit === 'true') return 15;
  return /:(furnace|blast_furnace)$/.test(s.name) && s.properties.lit === 'true' ? 13 : 0;
}
/** Conservative block-light field: skylight is ignored, full cells and stairs/slabs occlude. Not a game-engine replacement. */
export function blockLight(plan: Plan, grid: SparseBlocks): LightField {
  const ext = grid.extent(plan.minY, plan.maxY), b = ext.bounds, low = ext.minY, w = b.w, d = b.d, h = ext.maxY - low + 1, plane = w * d;
  if (w * d * h > 64 * 1024 * 1024) throw new Error('Lighting audit exceeds 64 million cells; reduce the building size.');
  const levels = new Uint8Array(plane * h), opaque = new Uint8Array(plane * h), buckets: number[][] = Array.from({ length: 16 }, () => []);
  const index = (x: number, y: number, z: number) => (y - low) * plane + (z - b.z) * w + x - b.x;
  let sources = 0;
  grid.forEach((x, y, z) => {
    const i = index(x, y, z), s = grid.stateAt(x, y, z), light = emittedLight(grid, x, y, z);
    const transparent = s && /glass|lantern|chain|_fence$|_wall$|_carpet$|_leaves$|campfire|flower_pot/.test(s.name);
    if (!transparent) opaque[i] = 1;
    if (light) { levels[i] = light; buckets[light].push(i); sources++; }
  });
  const visit = (i: number, light: number) => { if (!opaque[i] && levels[i] < light) { levels[i] = light; buckets[light].push(i); } };
  for (let light = 15; light > 1; light--) for (const i of buckets[light]) {
    if (levels[i] !== light) continue;
    const x = i % w, z = Math.floor(i / w) % d, y = Math.floor(i / plane), next = light - 1;
    if (x) visit(i - 1, next); if (x + 1 < w) visit(i + 1, next); if (z) visit(i - w, next); if (z + 1 < d) visit(i + w, next);
    if (y) visit(i - plane, next); if (y + 1 < h) visit(i + plane, next);
  }
  return { sources, at: (x, y, z) => { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); return x < b.x || x >= b.x + w || z < b.z || z >= b.z + d || y < low || y >= low + h ? 0 : levels[index(x, y, z)]; } };
}
export function lightSamples(room: Room, grid: SparseBlocks): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [], b = room.bounds;
  for (let z = b.z + 1; z < b.z + b.d; z++) for (let x = b.x + 1; x < b.x + b.w; x++) {
    if (!insideRoom(room, x, z) || !grid.get(x, room.floorY, z)) continue;
    const y = room.floorY + 1 + (grid.stateAt(x, room.floorY + 1, z)?.name.endsWith('_carpet') ? .0625 : 0);
    if (bodyClear(grid, x + .5, y, z + .5)) out.push({ x, y, z });
  } return out;
}
export function lightInteriors(ctx: DetailContext, layout: InteriorLayout): LightField {
  const { grid, plan } = ctx, additions = new Map<string, number>();
  const inStair = (x: number, y: number, z: number) => layout.staircases.some(a => x >= a.bounds.x && x < a.bounds.x + a.bounds.w && z >= a.bounds.z && z < a.bounds.z + a.bounds.d && y > a.fromY && y <= a.toY + 3);
  const hang = (r: Room, x: number, z: number): { x: number; y: number; z: number } | undefined => {
    // One below the ceiling, not two: a gabled top storey is four blocks tall, and hanging nothing at all in
    // it is worse than hanging the lamp a course lower. Standing head height is floorY + 2.8 either way.
    const y = Math.min(r.floorY + 4, r.ceilingY - 1);
    if (y < r.floorY + 3 || !insideRoom(r, x, z) || grid.get(x, y, z) || inStair(x, y, z)) return;
    let anchor = y + 1; while (anchor <= r.ceilingY + 20 && !grid.get(x, anchor, z)) anchor++;
    if (anchor > r.ceilingY + 20 || !solidUnderside(grid.stateAt(x, anchor, z))) return;
    // A lamp hangs in the room, never in the head of a doorway or over a reserved route.
    for (let yy = y; yy < anchor; yy++) if (grid.get(x, yy, z) || inStair(x, yy, z) || layout.reserved(x, yy, z)) return;
    for (let yy = y + 1; yy < anchor; yy++) setCell(grid, x, yy, z, chain(), 'furniture', r.componentId, 8);
    setCell(grid, x, y, z, lantern(true), 'furniture', r.componentId, 8);
    additions.set(r.id, (additions.get(r.id) ?? 0) + 1); return { x, y, z };
  };
  for (const room of plan.rooms) if (room.kind !== 'court') {
    const b = room.bounds;
    for (let z = b.z + 3; z < b.z + b.d - 2; z += 7) for (let x = b.x + 3; x < b.x + b.w - 2; x += 7) hang(room, x, z);
  }
  let field = blockLight(plan, grid);
  // Coverage is measured after furniture and ceiling placement. A regular lamp grid alone is not a lighting check.
  for (let pass = 0; pass < 4; pass++) {
    let added = 0;
    for (const r of plan.rooms) {
      if (r.kind === 'court') continue;
      const dark = lightSamples(r, grid).filter(p => field.at(p.x, p.y, p.z) < INTERIOR_LIGHT_TARGET).sort((a, b) => field.at(a.x, a.y, a.z) - field.at(b.x, b.y, b.z));
      const fresh: { x: number; y: number; z: number }[] = [];
      for (const p of dark) {
        // A lamp already hung this pass covers what is near it — unless this spot is pitch black, in which
        // case whatever is between them is a wall, and straight-line distance was the wrong question.
        if (field.at(p.x, p.y, p.z) > 0 && fresh.some(l => 15 - Math.abs(l.x - p.x) - Math.abs(l.y - Math.floor(p.y)) - Math.abs(l.z - p.z) >= INTERIOR_LIGHT_TARGET)) continue;
        const offsets = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2]];
        for (const [dx, dz] of offsets) { const lamp = hang(r, p.x + dx, p.z + dz); if (lamp) { fresh.push(lamp); added++; break; } }
      }
    }
    if (!added) break; field = blockLight(plan, grid);
  }
  for (const r of plan.rooms) if (additions.has(r.id)) ctx.features.push({ kind: 'interior-lighting', componentId: r.componentId, blocks: additions.get(r.id)!, bounds: { ...r.bounds, y: r.floorY, h: r.ceilingY - r.floorY } });
  return field;
}
