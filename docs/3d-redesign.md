# Exportable architectural detail

This change treats the 3D building as architecture, not as a lighting preset. It leaves `architecture.ts`, the room program, component composition, navigation, floor drawing, and structural audit unchanged.

## Design direction

The user-supplied `Raidproof_Castle.litematic` and `Skyhold_Keep2.litematic` informed the treatment of roof silhouettes, projecting cornices, capped battlements, window surrounds and stone/timber contrast. They are independent reference builds, not outputs of this generator. Their source files and assets are not included or copied into the application.

The implementation adds pitched stair-block roofs with verge and ridge treatments; steeper tower roofs and finials; battlements following the actual polygon rather than its bounding rectangle; ledges and corbels; alternating corner masonry; deterministic, clustered stone variation; framed window openings; hall/chapel buttresses; chimney collars/pots; and directional stair treads. Upper timber framing uses oriented stripped spruce logs. It does not add a new floor-plan family, import reference builds, or claim to reproduce their hand-built quality.

## One shared architectural model

`buildDetailedModel(plan)` returns a raw structural grid and a final detailed grid. The worker meshes the final grid and uses it for block-layer requests. Whole-building export compiles the same model. Floor drawings and floor-outline schematics still use the structural grid.

A sparse sidecar palette stores exact block states without changing existing material/role IDs. Full cubes retain greedy meshing. Stairs, slabs and isolated wall posts use exact quarter-block occupancy. Interfaces remain visible when roofs are hidden or storeys exploded. Every state used by this compiler has a corresponding vanilla block name/properties in the NBT palette; decoration is not a viewer-only mesh.

Room interiors, door/window volumes, stairs, court reservations, approach routes and explicit air cuts are protected. Added roofs and details cannot replace non-roof structural cells. Export bounds grow to enclose roof peaks and negative-coordinate overhangs. The NBT writer retains version 5 and Minecraft data version 2586 and writes `Properties` separately from `Name`.

The viewer uses material-specific colors, directional shadows, a neutral ground plane and camera fitting based on the actual mesh bounds. Fit, entrance-facing Front and Top presets supplement the existing controls. It is not a Minecraft texture-pack renderer; block layers still show material categories rather than oriented stair/slab symbols.

## What changed when this was merged

Two passes wanted the same job. `lib/dressing.ts` — a separate exporter-only pass over the voxel grid — was
stronger on material and contents; this one is stronger on form and feeds the viewer as well as the export.
They were merged into this module rather than kept side by side, and `lib/dressing.ts` was deleted:

- The stone field, per-kind stone sets, plinth, window panes, floor boards and flags, lanterns and the
  fittings pass all moved here, so the 3D view shows them too rather than only the export.
- Every state was re-picked so it exists in Java 1.16.5, which is the data version the schematic writer
  claims. That ruled out the tuff, deepslate, candles and chiseled bookshelves the old pass used: a block
  name the client cannot resolve is not a nicer stone, it is a hole.
- `lib/build.worker.ts` keeps the `only`/`alternatives` plumbing that lets a reader pick a different
  composition for the same seed; the package's version had dropped it.
- `lib/litematica.ts` keeps its notes on why the writer targets schematic version 5 and data version 2586,
  and gains this package's palette validation and detailed-model default.
- `prepareMeshes` caches the state sidecar per chunk and each shaped cell's six neighbours. Without that,
  meshing the largest estate cost 2.1 s rather than 1.5 s.

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
| `npm run test:architecture` | 13 focused + 12 integration tests pass |
| `npm test` | 71 tests pass |
| `npm run typecheck`, `npm run build` | clean |
| `npm run lint` | 32 errors, all pre-existing |
| 360-setting compile sweep (3 kinds × every family × 6 sizes × 5 storey counts) | 0 failures; detail mean 183 ms, slowest 501 ms; mesh mean 737 ms, slowest 1844 ms; 95 distinct block states, every one a well-formed vanilla id that exists in 1.16.5 |
| `node lib/regression-batch.ts 200` | 200/200 validity, 200/200 search success — the generator is untouched by this change |
| Cross-process determinism | the NBT of twelve families hashes identically in three separate processes |

The focused suite covers shape area/winding, face culling across negative and positive chunk boundaries,
roof/floor separation, stale state removal, immutable source plans, clear entrances/interiors/louvers/courts/
stairs, polygonal battlements, deterministic output, export extents and independent gzip/NBT/property/packed-cell
round trips. The integration suite exercises every architectural family at OUTLINE/224/3 and verifies
structural preservation, unchanged outlines, opening clearances, cell-by-cell export identity, and
finite/index-valid meshes.

**Not run here:** a live browser session, and an actual paste in Minecraft. The tests protect the geometry and
the file format; they do not certify a pleasing silhouette for every seed.

For the preview and sample schematic, `scripts/detail-fixture.ts` builds a deliberately small structural
fixture. It is not an application-generated castle or a game screenshot.

## Manual acceptance

Open representative castles and manors in the application; inspect all elevations and close-up roof
junctions; test roof hiding, isolated floors, exploded floors, clipping and room selection; then export and
paste the same build in Minecraft/Litematica. Check facing/half properties, roof junctions, doorways, stair
landings, louver shafts, courtyard openness and maximum-height bounds.

There are no new dependencies. Source plan JSON remains the original structural design; exact decorative
states are reconstructed deterministically for 3D and whole-building export. The optional explicit raw grid
parameter to `wholeBuilding` preserves structural-only export for callers that need it.
