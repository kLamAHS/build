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

## Room proportion and the grain of a range

A minimum area is satisfied by a strip ninety blocks long, and a target with no ceiling is satisfied by
whatever the passages happen to leave over. Both produce the same building: a solar, a pantry and a
household dining room each drawn as a band the length of the wing. So every room type carries an upper
bound as well — the extent it wants along its rank, a proportion band it may not leave, and an area ceiling
(`ROOM_FIT`). A range is cut into rooms in the order its programme matters, each taking the extent its own
use asks for; what is left at the end is too small to stand as a room and goes back to the room before it,
rather than being named as one. The audit rejects a candidate holding an ordinary room past 3.2:1 or past
760 blocks, so a composition that cannot hold its programme is retried rather than furnished.

The other half of the problem is which way a range is cut. A wing eighty blocks deep and twenty wide cannot
be divided by a passage across it: both halves come out as strips the length of the wing. Such a range is
walked along its length instead — one gallery down the flank that faces the rest of the house, with a rank
of rooms behind it. A range along a court is walked on the court side, so the yard is fronted by a walk
rather than by the backs of chambers. A range too deep for one rank takes the gallery down its middle with
a rank either side. Where a neighbouring range meets a flank the gallery does not reach, the rank is capped
with a cross passage at that end, so nobody's chamber becomes the way through.

Across a 288-plan survey the largest room in a range is around ten times the smallest, no ordinary room is
more than 2.5 times its own width, and the largest has taken 551 blocks. Before this, one in twenty-nine was
past three times its width, the worst was eighteen times, and one pantry had taken 3,220.

Shape carries meaning where it can. A chapel nave closes on a stepped half-round at the end furthest from
its door. A great hall's high end is canted back toward the dais — except at a corner another range stands
against, which stays square, because that is where its door has to go. A principal room wraps a closet in its
angle, and the closet keeps its own frontage on the passage so it is entered from circulation rather than
through the room it is cut from. A chamber in the head of a tower is closed as an octagon.

The voxel pipeline follows `Room.polygon` throughout — walls, floor, windows, the drawing and the audit —
so these are real geometry rather than a drawing convention. Two rules bound them: a room keeps one
straight four-block run of wall to receive its door, and its floor never pinches below the two walkable
blocks a household needs.

## The courtyard castle

`courtyard-castle` is the archetype laid out site first. The court is placed before anything else, and the
ranges are set against it: the great hall closes the head of the yard with its screens end opening onto it,
the kitchen range runs down the service side, the private accommodation and the chapel down the other, and
a gatehouse closes the foot with a carriage passage and lodging either side of it. A well stands in the yard.

Each range is one rank of rooms deep behind a court gallery, which is what makes the yard read as a yard;
the budget past that goes into the court rather than into the depth of the wing. The hall is entered
through its own screens and, at the dais, from the private side — never off the passage running along its
flank, which is what turns a great hall into a wide corridor.

The court is a room of the plan rather than a border drawn round it, so ranges are entered from the yard
and the approach reads as a sequence: **gate passage, court, screens passage, hall.** Nothing is discovered
by packing rooms and drawing a wall round the result. Below 128 blocks there is not enough ground for a
quadrangle and the composition falls back to the hall-and-wings massing.

## The household, and the site it stands on

The generator organises a household before it divides rooms.

A **suite** is a set of rooms occupied together: a chamber with the closet cut from its angle. The closet is
entered through its chamber and never takes a door onto a passage, so a wardrobe belongs to the room it
serves rather than opening off the corridor. A chamber carrying only its own suite is not counted as a
forced crossing; carrying anything else still is.

The **hall** is longer on its dais-to-screens axis than it is wide. A dais carries the high table across the
head of the room, the open hearth sits on the centre line, and the household tables run down the length
toward the screens passage, which is where the service doors are. A **kitchen, bakehouse or brewhouse** gets
a great fire, an oven and a dressing table. Fires, ovens, wells, daises and altars are drawn as
installations, so a room can be told from its fittings with the labels off.

A **defended enclosure** is a building rather than a border: a curtain three blocks thick, a gatehouse
astride it with a vaulted passage through the middle and a guard chamber to each side, and turrets carried
above. Its yard does the household's outdoor work — a stable range, a service yard, and the well the
kitchen draws from.

## Model and scope

Plans are deterministic from the complete settings and seed. A plan unit represents one chosen block, metre, or foot; changing the unit label is a scale interpretation, not a conversion. Room measures are approximate. These are conceptual creative build plans, with furnished floor diagrams and a floor overview. They do not export Minecraft schematics, construction documents, terrain-aware placement, or a solid 3D model.

The app keeps its active plan in memory. Download JSON to preserve the generated geometry and settings; the same seed and settings reproduce a plan. No API key or external generation service is required.

## Agent tools

When a browser supports `document.modelContext`, the app registers `generate_blueprint`, `read_blueprint`, and `show_blueprint_floor`. Contract tests use a simulated registry; no supported live WebMCP validation context was available during implementation. Browser UI testing was not requested or performed.
