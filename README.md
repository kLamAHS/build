# Keepwright

A medieval build-planning application with deterministic castle, manor, and house generation; furnished room plans; planned household circulation; drawing layers; and PNG, SVG, and JSON exports.

## Development

Use Node 22.13 or later, `npm install`, and `npm run dev`. Run `npm run build` to produce the Cloudflare Worker bundle.

## Checks

`npm test` checks deterministic generation, 3,150 combinations of footprints and room geometry, aligned floors, size-dependent room counts, feature options, agent-tool input contracts, and the circulation rules below. `npx tsc --noEmit` checks types.

## Circulation

Circulation is planned before rooms are cut. Passage positions are chosen for the whole composition at
once so that two adjoining ranges line up in the wall they share; a range met part-way along its flank
grows a passage down that flank, and one met end-on is entered at that end. Doors then follow a household's
access grammar rather than whichever walls happen to touch:

- Every room that is not circulation has its own door onto circulation, so no chamber is a corridor.
- No room a household would not cross carries another room's only route. The test is whether closing a
  room strands another one, so a bedchamber with a door to its own wardrobe is correctly not a defect.
- A chapel is sited off the great chamber or the hall, keeps its own antechapel, and is entered only from
  circulation. Service reaches the hall through the screens passage, not through the hall body.
- Loop closure adds passage-to-passage doors where the walk is longest, so a plan is never a bare tree
  with exactly one route to everywhere.

`lib/navigation.ts` measures this and `plan.navigation` carries the result: a navigability score, the
number of independent routes, the deepest reach in doors, and any room a household is still forced to
cross. `tryGenerate` composes several candidates and keeps the one that walks best. The studio shows the
score beside the plan name and the door-by-door walk from the entrance for whichever room is selected.

## Model and scope

Plans are deterministic from the complete settings and seed. A plan unit represents one chosen block, metre, or foot; changing the unit label is a scale interpretation, not a conversion. Room measures are approximate. These are conceptual creative build plans, with furnished floor diagrams and a floor overview. They do not export Minecraft schematics, construction documents, terrain-aware placement, or a solid 3D model.

The app keeps its active plan in memory. Download JSON to preserve the generated geometry and settings; the same seed and settings reproduce a plan. No API key or external generation service is required.

## Agent tools

When a browser supports `document.modelContext`, the app registers `generate_blueprint`, `read_blueprint`, and `show_blueprint_floor`. Contract tests use a simulated registry; no supported live WebMCP validation context was available during implementation. Browser UI testing was not requested or performed.
