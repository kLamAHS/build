# Litematica outline markers

Keepwright writes three kinds of `.litematic`. This document is about the third.

| Export | Module | What is in it |
| --- | --- | --- |
| Complete building | `wholeBuilding` in `lib/litematica.ts` | Every block of the compiled building — masonry, roofs, glazing, lights and fittings |
| Floor outline | `floorOutline` in `lib/litematica.ts` | One floor's wall course at its real thickness: stone brick wall, glass window, plank threshold |
| **Outline markers** | **`lib/litematica-outlines.ts`** | **The wall lines of one floor or every floor, at a scale and height you choose, as a single marker block** |

The markers are a hologram to stand inside and build against, not a building. They answer the question you
have before you start laying courses — where do the walls go, and is this the right size — which is the one
question a complete schematic answers worst, because it is already the finished building.

Two ways in:

- **Export → Outline markers · Litematica** in the studio, on the plan currently on screen.
- **`/litematica`**, which opens a `Complete building · JSON` file you exported earlier. The file is read,
  checked and converted in the tab; nothing is uploaded.

## What is marked

Every floor is cut at `floor.elevation + 2`, the same height `lib/build.worker.ts` cuts the floor plan at. A
cut at the floor itself is an unbroken ring that tells you nothing; head height is the course a doorway is a
gap in.

Walls, supports, chimneys and glass become markers. Glass is in so that a window wall keeps an unbroken
line. Roofs, floor slabs, furniture and ground are left out. Stairs are optional and get their own gold
block; they show the stair where it crosses that cut, not the whole flight.

Interior partitions are marked along with the exterior walls, at whatever thickness the plan gives them.
This is not a perimeter trace.

`plan.blocks` is read in the order the generator wrote it, boxes of air included — the same sampling
`voxelize()` does — so a wall the generator put up and took down again does not survive as an outline.
Anything outside `plan.bounds` is clipped, as the block-layer view clips it, and the export says so.

## Scale, height and elevation

Horizontal scale 1–4 turns one plan block into an N × N footprint. Marker height 1–5 repeats the flat
outline upwards; it does not raise real walls, lintels or window heads. **Storey spacing is never scaled** —
at scale 4 the walls are four times as wide and the floors are still six blocks apart, so an outline height
that would reach into the floor above is refused rather than drawn.

Every floor is its own named region: `Floor_-1`, `Floor_0`, and so on. Exporting all floors keeps the plan's
own elevations, with Y 0 the ground datum and cellars below it; place the schematic where you want the
ground floor and the rest follows. Exporting one floor puts it at Y 0. Either way X and Z come from
`plan.bounds`, so separately exported floors still line up with each other.

## In Minecraft Java Edition

1. Put the file in the `schematics` folder of the instance running Litematica — that instance's game
   directory, not another installation.
2. Open Litematica (**M** unless rebound) → **Load Schematics**, select the file and load it with **Create a
   placement** enabled.
3. Position the placement, then build against the hologram. Exporting places nothing in the world.

A region is a box with air between the markers. Pasting one in creative with replacement enabled writes
that air too, which will cut into whatever is already standing there. Check your world's build limits before
placing a tall all-floors export.

## The file

Gzipped big-endian NBT, schematic version 5, Minecraft data version 2586 — the same versions
`lib/litematica.ts` writes, for the reason `lib/nbt.ts` gives: every Litematica since 1.13 reads version 5
where the older ones refuse 6, and a data version behind the client is upgraded where one ahead is refused.
Both exporters share one NBT writer, one bit packer and one gzip envelope, so there is only ever one answer
to what version Keepwright writes.

Air is palette entry 0. A region carries at most three states and is packed at the format's two-bit minimum,
x fastest, then z, then y. NBT strings are Java's modified UTF-8, so a building named with an emoji still
reads back. `CompressionStream` does the gzip where it exists, and a stored-deflate writer does it where it
does not.

## Limits

A file read at `/litematica` is untrusted, so it is checked before anything is allocated for it: 64 MiB of
JSON, 16 floors, a million boxes, 2048 × 2048 bounds. The export itself is capped at 16,777,216 region cells
and 100 million sampled paint operations — hostile overlapping boxes cannot buy unbounded work. Every
refusal names what to change.

## What has been checked

`lib/litematica-outlines.test.ts` is 22 tests read back by an NBT reader written from the format rather than
from the writer: elevations and cellars, the cut, ordered overwrites, scale and height, palettes and floor
colours, packing across a long's sign bit, metadata, clipping, empty floors, malformed input, the budgets,
the gzip fallback at its block boundaries, and the outline of two generated estates, where every doorway
standing at the cut must be a gap you can walk through.

Exported files have been parsed and their block counts recounted independently, including the Crownward
showcase read back from a saved `plan.json`. A live Minecraft and Litematica session has not been run here.
