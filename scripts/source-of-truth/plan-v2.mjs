/**
 * Floor plan v2 — the owner's agreed geometry, as data.
 *
 * This is the seed of the source of truth: the owner's hand edits to
 * `docs/source-of-truth-n-floor.drawio.html` were read, measured (drawing scale
 * 30 px = 1 m), agreed in the session plan, and encoded here on the centimetre
 * grid. The drawing is regenerated from this file, and the domain model
 * (`src/features/building/domain/`) is then brought onto the same numbers.
 *
 * Plan coordinates, as in the model: origin = outer corner of sides A and C,
 * `x` runs A→D (0–22.50), `z` runs C→B (0–10.00), metres.
 *
 * Contract for the two renderers that consume this file:
 *
 *   Room    { n, id, name, type, kind, rects: [[minX,maxX,minZ,maxZ], ...], note? }
 *   Opening { kind, between: [idA, idB], along: 'x'|'z', spanMin, width, sill, head, why? }
 *
 *   deriveWalls(SPEC) -> Wall[]  (walls.mjs)
 *   Wall    { matricule, roomN, roomId, type, wallN, side, axis, at, spanMin,
 *             spanMax, length, thickness, faces, openings: DerivedOpening[] }
 *   DerivedOpening = Opening + { matricule }   // e.g. F1-R11-KIT-W3-G1
 */

/** Floor number of the typical floor (ADR-006: floors 1…N, floor 0 not designed). */
export const FLOOR_NUMBER = 1;

/** Outer plot, in metres: 22.50 × 10.00 (brief §1). */
export const PLOT = Object.freeze([0, 22.5, 0, 10]);

/**
 * Wall thicknesses, in metres (brief §2). `voidFacing` is not a duplicate of
 * `exterior`: a wall between a room and the side-A balcony, a side-B void or the
 * balcony slab is weather-exposed on one face, so it is built 0.30 like the
 * envelope even though it stands inside the plot. That is what the 0.30 gaps
 * drawn along x 1.30/1.60 and z 8.40/8.70 already are.
 */
export const WALLS = Object.freeze({
  exterior: 0.3,
  /** A wall on the owner's isolation list: built wide for sound and heat. */
  insulated: 0.3,
  /** Everything else inside: a separator, built as thin as it usefully can be. */
  partition: 0.15,
  voidFacing: 0.3,
});

/** Vertical sizes, in metres. Side B is now a normal exterior wall, so no side is a parapet. */
export const HEIGHTS = Object.freeze({ floorToFloor: 3.0, wall: 2.7, door: 2.1, railing: 1.1 });

/**
 * The stairwell, replacing the 17-riser / 0.75 m flight of ADR-008.
 *
 * A landing at each end with the two flights between them (owner). That needs
 * 1.00 + 2.00 + 1.00 = 4.00 m, because a landing turning 180° must be at least
 * as long as the flight is wide. The bay was 3.70 and is now 4.00, taking 0.30 m
 * off the corridor's west end — the smallest extension that works, and it leaves
 * the master bedroom exactly the 1.00 m of corridor frontage its door needs, so
 * no bedroom opens onto the stairs.
 *
 * 18 risers of 3.00/18 = 0.1667 carry a full storey, 9 per flight. The going is
 * 0.25, down from 0.28: the second landing is worth more than the extra 0.03,
 * and two 1.00 × 2.00 landings are far better for turning a washing machine or a
 * fridge than one. The east landing is at this floor's level and continuous with
 * the corridor; the west one is half a storey down.
 */
export const STAIRS = Object.freeze({
  bay: Object.freeze([1.6, 5.6, 4.0, 6.0]),
  riserCount: 18,
  going: 0.25,
  flightWidth: 1.0,
  /** Arrival landing, at this floor's level, continuous with the corridor. */
  landingEast: Object.freeze([4.6, 5.6, 4.0, 6.0]),
  /** Flight A descends west along the north strip, 9 risers. */
  flightA: Object.freeze([2.6, 4.6, 4.0, 5.0]),
  /** The turn, half a storey down, spanning both strips. */
  halfLanding: Object.freeze([1.6, 2.6, 4.0, 6.0]),
  /** Flight B descends east along the south strip, 9 risers, to the floor below. */
  flightB: Object.freeze([2.6, 4.6, 5.0, 6.0]),
});

/**
 * The 18 spaces, in matricule order R01…R18.
 *
 * Changed from v1: `linkCorridor` deleted; `ccBalcony` added; the stairs bay is
 * 0.50 m deeper; the corridor gains a second rect (the stair-hall widening in
 * front of the guest room, which is what keeps the guest room rectangular); the
 * control center runs to the side-B wall; the guest room is one rectangle again
 * (its two rects here are only the guest sanitair carved out of its SE corner);
 * `voidWest` starts at x 4.90 instead of 1.60.
 */
export const ROOMS = Object.freeze([
  { n: 1, id: 'balconyA', name: 'Side-A balcony', type: 'BAL', kind: 'openAir',
    rects: [[0.3, 1.3, 0.3, 9.7]], note: 'entry lands here; private to the master bedroom' },
  { n: 2, id: 'masterBedroom', name: 'Master bedroom', type: 'BED', kind: 'room',
    rects: [[1.6, 6.6, 0.3, 3.7]], note: 'no window (owner); balcony door centred on the wall' },
  { n: 3, id: 'livingRoom', name: 'Living room', type: 'LIV', kind: 'room',
    rects: [[6.9, 11.9, 0.3, 3.85]] },
  { n: 4, id: 'bedroomMaleKids', name: 'Bedroom — male kids', type: 'BED', kind: 'room',
    rects: [[12.05, 17.05, 0.3, 3.85]] },
  { n: 5, id: 'bedroomFemaleKids', name: 'Bedroom — female kids', type: 'BED', kind: 'room',
    rects: [[17.2, 22.2, 0.3, 3.85]] },
  { n: 6, id: 'stairs', name: 'Stairwell', type: 'STR', kind: 'stairwell',
    rects: [[1.6, 5.6, 4.0, 6.0]], note: 'a landing at each end, flights A and B between them' },
  // The second rect runs east to x 11.80, the living room's east wall, so the
  // television wall opposite the living room is one unbroken run. Stopping it at
  // the old x 9.80 split the viewing area in two, with the kitchen wall poking
  // into the middle of it (owner).
  { n: 7, id: 'corridor', name: 'Corridor', type: 'COR', kind: 'circulation',
    rects: [[5.6, 20.2, 4.0, 5.5], [5.6, 11.9, 5.5, 6.0]],
    note: 'the second rect is the stair hall and the television wall; it serves the guest room' },
  // Starts at z 6.90, not 6.10: the owner gave the 0.80 m strip above it to the
  // guest room, which now reaches the side-A balcony. This room is entered from
  // that strip through its north wall.
  // Starts at z 7.10: the owner dragged this edge and the guest-room strip above
  // it to the same z 6.90, leaving the two rooms touching with no wall at all.
  // The strip is only 0.80 m to walk through, so the 0.20 partition comes out of
  // this room rather than out of it.
  { n: 8, id: 'controlCenter', name: 'Control center', type: 'CTR', kind: 'room',
    rects: [[1.6, 3.8, 7.2, 9.7]], note: 'entered from the guest-room strip above it' },
  // The north strip now runs the full width from the side-A balcony at x 1.60 to
  // x 9.80, passing over the control center (owner). That strip is what gives the
  // balcony its second door and what the control center opens onto, so it is
  // circulation as much as room — the old link corridor, absorbed into the room.
  // The lower rect keeps its west edge at x 4.10 so the control center's east
  // wall is one thickness: 0.30 for its whole length, because further south it
  // passes the weather-exposed balcony.
  { n: 9, id: 'guestRoom', name: 'Guest room', type: 'GST', kind: 'room',
    rects: [[1.6, 9.7, 6.3, 7.05], [4.1, 6.9, 7.05, 8.6]],
    note: 'north strip reaches the side-A balcony; guest sanitair carved out of the SE corner' },
  { n: 10, id: 'guestSanitair', name: 'Guest sanitair', type: 'BTH', kind: 'room',
    rects: [[7.05, 9.85, 7.2, 7.75]],
    note: 'the open part: sink, and the sliding doors into the bath and shower cubicles' },
  // No longer a rectangle: the corridor's television run now reaches x 11.80, so
  // the kitchen steps back to z 6.10 west of x 12.00 and keeps its full depth
  // east of it (owner: "the kitchen shape is not square, make it fit").
  { n: 11, id: 'kitchen', name: 'Kitchen', type: 'KIT', kind: 'room',
    rects: [[10.0, 12.2, 6.3, 8.6], [12.2, 14.1, 5.8, 8.6]] },
  { n: 12, id: 'laundry', name: 'Laundry', type: 'LND', kind: 'room',
    rects: [[14.25, 17.55, 5.8, 8.6]], note: '1 door + 2 big windows on side B (owner)' },
  { n: 13, id: 'mainSanitair', name: 'Main sanitair', type: 'BTH', kind: 'room',
    rects: [[17.7, 20.35, 5.8, 7.3]],
    note: 'the open part: sink, and the doors into the bath and shower cubicles' },
  { n: 14, id: 'utilityRoom', name: 'Utility room', type: 'UTL', kind: 'room',
    rects: [[20.5, 22.2, 4.15, 9.7]] },
  // Flush with the guest room above it at x 4.10, so the control center's east
  // wall is one straight 0.30 wall for its whole length.
  { n: 15, id: 'ccBalcony', name: 'Control-center balcony', type: 'BAL', kind: 'openAir',
    rects: [[4.1, 4.9, 8.9, 9.7]], note: 'new (owner)' },
  // The slab runs 0.10 wider than drawn at each end so the kitchen and laundry
  // doors, which the owner drew hard against x 12.70 and 16.20, keep a 0.10 m
  // jamb to the railing at the slab edge instead of opening onto it. The two
  // joins are zero-thickness (one continuous strip), so nothing else moves.
  //
  // The strip is 0.80 deep, not the 1.00 first drawn: the owner set 1.00 as a
  // starting value, and its real job fixes the number. It carries the water, gas
  // and electricity risers, which run outside the rooms because that is cleaner
  // to service and safer to isolate; a laundry line is strung across it; and a
  // plumber needs to stand in it occasionally. Risers take about 0.15 off the
  // wall, so 0.80 leaves about 0.65 to work in. The 0.20 saved goes to the
  // kitchen, laundry and main sanitair, which are now 3.00 deep.
  { n: 16, id: 'balconySlabB', name: 'Side-B balcony slab', type: 'BAL', kind: 'openAir',
    rects: [[11.65, 15.35, 8.9, 9.7]] },
  { n: 17, id: 'voidWest', name: 'Void (west)', type: 'VOID', kind: 'void',
    rects: [[4.9, 11.65, 8.9, 9.7]], note: 'drying line and service risers; plumber access' },
  { n: 18, id: 'voidEast', name: 'Void (east)', type: 'VOID', kind: 'void',
    rects: [[15.35, 20.3, 8.9, 9.7]], note: 'drying line and service risers; plumber access' },
  // A bathroom is an open part with the basin, and a walled bath and a walled
  // shower each with its own door (owner). The bath and the shower are therefore
  // rooms, not fittings: that is what gives them walls, matricules and ports like
  // everything else on the floor. Both bathrooms are the same arrangement and
  // differ only in size — the family one has the room to be generous, the guest
  // one is a helper and is cut to the narrowest that still takes a real bath.
  { n: 19, id: 'guestBathCubicle', name: 'Guest bath', type: 'BAT', kind: 'room',
    rects: [[7.05, 8.7, 7.9, 8.6]], note: 'holds a 1.50 bath across its width' },
  { n: 20, id: 'guestShowerCubicle', name: 'Guest shower', type: 'SHW', kind: 'room',
    rects: [[8.85, 9.85, 7.9, 8.6]] },
  { n: 21, id: 'mainBathCubicle', name: 'Family bath', type: 'BAT', kind: 'room',
    rects: [[17.7, 19.35, 7.45, 8.6]] },
  { n: 22, id: 'mainShowerCubicle', name: 'Family shower', type: 'SHW', kind: 'room',
    rects: [[19.5, 20.35, 7.45, 8.6]] },
]);

/** Wall thicknesses that deviate from the kind-based default. */
export const JOIN_OVERRIDES = Object.freeze([
  { between: ['stairs', 'corridor'], thickness: 0, why: 'The corridor is the top landing of the stair, no wall (brief §4.2).' },
  { between: ['voidWest', 'ccBalcony'], thickness: 0, why: 'Both are the same open-air strip, no wall.' },
  { between: ['voidWest', 'balconySlabB'], thickness: 0, why: 'Both are the same open-air strip, no wall (brief §5.2).' },
  { between: ['voidEast', 'balconySlabB'], thickness: 0, why: 'Both are the same open-air strip, no wall (brief §5.2).' },
  { between: ['voidEast', 'utilityRoom'], thickness: 0.2, why: 'Owner kept the drawn 0.20 wall (ADR-006).' },
]);

/**
 * Every port: 16 doors and the single living-room opening.
 *
 * Gone from v1: the five `linkCorridor` doors, and the guest-room ↔ kitchen
 * door, which the owner replaced with the food-pass window. Doors sit near a
 * corner so the wall runs stay usable for furniture (owner), except the master
 * bedroom's balcony door, which is centred (owner).
 */
export const PORTS = Object.freeze([
  { kind: 'door', between: ['balconyA', 'masterBedroom'], along: 'z', spanMin: 1.55, width: 0.9,
    why: 'Centred on the wall (owner); the master has no window, so this is its only opening.' },
  { kind: 'door', between: ['masterBedroom', 'corridor'], along: 'x', spanMin: 5.65, width: 0.9,
    why: 'Near the east corner, 0.05 short of it: at 5.70 the leaf died on the master-bedroom east wall.' },
  { kind: 'opening', between: ['livingRoom', 'corridor'], along: 'x', spanMin: 7.5, width: 3.5,
    why: 'No leaf: the living room faces the TV wall across the corridor (brief §4.1).' },
  { kind: 'door', between: ['bedroomMaleKids', 'corridor'], along: 'x', spanMin: 12.3, width: 0.9 },
  { kind: 'door', between: ['bedroomFemaleKids', 'corridor'], along: 'x', spanMin: 17.6, width: 0.9 },
  { kind: 'door', between: ['corridor', 'utilityRoom'], along: 'z', spanMin: 4.2, width: 0.9 },
  { kind: 'door', between: ['stairs', 'guestRoom'], along: 'x', spanMin: 4.65, width: 0.9,
    why: 'Onto the stair landing rather than the corridor (owner). It sits in the east landing\'s run, x 4.60–5.60, which is floor at this level; a door onto the half-landing would open half a storey above its floor.' },
  { kind: 'door', between: ['corridor', 'kitchen'], along: 'x', spanMin: 12.7, width: 0.9 },
  { kind: 'door', between: ['corridor', 'mainSanitair'], along: 'x', spanMin: 18.6, width: 0.9,
    why: 'Moved east to clear the laundry door, which the owner wanted back beside the corridor wall; at x 17.90 the two leaves swung into the same floor.' },
  { kind: 'door', between: ['balconyA', 'guestRoom'], along: 'z', spanMin: 6.35, width: 0.65,
    why: 'The owner moved the control-center door onto this wall: the balcony\'s second way in, after the master bedroom. 0.70 wide because the strip it opens into is only 0.80 deep.' },
  { kind: 'door', between: ['controlCenter', 'guestRoom'], along: 'x', spanMin: 1.7, width: 0.9,
    why: 'The old east-wall door, moved to the north wall: the guest-room strip above is now the only side the control center can be entered from.' },
  { kind: 'door', between: ['controlCenter', 'ccBalcony'], along: 'z', spanMin: 8.95, width: 0.7,
    why: '0.70, not 0.90: the balcony is only 0.80 deep now that the side-B strip is 0.80.' },
  // All three guest-bathroom leaves slide: the open part is 0.55 deep, so nothing
  // can swing into it. That is the price of keeping the guest room's tunnel to
  // the kitchen, which needs the walking strip to run past this room to reach it.
  { kind: 'door', between: ['guestSanitair', 'guestBathCubicle'], along: 'x', spanMin: 7.55, width: 0.6,
    swing: 'slide' },
  { kind: 'door', between: ['guestSanitair', 'guestShowerCubicle'], along: 'x', spanMin: 9.0, width: 0.6,
    swing: 'slide' },
  // The family cubicles slide too: 1.15 deep with a bath or tray in them leaves
  // less floor than a leaf needs to swing through.
  { kind: 'door', between: ['mainSanitair', 'mainBathCubicle'], along: 'x', spanMin: 18.1, width: 0.7,
    swing: 'slide' },
  { kind: 'door', between: ['mainSanitair', 'mainShowerCubicle'], along: 'x', spanMin: 19.6, width: 0.65,
    swing: 'slide' },
  { kind: 'door', between: ['guestRoom', 'guestSanitair'], along: 'x', spanMin: 7.4, width: 0.7,
    swing: 'slide',
    why: 'Sliding, and 0.70 not 0.90. The room is 1.35 deep with a 0.65 wet block and its screen, leaving 0.60 of free depth against the 0.70 a swinging leaf needs — the widest inward leaf that would clear is 0.55, too narrow for a bathroom. A sliding leaf needs no floor to open into.' },
  { kind: 'door', between: ['kitchen', 'balconySlabB'], along: 'x', spanMin: 12.7, width: 0.9 },
  { kind: 'door', between: ['laundry', 'mainSanitair'], along: 'z', spanMin: 5.9, width: 0.9,
    why: 'Close to the corridor wall (owner); the main sanitair\'s corridor door moved east instead, so the two leaves no longer share floor.' },
  { kind: 'door', between: ['laundry', 'balconySlabB'], along: 'x', spanMin: 14.3, width: 0.9,
    why: 'Swapped with the window (owner): the door takes the west end of the wall, the glazing the east.' },
]);

/**
 * Every window, declared. v1 derived one 1.20 × 1.20 window per room per
 * glazeable face; the owner's drawing needs purposeful openings instead, so
 * each one carries its kind, sill and head:
 *
 * - `air`   bathroom ventilation, above eye level;
 * - `pass`  hand food and coffee through to the guests, counter height;
 * - `light` daylight; hand level at the kitchen sink.
 */
export const WINDOWS = Object.freeze([
  { kind: 'light', between: ['controlCenter', 'balconyA'], along: 'z', spanMin: 7.5, width: 0.9,
    sill: 0.9, head: 2.1 },
  { kind: 'pass', between: ['guestRoom', 'kitchen'], along: 'z', spanMin: 6.35, width: 0.65,
    sill: 1.0, head: 1.8,
    why: 'Pass food and ready coffee through to the guests (owner) — a short tunnel through the 0.30 wall. Keeping it is why the bathroom sits below the walking strip rather than taking the suite\'s east end: the strip has to reach the kitchen.' },
  { kind: 'air', between: ['guestBathCubicle', 'voidWest'], along: 'x', spanMin: 7.55, width: 0.6,
    sill: 1.9, head: 2.3 },
  { kind: 'air', between: ['guestShowerCubicle', 'voidWest'], along: 'x', spanMin: 9.0, width: 0.6,
    sill: 1.9, head: 2.3 },
  { kind: 'light', between: ['kitchen', 'voidWest'], along: 'x', spanMin: 10.1, width: 1.4,
    sill: 0.9, head: 2.1,
    why: 'Hand level, for light over the sink (owner). 1.40, not the 1.80 first drawn: once the balcony slab moved west to x 11.60, a 1.80 opening straddled the boundary and faced the void at one end and the balcony at the other.' },
  // The owner asked for the laundry to be "completely open light" on side B: a
  // door and two big windows. The 3.20 m wall cannot give them width — it already
  // carries 0.90 of door — so they are given height instead: a 0.60 sill and a
  // 2.30 head make each one 1.70 m tall rather than the usual 1.20.
  { kind: 'light', between: ['laundry', 'voidEast'], along: 'x', spanMin: 15.4, width: 1.9,
    sill: 0.6, head: 2.3,
    why: 'The two 0.90 windows merged into one opening (owner). It faces the void along its whole length now that the owner moved the balcony west to end at the laundry door — which is why the slab no longer has to stretch east to carry it.' },
  { kind: 'air', between: ['mainBathCubicle', 'voidEast'], along: 'x', spanMin: 18.1, width: 0.7,
    sill: 1.9, head: 2.3 },
  { kind: 'air', between: ['mainShowerCubicle', 'voidEast'], along: 'x', spanMin: 19.6, width: 0.6,
    sill: 1.9, head: 2.3 },
  { kind: 'light', between: ['utilityRoom', 'voidEast'], along: 'z', spanMin: 8.95, width: 0.7,
    sill: 0.9, head: 2.1, why: 'The only utility face that sees daylight.' },
]);

/**
 * Fixtures: the things standing in a room, drawn so a room can be judged by what
 * has to fit in it rather than by its area alone. Matricule tag `X`, since `W`,
 * `P` and `G` are taken by walls, ports and glazing.
 *
 * `partition` is a fixture rather than a wall on purpose: it is a screen inside
 * one room, not a boundary between two, so it must not enter the wall derivation
 * — which works from the room rectangles and would have to split a room in half
 * to express it.
 *
 * The television is here for the same reason the corridor was widened: it hangs
 * on the stair-hall wall facing the living room across the corridor, and that run
 * had to reach x 11.80 so the viewing area is not cut in two.
 */
export const FIXTURES = Object.freeze([
  // A basin stands in the open part of each bathroom; the bath and the shower
  // stand inside their own cubicle rooms. They belong here even though the
  // cubicles are rooms: they are still objects occupying floor, and without them
  // the model holds no sanitary ware at all — the drawing could not show a bath,
  // and the door-swing check would pass every cubicle vacuously because there
  // would be nothing inside it to hit.
  { kind: 'sink', room: 'mainSanitair', rect: [19.6, 20.3, 6.0, 6.45] },
  { kind: 'bath', room: 'mainBathCubicle', rect: [17.75, 19.25, 7.85, 8.55] },
  { kind: 'shower', room: 'mainShowerCubicle', rect: [19.55, 20.3, 7.8, 8.55] },
  // The guest suite: a small shower for a quick wash, a short bath beside it and
  // the basin in the open, which is what the owner asked for. Everything here is
  // cut to the minimum that still works — the suite gives the bathroom only
  // 1.40 m of depth once the walking strip to the kitchen has taken its share.
  { kind: 'sink', room: 'guestSanitair', rect: [8.95, 9.65, 7.25, 7.7] },
  { kind: 'bath', room: 'guestBathCubicle', rect: [7.1, 8.65, 7.95, 8.55] },
  { kind: 'shower', room: 'guestShowerCubicle', rect: [8.95, 9.8, 7.95, 8.55] },
  // The television wall, facing the living room opening across the corridor.
  { kind: 'tv', room: 'corridor', rect: [7.5, 11.0, 5.82, 5.9] },
]);

/**
 * The walls built for real sound and heat isolation, named by the owner off the
 * wall register. Every other wall is a separator: it divides two spaces and
 * nothing more, and does not have to be built heavy.
 *
 * Isolation is a property of the physical wall, not of one room's face, so a
 * named face also insulates whatever backs onto it. That is why the length the
 * owner quoted is kept beside each matricule: three of these — the kitchen,
 * laundry and main sanitair north walls, 2.00 + 3.20 + 2.60 — back onto one
 * 8.40 m corridor wall, so the corridor's face is insulated over 7.80 of its
 * length and plain for the rest. Anything that reads this must union the spans
 * rather than flag whole walls, or it will insulate 0.60 m of corridor that the
 * owner did not ask for.
 *
 * The quoted lengths are also a tripwire: they are checked against the derived
 * walls, so if the numbering ever shifts under the owner's list, the check fails
 * instead of silently insulating a different wall.
 *
 * Isolation does not change a wall's thickness. Building a wall heavy is a
 * question of how it is made, and moving thicknesses here would ripple through
 * every dimension chain on the floor.
 */
export const INSULATED_WALLS = Object.freeze([
  // The master bedroom, all four sides (owner).
  { matricule: 'F1-R02-BED-W1', length: 5.0 },
  { matricule: 'F1-R02-BED-W2', length: 3.4 },
  { matricule: 'F1-R02-BED-W3', length: 5.0 },
  { matricule: 'F1-R02-BED-W4', length: 3.4 },
  // The whole side-C envelope (owner): blocked, so it is a heat boundary.
  { matricule: 'F1-R01-BAL-W1', length: 1.0 },
  { matricule: 'F1-R03-LIV-W1', length: 5.0 },
  { matricule: 'F1-R04-BED-W1', length: 5.0 },
  { matricule: 'F1-R05-BED-W1', length: 5.0 },
  // The female kids' bedroom is the corner room: side C, side D and the utility
  // wall (owner). The utility side is already named below as F1-R14-UTL-W1.
  { matricule: 'F1-R05-BED-W2', length: 3.55 },
  // The corridor's north wall runs thick for its whole length, not just past the
  // master bedroom (owner). Isolating only the master would have made that wall
  // 0.30 for one metre and 0.15 for the other thirteen, stepping the corridor
  // edge and throwing the stairs bay out of line with it. The other three rooms
  // gain isolation from the corridor as a consequence.
  // The living room and both kids' bedrooms keep a plain wall to the corridor
  // (owner), so only the master bedroom's 1.00 m stretch of that wall is hard.
  // All three are 3.55 deep rather than 3.40, which is what lets the corridor's
  // north face still run straight at z 4.00: the 0.15 each thin wall frees goes
  // into the room instead of stepping the corridor. The female bedroom's wall to
  // the utility room stays hard, carried by F1-R14-UTL-W1 below.
  // Named one by one off the register (owner), with his own quoted lengths.
  { matricule: 'F1-R14-UTL-W1', length: 1.7 },
  { matricule: 'F1-R07-COR-W2', length: 1.5 },
  { matricule: 'F1-R13-BTH-W1', length: 2.65 },
  { matricule: 'F1-R12-LND-W1', length: 3.3 },
  { matricule: 'F1-R11-KIT-W1', length: 1.9 },
  { matricule: 'F1-R07-COR-W4', length: 0.5 },
  { matricule: 'F1-R11-KIT-W5', length: 2.2 },
  { matricule: 'F1-R07-COR-W5', length: 6.3 },
  { matricule: 'F1-R09-GST-W1', length: 8.1 },
  { matricule: 'F1-R06-STR-W3', length: 4.0 },
  // The side-A balcony spine, named face by face rather than as one 9.40 run.
  // Naming the spine itself insulated everything behind it, including the
  // control center, and the owner wants that stretch plain: it is a technical
  // room and does not need the sound isolation the bedrooms do. Note the wall
  // there stays 0.30 all the same, because it faces an open balcony and the
  // weather rule outranks the isolation list — it is wide for warmth, not quiet.
  { matricule: 'F1-R06-STR-W4', length: 2.0 },
  // The guest room, wrapped on every side that is its own boundary (owner).
  // Deliberately NOT its two walls to the guest sanitair: that room is inside
  // the wrap, so isolating against it would be isolating the suite from itself.
  // All six faces of the guest room's new outline. It has six walls rather than
  // the earlier eight because the bathroom took the suite's east end, and every
  // one of these is the room's own boundary — including its wall to the bathroom,
  // which the owner asked to be hard.
  // Its walls to its own bathroom are deliberately NOT here. That suite has only
  // 1.40 m of bathroom depth left once the walking strip has taken its share, and
  // a 0.30 wall inside one suite costs more floor than the quiet is worth.
  { matricule: 'F1-R09-GST-W2', length: 0.75 },
  { matricule: 'F1-R09-GST-W5', length: 2.8 },
  { matricule: 'F1-R09-GST-W6', length: 1.55 },
]);

/** The side labels of the drawing. Side B is no longer open air. */
export const SIDES = Object.freeze({
  A: 'SIDE A — entry, exterior wall 0.30',
  B: 'SIDE B — exterior wall 0.30, full height like the others (not open air)',
  C: 'SIDE C — blocked, exterior wall 0.30',
  D: 'SIDE D — blocked, exterior wall 0.30',
});
