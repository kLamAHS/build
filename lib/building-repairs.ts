import { componentFootprint, insidePolygon, insideRoom, type Opening, type Plan, type Point, type Room } from './model.ts';
import { solid, stair, pane, opposite, type Facing } from './block-states.ts';
import type { DetailContext } from './detail-context.ts';
import type { SparseBlocks } from './voxels.ts';

export type Repair = { kind: string; id: string; cells: number; message: string };
export type OpeningTunnel = { opening: Opening; dx: number; dz: number; inner: number; outer: number };
/**
 * Which room a doorway belongs to: the enclosed one, never the yard it opens onto. Outward is measured from
 * that room's centre, and a court's centre is on the far side — taking it would dig the reveal, the
 * threshold and the step outside the building inwards through the room instead.
 */
export function openingRoom(plan: Plan, o: Opening): Room | undefined {
  const rooms = o.roomIds.map(id => plan.rooms.find(r => r.id === id)).filter((r): r is Room => !!r);
  return rooms.find(r => r.kind !== 'court') ?? rooms[0];
}
/** A reveal is the thickness of its own wall, NOT an arbitrary sixteen-block exclusion corridor. */
export function openingTunnel(plan: Plan, o: Opening): OpeningTunnel {
  const room = openingRoom(plan, o), c = plan.components.find(c => c.id === room?.componentId);
  const across = o.axis === 'z';
  const out = o.outward ?? (across ? { x: 0, z: room && room.bounds.z + room.bounds.d / 2 > o.z ? -1 : 1 }
    : { x: room && room.bounds.x + room.bounds.w / 2 > o.x ? -1 : 1, z: 0 });
  const f = c ? componentFootprint(c, Math.floor(o.y / 6) * 6, plan.family) : undefined;
  const mainFace = f && (across ? o.z === f.z || o.z === f.z + f.d : o.x === f.x || o.x === f.x + f.w);
  const depth = mainFace && c && c.polygon.length === 4 ? (plan.settings.kind === 'castle' ? 3 : 2) + (c.phase === 0 ? 1 : 0) - 1 : 0;
  const internal = o.roomIds.filter(id => plan.rooms.some(r => r.id === id && r.kind !== 'court')).length > 1;
  return { opening: o, dx: out.x, dz: out.z, inner: 1, outer: internal ? 1 : depth + (o.type === 'window' ? 0 : 2) };
}
export function tunnelCells(t: OpeningTunnel, visit: (x: number, y: number, z: number, depth: number) => void): void {
  const o = t.opening;
  for (let d = -t.inner; d <= t.outer; d++) for (let w = 0; w < o.width; w++) for (let y = o.y; y < o.y + o.height; y++)
    visit(o.x + (o.axis === 'z' ? w : 0) + t.dx * d, y, o.z + (o.axis === 'x' ? w : 0) + t.dz * d, d);
}
export function setCell(grid: SparseBlocks, x: number, y: number, z: number, state: ReturnType<typeof solid>, kind: 'floor'|'roof'|'wall'|'support'|'stair'|'glass'|'furniture', id: string, material = 1): void {
  grid.apply({ x, y, z, w: 1, h: 1, d: 1, kind, material, componentId: id }); grid.setState(x, y, z, state);
}
export function clearCell(grid: SparseBlocks, x: number, y: number, z: number, id: string): void {
  grid.apply({ x, y, z, w: 1, h: 1, d: 1, kind: 'air', material: 0, componentId: id });
}
function perimeter(polygon: Point[]): Point[] {
  const points = new Map<string, Point>();
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], n = Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    for (let j = 0; j <= n; j++) { const t = n ? j / n : 0, x = Math.round(a.x + (b.x - a.x) * t), z = Math.round(a.z + (b.z - a.z) * t); points.set(`${x},${z}`, { x, z }); }
  }
  return [...points.values()];
}
/**
 * The air cuts a plan declares — louvers, stair wells, vents — indexed by column. Scanning every block of a
 * plan for every cell of every ceiling was, on its own, a third of the time it took to compile a building.
 */
export function airCuts(plan: Plan): (x: number, y: number, z: number) => boolean {
  const columns = new Map<string, { y: number; h: number }[]>();
  for (const b of plan.blocks) if (b.kind === 'air' && !b.material)
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      const k = `${x},${z}`, list = columns.get(k);
      if (list) list.push(b); else columns.set(k, [b]);
    }
  return (x, y, z) => (columns.get(`${x},${z}`) ?? []).some(b => y >= b.y && y < b.y + b.h);
}
function roofCuts(plan: Plan): (x: number, y: number, z: number) => boolean {
  const cut = airCuts(plan);
  return (x, y, z) => plan.reservations.some(r => (r.kind === 'court' || r.kind === 'stair') && y >= r.fromY && y <= r.toY
    && insidePolygon(x + .5, z + .5, r.polygon)) || cut(x, y, z);
}
/** Envelope repairs are scoped to declared rooms/walls; this never fills arbitrary air or an outdoor courtyard. */
export function repairEnvelope(ctx: DetailContext, repairs: Repair[]): void {
  const { plan, grid, structure } = ctx, intentionalRoofCut = roofCuts(plan);
  let removed = 0, masonry = 0, ceiling = 0, knee = 0, bases = 0;
  for (const room of plan.rooms) {
    if (room.kind === 'court') continue;
    const b = room.bounds;
    for (let z = b.z + 1; z < b.z + b.d; z++) for (let x = b.x + 1; x < b.x + b.w; x++) {
      if (!insideRoom(room, x, z)) continue;
      // Lower roofs cannot remain inside an adjoining taller occupied room.
      for (let y = room.floorY + 1; y < room.ceilingY; y++) if (grid.kindAt(x, y, z) === 'roof') { clearCell(grid, x, y, z, room.componentId); removed++; }
    }
  }
  // A range/curtain constructed later may cross an earlier room. Its wall is foreign to that room's
  // interior, not a partition in its plan. Remove only those identified source wall cells.
  let intrusions = 0;
  for (const b of plan.blocks) if (b.kind === 'wall') {
    const victims = plan.rooms.filter(r => r.kind !== 'court' && r.componentId !== b.componentId
      && b.y < r.ceilingY && b.y + b.h > r.floorY + 1 && b.x < r.bounds.x + r.bounds.w && b.x + b.w > r.bounds.x + 1 && b.z < r.bounds.z + r.bounds.d && b.z + b.d > r.bounds.z + 1);
    for (const r of victims) for (let y = Math.max(b.y, r.floorY + 1); y < Math.min(b.y + b.h, r.ceilingY); y++)
      for (let z = Math.max(b.z, r.bounds.z + 1); z < Math.min(b.z + b.d, r.bounds.z + r.bounds.d); z++)
        for (let x = Math.max(b.x, r.bounds.x + 1); x < Math.min(b.x + b.w, r.bounds.x + r.bounds.w); x++)
          if (insideRoom(r, x, z) && grid.kindAt(x, y, z) === 'wall') { clearCell(grid, x, y, z, r.componentId); intrusions++; }
  }
  if (intrusions) repairs.push({kind:'foreign-wall-in-room',id:'envelope',cells:intrusions,message:'Removed later-built foreign range/curtain walls crossing a declared room interior'});
  // A roof replay may have overwritten a wall. Restore only its exposed declared shell, respecting real cuts.
  for (const b of plan.blocks) if (b.kind === 'wall') {
    for (let y = b.y; y < b.y + b.h; y++) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      if (grid.kindAt(x, y, z) !== 'roof' || ctx.protectedAt(x, y, z)) continue;
      setCell(grid, x, y, z, solid('stone_bricks'), 'wall', b.componentId); masonry++;
    }
  }
  for (const c of plan.components) {
    if (c.kind === 'court') continue;
    const highest = plan.rooms.filter(r => r.componentId === c.id && r.ceilingY === c.topY && r.kind !== 'court');
    // Close the occupied storey's ceiling independently of the decorative roof skin. Vents and stair wells remain open.
    for (const r of highest) for (let z = r.bounds.z + 1; z < r.bounds.z + r.bounds.d; z++) for (let x = r.bounds.x + 1; x < r.bounds.x + r.bounds.w; x++) {
      if (!insideRoom(r, x, z) || grid.get(x, c.topY, z) || intentionalRoofCut(x, c.topY, z)) continue;
      setCell(grid, x, c.topY, z, solid('spruce_planks'), 'roof', c.id, 2); ceiling++;
    }
    // The deeper eave moved the roof away from the wall but V2 did not build the attic/knee wall below it.
    // Terminate each top-storey perimeter column on the actual roof above, rather than leaving an open horizontal slot.
    for (const r of highest) for (const { x, z } of perimeter(r.polygon)) {
      if (!structure.get(x, c.topY - 1, z)) continue;
      let roof = c.topY;
      while (roof <= c.topY + 24 && grid.kindAt(x, roof, z) !== 'roof') roof++;
      if (roof > c.topY + 24) continue;
      for (let y = c.topY; y < roof; y++) {
        if (grid.get(x, y, z) || ctx.protectedAt(x, y, z) || intentionalRoofCut(x, y, z)) continue;
        setCell(grid, x, y, z, solid(plan.settings.kind === 'castle' ? 'stone_bricks' : 'spruce_planks'), 'roof', c.id, plan.settings.kind === 'castle' ? 1 : 2); knee++;
      }
    }
  }
  // Fix one-course foundation gaps only under the bottom of an existing wall, with nearby ground beneath it.
  const bottoms: Point[] = [];
  grid.forEach((x, y, z) => { if (y === 0 && grid.kindAt(x, y, z) === 'wall' && !grid.get(x, -1, z)) bottoms.push({ x, z }); });
  for (const { x, z } of bottoms) {
    let ground = -1; while (ground >= -8 && !grid.get(x, ground, z)) ground--;
    if (ground < -8) continue;
    for (let y = ground + 1; y < 0; y++) {
      if (plan.rooms.some(r => r.floorY < 0 && y > r.floorY && y < r.ceilingY && insideRoom(r, x, z))) continue;
      setCell(grid, x, y, z, solid('stone_bricks'), 'support', 'foundation'); bases++;
    }
  }
  for (const [kind, cells, message] of [
    ['roof-in-room', removed, 'Removed roof cells intruding into an occupied room'], ['overwritten-shell', masonry, 'Restored exposed wall cells overwritten by roof replay'],
    ['ceiling-closure', ceiling, 'Closed top-storey ceilings without filling vents or reservations'], ['eaves-closure', knee, 'Joined top-storey walls to the actual roof'],
    ['foundation-gap', bases, 'Supported existing walls across a missing ground course'],
  ] as const) if (cells) repairs.push({ kind, cells, id: 'envelope', message });
}
/** Re-open declared portals LAST, through their own reveals. Doors do not get sills; windows do get glazing. */
export function reconcileOpenings(ctx: DetailContext, repairs: Repair[]): void {
  const { plan, grid } = ctx;
  // Two rooms may each claim a light in the same wall cell. One window's reveal must not unglaze the other's
  // aperture, so every declared aperture is off limits to every reveal.
  const apertures = new Set<string>();
  for (const o of plan.openings) if (o.type === 'window')
    for (let w = 0; w < o.width; w++) for (let y = o.y; y < o.y + o.height; y++)
      apertures.add(`${o.x + (o.axis === 'z' ? w : 0)},${y},${o.z + (o.axis === 'x' ? w : 0)}`);
  for (const o of [...plan.openings].sort((a,b)=>(a.type==='window'?0:1)-(b.type==='window'?0:1))) {
    const t = openingTunnel(plan, o), room = openingRoom(plan, o); if (!room) continue;
    let cleared = 0, glazed = 0;
    tunnelCells(t, (x, y, z, depth) => {
      if (o.type === 'window') {
        // A single complete pane plane, with a recessed reveal behind and ahead of it.
        if (depth === 0) { setCell(grid, x, y, z, pane('gray_stained_glass_pane', o.axis === 'z' ? 'x' : 'z'), 'glass', room.componentId, 4); glazed++; }
        else if (grid.kindAt(x, y, z) === 'glass' && !apertures.has(`${x},${y},${z}`)) { clearCell(grid, x, y, z, room.componentId); cleared++; }
      } else if (grid.get(x, y, z)) { clearCell(grid, x, y, z, room.componentId); cleared++; }
    });
    if (o.type !== 'window') {
      // The threshold is a floor, not a two-block plinth. Only bridge missing cells inside the planned reveal.
      for (let d = -t.inner; d <= t.outer; d++) for (let w = 0; w < o.width; w++) {
        const x = o.x + (o.axis === 'z' ? w : 0) + t.dx * d, z = o.z + (o.axis === 'x' ? w : 0) + t.dz * d, y = o.y - 1;
        // A threshold you can stand on: the mass under a doorway is part of the wall, but the top of it is
        // the floor you walk across, and an audit that reads roles rather than blocks has to be told so.
        const kind = grid.kindAt(x, y, z);
        if (kind !== 'floor' && kind !== 'stair' && kind !== 'ground') setCell(grid, x, y, z, solid('polished_andesite'), 'floor', room.componentId);
      }
      const outward = t.dx < 0 ? 'west' : t.dx > 0 ? 'east' : t.dz < 0 ? 'north' : 'south';
      // Exterior doors meet ground one course below the room; a real stair apron makes that a walk, not a jump.
      for (let w = 0; w < o.width; w++) {
        const x = o.x + (o.axis === 'z' ? w : 0) + t.dx * (t.outer + 1), z = o.z + (o.axis === 'x' ? w : 0) + t.dz * (t.outer + 1), y = o.y - 1;
        if (!grid.get(x, y, z) && grid.get(x, y - 1, z) && !grid.get(x, y + 1, z)
          && !plan.rooms.some(r => r.id !== room.id && r.kind !== 'court' && insideRoom(r, x, z)))
          setCell(grid, x, y, z, stair('stone_brick_stairs', opposite(outward)), 'stair', room.componentId);
      }
    }
    if (cleared || glazed) repairs.push({ kind: o.type === 'window' ? 'window-reveal' : 'portal-clearance', id: o.id, cells: cleared + glazed, message: o.type === 'window' ? 'Completed recessed glazing' : 'Restored the declared doorway and threshold' });
  }
  // A window is one plane of panes in a reveal. Glass the massing left outside a declared aperture belongs to
  // no window at all, and once the reveal is cut it hangs there in mid-air.
  const orphans: { x: number; y: number; z: number }[] = [];
  grid.forEach((x, y, z) => { if (grid.kindAt(x, y, z) === 'glass' && !apertures.has(`${x},${y},${z}`)) orphans.push({ x, y, z }); });
  for (const o of orphans) clearCell(grid, o.x, o.y, o.z, 'openings');
  if (orphans.length) repairs.push({ kind: 'orphan-glazing', id: 'openings', cells: orphans.length, message: 'Removed massing glass left outside any declared aperture' });
}
/** Exterior approach steps used to remain full cubes and required jumping. Shape their exposed top course. */
export function shapeApproachSteps(ctx: DetailContext): void {
  const { plan, grid } = ctx, pending: { x: number; y: number; z: number; f: Facing }[] = [];
  grid.forEach((x, y, z) => {
    if (grid.kindAt(x, y, z) !== 'stair' || grid.get(x, y + 1, z) || grid.stateAt(x, y, z)) return;
    if (plan.stairs.some(s => x >= s.bounds.x && x <= s.bounds.x + s.bounds.w && z >= s.bounds.z && z <= s.bounds.z + s.bounds.d && y >= s.fromY && y <= s.toY)) return;
    for (const [dx, dz, f] of [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']] as const)
      if (grid.get(x + dx, y + 1, z + dz) && !grid.get(x + dx, y + 2, z + dz)) { pending.push({ x, y, z, f }); break; }
  });
  for (const p of pending) grid.setState(p.x, p.y, p.z, stair('stone_brick_stairs', p.f));
}
