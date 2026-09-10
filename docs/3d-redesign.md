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

## What changed when this was merged

The package was written against an upstream that predates the first redesign merge, so it was applied by hand rather than by its installer, and three things were carried across it:

- `lib/build.worker.ts` and `lib/litematica.ts` keep the composition-alternatives plumbing and the writer's own notes on why it targets schematic version 5 and data version 2586.
- `prepareMeshes` buckets the state sidecar per chunk, reads each of a shaped block's six neighbours once instead of once per sub-block face, promotes only the face that actually meets a finer neighbour, and allocates nothing in its inner loop. Without that, meshing the largest estate cost 4.1 s rather than 2.6 s.
- `chain()` no longer declares an `axis`, which a chain does not have before 1.17 — the one state in the package that fell outside the version the writer claims.
- The lint fixes and typed test helpers the repository already carried were reapplied on top of the package's files.

Panes, per-kind stone sets and a separate plinth pass from the first merge are gone, superseded by this package's glazing, masonry patches and facade base course.

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
| `npm run test:architecture` | 21 focused + 12 integration tests pass |
| `npm test` | 79 tests pass |
| `npm run typecheck`, `npm run build` | clean |
| `npm run lint` | 32 errors, all pre-existing |
| 360-setting compile sweep (3 kinds × every family × 6 sizes × 5 storey counts) | 0 failures; compile mean 305 ms, slowest 805 ms; mesh mean 1164 ms, slowest 2721 ms; 73 distinct block states, every one a well-formed vanilla id that exists in 1.16.5 |
| `node lib/regression-batch.ts 200` | 200/200 validity, 200/200 search success — the generator is untouched by this change |
| Cross-process determinism | the NBT of twelve families hashes identically in separate processes |

The focused suite covers mesh surfaces and chunk boundaries, thin sixteenth-block elements, floor/roof interfaces, protected openings and stair headroom, unchanged structural outlines, determinism, large-reference structural preservation, paired beds and lantern attachment, export bounds, NBT properties and bit packing, and GLB buffer/material data. The integration suite exercises every architectural family at OUTLINE/224/3.

**Still not run here:** live-browser interaction, and a Minecraft/Litematica paste. The writer declares schematic version 5 and data version 2586, and every state the compiler can write exists in Java 1.16.5; in-game block updates, lighting coverage, mob spawning, inventories and exact client-side shape reconciliation are not certified. Connected block cells are not proof of physical contact between every partial shape, and the reference's complete room-to-room navigation has not been certified.

Before merging anything further, inspect several real castle and manor seeds, small footprints and adjoining roof heights. Check doors, stairs, courtyard openness, roof visibility, isolation and GLB export; then paste into a disposable world. The schematic includes air within its envelope, so take care when pasting into an existing build.
