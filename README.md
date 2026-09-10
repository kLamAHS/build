# Keepwright

A medieval build-planning application with deterministic castle, manor, and house generation; furnished room plans; planned household circulation; drawing layers; and PNG, SVG, and JSON exports.

## Development

Use Node 22.13 or later, `npm install`, and `npm run dev`. Run `npm run build` to produce the Cloudflare Worker bundle.

## Checks

`npm test` checks deterministic generation, 3,150 combinations of footprints and room geometry, aligned floors, size-dependent room counts, feature options, agent-tool input contracts, that every diagnostic overlay draws, and the circulation, composition, proportion and facade rules below. `npx tsc --noEmit` checks types.

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

## Showing the working

A defect in a finished drawing tells you what went wrong and nothing about which stage made it: a room drawn
as a strip could have come from the programme that asked for it, the composition that gave it its ground, or
the cut that divided the range. The plan view carries four overlays that each show one stage, chosen from the
toolbar or by passing `diagnostics` to `PlanDrawing`.

- **Volumes** — every range outlined and labelled with its kind, its proportions, its storeys and how many
  volumes it stands from the hall, with a line for each wall two of them share. This is the composition
  stage: a straggling arm shows here as a chain of high numbers.
- **Circulation** — every doorway drawn as a line between the rooms it joins, every room as a dot carrying
  the number of doors from the entrance, circulation and destinations coloured apart, and any room a
  household is forced to cross ringed in red.
- **Facade bays** — the bay lines each wall was divided into, green where the bay took a light and orange
  where it was refused, with the corner piers marked. This is where a missing window is either a bay that
  was never there or a bay something stood in the way of.
- **Room fit** — every room tinted by how near it stands to the proportion and area the audit will reject it
  at, and labelled with its dimensions and aspect. This is the room-cutting stage.

The bay lines are not redrawn for the overlay: `bayLines` in `lib/composition.ts` is the one description, used
by the generator to place its openings and by the drawing to show where it put them.

## Choosing between compositions

The ranker used to return the first candidate that merely stood up without a forced crossing, whatever it
looked like — so a composition strung out in a chain of sheds was accepted as readily as a building. Every
candidate a seed is worth is now composed and the best of them kept, on two reports rather than one.

`lib/navigation.ts` asks whether you can get there. It now also counts the **compromises**: doors the access
grammar would not have chosen, cut only because nothing else reached — service into the body of the hall, a
chapel opening onto a chamber, a door into the middle of the hall's flank. A plan needing several of them is
connected but compromised, and the score says so.

`lib/composition.ts` asks whether the thing you are getting around is a building. It measures how far the
composition **reaches** from the hall in volumes, what share of its ground it actually uses, how many yards
it holds and addresses, the **hierarchy** between its principal room and its median one, and the share of
rooms with an outside wall — a room with none can never have a window, and that is a massing question rather
than a window one. Each dimension is bounded on its own so none of them can buy off another.

`tryGenerate` ranks on `navigation × 2 + composition`: a forced crossing is the defect this generator exists
to avoid, but between two plans that both walk, the one that is a building wins. It composes the ordinary
budget of candidates — five, or three on a large site, because the fifth is worth about a point of rank and
the eighth barely half of one — and keeps composing past that only while nothing yet walks without a forced
crossing, which is where the effort belongs. Ranking happens on what is cheap to know; only the best
candidate in turn is voxelised for the built check, which costs more than composing them all.

The studio shows both scores with their components beside the plan name.

## What the estate has to house, and how it is set on the ground

Growth used to be a count: every twenty-four blocks of budget bought one more rectangle of `22–30 × 30–38`,
attached to a random range on a random side. That is why the additions all read alike — they were all the
same shape, and the only thing separating one from the next was the label on the rooms.

An estate now starts from a **programme**: lodging for the household and the guests it keeps, the service
groups a kitchen cannot hold, the workshops it works from, the towers a castle keeps, a second domestic range
for its officers. Each entry carries the floor its use needs and the shape that floor should take — a lodging
range is long and one rank deep because a rank of chambers is long and one rank deep; a service court is a
compact block because brewing and baking are; a tower is square. Across a 96-plan survey, 70% of lodging
volumes are ranges (they were 0%) and 55% of towers are compact. Room count follows from the programme
rather than from area: a 224-block estate holds between six and twenty volumes, depending what it must house.

Each entry is then set on the ground by one of three **composition moves**, not by a random side:

- **a wing** square to its host, aligned on one of its ends or centred — an L, a T, or a stepped range;
- **a range across an open yard**, where the yard is part of the composition and only the stretch the two
  ranges share is paved, so the open ends are where a later range can close the court;
- **a cross-range** dropped into a gap two masses already leave facing each other, joining them into one.

94% of compositions now hold at least one interior yard; before, 8% did, and those were the bailey outside the
walls. Every yard is addressed by at least two buildings and is a way through rather than a dead end, and the
ground in front of the door is reserved before anything else is placed, so nothing is ever built across the
approach. An estate that builds a second service court gets a laundry and a dairy rather than a second
kitchen: each further range of a kind takes the next trade the household needs.

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

A range too short for either treatment carries a stair bay down one side and a passage across each end that
another range meets, joined to one another by the bay. Where its passage still misses a neighbour whose own
circulation is already settled — a yard, a hall, a gallery — the passage is deepened to reach it, or run down
that flank instead. One description of where a short range puts its passages answers both the range itself and
every neighbour reading its wall: a neighbour told the passage is somewhere it is not builds nothing to meet
it, and the only way left between the two is a door through whichever chamber happens to be there.

Across a 288-plan survey the largest room in a range is around ten times the smallest, no ordinary room is
more than 3.1 times its own width, and the largest has taken 735 blocks. Before this, one in twenty-nine was
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

## What stands above the ground floor

Every storey above the first used to hold the same accommodation whatever the range was for: bedchambers,
guest chambers and wardrobes, in a building whose ground floor had just been given a solar, a brewhouse and a
smithy. That flattens the hierarchy the composition built.

A range's upper storeys now carry accommodation of their own, chosen by what the range is and which storey it
is. A domestic range gives its first floor to the great chamber with its antechamber and closet and its
second to bedchambers and dressing rooms; a lodging range gives one floor to guests and the next to attic
lodgings; a service range houses the servants and grooms above its work; a workshop keeps its drying and
store lofts. Across a 24-plan survey there are 32 kinds of room above ground where there were 12, and the
commonest is one room in ten rather than one in five.

The hole a stair comes up through is a void, and is drawn as one: its own perimeter, its hatch, and an
annotation, rather than an unexplained grey gap in the boards. The audit rejects a plan where a door opens
onto one — the route test would have caught it as a missing floor, but a household walking off a landing into
the stair well deserves to be told what it is.

## Wall mass

A wall one block thick whatever it carries reads as a line rather than as masonry, and the drawing has to
fake the difference with a heavier stroke. An outside wall now has its real thickness — three blocks on a
castle, two otherwise, one less again where an upper storey is timber-framed — and an internal partition
stays one, so the structural hierarchy is in the geometry rather than in the linework.

The thickness is taken **outward**. A room keeps the floor it was cut with, so nothing downstream of the
composition moves: routes, door approaches, furniture and the audit all still see the plan they were given.
A wall two ranges share is not thickened at all, which keeps it one wall between them rather than two; nor is
the wall a range presents to a yard, since that is a face the yard is entered through. A chamfered tower has
no straight face to take the mass and keeps the shell it was cut with.

Every opening is then cut through the whole thickness, so a door is a passage and a window a reveal rather
than a hole in the inner face with masonry still standing behind it. The audit checks that: a doorway walled
up even one block beyond its face is a rejected candidate, not a drawing to be trusted.

## Facades

A window used to be stamped every seven blocks from each room's own corner, the same two-by-two light for a
pantry as for a great hall, and on an upper storey it fell wherever that floor's rooms happened to divide.

A wall is now divided into **bays** before anything is cut into it. The bay lines come from the range itself —
a pier at each corner, then an even rhythm at roughly six blocks, or seven for a tower, with heavier piers on
a castle and no bay at all inside a chamfered corner. The same lines serve every storey, so an upper light
stands over the one below rather than over nothing. Across the standard set 65% of upper lights now stand
over a lower one, against 48% before.

What a bay gets depends on what is behind it. A hall or a chapel takes a tall light and a second tier above
it where the volume is carried through two storeys; a chamber or a study takes an ordinary one; a store or a
passage takes a slit, set higher. A bay is refused where the wall is a doorway, where a hearth or an oven
stands against it as a mass of masonry, where the room behind is a stair, or where the light and a pier
either side would not all belong to the same room — which is what keeps a window out of a corner pier and
off an internal division.

Where the bay rhythm and the rooms behind it disagree, they are repaired together rather than one overruling
the other: a room the rhythm misses, but which has a wall of its own to the outside, takes its light on the
same wall grid, and a narrow one where a full light will not fit. Sixteen rooms in a 2,600-room survey still
have an outside wall and no window, against seven before; every other windowless room has no outside wall at
all, which is a massing question rather than a window one.

A chimney now rises over a fire. Where a hearth or an oven backs onto an outside wall the flue stands against
that wall and in line with it; only a range whose fires are all internal takes a stack on the first free
corner instead.

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
