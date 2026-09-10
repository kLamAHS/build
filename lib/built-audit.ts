import { insideRoom, type Plan } from './model.ts';
import type { SparseBlocks } from './voxels.ts';
import { walkGraph, floodWalk, inRoomAtFloor, bodyClear, type Vec3, type WalkNode } from './walkability.ts';
import { planStaircases } from './interior-stairs.ts';
import { blockLight, lightSamples, INTERIOR_LIGHT_TARGET, type LightField } from './interior-lighting.ts';
import { airCuts } from './building-repairs.ts';

export type BuildIssue = { code: string; severity: 'error'|'warning'; id: string; message: string; at?: Vec3 };
export type BuiltAudit = {
  valid: boolean; issues: BuildIssue[]; walking: { nodes: number; reached: number; entry: Vec3 | null; rooms: { id: string; name: string; standing: number; reachable: number }[] };
  stairs: { id: string; style: string; connected: boolean; lower: Vec3; upper: Vec3; roofAccess: boolean }[];
  lighting: { target: number; minimum: number | null; sources: number; samples: number; belowTarget: number; rooms: { id: string; minimum: number | null; samples: number; belowTarget: number }[] };
  envelope: { testedColumns: number; leaks: number }; model: string;
};
/** Acceptance checks run on the FINISHED block-state model, not the abstract room graph. */
export function auditBuiltModel(plan: Plan, grid: SparseBlocks, assemblies: ReturnType<typeof planStaircases> = planStaircases(plan), suppliedLight?: LightField): BuiltAudit {
  const auditKey = JSON.stringify([plan.entry, plan.openings, plan.rooms.map(r => [r.id, r.floorY, r.ceilingY, r.polygon, r.holes]), plan.stairs, plan.reservations]);
  if (grid.buildAudit && grid.auditedRevision === grid.revision && grid.auditKey === auditKey) return grid.buildAudit;
  const issues: BuildIssue[] = [], graph = walkGraph(plan, grid), field = suppliedLight ?? blockLight(plan, grid);
  // The graph already indexes its standing positions by half-block column. Asking every room and every stair
  // about every node in the estate is quadratic, and at sixty thousand nodes that is most of the audit.
  const near = (x: number, z: number, radius: number, test: (n: WalkNode) => boolean) => {
    const out: WalkNode[] = [];
    for (let cz = Math.floor((z - radius) * 2); cz <= Math.ceil((z + radius) * 2); cz++)
      for (let cx = Math.floor((x - radius) * 2); cx <= Math.ceil((x + radius) * 2); cx++)
        for (const id of graph.columns.get(`${cx},${cz}`) ?? []) { const n = graph.nodes[id]; if (test(n)) out.push(n); }
    return out;
  };
  const nearest = (point: Vec3, distance = 1.5) => {
    let found = -1, best = Infinity;
    for (const n of near(point.x, point.z, distance, () => true)) {
      const d = Math.hypot(n.x - point.x, n.z - point.z);
      if (d <= distance && Math.abs(n.y - point.y) <= .6 && d < best) { best = d; found = n.id; }
    }
    return found;
  };
  if (graph.truncated) issues.push({ code: 'audit-budget', severity: 'error', id: 'walking', message: 'The walking audit exceeded its node budget. This build has not passed validation.' });
  if (graph.root < 0) issues.push({ code: 'entry-unreachable', severity: 'error', id: 'entry', message: 'There is no supported player-sized standing position at the entry.', at: { ...plan.entry, y: 1 } });
  const rooms = plan.rooms.map(room => {
    const b = room.bounds, nodes = near(b.x + b.w / 2, b.z + b.d / 2, Math.max(b.w, b.d) / 2 + 1, n => inRoomAtFloor(room, n));
    const reachable = nodes.reduce((n, a) => n + graph.reached[a.id], 0);
    if (!reachable) issues.push({ code: 'room-unreachable', severity: 'error', id: room.id, message: `${room.name} cannot be reached from the entry without flying, jumping or breaking blocks.`, at: { x: room.bounds.x + 1, y: room.floorY + 1, z: room.bounds.z + 1 } });
    else if (room.kind !== 'court' && nodes.length - reachable >= 24 && reachable / nodes.length < .75) issues.push({ code: 'room-fragmented', severity: 'error', id: room.id, message: `${room.name} contains a substantial disconnected standing area.` });
    return { id: room.id, name: room.name, standing: nodes.length, reachable };
  });
  const stairs = assemblies.map(a => {
    const low = nearest(a.lower), high = nearest(a.upper); let connected = false;
    if (low >= 0 && high >= 0) {
      const seen = new Uint8Array(graph.nodes.length);
      floodWalk(grid, graph, low, seen, n => n.x >= a.bounds.x && n.x <= a.bounds.x + a.bounds.w && n.z >= a.bounds.z && n.z <= a.bounds.z + a.bounds.d && n.y >= a.fromY + 1 && n.y <= a.toY + 1.6);
      connected = !!seen[high];
    }
    if (!connected) issues.push({ code: 'stair-blocked', severity: 'error', id: a.id, message: `${a.style} stair ${a.id} does not connect its two landings with player clearance.`, at: a.lower });
    return { id: a.id, style: a.style, connected, lower: a.lower, upper: a.upper, roofAccess: a.roofAccess };
  });
  for (const o of plan.openings) {
    if (o.type === 'window') {
      let missing = 0;
      for (let w = 0; w < o.width; w++) for (let y = o.y; y < o.y + o.height; y++) if (!grid.stateAt(o.x + (o.axis === 'z' ? w : 0), y, o.z + (o.axis === 'x' ? w : 0))?.name.includes('glass')) missing++;
      // A doorway has priority where input metadata incorrectly overlaps a window.
      const overlappingDoor = plan.openings.some(d => d.type !== 'window' && d.axis === o.axis && Math.abs(d.x - o.x) < d.width + o.width && Math.abs(d.z - o.z) < d.width + o.width && d.y < o.y + o.height && d.y + d.height > o.y);
      if (missing && !overlappingDoor) issues.push({ code: 'window-unsealed', severity: 'error', id: o.id, message: `${o.id} is missing ${missing} glazing cells.` });
    } else {
      let clear = false;
      for (let w = 0; w < o.width; w++) if (bodyClear(grid, o.x + .5 + (o.axis === 'z' ? w : 0), o.y, o.z + .5 + (o.axis === 'x' ? w : 0))) clear = true;
      if (!clear) issues.push({ code: 'door-blocked', severity: 'error', id: o.id, message: `${o.id} has no player-sized clear threshold.`, at: { x: o.x, y: o.y, z: o.z } });
    }
  }
  const lightRooms = plan.rooms.filter(r => r.kind !== 'court').map(r => {
    const samples = lightSamples(r, grid), values = samples.map(p => field.at(p.x, p.y, p.z)), minimum = values.length ? Math.min(...values) : null;
    const below = values.filter(v => v < INTERIOR_LIGHT_TARGET).length;
    if (below) issues.push({ code: 'low-interior-light', severity: minimum === 0 ? 'error' : 'warning', id: r.id, message: `${r.name}: ${below} walkable floor samples are below the design target ${INTERIOR_LIGHT_TARGET}; minimum ${minimum}.` });
    return { id: r.id, minimum, samples: samples.length, belowTarget: below };
  });
  let testedColumns = 0, leaks = 0;
  const cut = airCuts(plan);
  for (const c of plan.components) for (const r of plan.rooms.filter(r => r.componentId === c.id && r.ceilingY === c.topY && r.kind !== 'court')) {
    for (let z = r.bounds.z + 1; z < r.bounds.z + r.bounds.d; z++) for (let x = r.bounds.x + 1; x < r.bounds.x + r.bounds.w; x++) {
      if (!insideRoom(r, x, z)) continue;
      // Named/existing vent cuts and designed roof stairheads are checked as their own features, not filled shut.
      if (cut(x, c.topY, z)) continue;
      testedColumns++; let covered = false;
      for (let y = c.topY; y <= c.topY + 40; y++) if (grid.get(x, y, z)) { covered = true; break; }
      if (!covered) { leaks++; if (leaks < 8) issues.push({ code: 'envelope-leak', severity: 'error', id: r.id, message: 'An occupied top-storey column has no ceiling or roof above it.', at: { x, y: c.topY, z } }); }
    }
  }
  const minima = lightRooms.flatMap(r => r.minimum === null ? [] : [r.minimum]);
  const result: BuiltAudit = { valid: !issues.some(i => i.severity === 'error'), issues,
    walking: { nodes: graph.nodes.length, reached: graph.reached.reduce((a, b) => a + b, 0), entry: graph.root < 0 ? null : graph.nodes[graph.root], rooms }, stairs,
    lighting: { target: INTERIOR_LIGHT_TARGET, minimum: minima.length ? Math.min(...minima) : null, sources: field.sources, samples: lightRooms.reduce((n, r) => n + r.samples, 0), belowTarget: lightRooms.reduce((n, r) => n + r.belowTarget, 0), rooms: lightRooms },
    envelope: { testedColumns, leaks }, model: 'Conservative AABB walking / half-block lattice / no jumps / block light without skylight. Not an in-game physics certification.' };
  grid.buildAudit = result; grid.auditedRevision = grid.revision; grid.auditKey = auditKey; return result;
}
export function assertBuildable(plan: Plan, grid: SparseBlocks): BuiltAudit {
  const report = auditBuiltModel(plan, grid);
  if (!report.valid) { const errors = report.issues.filter(i => i.severity === 'error'); throw new Error(`Finished build failed ${errors.length} physical checks: ${errors.slice(0, 5).map(i => i.message).join(' ')} Your previous build is retained.`); }
  return report;
}
