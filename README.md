# Keepwright

A medieval build-planning application with deterministic castle, manor, and house generation; furnished room plans; planned household circulation; drawing layers; and PNG, SVG, JSON and Litematica exports.

## Development

Use Node 22.13 or later, `npm install`, and `npm run dev`. Run `npm run build` to produce the Cloudflare Worker bundle.

## Checks

`npm test` checks deterministic generation, 3,150 combinations of footprints and room geometry, aligned floors, size-dependent room counts, feature options, agent-tool input contracts, that every diagnostic overlay draws, that a Litematica export reads back as the blocks it was given, and the circulation, composition, proportion and facade rules below. `npx tsc --noEmit` checks types.

`npm run batch` runs the fixed-seed regression suite — 1,000 estates by default, `npm run batch 200` for a
shorter run. It reports the two outcomes separately, and never adds them together:

```
settings 1000
accepted-plan validity  1000/1000 (100.0%)
search success          1000/1000 (100.0%)
mean navigability 83.2  mean composition 91  mean rooms 90.7
181s total, slowest 516ms
```

**Accepted-plan validity** is whether the plans the engine returns as valid actually are; **search success**
is how often it finds an acceptable plan at all under its candidate budget. A run that quietly returned
broken geometry and a run that honestly gave up are not the same failure, and one number would hide the one
that matters. The exit code follows validity alone: giving up is a measurement, returning a broken plan is a
defect. Index *i* of the batch always means the same estate, so a change that moves a plan shows up as a
change in the batch rather than as a different sample.

## Circulation

Circulation is planned before rooms are cut. Passage positions are chosen for the whole composition at
once so that two adjoining ranges line up in the wall they share; a range met part-way along its flank
grows a passage down that flank, and one met end-on is entered at that end. Doors then follow a household's
access grammar rather than whichever walls happen to touch:

- Every room that is not circulation has its own door onto circulation, so no chamber is a corridor.
- No room a household would not cross carries another room's only route. The test is whether closing a
  room strands another one, so a bedchamber with a door to its own wardrobe is correctly not a defect.
- A chapel is sited off the great chamber or the hall, keeps its own antechapel, and is entered only from
  circulation — and the audit now checks the whole *route* to it, not only its own doors, because a forced
  connection elsewhere in the plan can quietly put a lodging hall on the way to the chapel. Service reaches the hall through the screens passage, not through the hall body.
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

- **Volumes** — every range outlined and labelled with its kind, its proportions, its storeys, the build it
  belongs to and how many volumes it stands from the hall, shaded by age, with a line for each wall two of
  them share; and on the ground floor, each motif's two ends and every port it takes, marked P, S or R for
  public, service and private. This is the composition stage: a straggling arm shows here as a chain of high
  numbers, and a hall whose service door has crept up to the dais shows as an S in the high end.
- **Circulation** — every doorway drawn as a line between the rooms it joins, every room as a dot carrying
  the number of doors from the entrance, circulation and destinations coloured apart, and any room a
  household is forced to cross ringed in red.
- **Facade bays** — the bay lines each wall was divided into, green where the bay took a light and orange
  where it was refused, with the corner piers marked, and every projection outlined and named by its role.
  This is where a missing window is either a bay that was never there or a bay something stood in the way of.
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

## Building it in the world

Two of the export options write `.litematic` files, which Litematica reads straight off disk: put them in
`.minecraft/schematics`, or your instance's own schematics folder, and load one from Litematica's menu.

**Floor outline** is the one to build from. It is a single course, one block high, read at head height rather
than at the floor — because that is the course a doorway is a gap in and a window is glass in, where an
outline taken at floor level would be a continuous ring telling you nothing about the way in. Three blocks,
so it reads without a legend:

| Block | What it is |
|---|---|
| Stone brick | Wall |
| Glass | A window |
| Oak planks | A doorway — walk over it, and you can still see the line |

Lay it out, and build up from it. A 512-block estate's outline is about 3 kB.

**Complete building** is every block of every floor as the 3D view shows it — see *Building it, not blocking
it out* below. About 260 kB for the largest estate the generator makes, and a second to prepare. The 3D view
also has its own **Export 3D · GLB** button, which writes the same model as mesh geometry for anything that
reads glTF: the complete building, not the cutaway you happen to be looking at.

Both are gzipped NBT written by `lib/litematica.ts`, which writes the tags this one format needs and no
others. Two deliberate choices are in there:

- **Schematic version 5, not the current 6.** They differ only in how entities and tile entities carry their
  positions; this writer has neither, and every Litematica since Minecraft 1.13 reads 5 where the older ones
  refuse 6.
- **A data version behind the client.** Minecraft upgrades a schematic older than the client and refuses one
  that is newer, so being behind is the safe direction to be wrong in, and every block in the palette has
  existed since 1.13.

The block states are packed the way Litematica packs them — entries of *n* bits end to end, straddling the
boundary between one long and the next, which is not the padded packing modern Minecraft chunks use. The
tests read the file back with an NBT reader written from the format rather than from the writer, and unpack
every cell of an outline with Litematica's own read, so the two have to agree.

## What every stage is held to

A rule that lives only in the stage that places something can be undone by a later stage without anything
saying so. These are checked on the finished plan, and a candidate that fails one is rejected and another
composition tried:

- An **ordinary room** forced into a strip past 3.2:1, or one that has eaten more than 760 blocks of its
  range, is rejected — not renamed to something the rule does not cover. A **gallery** is a kind with its own
  proportions, so a genuinely long connector is accepted for what it is.
- A **court** is open exterior for its whole reserved height. An eave may oversail it — that is what an eave
  is — but a floor or a roof carried across it is a yard with a lid on. Nineteen yards in a 159-yard sample
  had a roof reaching four to seven blocks in, because a bay was projecting into them; a projection is now
  kept out of a yard, which is composed open space rather than ground to build on.
- A **light** is never cut through a wall two rooms share, nor through the mass of a hearth or an oven.
- A **bay** may not take more than half the wall of the room it comes out of: a projection that has eaten its
  host is not a bay.
- A **stair** rises one storey, lands at both ends of that rise, keeps both landings inside its own shaft, and
  joins a room at each level it serves.
- An **upper room** stands over the storey below it or over a cantilever that says so, and never in a
  reservation another volume was given.
- A **hall** keeps its long axis, its dais at the high end, its screens at the serving end, and its service
  doors out of the private half.
- A **yard** is a way through, not a dead end with a gate on it.

## Building it, not blocking it out

The generator settles what stands where. For a long time the exporter settled what it was made of by mapping
each of nine materials to one block, and the 3D view coloured the same nine. That produced a massing model:
one grey stone, roofs of stacked cubes, walls of solid glass, square battlements floating at the corners of a
chamfered tower, and — worse than any of it — no light anywhere inside. A castle you cannot see inside is a
castle full of monsters by the second night.

`lib/architectural-detail.ts` is the pass that answers that, and the important thing about it is that there is
only **one** of it. `buildDetailedModel(plan)` returns the structural grid and a detailed grid; the worker
meshes the detailed grid, the whole-building export writes the same one out, and so does the GLB button. What
you turn around in the studio is what you paste into the world. Block states live in a sidecar on the grid
(`lib/block-states.ts`), and the mesher gives each one its real shape — quarter-block for a stair or a slab,
sixteenth-block for a chain, a pane or a bed — rather than a cube.

It compiles architecture, not a second floor plan. Rooms, openings, stairs, routes, court reservations and
explicit air cuts are all protected, and no non-roof structural cell may be replaced — so the plan you
approved is still the plan, and the audits still hold. Floor drawings and outline schematics still read the
structural grid.

It works at three scales, and records what it actually placed in a feature manifest:

**Roof composition** (`lib/architectural-language.ts`). A tall tower gets a flared skirt, an octagonal glazed
drum with a lantern in it, a steeper second roof and a supported finial — not one giant pyramid. Long ranges
get dormers set into the slope and carved or timbered gable ends with tracery. A battlement tower wide enough
to carry them gets corbelled corner bartizans. Every one of these is drafted in full and placed only if the
whole motif fits: an adjoining range vetoes the drum rather than getting a hole cut through it.

**Façade bays.** Bases, capitals and corbel tables as continuous bands; engaged piers on halls, chapels and
towers; hooded surrounds around every window and a carved portal with a banner over every door; heraldic
hangings on blind tower bays; a developed gate arch and roof on each gatehouse, and a coped curtain wall.

**Material and contents.** Stone is never one stone — a patchy field three blocks across and two courses tall,
because the hand-built castles this was measured against put the same stone above itself about half the time,
where random mixing at that palette size would be a twelfth. Timber upstairs is oriented log, and courtyard
flags have a border and a grid. Inside, every fitting is the thing it stands for and is built at room scale
rather than as a labelled cuboid: a hearth is brick with a lit campfire and an iron-barred front, a table is
boards on legs with space at its ends, a bed a real pair with a canopy where the chamber allows one, a forge a
blast furnace and an anvil, a lectern its bookshelves — or the enchanting table, in the room programmed for
one. Rooms get floors laid to a pattern, panelled walls, coffered or braced ceilings, a carpet where one
belongs, and lanterns hung on real chains from a real overhead block. What may stand where, and what has to
stay clear, is settled by the passes under *Can you actually walk through it?* below.

Every state it can write existed in Java 1.16.5, which is the version the schematic file claims: a block name
the client cannot resolve at the declared data version is not a nicer stone, it is a hole.

How it measures against the two references, counted the same way on a 288-block courtyard castle:

| | Raidproof Castle | Skyhold Keep | Blocked out | Now |
|---|---|---|---|---|
| stone blocks in use | 12 | 35 | 1 | **7** |
| same block above | 56% | 42% | 100% | **52%** |
| stairs | 14.4% | 7.0% | 0% | **12.7%** |
| slabs | 12.6% | 8.0% | 0% | **3.4%** |
| light sources | ~150 | many | 0 | **260** |
| palette | 569 | 1128 | 9 | **56** |

Slabs are still the thin one, and the palette is a fraction of a hand-built castle's — there is no furniture
variety, no vines, no deliberately broken masonry. What is here is the structure of a good build rather than
the finish of one.

`lib/showcase-plan.ts` is an authored composition, **not** a candidate the search produced, for looking at all
of this at castle scale: `npm run showcase:architecture -- ./exports/crownward` writes its `.litematic`, its
GLB and a report of every feature placed. `docs/3d-redesign.md` records what the compiler promises and what
was measured of it.

## Can you actually walk through it?

Everything above is checked against the plan. A plan can be perfectly navigable and still compile into a
building you cannot get into: a threshold that is a wall block rather than a floor, a flight whose treads a
partition runs through, a yard well parked in front of the only door out of a range, a chapel corner with no
light in it. None of that is visible to a rule about rooms and doors, because none of it is about rooms and
doors — it is about blocks.

So the last thing the compiler does is put a player-sized body into the finished blocks and try to walk.
`lib/walkability.ts` builds a graph of every place a 0.6 × 1.8 box can stand — on a half-block lattice, on
whatever a cell's collision shape actually is, so the top of a slab is at half height and a carpet is not a
step — and connects two of them only if you could walk between them without jumping, flying or breaking
anything. Half a block is a step; a whole one is a jump, and a jump is not a route.

`lib/built-audit.ts` then asks the questions that follow from that:

- Every room can be reached **on foot from the front door**, and no room is half cut off from itself.
- Every stair connects its two landings with a player's clearance, inside its own shaft.
- Every doorway has a threshold you can stand on; every window is glazed across its aperture.
- Every occupied top-storey column has something over it — a building with a hole in its roof is not finished.
- Nowhere a player can stand is dark: block light, conservatively, with no daylight counted.

It is a model, not the game: a conservative box, no jumping, no skylight. It will not certify that Minecraft
agrees with it. What it will do is fail loudly when something is unbuildable: the studio shows a **walkable**
score beside navigability and composition and names every failure, and a schematic that failed says so in its
own description and in the notice that exports it. It is still written — refusing to write it would take away
the one thing the file is for, and a build with an unreachable cellar is worth pasting and fixing by hand.
What matters is that nobody finds out in the world.

Three passes exist to answer it. `lib/building-repairs.ts` repairs the envelope — roofs that intrude into
rooms, walls a later range drove through an earlier one's interior, ceilings, the knee wall under a deep eave,
a missing foundation course — and then re-opens every declared portal through its own reveal, with a threshold
you walk across and a step down to the ground outside. `lib/interior-stairs.ts` designs each flight as a
real assembly — a switchback where the shaft allows one, otherwise a straight run — with landings, sloping
strings and balustrades, cuts its well, and builds it. `lib/interior-layout.ts` reserves the actual paths
between doors, landings and each room's usable middle **before** any furniture is placed, so a wardrobe can
never end up across a route. Only then does the furnishing run, and last of all
`lib/interior-lighting.ts` hangs lanterns on chains from real overhead blocks, measures what is still dark,
and hangs more until nothing is.

Across 144 settings — every family, four footprints, one to five storeys — every building passes: every room
walkable from the door, every stair connected, every portal clear, every aperture glazed, no hole in any
roof, and nothing pitch dark. Compiling and auditing the largest of them takes about three seconds.

## Choosing between the compositions a seed made

A seed composed several estates, the best of them was returned, and the rest were thrown away. So the only
number a reader could act on was the seed, and the only way to see another composition was to lose the one
they had.

`tryGenerate` now returns the compositions it considered along with the one it chose — §5.4's *preserve a
diverse set of promising candidates rather than taking only the most compact footprint*. Each carries its
rank, its navigability and composition scores, how many volumes, yards and rooms it has, what became of it,
and the **attempt number** that built it. The same attempt of the same seed always composes the same estate,
so an attempt number is the whole of what it takes to build one again: the studio shows the list beside the
composition score and rebuilds whichever you pick.

Four and a half compositions per seed on average. **Half of them differ from the one chosen in massing**, not
only in labels — a different count of volumes, a different arrangement of them — so the list is a list of
estates rather than a list of copies. About one in nine will not stand up when you pick it, because the
search only pays for the built check on candidates it might return; picking one of those costs a message
rather than a plan.

And that message now proposes something. §17.4 asks that impossible constraints come back as a specific
conflict with proposed relaxations, and *try a different seed or a larger footprint* was not a proposal.
What to change is said in terms of what actually went wrong: a room stretched into a strip suggests fewer
storeys as well as more ground; a route that will not close suggests another seed; a yard with a lid on it
suggests turning the enclosed court off; a stair with nowhere to land suggests fewer storeys. Every one of
them still ends by saying the previous build is retained.

## Rooms a player needs, and rooms a house should have had

Two gaps, one on each side of the same list.

**A house should have had a library.** A great house has a library, a reading room, a still room, a map room,
an infirmary; this one had a music room and a nursery and stopped. Four new trade groups fill that in — a
library group, a still-room group, a physician's group, and more of the tower's clerical rooms — and they are
ordinary groups, present whatever else is asked for. About half the estates now hold a library or a reading
room without being asked.

**A build needs somewhere to enchant.** Tick **Rooms a player needs** and the estate also programmes what you
will have to do in it rather than only what the household did: an enchanting room and its library, a brewing
room with its ingredient and potion stores, a smelting house with ore and fuel stores and an anvil floor, a
storage hall with its sorting room and crates, and a trading hall. These are held apart from the trades
because they answer a different question, and they are only built when the estate is asked for them.

Everything else about them is ordinary, which is the point. They take their place in the programme, get their
proportions from their kind, are furnished with the fixture they exist for, take their own door onto
circulation, and are held to the same audit as any other room. They are spliced in behind the first trade
rather than after the last, so a house with one service range still has somewhere to brew and a small manor
still has somewhere to enchant. Across a 72-plan sample: an enchanting room in 51, a brewing room in 53, a
trading hall in 48, a smelting house in 37.

**Four new fixtures** come with them, because a room named for what happens in it should have the thing that
happens in it: a **lectern** to read or enchant at, a **still** to brew over, a **forge** to smelt and beat
at, and **crates** that are why a store is a store. Each has real dimensions and a clear side to use it from,
like every other fitting. A room is named for its function, so the name is what says which fixture it wants —
the same way the screens passage is known by its name.

While fitting them, furniture stopped being one material. A hearth, an oven, a forge and a still are masonry;
a well and a dais are stone; everything else is timber. The whole-building Litematica export was building the
household's fires out of oak log.

## What a range does when it runs out of programme

Past the end of its programme a long range repeated whatever came second, so an estate could hold a Bakehouse,
a Bakehouse 2 and a Bakehouse 3. That is not a household with three bakehouses; it is a programme that has run
out of things to call a room, and the numeral on it says so.

A range now repeats only what a household really has more than one of. Stores and lodging chambers come
first, then anything else the programme lists, and a workroom is taken only if the range has not had one yet.
The principal room is never repeated at all. Across a 108-plan sample no workroom anywhere carries a numeral:
no *Bakehouse 3*, no *Scullery 3*, no *Laundry 2*, no *Great chamber 4*. Stores and chambers still come in
runs, because a service court does hold several larders and a lodging range does hold several chambers.

Then a range longer than one trade takes **the next trade**. The variants of a kind are groups — a kitchen
group, a brewhouse group, a laundry group — and a range that runs past the end of one continues into the
next, starting at its own. A very long service range holds the kitchen group, then the brewhouse group, then
the laundry: which is what a service court is. That is §7.4's second repair, *select another variant*, reached
long before its last, *reject the composition*. Numbered rooms fell from 10% of all rooms to **4%**, and the
ones left are stores and lodging chambers, which is what a household has several of.

**The rest of §7.4's order is not implemented, and the generator does not pretend otherwise.** Of its six
steps it now has the first — a remainder too short to be a room goes to the room before it — the second, and
the last. Steps three to five (add a genuinely required support function, shorten the wing or turn the residue
into exterior space, move accommodation to another level) are not there.

I tried capping how many rooms a rank may hold and giving the remainder to the last room, which is step one
applied harder. With the middle of the order missing, step six then fired for every candidate and generation
failed outright: `Pantry 3 has swallowed 884 blocks of its range`. A naming blemish had become a broken
generator, and the cap came back out. A range longer than everything its kind knows how to be still has to be
divided into something, and repeating a store is the least bad answer left.

## A fitting is a fitting

A great hall was furnished with one dining table sixty-one blocks long, and a bench sixty-one blocks long
either side of it, because the board was drawn to the room instead of the room being filled with boards. A
solar got a single shelf twenty-one blocks long. §7.3 asks for the opposite: a fitting has real dimensions,
and a larger room gets more of them or a different arrangement of them, never a bigger one.

`FITTINGS` in `lib/model.ts` is the one place that says how big each thing is and how much room you need
beside it to use it — the side you stand on to sleep in it, sit at it or work at it. The audit holds every
piece of furniture to both: a fitting past its dimensions is rejected, and so is one with no clear side.

| | before | after |
|---|---|---|
| longest dining table | 61 × 2 | **8 × 2** |
| longest bench | 61 × 1 | **8 × 1** |
| longest shelf | 21 × 1 | **4 × 1** |
| boards in a 3,000-block hall | 2 | **11** |

The hall's dining is now a repeated trestle — a board, a bench either side, and room to get round the ends —
laid down the hall as many times as the hall is long. A wall gets a row of shelves with a gap to reach
between them. The altar is an altar rather than a shelf the width of the chapel.

Chasing that turned up something worse. **No hall had ever had a high table, and four in five had no dais.**
Three separate things were refusing them, each reasonable on its own:

- the dais was tested against its own route-survival check as though it were an obstacle, and a platform
  across the high end closes every route by definition;
- the high table was placed on the dais and rejected for intersecting it;
- the corners of the high end are cut back, and a platform the width of the hall puts its own corners
  exactly where the cant took the floor away.

A dais is not an obstacle: it is the floor of the high end, one step up in the reading and level with it in
the walking, so it is laid in the floor course rather than on top of it and nothing has to climb it to reach
the private door. Things stand on it. It is narrowed until it fits the cant rather than dropped. And the high
table goes on the centre line where the centre line is free and slides along the dais where it is not.

Every hall now has a dais, and a high table standing on it. §6.1's *typical failure to reject* for the hall
motif is "a square leftover box with stretched tables and no focal end", and until now that was two out of
three.

## Motifs, and what makes a hall a hall

A hall used to be a room labelled `hall`: as wide as it was long, with a dais at one end because that was
where the code put one. Nothing said what a hall *is*, so nothing could tell when it had stopped being one.

`Plan.motifs` records an arrangement whose ends are not interchangeable, together with the relationships that
make it that arrangement — and the audit then checks them rather than assuming them.

**The hall.** Its long axis, its high end and its serving end, and its ports: the public way in, the service
doors, the private door to the household's own side. The audit rejects a hall shorter than 1.35:1 on its long
axis, a hall whose two ends are in the same place, a dais outside the high end, or screens outside the serving
end. Halls were widened and shortened to fit — a median of 1.32:1, and 129 of 144 under 1.6 — and are now
median **1.89:1**, with 3 of 144 under 1.6. Making them long meant putting the wings at their ends: the solar
wing now stands at the high end and the kitchen range at the serving end, rather than both centred on the
flanks, which is what makes a screens passage a threshold instead of a door halfway along a wall.

**The gate.** Its outer threshold, its passage and its inner threshold, with the guard rooms beside it.

**Hall variants.** §6.1 asks for the motif to have forms, not one drawing. The hearth strategy is the first:
an **open hearth** stands in the middle of the floor and vents through a louver built over it — a shaft through
the roof with a lantern on posts — and is what a hall retained from an earlier build still has; a **wall
fireplace** stands against the flank and takes the stack, and the stack over the household's own fire is now
placed before any service range's. With the high-end bay from the articulation pass, that gives four forms:
*open-hearth*, *open-hearth-with-bay*, *wall-fireplace*, *wall-fireplace-with-bay*, spread roughly 40/60/25/20
across a 144-plan slice.

**Dinner does not come past the dais.** A door between the hall and a service or workshop range must be in the
serving half of the long axis. That took service doors at the high end from 63 in 229 to 3 in 157. Where the
door grammar is forced into one anyway to keep a range reachable, it is counted as a compromise and costs the
candidate its rank, the same as any other improper door.

**A yard is a way through.** An open space the household can enter only one way is a gap with a gate on it,
not a court, and the audit rejects it.

## New seeds vary in architecture

The **courtyard castle** took every dimension straight off the site budget, so sixty seeds raised the same
castle sixty times over: **one distinct massing in sixty seeds**. The court's proportion, the depth of each
range, how tall the gate stands and whether the corners are towered are now the seed's to choose — a castle
may have no corner towers, a pair, or all four, each set against the end of a flanking range so that a tower
is a room of the household rather than an ornament in the grass. What stays fixed is the type: four ranges
round a yard, the hall at its head, the way in opposite the hall.

Sixty seeds now give **seventeen** distinct massings, with the commonest ten. Every other family already
varied and still does: 54 to 60 distinct massings in 60 seeds, commonest 2 to 4. A massing here is what a
reader would see with the labels off — the kinds of volume, their proportions and their heights — and it is
measured so that a mirror, a rotation or a rename counts for nothing.

## Vertical composition

The hall void and the stair well used to be worked out again by whichever floor was being drawn, so nothing
in the plan said which volumes the storeys owed each other, or why.

`Plan.reservations` is settled before any floor is divided, so an upper plan inherits these volumes rather
than discovering them. The three conditions are kept apart because they are not the same thing:

- a **court** is open exterior for its whole height, which is as far up as the ranges around it stand;
- a **hall** is interior volume with no floor carried across it, from the first floor to the top of the hall;
- a **stair** well is the hole one storey leaves in the next, for the flight that comes up through it;
- a **loggia** is covered overhead but open to the weather down one side.

Each reservation names the exception it allows. A gallery may overlook a hall; a chamber may not be dropped
into one. A stair well takes stairs and circulation and nothing else. A yard takes nothing at all unless a
cantilever says otherwise. A loggia takes the covered walk it exists for, and must actually be both covered
and open: it is checked for a roof somewhere above it and for an outer side that is arcade along more than
half its length, with piers still standing between the bays. The audit enforces that, and a floor's voids are no longer worked out by the
drawing — they are the reservations that reach that level, so a hole in the boards is always the volume
something else was given. Across the 960-setting sweep that comes to a hall void in every estate that has a
hall of more than one storey, 830 stair wells and 159 reserved yards in a 108-plan slice.

Three further checks come with it. Every occupied upper room must be carried by the storey below it or by a
cantilever that says so; every stair must rise exactly one storey, land at both ends of that rise, keep both
landings inside its own shaft, and join a room at each level it serves; and no door may open onto a void it
was never meant to reach.

The first of those found a real defect. The merchant house's first floor **jetties** — it oversails the
storey below by a block on two sides — and `componentFootprint` had always known that, but nothing else did:
the storey stood in mid-air with no joists under it. A jetty is now an articulation like any other, with the
joist course and the bracket ends built underneath it, drawn on the floor it oversails, and checked by the
audit that it has something to stand on.

**Level offsets are deliberately not modelled.** A floor is the set of rooms at one elevation, and the whole
plan — the floor list, the drawing, the stair rise, the export — is keyed on that. Half-sunken undercrofts
and split levels would need floors to be a range of elevations rather than one, which is a larger change than
this section is worth; pretending to them by moving rooms between floor groups would be worse than not having
them.

## Construction history

Every range of every seat used to be the same masonry, the same rhythm and the same window, because nothing
in the plan recorded that a household builds against what is already standing.

Each volume now belongs to a **build**. Phase 0 is inherited fabric: a core that was already there when this
household began adding to it. Phases 1 and up are its own campaigns, taken two additions at a time in the
order the composition placed them. Nothing here simulates history by nudging vertices about — a phase is a
fact about a volume, and the masonry, the framing and the windows are then answerable to it.

Not every seat grew. A formal quadrangle is raised in one go, and so is a quarter of everything else, on a
decision taken off the seed rather than off the running sequence so that it does not shift a composition a
seed already produces. A plan raised in one campaign has no phase 0 at all: one masonry, one rhythm, no seam.
Nor does a plan the budget allowed nothing to be added to — a lone core is not inherited from anybody, it is
simply the one build there ever was. Across the 960-setting sweep 382 seats keep inherited fabric and 578
were raised in a single campaign.

What the phase changes:

- **Masonry.** A retained core carries one more block of wall than the later ranges around it, so the join
  between an old range and a new one is a visible step in the facade rather than a line on a drawing.
- **Framing.** An upper storey outside a castle is a timber frame on its studs — but never on a retained
  core, which is masonry all the way up. 140 plans in the sweep carry framing.
- **Rhythm.** An older wall was raised when a wall was structure before it was anything else, so it takes
  wider piers and a coarser bay spacing; a later range can afford to be mostly window.
- **Light.** In a retained core every opening but the showpiece ones — the hall, the chapel — is a single
  block deep in its embrasure. Across the sweep every ordinary light in a retained core is a slit, against
  56% of ordinary lights in later ranges taking the full width.

The **volumes** overlay names the build each range belongs to and shades it by age, so a seam in the drawing
can be traced back to the stage that made it.

## Wall mass

A wall one block thick whatever it carries reads as a line rather than as masonry, and the drawing has to
fake the difference with a heavier stroke. An outside wall now has its real thickness — three blocks on a
castle, two otherwise, one more again on a retained core and one less where an upper storey is timber-framed
— and an internal partition stays one, so the structural hierarchy is in the geometry rather than in the
linework.

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
a castle, wider piers and a coarser spacing on a retained core, and no bay at all inside a chamfered corner.
The same lines serve every storey, so an upper light stands over the one below rather than over nothing.
Across the standard set 65% of upper lights now stand over a lower one, against 48% before.

What a bay gets depends on what is behind it. A hall or a chapel takes a tall light and a second tier above
it where the volume is carried through two storeys; a chamber or a study takes an ordinary one; a store or a
passage takes a slit, set higher; and in a retained core everything but the showpiece lights is a slit. A bay is refused where the wall is a doorway, where a hearth or an oven
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

## Articulation: what steps out of line, and why

Every wall ran corner to corner without once stepping out of line, and the only things that ever stood proud
of one — a chimney, a tower — carried no record of why they did.

`Plan.articulation` is now a list of every place a wall does something other than run straight, each with the
role it plays and the reason it is there. Whole projecting volumes — a tower, a chapel end, a gatehouse porch
— carry their role in `ComponentKind` already and are not repeated in it.

- **Bay.** Where a principal room has the ground for it, the wall steps out. The bay's footprint swallows the
  wall it comes through as well as the space it gives, so that the mass of the range does not eat the room the
  bay was built to make. The wall is then taken out over the bay's whole interior width and through its whole
  thickness, leaving the bay's returns as the piers of the arch — the point of a bay is that the room reaches
  into it. It is lit on three sides, and beyond the wall its own walls stay one block even where the range
  behind is three: that lightness is what makes it a bay rather than a turret.
- **Oriel.** The same thing on an upper storey, hanging over open ground. What carries it is drawn rather than
  assumed — a stepped corbel course under the floor it hangs from — and the storey below shows the overhang
  dashed, with its corbels and the caption *Oriel over*, instead of a room in mid-air.
- **Chimney.** The stack over a fire, which was already built but never recorded. Its reason names the fire.
- **Niche.** The inward case: a recess for a lamp or an image, cut into a wall thick enough to give one away —
  a castle's, or a retained core's — and stopping well short of daylight.
- **Jetty.** A whole upper storey oversailing the one below on its joists, which the merchant house has always
  done and nothing had ever recorded. See *Vertical composition* above.

The role is what the audit checks, so a projection that does not do what it claims is a rejected candidate
rather than a decoration. A bay must have a floor to stand on, must enclose something, and must open into the
room it is recorded against; an oriel must have something under it; a niche must be hollow and must *not* go
through its wall. Nothing is placed over a doorway, over the path from the gate, on a curtain wall, in a
working yard, or on ground another projection has already taken.

Restraint is the rule. A hall with one bay reads as a hall with a bay; a house where every room has one reads
as a house with none. The budget is one projection, two past 200 blocks and three past 340, spent on the hall
first and then on the largest of what is left. Across the 960-setting sweep that comes to 1,183 bays, 367
oriels and 694 niches: 950 of 960 estates have at least one, the hall gets one in 610 of them, and projections
account for 1.8% of all rooms.

A bay's seat is furniture like any other, so it is drawn, exported and voxelised with the rest — a bay window
without a window seat is a corridor with a view.

## The forecourt

Every addition either squared up to its host or stood across a yard from it, so the only outdoor room the
composition could make was one enclosed between two facing walls.

A range may now be set **alongside** another, running the same way, and **stepped past the end of it**. What
that leaves is a forecourt: an outdoor room closed on two sides that meet, and open on the others — which is
a different thing from a yard enclosed between two faces. Two preconditions keep it a composition rather than
a leftover: the two ranges must overlap by enough to share a wall a door can go in, and the step must be long
enough that what it leaves is a court and not a slot.

That is §5.2's *offset a parallel wing*, and it joins the three moves already there — a wing square to its
host, a range across an open yard, and a range dropped into a gap two masses already leave facing each other.
115 forecourts across a 144-plan slice, in 78 of the plans.

One more composition operation made one setting in nine hundred and sixty harder to solve — a 512-block
eight-storey castle came back with a chamber somebody had to walk through. The attempt cap went from eight to
twelve. Only a seed that has not yet produced a plan without a forced crossing ever pays it; an easy seed
still returns at its budget, and the slowest single build is 1.8 seconds.

## The covered walk

A courtyard range's walk used to be a corridor with doors onto the yard, which made the court the gap left
between the wings rather than the room the house is arranged around.

Where the walk down a range's flank faces a yard, its outer side is now an **arcade**: piers at four blocks
with the wall taken out between them, so the walk and the court are one space at ground level and you cross a
courtyard house under cover without ever going through a door. The wall above the piers stays, because what
makes a loggia a loggia is that it is roofed — the storey over it, or the rafters of a single-storey range.
Nothing is cut into the arcade wall: the arcade is the opening, so the lights the facade pass would have put
there are removed.

Seventy covered walks across a 108-plan slice, in 49 of the plans; the courtyard castle has the most of them,
which is what a quadrangle is for. §10.1 asks for the loggia's condition to be kept explicit alongside the
court's and the hall's, and it is: `open` is `covered`, not `interior` or `exterior`.

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

The type is fixed; the castle is not. See *New seeds vary in architecture* above for what the seed chooses
here — the court's proportion, each range's depth, the height of the gate, and whether the corners carry
towers.

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
