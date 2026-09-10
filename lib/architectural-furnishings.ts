import { insideRoom, type Furniture, type Room } from './model.ts';
import { solid, slab, stair, fence, timber, bed, barrel, campfire, machine, brewingStand, lectern, enchantingTable, anvil, trapdoor, carpet, flowerpot, pane, type BlockState, type Facing } from './block-states.ts';
import type { DetailContext } from './detail-context.ts';
import type { InteriorLayout } from './interior-layout.ts';
import { setCell } from './building-repairs.ts';

type Piece = { x: number; y: number; z: number; state: BlockState; material: number };
/** A whole fitting either fits, including its bed pair and supports, or none of it is placed. */
class FittingDraft {
  cells = new Map<string, Piece>();
  put(x: number, y: number, z: number, state: BlockState, material = 9) { this.cells.set(`${x},${y},${z}`, { x, y, z, state, material }); }
  box(x: number, y: number, z: number, w: number, h: number, d: number, state: BlockState, material = 9) {
    for (let yy = y; yy < y + h; yy++) for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) this.put(xx, yy, zz, state, material);
  }
}
function faceAway(f: Furniture, target: { x: number; z: number }): Facing {
  const x = f.x + f.w / 2 - target.x, z = f.z + f.d / 2 - target.z;
  return Math.abs(x) > Math.abs(z) ? x > 0 ? 'east' : 'west' : z > 0 ? 'south' : 'north';
}
function draftFitting(room: Room, f: Furniture, canopy: boolean): FittingDraft {
  const d = new FittingDraft(), x = f.x, y = f.y, z = f.z, w = f.w, depth = f.d;
  const facing = faceAway(f, { x: room.bounds.x + room.bounds.w / 2, z: room.bounds.z + room.bounds.d / 2 });
  if (f.type === 'bed') {
    if (w < 2 || depth < 2) return d;
    const bx = x + (w >= 3 ? 1 : 0), bz = z + (depth >= 3 ? 1 : 0);
    d.put(bx, y, bz, bed('north', 'head')); d.put(bx, y, bz + 1, bed('north', 'foot'));
    if (!canopy) return d;
    if (depth >= 3) for (let dx = 0; dx < Math.min(w, 3); dx++) { d.put(x + dx, y, z, timber()); d.put(x + dx, y + 1, z, trapdoor('spruce_trapdoor', 'south', 'bottom', true)); }
    if (w >= 3) { d.put(x + 2, y, bz, barrel()); d.put(x + 2, y + 1, bz, flowerpot()); }
    if (canopy && w >= 3 && depth >= 3 && y + 4 < room.ceilingY) {
      for (const dx of [0, 2]) for (const dz of [0, 2]) for (let dy = 0; dy < 3; dy++) d.put(x + dx, y + dy, z + dz, timber());
      d.box(x, y + 3, z, 3, 1, 3, slab('dark_oak_slab'));
    }
  } else if (f.type === 'table' || f.type === 'desk') {
    const alongX = w >= depth, length = alongX ? w : depth;
    // A long footprint becomes separate boards with end space, not a twelve-block solid cuboid.
    for (let start = 0; start < length; start += 7) {
      const n = Math.min(6, length - start); if (n < 2) continue;
      const xx = x + (alongX ? start : 0), zz = z + (alongX ? 0 : start), ww = alongX ? n : Math.min(2, w), dd = alongX ? Math.min(2, depth) : n;
      for (const dx of [0, ww - 1]) for (const dz of [0, dd - 1]) d.put(xx + dx, y, zz + dz, fence('spruce_fence'));
      d.box(xx, y + 1, zz, ww, 1, dd, trapdoor('spruce_trapdoor'));
      if (f.type === 'desk') d.put(xx, y, zz, barrel());
    }
  } else if (f.type === 'bench' || f.type === 'seat') {
    const table = room.furniture.filter(a => a.type === 'table').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    const back = table ? faceAway(f, { x: table.x + table.w / 2, z: table.z + table.d / 2 }) : facing;
    d.box(x, y, z, w, 1, depth, stair('spruce_stairs', back));
  } else if (f.type === 'shelf' || f.type === 'crate') {
    const h = Math.min(3, f.h), longX = w >= depth;
    for (let yy = 0; yy < h; yy++) for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < w; dx++) {
      const frame = f.type === 'shelf' && (longX ? w >= 3 && (dx === 0 || dx === w - 1) : depth >= 3 && (dz === 0 || dz === depth - 1));
      d.put(x + dx, y + yy, z + dz, frame ? timber() : f.type === 'crate' ? barrel() : solid('bookshelf'));
    }
    if (f.type === 'shelf' && y + h < room.ceilingY) d.box(x, y + h, z, w, 1, depth, slab('dark_oak_slab'));
  } else if (f.type === 'hearth' || f.type === 'oven' || f.type === 'forge') {
    const ax = w >= depth, wide = ax ? w : depth, deep = ax ? depth : w;
    const at = (u: number, v: number, yy: number, state: BlockState) => d.put(x + (ax ? u : v), yy, z + (ax ? v : u), state, state.name.includes('campfire') ? 8 : 9);
    for (let u = 0; u < wide; u++) {
      for (let yy = y; yy < Math.min(y + 3, room.ceilingY - 1); yy++) at(u, 0, yy, solid('bricks'));
      if (u === 0 || u === wide - 1) for (let v = 0; v < deep; v++) for (let yy = y; yy < y + 3; yy++) at(u, v, yy, solid('bricks'));
      if (y + 3 < room.ceilingY) at(u, Math.max(0, deep - 1), y + 3, stair('brick_stairs', ax ? 'north' : 'west', 'top'));
    }
    const u = Math.floor(wide / 2), v = Math.min(1, deep - 1);
    at(u, v, y, f.type === 'hearth' ? campfire(ax ? 'south' : 'east') : machine(f.type === 'forge' ? 'blast_furnace' : 'furnace', ax ? 'south' : 'east'));
    if (f.type === 'hearth' && deep >= 3) at(u, deep - 1, y, pane('iron_bars', ax ? 'x' : 'z'));
    if (f.type === 'forge' && wide >= 4) at(1, deep - 1, y, anvil(ax ? 'north' : 'east'));
  } else if (f.type === 'altar') {
    d.box(x, y, z, w, 1, depth, solid('polished_andesite'));
    d.box(x, y + 1, z, w, 1, depth, slab('smooth_stone_slab'));
    d.put(x + Math.floor(w / 2), y + 2, z + Math.floor(depth / 2), lectern(facing));
  } else if (f.type === 'lectern') {
    d.put(x, y, z, room.name.toLowerCase().startsWith('enchant') ? enchantingTable() : lectern(facing));
    if (w > 1) d.box(x + w - 1, y, z, 1, 2, depth, solid('bookshelf'));
  } else if (f.type === 'still') {
    d.box(x, y, z, w, 1, depth, solid('polished_andesite'));
    d.put(x + Math.floor(w / 2), y + 1, z + Math.floor(depth / 2), brewingStand());
  } else if (f.type === 'well') {
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < depth; dz++) d.put(x + dx, y, z + dz, dx === 0 || dz === 0 || dx === w - 1 || dz === depth - 1 ? solid('stone_bricks') : solid('water'));
  }
  return d;
}
export function furnishInteriors(ctx: DetailContext, layout: InteriorLayout): void {
  const { plan, grid } = ctx;
  const place = (room: Room, draft: FittingDraft, kind: string) => {
    const pieces = [...draft.cells.values()];
    // A yard is bounded by the sky, not by a ceiling: its well is still a fitting that has to fit.
    const roofed = room.kind !== 'court';
    if (!pieces.length || pieces.some(p => p.y <= room.floorY || (roofed && p.y >= room.ceilingY) || !insideRoom(room, p.x, p.z)
      || layout.reserved(p.x, p.y, p.z) || grid.get(p.x, p.y, p.z))) return false;
    // A fitting has at least one real floor support; no floating wardrobe is accepted over a stair hole.
    for (const p of pieces) if (p.y === room.floorY + 1 && !grid.get(p.x, p.y - 1, p.z)) return false;
    for (const p of pieces) setCell(grid, p.x, p.y, p.z, p.state, 'furniture', room.componentId, p.material);
    ctx.features.push({ kind, componentId: room.componentId, blocks: pieces.length, bounds: { ...room.bounds, y: room.floorY, h: room.ceilingY - room.floorY } }); return true;
  };
  for (const room of plan.rooms) {
    for (const f of room.furniture) {
      if (f.type === 'dais') continue; // Its original floor-course geometry is kept.
      if (!place(room, draftFitting(room, f, true), 'fitted-' + f.type)) place(room, draftFitting(room, f, false), 'fitted-' + f.type);
    }
    // Give otherwise-empty large rooms small, coherent activity groups, never a central obstacle field.
    if (room.kind === 'court' || room.area < 80 || room.kind === 'stairs' || room.kind === 'gallery') continue;
    const b = room.bounds, candidates = [
      { x: b.x + 2, z: b.z + 2 }, { x: b.x + b.w - 5, z: b.z + 2 },
      { x: b.x + 2, z: b.z + b.d - 5 }, { x: b.x + b.w - 5, z: b.z + b.d - 5 },
      { x: b.x + 2, z: Math.floor(b.z + b.d / 2) }, { x: b.x + b.w - 5, z: Math.floor(b.z + b.d / 2) },
    ];
    const program: Furniture['type'][] = room.kind === 'bedroom' ? ['crate', 'desk', 'shelf'] : room.kind === 'study' ? ['shelf', 'desk', 'lectern']
      : room.kind === 'service' || room.kind === 'storage' ? ['crate', 'table'] : room.kind === 'sacred' ? ['bench', 'bench'] : ['seat', 'shelf'];
    let placed = 0;
    for (const type of program) for (const p of candidates) {
      const f: Furniture = { ...p, w: 3, d: type === 'shelf' || type === 'bench' || type === 'seat' ? 1 : 2, y: room.floorY + 1, h: type === 'shelf' ? 3 : type === 'crate' ? 2 : 1, type, material: 9 };
      if (place(room, draftFitting(room, f, false), 'room-program-' + type)) { placed++; break; }
    }
    void placed;
  }
}
/** In-place floor/wall treatments and coffered beams; paths and stair headroom take precedence. */
export function finishInteriorSurfaces(ctx: DetailContext, layout: InteriorLayout): void {
  const { grid, plan } = ctx;
  for (const room of plan.rooms) {
    if (room.kind === 'court') continue;
    const b = room.bounds, ceremonial = room.kind === 'hall' || room.kind === 'sacred', stoneFloor = ceremonial || room.kind === 'service' || room.floorY < 0;
    let count = 0;
    for (let z = b.z + 1; z < b.z + b.d; z++) for (let x = b.x + 1; x < b.x + b.w; x++) {
      if (!insideRoom(room, x, z)) continue;
      if (grid.kindAt(x, room.floorY, z) === 'floor') {
        const border = Math.min(x - b.x, b.x + b.w - x, z - b.z, b.z + b.d - z) <= 2;
        grid.setState(x, room.floorY, z, solid(stoneFloor ? border ? 'polished_andesite' : (x + z) % 4 ? 'stone_bricks' : 'andesite' : border ? 'dark_oak_planks' : 'spruce_planks'));
      }
      const ceiling = room.ceilingY - 1, axisX = b.w > b.d, beam = (axisX ? x - b.x : z - b.z) % 6 === 2;
      if (beam && !grid.get(x, ceiling, z) && !layout.reserved(x, ceiling, z)) {
        setCell(grid, x, ceiling, z, timber(axisX ? 'z' : 'x'), 'support', room.componentId, 2); count++;
        // Braced trusses at the hall's edges; never place a brace across a door, gallery or stair.
        if (ceremonial && room.ceilingY - room.floorY >= 10 && Math.min(axisX ? z - b.z : x - b.x, axisX ? b.z + b.d - z : b.x + b.w - x) <= 3) {
          const y = ceiling - 1;
          if (!grid.get(x, y, z) && !layout.reserved(x, y, z)) setCell(grid, x, y, z, stair('dark_oak_stairs', axisX ? z < b.z + b.d / 2 ? 'south' : 'north' : x < b.x + b.w / 2 ? 'east' : 'west', 'top'), 'support', room.componentId, 2);
        }
      }
    }
    // Interior-only panelling on the innermost face of thick rectangular masonry.
    const c = plan.components.find(c => c.id === room.componentId);
    if (!ceremonial && c?.polygon.length === 4) for (let y = room.floorY + 1; y <= room.floorY + 2; y++) {
      for (let x = b.x; x <= b.x + b.w; x++) for (const z of [b.z, b.z + b.d]) if (grid.kindAt(x, y, z) === 'wall') grid.setState(x, y, z, (x - b.x) % 4 === 0 ? timber() : solid('spruce_planks'));
      for (let z = b.z; z <= b.z + b.d; z++) for (const x of [b.x, b.x + b.w]) if (grid.kindAt(x, y, z) === 'wall') grid.setState(x, y, z, (z - b.z) % 4 === 0 ? timber() : solid('spruce_planks'));
    }
    // A low carpet is part of the collision audit, rather than being incorrectly treated as a full cube.
    if (ceremonial || room.kind === 'bedroom' || room.kind === 'study') {
      const cx = Math.floor(b.x + b.w / 2), cz = Math.floor(b.z + b.d / 2);
      for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 1; x <= cx + 1; x++)
        if (insideRoom(room, x, z) && grid.kindAt(x, room.floorY, z) === 'floor' && !grid.get(x, room.floorY + 1, z)
          && !layout.reserved(x, room.floorY + 1, z)
          && !layout.staircases.some(a => x >= a.bounds.x && x < a.bounds.x + a.bounds.w && z >= a.bounds.z && z < a.bounds.z + a.bounds.d && room.floorY >= a.fromY && room.floorY <= a.toY))
          setCell(grid, x, room.floorY + 1, z, carpet(), 'furniture', room.componentId, 9);
    }
    if (count) ctx.features.push({ kind: ceremonial ? 'braced-hall-ceiling' : 'coffered-ceiling', componentId: room.componentId, blocks: count, bounds: { ...b, y: room.ceilingY - 2, h: 2 } });
  }
}
