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
 * The stairwell, replacing the 17-riser / 0.25 going / 0.75 m flight of ADR-008.
 *
 * 18 risers of 3.00/18 carry a full storey; the going is 0.28 and each flight is
 * 1.00 m clear, so a washing machine or a fridge passes and the 1.46 × 2.00
 * half-landing is big enough to swing one round. The bay is only 3.70 m long,
 * which is too short to also hold a floor-level arrival landing (that would need
 * 1.00 + 2.24 + 1.00 = 4.24 m), so the top landing is the corridor itself, as
 * today. Consequence: the bay carries no floor at this level and no room may
 * open onto it — the control center and the guest room are reached elsewhere.
 */
export const STAIRS = Object.freeze({
  bay: Object.freeze([1.6, 5.3, 3.9, 5.9]),
  riserCount: 18,
  going: 0.28,
  flightWidth: 1.0,
  /** Flight A descends west along the north strip, from the corridor edge. */
  flightA: Object.freeze([3.06, 5.3, 3.9, 4.9]),
  /** Half-landing, half a storey down, spanning both strips. */
  halfLanding: Object.freeze([1.6, 3.06, 3.9, 5.9]),
  /** Flight B descends east along the south strip, to the floor below. */
  flightB: Object.freeze([3.06, 5.3, 4.9, 5.9]),
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
    rects: [[1.6, 5.3, 3.9, 5.9]], note: 'no floor at this level: 2 flights + half-landing' },
  { n: 7, id: 'corridor', name: 'Corridor', type: 'COR', kind: 'circulation',
    rects: [[5.3, 20.2, 3.9, 5.4], [5.3, 9.8, 5.4, 5.9]],
    note: 'the second rect is the stair hall; it serves the guest room' },
  { n: 8, id: 'controlCenter', name: 'Control center', type: 'CTR', kind: 'room',
    rects: [[1.6, 3.8, 6.1, 9.7]], note: 'reached through the guest room (as drawn)' },
  // West edge at x 4.10, not 4.00: the control center's east wall runs the whole
  // depth past this room and then past the control-center balcony. The balcony
  // face is weather-exposed and needs 0.30, so the room side must be 0.30 too —
  // one wall cannot be 0.20 for part of its length and 0.30 for the rest.
  { n: 9, id: 'guestRoom', name: 'Guest room', type: 'GST', kind: 'room',
    rects: [[4.1, 9.8, 6.1, 6.9], [4.1, 8.0, 6.9, 8.4]],
    note: 'one rectangle 5.70 × 2.30 with the guest sanitair carved out of its SE corner' },
  { n: 10, id: 'guestSanitair', name: 'Guest sanitair', type: 'BTH', kind: 'room',
    rects: [[8.2, 9.8, 7.1, 8.4]] },
  { n: 11, id: 'kitchen', name: 'Kitchen', type: 'KIT', kind: 'room',
    rects: [[10.0, 14.0, 5.6, 8.4]] },
  { n: 12, id: 'laundry', name: 'Laundry', type: 'LND', kind: 'room',
    rects: [[14.2, 17.4, 5.6, 8.4]], note: '1 door + 2 big windows on side B (owner)' },
  { n: 13, id: 'mainSanitair', name: 'Main sanitair', type: 'BTH', kind: 'room',
    rects: [[17.6, 20.2, 5.6, 8.4]] },
  { n: 14, id: 'utilityRoom', name: 'Utility room', type: 'UTL', kind: 'room',
    rects: [[20.4, 22.2, 3.9, 9.7]] },
  // Flush with the guest room above it at x 4.10, so the control center's east
  // wall is one straight 0.30 wall for its whole length.
  { n: 15, id: 'ccBalcony', name: 'Control-center balcony', type: 'BAL', kind: 'openAir',
    rects: [[4.1, 4.9, 8.7, 9.7]], note: 'new (owner)' },
  // The slab runs 0.10 wider than drawn at each end so the kitchen and laundry
  // doors, which the owner drew hard against x 12.70 and 16.20, keep a 0.10 m
  // jamb to the railing at the slab edge instead of opening onto it. The two
  // joins are zero-thickness (one continuous strip), so nothing else moves.
  { n: 16, id: 'balconySlabB', name: 'Side-B balcony slab', type: 'BAL', kind: 'openAir',
    rects: [[12.6, 16.3, 8.7, 9.7]] },
  { n: 17, id: 'voidWest', name: 'Void (west)', type: 'VOID', kind: 'void',
    rects: [[4.9, 12.6, 8.7, 9.7]] },
  { n: 18, id: 'voidEast', name: 'Void (east)', type: 'VOID', kind: 'void',
    rects: [[16.3, 20.2, 8.7, 9.7]] },
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
  { kind: 'door', between: ['corridor', 'guestRoom'], along: 'x', spanMin: 5.4, width: 0.9,
    why: 'From the stair hall: no room may open onto the stairwell, so the drawn stairs door moved here.' },
  { kind: 'door', between: ['corridor', 'kitchen'], along: 'x', spanMin: 12.7, width: 0.9 },
  { kind: 'door', between: ['corridor', 'mainSanitair'], along: 'x', spanMin: 17.9, width: 0.9 },
  { kind: 'door', between: ['controlCenter', 'guestRoom'], along: 'z', spanMin: 7.3, width: 0.9,
    why: 'As drawn. The stairwell has no floor and side A is private, so this is the only way in.' },
  { kind: 'door', between: ['controlCenter', 'ccBalcony'], along: 'z', spanMin: 8.75, width: 0.9 },
  { kind: 'door', between: ['guestRoom', 'guestSanitair'], along: 'z', spanMin: 7.2, width: 0.9,
    why: 'Moved 0.10 south: the sanitair west wall starts at z 7.10, so the drawn span had no jamb.' },
  { kind: 'door', between: ['kitchen', 'laundry'], along: 'z', spanMin: 7.2, width: 0.9 },
  { kind: 'door', between: ['kitchen', 'balconySlabB'], along: 'x', spanMin: 12.7, width: 0.9 },
  { kind: 'door', between: ['laundry', 'mainSanitair'], along: 'z', spanMin: 5.8, width: 0.9 },
  { kind: 'door', between: ['laundry', 'balconySlabB'], along: 'x', spanMin: 15.3, width: 0.9 },
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
  { kind: 'light', between: ['laundry', 'balconySlabB'], along: 'x', spanMin: 14.3, width: 0.9,
    sill: 0.9, head: 2.1 },
  { kind: 'light', between: ['laundry', 'voidEast'], along: 'x', spanMin: 16.4, width: 0.9,
    sill: 0.9, head: 2.1,
    why: '0.90 not 1.00: the laundry south wall is 3.20 and already carries 0.90 of window and 0.90 of door, so 1.00 left no jamb at the east end.' },
  { kind: 'air', between: ['mainSanitair', 'voidEast'], along: 'x', spanMin: 18.0, width: 0.7,
    sill: 1.9, head: 2.3 },
  { kind: 'air', between: ['mainSanitair', 'voidEast'], along: 'x', spanMin: 19.3, width: 0.7,
    sill: 1.9, head: 2.3 },
  { kind: 'light', between: ['utilityRoom', 'voidEast'], along: 'z', spanMin: 8.85, width: 0.7,
    sill: 0.9, head: 2.1, why: 'The only utility face that sees daylight.' },
]);

/** The side labels of the drawing. Side B is no longer open air. */
export const SIDES = Object.freeze({
  A: 'SIDE A — entry, exterior wall 0.30',
  B: 'SIDE B — exterior wall 0.30, full height like the others (not open air)',
  C: 'SIDE C — blocked, exterior wall 0.30',
  D: 'SIDE D — blocked, exterior wall 0.30',
});
