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
export const WALLS = Object.freeze({ exterior: 0.3, partition: 0.2, voidFacing: 0.3 });

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
  bay: Object.freeze([1.6, 5.6, 3.9, 5.9]),
  riserCount: 18,
  going: 0.25,
  flightWidth: 1.0,
  /** Arrival landing, at this floor's level, continuous with the corridor. */
  landingEast: Object.freeze([4.6, 5.6, 3.9, 5.9]),
  /** Flight A descends west along the north strip, 9 risers. */
  flightA: Object.freeze([2.6, 4.6, 3.9, 4.9]),
  /** The turn, half a storey down, spanning both strips. */
  halfLanding: Object.freeze([1.6, 2.6, 3.9, 5.9]),
  /** Flight B descends east along the south strip, 9 risers, to the floor below. */
  flightB: Object.freeze([2.6, 4.6, 4.9, 5.9]),
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
    rects: [[6.8, 11.8, 0.3, 3.7]] },
  { n: 4, id: 'bedroomMaleKids', name: 'Bedroom — male kids', type: 'BED', kind: 'room',
    rects: [[12.0, 17.0, 0.3, 3.7]] },
  { n: 5, id: 'bedroomFemaleKids', name: 'Bedroom — female kids', type: 'BED', kind: 'room',
    rects: [[17.2, 22.2, 0.3, 3.7]] },
  { n: 6, id: 'stairs', name: 'Stairwell', type: 'STR', kind: 'stairwell',
    rects: [[1.6, 5.6, 3.9, 5.9]], note: 'a landing at each end, flights A and B between them' },
  // The second rect runs east to x 11.80, the living room's east wall, so the
  // television wall opposite the living room is one unbroken run. Stopping it at
  // the old x 9.80 split the viewing area in two, with the kitchen wall poking
  // into the middle of it (owner).
  { n: 7, id: 'corridor', name: 'Corridor', type: 'COR', kind: 'circulation',
    rects: [[5.6, 20.2, 3.9, 5.4], [5.6, 11.8, 5.4, 5.9]],
    note: 'the second rect is the stair hall and the television wall; it serves the guest room' },
  // Starts at z 6.90, not 6.10: the owner gave the 0.80 m strip above it to the
  // guest room, which now reaches the side-A balcony. This room is entered from
  // that strip through its north wall.
  // Starts at z 7.10: the owner dragged this edge and the guest-room strip above
  // it to the same z 6.90, leaving the two rooms touching with no wall at all.
  // The strip is only 0.80 m to walk through, so the 0.20 partition comes out of
  // this room rather than out of it.
  { n: 8, id: 'controlCenter', name: 'Control center', type: 'CTR', kind: 'room',
    rects: [[1.6, 3.8, 7.1, 9.7]], note: 'entered from the guest-room strip above it' },
  // The north strip now runs the full width from the side-A balcony at x 1.60 to
  // x 9.80, passing over the control center (owner). That strip is what gives the
  // balcony its second door and what the control center opens onto, so it is
  // circulation as much as room — the old link corridor, absorbed into the room.
  // The lower rect keeps its west edge at x 4.10 so the control center's east
  // wall is one thickness: 0.30 for its whole length, because further south it
  // passes the weather-exposed balcony.
  { n: 9, id: 'guestRoom', name: 'Guest room', type: 'GST', kind: 'room',
    rects: [[1.6, 9.8, 6.1, 6.9], [4.1, 8.0, 6.9, 8.6]],
    note: 'north strip reaches the side-A balcony; guest sanitair carved out of the SE corner' },
  { n: 10, id: 'guestSanitair', name: 'Guest sanitair', type: 'BTH', kind: 'room',
    rects: [[8.2, 9.8, 7.1, 8.6]] },
  // No longer a rectangle: the corridor's television run now reaches x 11.80, so
  // the kitchen steps back to z 6.10 west of x 12.00 and keeps its full depth
  // east of it (owner: "the kitchen shape is not square, make it fit").
  { n: 11, id: 'kitchen', name: 'Kitchen', type: 'KIT', kind: 'room',
    rects: [[10.0, 12.0, 6.1, 8.6], [12.0, 14.0, 5.6, 8.6]] },
  { n: 12, id: 'laundry', name: 'Laundry', type: 'LND', kind: 'room',
    rects: [[14.2, 17.4, 5.6, 8.6]], note: '1 door + 2 big windows on side B (owner)' },
  { n: 13, id: 'mainSanitair', name: 'Main sanitair', type: 'BTH', kind: 'room',
    rects: [[17.6, 20.2, 5.6, 8.6]] },
  { n: 14, id: 'utilityRoom', name: 'Utility room', type: 'UTL', kind: 'room',
    rects: [[20.4, 22.2, 3.9, 9.7]] },
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
    rects: [[12.6, 17.4, 8.9, 9.7]] },
  { n: 17, id: 'voidWest', name: 'Void (west)', type: 'VOID', kind: 'void',
    rects: [[4.9, 12.6, 8.9, 9.7]], note: 'drying line and service risers; plumber access' },
  { n: 18, id: 'voidEast', name: 'Void (east)', type: 'VOID', kind: 'void',
    rects: [[17.4, 20.2, 8.9, 9.7]], note: 'drying line and service risers; plumber access' },
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
  { kind: 'door', between: ['balconyA', 'guestRoom'], along: 'z', spanMin: 6.15, width: 0.7,
    why: 'The owner moved the control-center door onto this wall: the balcony\'s second way in, after the master bedroom. 0.70 wide because the strip it opens into is only 0.80 deep.' },
  { kind: 'door', between: ['controlCenter', 'guestRoom'], along: 'x', spanMin: 1.7, width: 0.9,
    why: 'The old east-wall door, moved to the north wall: the guest-room strip above is now the only side the control center can be entered from.' },
  { kind: 'door', between: ['controlCenter', 'ccBalcony'], along: 'z', spanMin: 8.95, width: 0.7,
    why: '0.70, not 0.90: the balcony is only 0.80 deep now that the side-B strip is 0.80.' },
  { kind: 'door', between: ['guestRoom', 'guestSanitair'], along: 'z', spanMin: 7.15, width: 0.7,
    why: '0.70, not 0.90: the room is 1.50 deep and the bath takes 0.70 of it, so no 0.90 leaf can swing anywhere in it without hitting the bath.' },
  { kind: 'door', between: ['kitchen', 'balconySlabB'], along: 'x', spanMin: 12.7, width: 0.9 },
  { kind: 'door', between: ['laundry', 'mainSanitair'], along: 'z', spanMin: 5.7, width: 0.9,
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
  { kind: 'pass', between: ['guestRoom', 'kitchen'], along: 'z', spanMin: 6.2, width: 0.6,
    sill: 1.0, head: 1.8, why: 'Pass food and ready coffee to the guests (owner).' },
  { kind: 'air', between: ['guestSanitair', 'voidWest'], along: 'x', spanMin: 8.65, width: 0.7,
    sill: 1.9, head: 2.3 },
  { kind: 'light', between: ['kitchen', 'voidWest'], along: 'x', spanMin: 10.35, width: 1.8,
    sill: 0.9, head: 2.1, why: 'Hand level, for light over the sink (owner).' },
  // The owner asked for the laundry to be "completely open light" on side B: a
  // door and two big windows. The 3.20 m wall cannot give them width — it already
  // carries 0.90 of door — so they are given height instead: a 0.60 sill and a
  // 2.30 head make each one 1.70 m tall rather than the usual 1.20.
  { kind: 'light', between: ['laundry', 'balconySlabB'], along: 'x', spanMin: 15.3, width: 2.0,
    sill: 0.6, head: 2.3,
    why: 'The two 0.90 windows merged into one 2.00 opening (owner). 2.00 x 1.70 of glass is why the balcony slab now runs east to x 17.40 — a window should look at one thing, and at the old 16.30 edge half of it faced the void instead.' },
  { kind: 'air', between: ['mainSanitair', 'voidEast'], along: 'x', spanMin: 18.0, width: 0.7,
    sill: 1.9, head: 2.3 },
  { kind: 'air', between: ['mainSanitair', 'voidEast'], along: 'x', spanMin: 19.3, width: 0.7,
    sill: 1.9, head: 2.3 },
  { kind: 'light', between: ['utilityRoom', 'voidEast'], along: 'z', spanMin: 8.95, width: 0.7,
    sill: 0.9, head: 2.1, why: 'The only utility face that sees daylight.' },
]);

/**
 * Fixtures: the things standing in a room, drawn so a room can be judged by what
 * has to fit in it rather than by its area alone. Matricule tag `X`, since `W`,
 * `P` and `G` are taken by walls, ports and glazing.
 *
 * The television is here for the same reason the corridor was widened: it hangs
 * on the stair-hall wall facing the living room across the corridor, and that run
 * had to reach x 11.80 so the viewing area is not cut in two.
 */
export const FIXTURES = Object.freeze([
  // Main sanitair: sink, bath and shower (owner). The bath takes the south wall
  // under the two air windows; the shower fills the corner beside it.
  { kind: 'sink', room: 'mainSanitair', rect: [19.5, 20.2, 6.7, 7.15] },
  { kind: 'bath', room: 'mainSanitair', rect: [17.7, 19.4, 7.9, 8.6] },
  { kind: 'shower', room: 'mainSanitair', rect: [19.5, 20.1, 7.7, 8.6] },
  // Guest sanitair: sink and bath (owner). At 1.60 × 1.50 the room only takes a
  // bath across its full width, which leaves 0.80 of free depth — hence the 0.70
  // door, the only leaf that can swing clear of the bath.
  { kind: 'sink', room: 'guestSanitair', rect: [9.2, 9.8, 7.1, 7.55] },
  { kind: 'bath', room: 'guestSanitair', rect: [8.2, 9.8, 7.9, 8.6] },
  // The television wall, facing the living room opening across the corridor.
  { kind: 'tv', room: 'corridor', rect: [7.5, 11.0, 5.82, 5.9] },
]);

/** The side labels of the drawing. Side B is no longer open air. */
export const SIDES = Object.freeze({
  A: 'SIDE A — entry, exterior wall 0.30',
  B: 'SIDE B — exterior wall 0.30, full height like the others (not open air)',
  C: 'SIDE C — blocked, exterior wall 0.30',
  D: 'SIDE D — blocked, exterior wall 0.30',
});
