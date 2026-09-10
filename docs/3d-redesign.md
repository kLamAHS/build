# Keepwright architectural compiler · second iteration

## Architecture, not just surface decoration

The floor-plan generator remains authoritative. `buildDetailedModel(plan)` compiles its accepted structural plan into a more elaborate block-state building. The worker, whole-building Litematica export, block-layer inspector and GLB exporter share that result. Floor drawings and floor-outline schematics continue to use the structural grid.

Larger pitched towers receive a flared lower roof, a glazed upper drum, a second crown and a finial. Suitable battlement towers receive corbel-supported corner turrets. Long gables receive dormers, carved verge profiles and small gable windows. Facades receive projecting courses, window surrounds, corner piers, entrance surrounds and selected heraldic hangings. Gatehouses receive a developed roof and entrance treatment. A feature manifest records what was actually placed.

Upper motifs are checked as complete groups before placement. Existing openings, rooms, stair clearance, routes, air cuts and open-court reservations constrain decoration. Non-roof, non-furniture structural blocks are retained. Furniture is remodeled within existing fitting footprints, including paired beds, shelving, benches, tables, barrels and selected work fittings. Lanterns are suspended from real overhead cells. This is not a second room-layout algorithm.

## Implementation

`architectural-detail.ts` orchestrates structural replay, protection masks, roof replacement and seeded material patches. `architectural-language.ts` adds the architectural motifs. `architectural-furnishings.ts` handles fittings and interior lights. `detail-context.ts` and `block-states.ts` define their shared state/shape vocabulary.

`voxels.ts` contains sparse structural/state grids and mixed-resolution partial-block meshing. Thin elements use sixteenth-block occupancy where needed; stairs and slabs use lower-resolution box shapes. Meshes batch by material/color, roof ownership and floor rather than by stair orientation.

`litematica.ts` retains upstream's object-based `{name, props}` palette API, writes NBT properties, and calculates completed export bounds. Passing an ordinary structural grid to `wholeBuilding` still compiles it; a version-marked detailed grid is reused directly. `gltf.ts` writes binary glTF without a new dependency. The viewer's GLB button exports the complete, uncut model in Y-up block units; hidden roofs and exploded-view offsets do not change that export.

`build.worker.ts` preserves upstream composition alternatives and the optional candidate-attempt argument. No application dependencies are added. The generator, model, navigation, structural audits, page composition picker and lockfile are not replaced. The earlier export-only `dressing.ts` pass is gone: everything it did that this compiler wants is inside the compiler, where the viewer sees it too.

## Crownward Citadel reference

`showcase-plan.ts` defines an **authored Plan-format composition** for inspecting the compiler at castle scale: twelve primary components, a separate ward gatehouse, forty-six room records and seven floor levels. The terraced podium, site layout and volume arrangement are authored in the example. They are not new layout rules inserted into the application's generator.

This reference is **not output from the candidate search** in `architecture.ts`. Its Plan validation flag explicitly records that it has not been ranked or certified by that search. The rooms and stairs are real structural geometry, but its complete navigation graph has not been certified. Do not treat this sample as evidence that every seed produces its massing or that every room has a validated playable route.

Regenerate it from the repository root:

```sh
npm run showcase:architecture -- ./exports/crownward
```

The script writes Litematica and GLB files, structural/detailed mesh data, the Plan and a feature report. The included PNGs render this actual geometry, not an image-model concept and not a Minecraft screenshot. They use flat material colors, not Minecraft textures. Some decorative fitting shapes are simplified; their block IDs and properties are preserved for the game to render. Texture-perfect visual parity is not claimed.

## The third pass: a building you can walk through

`buildDetailedModel` now compiles the inside as well as the outside, and finishes by auditing the result.
After the architectural language has composed roofs, facades and ornament:

- `building-repairs.ts` repairs the envelope (roof cells inside occupied rooms, walls a later range drove
  through an earlier one's interior, top-storey ceilings, the knee wall under a deep eave, missing foundation
  courses) and re-opens every declared portal through its own reveal, with a threshold you walk across, a
  glazed aperture for each light, and a stair apron down to the ground outside an exterior door.
- `interior-layout.ts` strips the old cuboid fittings, then reserves the actual routes between doors,
  landings and each room's usable middle before any furniture is placed.
- `interior-stairs.ts` designs each flight as an assembly — switchback where the shaft allows it, otherwise a
  straight run — with real landings, sloping strings and balustrades, cuts its well and builds it. The same
  assemblies drive both the carving and the validation.
- `architectural-furnishings.ts` rebuilds each fitting at room scale within its existing footprint, drafted
  whole and placed only if all of it fits, and finishes floors, panelling, ceilings and carpets.
- `interior-lighting.ts` hangs lanterns on chains from real overhead blocks, measures the block light on
  every walkable floor sample, and hangs more until nothing is below the design target.
- `walkability.ts` and `built-audit.ts` then put a 0.6 × 1.8 body into the finished blocks and try to walk:
  every room reachable from the entry, every stair connecting its landings, every doorway clear, every window
  glazed, every top-storey column covered, nothing dark. The verdict rides on the model as `audit`, reaches
  the worker, and is shown in the studio beside navigability and composition.

The model is conservative and deliberately not the game: a box on a half-block lattice, no jumping, block
light with no daylight. It cannot certify that Minecraft agrees. It can and does fail loudly when a building
is unbuildable.

## What changed when this was merged

The package was written against an upstream that predates the first redesign merge, so it was applied by hand rather than by its installer, and three things were carried across it:

- `lib/build.worker.ts` and `lib/litematica.ts` keep the composition-alternatives plumbing and the writer's own notes on why it targets schematic version 5 and data version 2586.
- `prepareMeshes` buckets the state sidecar per chunk, reads each of a shaped block's six neighbours once instead of once per sub-block face, promotes only the face that actually meets a finer neighbour, and allocates nothing in its inner loop. Without that, meshing the largest estate cost 4.1 s rather than 2.6 s.
- `chain()` no longer declares an `axis`, which a chain does not have before 1.17 — the one state in the package that fell outside the version the writer claims.
- The lint fixes and typed test helpers the repository already carried were reapplied on top of the package's files.

Panes, per-kind stone sets and a separate plinth pass from the first merge are gone, superseded by this package's glazing, masonry patches and facade base course.

The interior package arrived as seven modules with no installer, written against the reference composition
rather than against the generator's own output. Hooking it up meant fixing what only the real generator
shows, all of it in the package's own modules:

- A doorway's threshold is relabelled as the floor you walk across. The mass under a door is part of the
  wall, and an audit that reads roles rather than blocks saw every internal doorway as a cliff — the whole
  house came apart into one component per room.
- A flight goes in the shaft the plan declared. Centring it in the middle of a chamfered tower instead was a
  fallback for a shaft that does not fit, not the ordinary case, and it drove every cellar stair through a
  partition wall.
- Outward is measured from the room a doorway belongs to, not from the yard it opens onto: a court's centre
  is on the wrong side, and the reveal, threshold and step were being cut backwards into the building.
- One window's reveal no longer un-glazes another's aperture where two rooms claim the same wall cell, and
  glass the massing left outside any declared aperture is removed rather than left hanging.
- Stale fittings are stripped before the openings are reconciled, so a yard well no longer blocks the step
  outside the only door out of a range.
- The doorway approach is reserved for two cells past its reveal, and lamps respect that reservation; a lamp
  hangs one course below a ceiling rather than two, so a four-block gabled storey can have one at all; a lamp
  hangs from anything solid across its underside; and a pitch-dark spot always gets its own lamp, because
  straight-line distance to another lamp says nothing about the wall between them.
- `airCuts` indexes a plan's declared vents by column, `SparseBlocks.get` caches its chunk, the audit reads
  its standing positions out of the graph's own column index, and the shaped-block mesher walks each shape's
  occupied span. Together those took the largest building from 9.9 s to compile, audit and mesh down to 3.6 s.

The interior hotfix that followed carried the same integration problem — it was built on the modules as they
arrived rather than as they were fixed — so three things were taken from it and the rest left alone:

- `trapdoor()` is the package's: an open one hangs on the face opposite the one it faces, which is what the
  vanilla model does and the reverse of what the earlier version assumed, and a closed one defaults to the
  bottom of its cell, which is where a table top on fence legs belongs.
- The whole-building export refuses to write a schematic that fails the finished-building audit. `audited:
  false` exists only for the authored reference and the test fixtures, which are not generator output and
  whose navigation their own documentation calls uncertified.
- Portals are reconciled once more after the interior finishes, so a beam or a carpet cannot have the last
  word over a declared doorway.

Its own diagnosis — `furnishInteriors` being called with one argument — was already fixed when the modules
were first wired up, and its orchestration reverts the six fixes that took the generator's own output from 84
failing buildings to none, so it was not applied.

The walking audit also starts at the door rather than at `plan.entry`: in an authored composition the entry
can be the foot of an approach fifty blocks away and six courses below the threshold. And a full-cube top at a
room's own floor level now counts as somewhere to stand — a three-block wall with a doorway through its outer
face leaves masonry at floor level a course further in, and reading that as a cliff cut the Crown Keep off
from its own door.

## Validation

Run from the repository root:

```sh
npm run test:architecture
npm test
npm run typecheck
npm run build
```

What was actually run, in this repository, against the real generator:

| Check | Result |
|---|---|
| `npm run test:architecture` | 21 focused + 7 walkability + 12 integration tests pass |
| `npm test` | 86 tests pass |
| `npm run typecheck`, `npm run build` | clean |
| `npm run lint` | 32 errors, all pre-existing |
| 360-setting compile sweep | 0 failures; every block state a well-formed vanilla id that exists in 1.16.5 |
| 144-setting built audit (every family × 4 footprints × 3 storey counts) | 0 buildings with an error: every room walkable from the door, every stair connected, every portal clear, every aperture glazed, no uncovered column, nothing dark. Slowest compile-and-audit 3.3 s |
| `node lib/regression-batch.ts 200` | 200/200 validity, 200/200 search success — the generator is untouched by this change |
| Cross-process determinism | the NBT of twelve families hashes identically in separate processes |

The focused suite covers mesh surfaces and chunk boundaries, thin sixteenth-block elements, floor/roof interfaces, protected openings and stair headroom, unchanged structural outlines, determinism, large-reference structural preservation, paired beds and lantern attachment, export bounds, NBT properties and bit packing, and GLB buffer/material data. The integration suite exercises every architectural family at OUTLINE/224/3.

**Still not run here:** live-browser interaction, and a Minecraft/Litematica paste. The writer declares schematic version 5 and data version 2586, and every state the compiler can write exists in Java 1.16.5; in-game block updates, lighting coverage, mob spawning, inventories and exact client-side shape reconciliation are not certified. Connected block cells are not proof of physical contact between every partial shape, and the reference's complete room-to-room navigation has not been certified.

Before merging anything further, inspect several real castle and manor seeds, small footprints and adjoining roof heights. Check doors, stairs, courtyard openness, roof visibility, isolation and GLB export; then paste into a disposable world. The schematic includes air within its envelope, so take care when pasting into an existing build.
