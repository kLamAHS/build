import { insidePolygon, type BlockKind, type Plan, type Rect, type Stair } from './model.ts';
import { fence, slab, stair, solid, timber, type BlockState } from './block-states.ts';
import type { DetailContext } from './detail-context.ts';
import { clearCell, setCell, type Repair } from './building-repairs.ts';
import type { Vec3 } from './walkability.ts';

export type StairPiece = Vec3 & { state: BlockState; kind: BlockKind };
export type StairAssembly = {
  id: string; componentId: string; style: 'switchback'|'open-straight'; fromY: number; toY: number; width: number;
  bounds: Rect; well: Rect; lower: Vec3; upper: Vec3; pieces: StairPiece[]; source: Stair; roofAccess: boolean;
};
/** Stair volumes are designed before furniture or ornament. The same assemblies drive carving and validation. */
export function planStaircases(plan: Plan): StairAssembly[] {
  const inputs: { source: Stair; roof: boolean }[] = plan.stairs.map(source => ({ source, roof: false }));
  for (const c of plan.components) {
    if (c.roof !== 'battlement') continue;
    const last = plan.stairs.filter(s => s.componentId === c.id).sort((a, b) => b.toY - a.toY)[0];
    if (last && last.toY === c.topY - 6) inputs.push({ source: { ...last, id: `${last.id}-terrace`, fromY: c.topY - 6, toY: c.topY,
      roomIds: plan.rooms.filter(r => r.componentId === c.id && r.floorY === c.topY - 6).map(r => r.id) }, roof: true });
  }
  return inputs.map(({ source: s, roof }) => {
    if (s.toY - s.fromY !== 6 || s.width < 2) throw new Error(`Stair ${s.id}: expected a six-block storey and at least two-block width.`);
    const c = plan.components.find(c => c.id === s.componentId)!;
    const twoFlights = s.bounds.w >= 8 && s.bounds.d >= 9 && c.polygon.length === 4;
    const pieces: StairPiece[] = [], unique = new Map<string, StairPiece>();
    const put = (x: number, y: number, z: number, state: BlockState, kind: BlockKind = 'stair') => unique.set(`${x},${y},${z}`, { x, y, z, state, kind });
    const platform = (x: number, y: number, z: number, w: number, d: number) => { for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) put(x + dx, y, z + dz, solid('spruce_planks'), 'floor'); };
    let bounds: Rect, well: Rect, lower: Vec3, upper: Vec3;
    if (twoFlights) {
      const x = s.bounds.x, z = s.bounds.z, y = s.fromY;
      bounds = { x, z, w: 8, d: 9 }; well = { x: x + 1, z: z + 3, w: 6, d: 5 };
      platform(x + 1, y, z + 1, 2, 2); platform(x + 1, y + 3, z + 6, 6, 2); platform(x + 5, s.toY, z + 1, 2, 2);
      for (let j = 0; j < 3; j++) {
        for (let w = 0; w < 2; w++) {
          put(x + 1 + w, y + j + 1, z + 3 + j, stair('spruce_stairs', 'south'));
          put(x + 5 + w, y + j + 4, z + 5 - j, stair('spruce_stairs', 'north'));
        }
        // Sloping strings, balusters and rake rails replace the old solid side pyramid.
        for (const side of [0, 3]) {
          put(x + side, y + j + 1, z + 3 + j, stair('dark_oak_stairs', 'south', 'top'), 'support');
          put(x + side, y + j + 2, z + 3 + j, fence('spruce_fence', 'z'), 'support');
        }
        for (const side of [4, 7]) {
          put(x + side, y + j + 4, z + 5 - j, stair('dark_oak_stairs', 'north', 'top'), 'support');
          put(x + side, y + j + 5, z + 5 - j, fence('spruce_fence', 'z'), 'support');
        }
      }
      for (let a = 0; a < 8; a++) { put(x + a, y + 3, z + 8, timber('x'), 'support'); put(x + a, y + 4, z + 8, fence('spruce_fence', 'x'), 'support'); }
      for (const side of [0, 7]) for (const zz of [6, 7]) { put(x + side, y + 3, z + zz, timber('z'), 'support'); put(x + side, y + 4, z + zz, fence('spruce_fence', 'z'), 'support'); }
      // Real landing posts reach the lower floor, but the underside between them remains open.
      for (const side of [0, 7]) for (let yy = y + 1; yy <= y + 4; yy++) put(x + side, yy, z + 7, timber(), 'support');
      for (const [xx, yy] of [[x, y], [x + 3, y], [x + 4, s.toY], [x + 7, s.toY]]) {
        put(xx, yy + 1, z + 2, timber(), 'support'); put(xx, yy + 2, z + 2, slab('dark_oak_slab'), 'support');
      }
      lower = { x: x + 2, y: y + 1, z: z + 1.5 }; upper = { x: x + 6, y: s.toY + 1, z: z + 1.5 };
    } else {
      // The shaft the plan declared is where the flight goes. Centring it in a chamfered tower instead is a
      // fallback for the case where the declared corner falls outside the polygon, not the ordinary case:
      // the generator ran its rooms and partitions around the shaft, not around the middle of the building.
      const inside = (px: number, pz: number) => insidePolygon(px + .5, pz + .5, c.polygon);
      let x = s.bounds.x + 3, z = s.bounds.z + 3;
      if (c.polygon.length > 4 && !(inside(x - 1, z - 2) && inside(x + 2, z - 2) && inside(x - 1, z + 7) && inside(x + 2, z + 7))) {
        x = Math.floor(c.bounds.x + c.bounds.w / 2) - 1; z = Math.floor(c.bounds.z + c.bounds.d / 2) - 3;
      }
      bounds = { x: x - 1, z: z - 2, w: 4, d: 10 }; well = { x, z, w: 2, d: 6 };
      platform(x, s.fromY, z - 2, 2, 2); platform(x, s.toY, z + 6, 2, 2);
      for (let j = 0; j < 6; j++) {
        for (let w = 0; w < 2; w++) put(x + w, s.fromY + j + 1, z + j, stair('spruce_stairs', 'south'));
        for (const side of [-1, 2]) {
          put(x + side, s.fromY + j, z + j, stair('dark_oak_stairs', 'south', 'top'), 'support');
          put(x + side, s.fromY + j + 2, z + j, fence('spruce_fence', 'z'), 'support');
        }
      }
      for (const [zz, yy] of [[z - 1, s.fromY], [z + 6, s.toY]]) for (const side of [-1, 2]) {
        put(x + side, yy + 1, zz, timber(), 'support'); put(x + side, yy + 2, zz, slab('dark_oak_slab'), 'support');
      }
      lower = { x: x + 1, y: s.fromY + 1, z: z - 1 }; upper = { x: x + 1, y: s.toY + 1, z: z + 7 };
    }
    for (const p of unique.values()) pieces.push(p);
    return { id: s.id, source: s, componentId: s.componentId, style: twoFlights ? 'switchback' : 'open-straight', fromY: s.fromY, toY: s.toY, width: 2, bounds, well, lower, upper, pieces, roofAccess: roof };
  });
}
const contains = (b: Rect, x: number, z: number) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d;
export function staircaseProtected(assemblies: StairAssembly[], x: number, y: number, z: number): boolean {
  return assemblies.some(a => contains(a.bounds, x, z) && y > a.fromY && y <= a.toY + 3 && !(a.roofAccess && y >= a.toY - 2 && a.style === 'switchback' && x < a.bounds.x + 4));
}
export function buildStaircases(ctx: DetailContext, assemblies: StairAssembly[], repairs: Repair[]): void {
  const { grid, plan } = ctx;
  // Clear every run before constructing any: the next storey must not erase the preceding run's landing rails.
  for (const a of assemblies) {
    const c = plan.components.find(c => c.id === a.componentId)!;
    const rooms = plan.rooms.filter(r => r.componentId === a.componentId && (r.floorY === a.fromY || r.floorY === a.toY));
    for (const p of a.pieces.filter(p => p.kind === 'stair' || p.kind === 'floor')) {
      // The stair hall is whichever room on that storey actually contains the flight, not the first one the
      // component happens to list: a range has several rooms per floor and only one of them is the shaft.
      const floor = p.y > a.fromY + 5 ? a.toY : a.fromY, storey = rooms.filter(r => r.floorY === floor);
      if (storey.length && !storey.some(r => insidePolygon(p.x + .5, p.z + .5, r.polygon)))
        throw new Error(`Stair ${a.id} does not fit its room at ${p.x},${p.y},${p.z}.`);
    }
    let count = 0;
    // Remove the old two-wide six-step run and its cuboid support, not every support in the room.
    const old = a.source.bounds;
    for (let z = old.z + 3; z < old.z + 9; z++) for (let x = old.x + 3; x <= old.x + 5; x++) for (let y = a.fromY + 1; y <= a.toY + 3; y++) {
      if (['stair', 'support', 'furniture'].includes(grid.kindAt(x, y, z))) { clearCell(grid, x, y, z, c.id); count++; }
    }
    // Restore the original narrow slab cut, then cut the new well. This is why no crescent-shaped old holes remain.
    for (let z = old.z + 3; z < old.z + 9; z++) for (let x = old.x + 3; x < old.x + 5; x++)
      if (insidePolygon(x + .5, z + .5, c.polygon) && !grid.get(x, a.toY, z)) setCell(grid, x, a.toY, z, solid('spruce_planks'), 'floor', c.id, 2);
    for (let z = a.bounds.z; z < a.bounds.z + a.bounds.d; z++) for (let x = a.bounds.x; x < a.bounds.x + a.bounds.w; x++) for (let y = a.fromY + 1; y <= a.toY + 3; y++) {
      const k = grid.kindAt(x, y, z);
      // Existing walls are not silently demolished to make a staircase fit.
      if (k === 'wall' || k === 'glass' || k === 'chimney') continue;
      if (k === 'furniture' || k === 'stair' || k === 'support' || (k === 'roof' && (y !== a.toY || contains(a.well, x, z))) || (k === 'floor' && contains(a.well, x, z))) {
        clearCell(grid, x, y, z, c.id); count++;
      }
    }
    repairs.push({ kind: 'stair-rebuild', id: a.id, cells: count, message: `Replaced the old run with ${a.style}, actual landings, strings and balustrades` });
  }
  for (const a of assemblies) {
    for (const p of a.pieces) {
      const k = grid.kindAt(p.x, p.y, p.z);
      if (k === 'wall' || k === 'glass' || k === 'chimney') continue; // The physical audit reports an obstructed run.
      grid.apply({ x: p.x, y: p.y, z: p.z, w: 1, h: 1, d: 1, kind: p.kind, material: 2, componentId: a.componentId }); grid.setState(p.x, p.y, p.z, p.state);
    }
    // Roof stairs terminate in a covered stairhead rather than a raw hole in the battlement deck.
    if (a.roofAccess) {
      const b = a.well, top = a.toY + 4;
      for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++)
        if (!grid.get(x, top, z)) setCell(grid, x, top, z, slab('stone_brick_slab'), 'roof', a.componentId);
      for (const x of [b.x - 1, b.x + b.w]) for (const z of [b.z + b.d - 1, b.z + b.d]) for (let y = a.toY + 1; y < top; y++)
        if (!grid.get(x, y, z)) setCell(grid, x, y, z, timber(), 'support', a.componentId, 2);
    }
    ctx.features.push({ kind: a.roofAccess ? 'terrace-stair' : a.style + '-stair', componentId: a.componentId, blocks: a.pieces.length, bounds: { ...a.bounds, y: a.fromY, h: a.toY - a.fromY + 4 } });
  }
}
