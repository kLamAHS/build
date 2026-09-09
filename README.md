# Keepwright

A medieval build-planning application with deterministic castle, manor, and house generation; furnished room plans; aligned floor circulation; drawing layers; and PNG, SVG, and JSON exports.

## Development

Use Node 22.13 or later, `npm install`, and `npm run dev`. Run `npm run build` to produce the Cloudflare Worker bundle.

## Checks

`node --test lib/generator.test.ts lib/blueprint-tools.test.ts` checks deterministic generation, 3,150 combinations of footprints and room geometry, aligned floors, size-dependent room counts, feature options, and agent-tool input contracts. `npx tsc --noEmit` checks types.

## Model and scope

Plans are deterministic from the complete settings and seed. A plan unit represents one chosen block, metre, or foot; changing the unit label is a scale interpretation, not a conversion. Room measures are approximate. These are conceptual creative build plans, with furnished floor diagrams and a floor overview. They do not export Minecraft schematics, construction documents, terrain-aware placement, or a solid 3D model.

The app keeps its active plan in memory. Download JSON to preserve the generated geometry and settings; the same seed and settings reproduce a plan. No API key or external generation service is required.

## Agent tools

When a browser supports `document.modelContext`, the app registers `generate_blueprint`, `read_blueprint`, and `show_blueprint_floor`. Contract tests use a simulated registry; no supported live WebMCP validation context was available during implementation. Browser UI testing was not requested or performed.
