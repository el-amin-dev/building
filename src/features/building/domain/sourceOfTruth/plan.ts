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
 *
 * WHY this file lives in `src/` and not beside the scripts that read it: it is
 * the SINGLE copy of the geometry. It used to be `scripts/source-of-truth/
 * plan-v2.mjs`, with the 3D app holding a second, older copy of the same floor;
 * two copies of a plan means two buildings, and the drawing was already right
 * about one of them and wrong about the other. So the data moved here, where the
 * domain can import it directly, and the build/verify scripts import it from
 * here — `node` strips the types natively, which is why nothing in this file may
 * be a TypeScript-only runtime construct (no enums, no namespaces): types and
 * interfaces only, so `node scripts/source-of-truth/verify.mjs` keeps working
 * with no toolchain at all.
 */

/**
 * Deeply freezes a literal, so the single source of truth cannot be edited at
 * runtime by anything that reads it.
 *
 * @param value - The value to freeze, in place.
 * @returns The same value, frozen through every object and array it holds.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

/** A clear rect as `[minX, maxX, minZ, maxZ]`, in metres on the centimetre grid. */
export type PlanRectCoordinates = readonly [minX: number, maxX: number, minZ: number, maxZ: number];

/** Floor number of the typical floor (ADR-006: floors 1…N, floor 0 not designed). */
export const FLOOR_NUMBER = 1;

/** Outer plot, in metres: 22.50 × 10.00 (brief §1). */
export const PLOT = deepFreeze([0, 22.5, 0, 10] as const satisfies PlanRectCoordinates);

/** The wall thicknesses of the floor, in metres, by what the wall is for. */
export interface PlanWallThicknesses {
  /** Thickness of the exterior envelope, sides A, B, C and D. */
  readonly exterior: number;
  /** A wall on the owner's isolation list: built wide for sound and heat. */
  readonly insulated: number;
  /** Everything else inside: a separator, built as thin as it usefully can be. */
  readonly partition: number;
  /** A wall with one face on a balcony, a void or the balcony slab. */
  readonly voidFacing: number;
}

/**
 * Wall thicknesses, in metres (brief §2). `voidFacing` is not a duplicate of
 * `exterior`: a wall between a room and the side-A balcony, a side-B void or the
 * balcony slab is weather-exposed on one face, so it is built 0.30 like the
 * envelope even though it stands inside the plot. That is what the 0.30 gaps
 * drawn along x 1.30/1.60 and z 8.40/8.70 already are.
 */
export const WALLS = deepFreeze({
  exterior: 0.3,
  /** A wall on the owner's isolation list: built wide for sound and heat. */
  insulated: 0.3,
  /** Everything else inside: a separator, built as thin as it usefully can be. */
  partition: 0.15,
  voidFacing: 0.3,
} as const satisfies PlanWallThicknesses);

/** The vertical sizes of the floor, in metres. */
export interface PlanHeights {
  /** Floor level to the floor level above. */
  readonly floorToFloor: number;
  /** Finished floor to the underside of the slab. */
  readonly wall: number;
  /** Finished floor to the head of a door. */
  readonly door: number;
  /** Height of a railing on an open edge. */
  readonly railing: number;
}

/** Vertical sizes, in metres. Side B is now a normal exterior wall, so no side is a parapet. */
export const HEIGHTS = deepFreeze({
  floorToFloor: 3.0,
  wall: 2.7,
  door: 2.1,
  railing: 1.1,
} as const satisfies PlanHeights);

/** The stairwell: the bay it occupies, its risers, and the pieces that tile it. */
export interface PlanStairs {
  /** The whole stair bay, which the pieces below tile exactly. */
  readonly bay: PlanRectCoordinates;
  /** Risers for one full storey. */
  readonly riserCount: number;
  /** Going of one step, in metres. */
  readonly going: number;
  /** Clear width of one flight, in metres. */
  readonly flightWidth: number;
  /** Arrival landing, at this floor's level, continuous with the corridor. */
  readonly landingEast: PlanRectCoordinates;
  /** Flight A rises west along the north strip, 9 risers, to the half-landing above. */
  readonly flightA: PlanRectCoordinates;
  /**
   * The turn, spanning both strips. Its footprint is occupied twice over: half a
   * storey ABOVE this floor, where flight A arrives, and half a storey BELOW it,
   * where flight B starts. The stair repeats, so every half-landing level exists.
   */
  readonly halfLanding: PlanRectCoordinates;
  /** Flight B rises east along the south strip, 9 risers, from the half-landing below to this floor. */
  readonly flightB: PlanRectCoordinates;
}

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
 * the corridor.
 *
 * **The stair does not begin or end at this floor — it runs through it** (owner).
 * This is the typical floor of a stack, so the stairwell repeats every storey,
 * and the two flights touching this landing go in OPPOSITE directions:
 *
 * - flight A, the north strip, RISES from this floor to the half-landing above;
 * - flight B, the south strip, RISES from the half-landing below to this floor.
 *
 * Modelling both as descending would be a stair that arrives here and stops —
 * it would show no way up at all, and would put two flights in the footprints of
 * one. Which strip rises and which arrives is not arbitrary: a dog-leg that
 * repeats must hand the walker from one strip to the other at each half-landing,
 * so the strip you climb out of this landing on is the strip you did not arrive
 * by.
 */
export const STAIRS = deepFreeze({
  bay: [1.6, 5.6, 4.0, 6.0],
  riserCount: 18,
  going: 0.25,
  flightWidth: 1.0,
  /** Arrival landing, at this floor's level, continuous with the corridor. */
  landingEast: [4.6, 5.6, 4.0, 6.0],
  /** Flight A rises west along the north strip, 9 risers, to the half-landing above. */
  flightA: [2.6, 4.6, 4.0, 5.0],
  /** The turn, spanning both strips, at half a storey above AND half a storey below. */
  halfLanding: [1.6, 2.6, 4.0, 6.0],
  /** Flight B rises east along the south strip, 9 risers, from the half-landing below. */
  flightB: [2.6, 4.6, 5.0, 6.0],
} as const satisfies PlanStairs);

/**
 * What a space is, which drives its walls, its floor and whether it is walkable.
 *
 * - `room`: habitable, service and technical rooms;
 * - `circulation`: corridors and landings;
 * - `stairwell`: the stair bay, only part of which is floor at this level;
 * - `openAir`: walkable balconies;
 * - `void`: no floor, open to the sky.
 */
export type PlanRoomKind = 'room' | 'circulation' | 'stairwell' | 'openAir' | 'void';

/** The three-letter type code of a room, as it appears in its matricule. */
export type PlanRoomType =
  | 'BAL'
  | 'BAT'
  | 'BED'
  | 'BTH'
  | 'COR'
  | 'CTR'
  | 'GST'
  | 'KIT'
  | 'LIV'
  | 'LND'
  | 'SHW'
  | 'STR'
  | 'UTL'
  | 'VOID';

/** One space of the floor: its matricule number, its identity and its clear rects. */
export interface PlanRoom {
  /** Matricule number of the room, `R01`…`R22`. */
  readonly n: number;
  /** Stable identifier of the room. */
  readonly id: string;
  /** Human-readable name, as printed on the drawing. */
  readonly name: string;
  /** Type code of the room, used in its matricule. */
  readonly type: PlanRoomType;
  /** What the space is, which drives its walls and its floor. */
  readonly kind: PlanRoomKind;
  /**
   * Clear (inner) rectangles covering the room. A non-rectangular room uses
   * several rects; they touch, they do not overlap, and they enclose no hole.
   */
  readonly rects: readonly PlanRectCoordinates[];
  /** What the owner wanted from this room, when the rects alone do not say it. */
  readonly note?: string;
  /**
   * What is still unresolved about this room, in the owner's own terms.
   *
   * A `note` says what the room IS; this says what has not been settled about
   * it, and the two are kept apart because a reader acts on them differently —
   * one is a fact of the floor, the other is a decision still owed.
   *
   * It lives on the room rather than only in `docs/house-design-brief.md` §9
   * because the brief is a document you have to know to open: the app and the
   * generated drawing both read this file, so an item written here is shown on
   * the room it belongs to instead of being findable only by someone who
   * already knew it existed. One sentence per item, quoting the owner rather
   * than paraphrasing him, and the list is short on purpose — everything that
   * is decided belongs in the geometry, not here.
   */
  readonly open?: readonly string[];
}

/**
 * The 21 spaces, in matricule order R01…R21.
 *
 * Changed from v1: `linkCorridor` deleted; `ccBalcony` added; the stairs bay is
 * 0.50 m deeper; the corridor gains a second rect (the stair-hall widening in
 * front of the guest room, which is what keeps the guest room rectangular); the
 * control center runs to the side-B wall; the guest room is one rectangle again
 * (its two rects here are only the guest sanitair carved out of its SE corner);
 * `voidWest` starts at x 4.90 instead of 1.60.
 */
export const ROOMS = deepFreeze([
  {
    n: 1,
    id: 'balconyA',
    name: 'Side-A balcony',
    type: 'BAL',
    kind: 'openAir',
    rects: [[0.3, 1.3, 0.3, 9.7]],
    note: 'entry lands here; private to the master bedroom',
  },
  {
    n: 2,
    id: 'masterBedroom',
    name: 'Master bedroom',
    type: 'BED',
    kind: 'room',
    rects: [[1.6, 6.6, 0.3, 3.7]],
    note: 'no window (owner); balcony door centred on the wall',
  },
  {
    n: 3,
    id: 'livingRoom',
    name: 'Living room',
    type: 'LIV',
    kind: 'room',
    rects: [[6.9, 11.9, 0.3, 3.85]],
    open: [
      'No daylight: it touches only the blocked side C, so it gets electric light only (ADR-006), which is still in tension with the brief §1 rule that every habitable room take light and air from side A or B.',
    ],
  },
  {
    n: 4,
    id: 'bedroomMaleKids',
    name: 'Bedroom — male kids',
    type: 'BED',
    kind: 'room',
    rects: [[12.05, 17.05, 0.3, 3.85]],
    open: [
      'No daylight: it touches only the blocked side C, so it gets electric light only (ADR-006), which is still in tension with the brief §1 rule that every habitable room take light and air from side A or B.',
    ],
  },
  {
    n: 5,
    id: 'bedroomFemaleKids',
    name: 'Bedroom — female kids',
    type: 'BED',
    kind: 'room',
    rects: [[17.2, 22.2, 0.3, 3.85]],
    open: [
      'No daylight: it touches only the blocked side C, so it gets electric light only (ADR-006), which is still in tension with the brief §1 rule that every habitable room take light and air from side A or B.',
    ],
  },
  {
    n: 6,
    id: 'stairs',
    name: 'Stairwell',
    type: 'STR',
    kind: 'stairwell',
    rects: [[1.6, 5.6, 4.0, 6.0]],
    note: 'a landing at each end, flights A and B between them',
  },
  // The second rect runs east to the living room's east wall, so the
  // television wall opposite the living room is one unbroken run. Stopping it at
  // the old x 9.80 split the viewing area in two, with the kitchen wall poking
  // into the middle of it (owner).
  {
    n: 7,
    id: 'corridor',
    name: 'Corridor',
    type: 'COR',
    kind: 'circulation',
    rects: [
      [5.6, 20.2, 4.0, 5.5],
      [5.6, 11.9, 5.5, 6.0],
    ],
    note: 'the second rect is the stair hall and the television wall; it serves the guest room',
  },
  // Its north edge follows the guest-room strip rather than the other way round.
  // The owner gave the strip above this room to the guest room so it could reach
  // the side-A balcony, and this room is entered from that strip through its
  // north wall. Each time the strip moved, the partition below it moved with it
  // and this room gave up the depth — the strip is the minimum width anyone can
  // walk through, so it was never the side that could afford to shrink.
  {
    n: 8,
    id: 'controlCenter',
    name: 'Control center',
    type: 'CTR',
    kind: 'room',
    rects: [[1.6, 3.8, 7.2, 9.7]],
    note: 'entered from the guest-room strip above it; holds the two sealed service chambers and the central water heater',
  },
  // The north strip now runs the full width from the side-A balcony at x 1.60 to
  // x 9.70, passing over the control center (owner). That strip is what gives the
  // balcony its second door and what the control center opens onto, so it is
  // circulation as much as room — the old link corridor, absorbed into the room.
  // The lower rect keeps its west edge at x 4.10 so the control center's east
  // wall is one thickness: 0.30 for its whole length, because further south it
  // passes the weather-exposed balcony.
  {
    n: 9,
    id: 'guestRoom',
    name: 'Guest room',
    type: 'GST',
    kind: 'room',
    rects: [
      [1.6, 9.7, 6.3, 7.05],
      [4.1, 7.9, 7.05, 8.6],
    ],
    note: 'north strip reaches the side-A balcony; guest sanitair carved out of the SE corner',
  },
  {
    n: 10,
    id: 'guestSanitair',
    name: 'Guest sanitair',
    type: 'BTH',
    kind: 'room',
    rects: [[8.05, 9.85, 7.2, 7.75]],
    note: 'the open part: sink, and the sliding door into the bath cubicle',
    open: [
      'The suite is cut to the minimum that works, and if it proves too tight in the 3D walk-through the levers are to drop its bath or to take depth from the guest room (brief §7.3).',
      "It has no WC, deliberately: the floor's only WC stands in the main sanitair (owner, 2026-09-19).",
    ],
  },
  // No longer a rectangle: the corridor's television run now reaches x 11.90, so
  // the kitchen steps back at its west end and keeps its full depth
  // east of it (owner: "the kitchen shape is not square, make it fit").
  {
    n: 11,
    id: 'kitchen',
    name: 'Kitchen',
    type: 'KIT',
    kind: 'room',
    rects: [
      [10.0, 12.2, 6.3, 8.6],
      [12.2, 14.1, 5.8, 8.6],
    ],
  },
  {
    n: 12,
    id: 'laundry',
    name: 'Laundry',
    type: 'LND',
    kind: 'room',
    rects: [[14.25, 17.55, 5.8, 8.6]],
    note: '1 door + 2 big windows on side B (owner)',
  },
  {
    n: 13,
    id: 'mainSanitair',
    name: 'Main sanitair',
    type: 'BTH',
    kind: 'room',
    rects: [[17.7, 20.35, 5.8, 7.3]],
    note: 'the open part: sink, and the doors into the bath and shower cubicles',
  },
  {
    n: 14,
    id: 'utilityRoom',
    name: 'Utility room',
    type: 'UTL',
    kind: 'room',
    rects: [[20.5, 22.2, 4.15, 9.7]],
  },
  // Flush with the guest room above it at x 4.10, so the control center's east
  // wall is one straight 0.30 wall for its whole length.
  {
    n: 15,
    id: 'ccBalcony',
    name: 'Control-center balcony',
    type: 'BAL',
    kind: 'openAir',
    rects: [[4.1, 4.9, 8.9, 9.7]],
    note: 'new (owner)',
  },
  // The slab runs x 11.65–15.35 and carries both side-B doors: the kitchen's at
  // x 12.70–13.60 and the laundry's at x 14.30–15.20. Each door keeps slab to walk
  // out onto rather than opening straight onto the railed edge, but the margins are
  // deliberately uneven — 1.05 west of the kitchen door, 0.15 east of the laundry
  // one — because each door is placed by the room behind it, not by the slab. (An
  // earlier version of this note said both doors were drawn hard against x 12.70
  // and 16.20 with a 0.10 margin each; neither number survived the redraw.) The two
  // joins to the void are zero-thickness — one continuous strip — so nothing else
  // moves when the slab does.
  //
  // The strip is 0.80 deep, not the 1.00 first drawn: the owner set 1.00 as a
  // starting value, and its real job fixes the number. It carries the water, gas
  // and electricity risers, which run outside the rooms because that is cleaner
  // to service and safer to isolate; a laundry line is strung across it; and a
  // plumber needs to stand in it occasionally. Risers take about 0.15 off the
  // wall, so 0.80 leaves about 0.65 to work in. The 0.20 saved goes to the
  // kitchen, laundry and main sanitair: the kitchen's east rect and the laundry are
  // 2.80 deep (z 5.80–8.60) and the main sanitair 1.50 (z 5.80–7.30), the rest of
  // its depth having gone to the bath and shower cubicles.
  {
    n: 16,
    id: 'balconySlabB',
    name: 'Side-B balcony slab',
    type: 'BAL',
    kind: 'openAir',
    rects: [[11.65, 15.35, 8.9, 9.7]],
  },
  {
    n: 17,
    id: 'voidWest',
    name: 'Void (west)',
    type: 'VOID',
    kind: 'void',
    rects: [[4.9, 11.65, 8.9, 9.7]],
    note: 'drying line and service risers; plumber access',
  },
  {
    n: 18,
    id: 'voidEast',
    name: 'Void (east)',
    type: 'VOID',
    kind: 'void',
    rects: [[15.35, 20.3, 8.9, 9.7]],
    note: 'drying line and service risers; plumber access',
  },
  // A bathroom is an open part with the basin, and a walled bath and a walled
  // shower each with its own door (owner). The bath and the shower are therefore
  // rooms, not fittings: that is what gives them walls, matricules and ports like
  // everything else on the floor.
  //
  // The two bathrooms are no longer the same arrangement. The family one keeps
  // both cubicles; the guest one has a bath and no shower, which is what brief
  // §7.3's own table asked for in the first place — `Guest Sanitair | Sink (open)
  // + Bath — NO shower`. The shower was added later, against that row, and it is
  // what made the suite the tightest thing on the floor: §7.3 stayed OPEN on
  // whether it worked, the 3D walk-through answered no, and the owner spent the
  // shower (2026-09-19) rather than either of the two levers the brief listed.
  // Dropping it is also what pays for the guest room's extra metre: the suite
  // slides east onto the floor the shower held, and the room grows into the west
  // end it leaves behind.
  {
    n: 19,
    id: 'guestBathCubicle',
    name: 'Guest bath',
    type: 'BAT',
    kind: 'room',
    rects: [[8.05, 9.85, 7.9, 8.6]],
    note: 'holds a 1.55 bath along its width, with floor left beside it',
  },
  {
    n: 20,
    id: 'mainBathCubicle',
    name: 'Family bath',
    type: 'BAT',
    kind: 'room',
    rects: [[17.7, 19.35, 7.45, 8.6]],
  },
  {
    n: 21,
    id: 'mainShowerCubicle',
    name: 'Family shower',
    type: 'SHW',
    kind: 'room',
    rects: [[19.5, 20.35, 7.45, 8.6]],
  },
] as const satisfies readonly PlanRoom[]);

/** Identifier of a space on the floor; the `id` of one of {@link ROOMS}. */
export type PlanRoomId = (typeof ROOMS)[number]['id'];

/** A wall thickness that deviates from the kind-based default, and why. */
export interface PlanJoinOverride {
  /** The two rooms whose shared wall is overridden. */
  readonly between: readonly [PlanRoomId, PlanRoomId];
  /** Thickness of the wall between them, in metres; `0` means no wall at all. */
  readonly thickness: number;
  /** Why the default thickness does not apply, for traceability to the brief. */
  readonly why: string;
}

/** Wall thicknesses that deviate from the kind-based default. */
export const JOIN_OVERRIDES = deepFreeze([
  {
    between: ['stairs', 'corridor'],
    thickness: 0,
    // Stays 0, and the zero is NOT a mistake to be tidied away later. The owner
    // will separate the landing from the corridor with a demountable aluminium /
    // sandwich panel carrying a wide door — removable in about five minutes — and
    // asked that it not be drawn: it exists in the building, not in the geometry.
    // Modelling it was tried and reverted, because masonry here costs 0.15 that
    // the floor does not have: the stair needs its full 1.00 landing to turn a
    // 180°, so the corridor would have had to pay all of it and the master
    // bedroom's door would have dropped from 0.90 to 0.75. A demountable panel
    // takes none of that, which is exactly why the owner chose one.
    why: 'The corridor is the top landing of the stair, no wall (brief §4.2). A demountable panel with a wide door will stand here in the building; it is deliberately not modelled (owner, 2026-09-12).',
  },
  {
    between: ['voidWest', 'ccBalcony'],
    thickness: 0,
    why: 'Both are the same open-air strip, no wall.',
  },
  {
    between: ['voidWest', 'balconySlabB'],
    thickness: 0,
    why: 'Both are the same open-air strip, no wall (brief §5.2).',
  },
  {
    between: ['voidEast', 'balconySlabB'],
    thickness: 0,
    why: 'Both are the same open-air strip, no wall (brief §5.2).',
  },
  {
    between: ['voidEast', 'utilityRoom'],
    thickness: 0.2,
    why: 'Owner kept the drawn 0.20 wall (ADR-006).',
  },
] as const satisfies readonly PlanJoinOverride[]);

/** The plan axis an opening's width runs along. */
export type PlanOpeningAxis = 'x' | 'z';

/** What kind of passage a port is: a leaf in a wall, or a wall interruption. */
export type PlanPortKind = 'door' | 'opening';

/** How a door leaf opens. Absent means it swings. */
export type PlanPortSwing = 'slide';

/** One passage between two rooms: a door, or an opening with no leaf. */
export interface PlanPort {
  /** Whether the passage has a leaf. */
  readonly kind: PlanPortKind;
  /** The two rooms the port connects. */
  readonly between: readonly [PlanRoomId, PlanRoomId];
  /** The axis the port's width runs along. */
  readonly along: PlanOpeningAxis;
  /** Start of the port along {@link PlanPort.along}, in metres. */
  readonly spanMin: number;
  /** Clear width of the passage, in metres; the port ends at `spanMin + width`. */
  readonly width: number;
  /** How the leaf opens; absent when it swings. */
  readonly swing?: PlanPortSwing;
  /** Why the port is where it is and the size it is, in the owner's terms. */
  readonly why?: string;
}

/**
 * Every port: 18 doors and the single living-room opening.
 *
 * Gone from v1: the five `linkCorridor` doors, and the guest-room ↔ kitchen
 * door, which the owner replaced with the food-pass window. Doors sit near a
 * corner so the wall runs stay usable for furniture (owner), except the master
 * bedroom's balcony door, which is centred (owner).
 */
export const PORTS = deepFreeze([
  {
    kind: 'door',
    between: ['balconyA', 'masterBedroom'],
    along: 'z',
    spanMin: 1.55,
    width: 0.9,
    why: 'Centred on the wall (owner); the master has no window, so this is its only opening.',
  },
  {
    kind: 'door',
    between: ['masterBedroom', 'corridor'],
    along: 'x',
    spanMin: 5.65,
    width: 0.9,
    why: 'Near the east corner, 0.05 short of it: at 5.70 the leaf died on the master-bedroom east wall.',
  },
  {
    kind: 'opening',
    between: ['livingRoom', 'corridor'],
    along: 'x',
    spanMin: 7.5,
    width: 3.5,
    why: 'No leaf: the living room faces the TV wall across the corridor (brief §4.1).',
  },
  { kind: 'door', between: ['bedroomMaleKids', 'corridor'], along: 'x', spanMin: 12.3, width: 0.9 },
  {
    kind: 'door',
    between: ['bedroomFemaleKids', 'corridor'],
    along: 'x',
    spanMin: 17.6,
    width: 0.9,
  },
  { kind: 'door', between: ['corridor', 'utilityRoom'], along: 'z', spanMin: 4.2, width: 0.9 },
  {
    kind: 'door',
    between: ['stairs', 'guestRoom'],
    along: 'x',
    spanMin: 4.65,
    width: 0.9,
    why: "Onto the stair landing rather than the corridor (owner). It sits in the east landing's run, x 4.60–5.60, which is floor at this level; a door onto the half-landing would open half a storey above its floor.",
  },
  { kind: 'door', between: ['corridor', 'kitchen'], along: 'x', spanMin: 12.7, width: 0.9 },
  {
    kind: 'door',
    between: ['corridor', 'mainSanitair'],
    along: 'x',
    spanMin: 18.6,
    width: 0.9,
    why: 'Moved east to clear the laundry door, which the owner wanted back beside the corridor wall; at x 17.90 the two leaves swung into the same floor.',
  },
  {
    kind: 'door',
    between: ['balconyA', 'guestRoom'],
    along: 'z',
    spanMin: 6.35,
    width: 0.65,
    why: "The owner moved the control-center door onto this wall: the balcony's second way in, after the master bedroom. 0.65 wide because the strip it opens into is only 0.75 deep, which leaves a 0.05 jamb at each end.",
  },
  {
    kind: 'door',
    between: ['controlCenter', 'guestRoom'],
    along: 'x',
    spanMin: 1.7,
    width: 1.2,
    why: 'The old east-wall door, moved to the north wall: the guest-room strip above is now the only side the control center can be entered from. Widened from 0.90 to 1.20 (owner), "for any some usage" — the control center holds the water, gas and electricity risers, so a water heater or a gas bottle has to pass. 1.20 is the owner\'s choice and not a geometric limit: the wall runs x 1.60–3.80, so with a 0.05 jamb at each end it could take 2.10. The door sits 1.70–2.90, leaving 0.10 of wall west of it and 0.90 east.',
  },
  {
    kind: 'door',
    between: ['controlCenter', 'ccBalcony'],
    along: 'z',
    spanMin: 8.95,
    width: 0.7,
    why: '0.70, not 0.90: the balcony is only 0.80 deep now that the side-B strip is 0.80.',
  },
  // Both guest-bathroom leaves slide: the open part is 0.55 deep, so nothing can
  // swing into it. That is the price of keeping the guest room's tunnel to the
  // kitchen, which needs the walking strip to run past this room to reach it.
  //
  // Their spans moved east with the suite when the shower was dropped, and the two
  // sit in OPPOSITE faces of a room 0.55 deep — the room leaf in the north face at
  // x 8.10–8.80, the bath leaf in the south face at x 8.20–8.80, almost directly
  // across from each other (owner, 2026-09-19). They do not compete for a run,
  // which is the whole reason a 1.80 room can carry both: check 4's 0.10 rule is
  // about two openings in ONE face. What they do is put the bathroom's two doors
  // at the same end, so the basin keeps the east dead-end to itself.
  {
    kind: 'door',
    between: ['guestSanitair', 'guestBathCubicle'],
    along: 'x',
    spanMin: 8.2,
    width: 0.6,
    swing: 'slide',
  },
  // The family cubicles slide too: 1.15 deep with a bath or tray in them leaves
  // less floor than a leaf needs to swing through.
  {
    kind: 'door',
    between: ['mainSanitair', 'mainBathCubicle'],
    along: 'x',
    spanMin: 18.1,
    width: 0.7,
    swing: 'slide',
  },
  {
    kind: 'door',
    between: ['mainSanitair', 'mainShowerCubicle'],
    along: 'x',
    spanMin: 19.6,
    width: 0.65,
    swing: 'slide',
  },
  {
    kind: 'door',
    between: ['guestRoom', 'guestSanitair'],
    along: 'x',
    spanMin: 8.1,
    width: 0.7,
    swing: 'slide',
    why: 'Sliding, and 0.70 not 0.90. The suite is 1.40 deep, and the 0.70 wet block with its 0.15 screen leaves the open part only 0.55 (z 7.20–7.75) against the 0.70 a swinging leaf needs — the widest inward leaf that would clear is 0.55, too narrow for a bathroom. A sliding leaf needs no floor to open into. It takes the WEST end of the 1.80 run the suite now has: the pass counter is built out from x 9.00, so a leaf any further east would open against the side of it.',
  },
  { kind: 'door', between: ['kitchen', 'balconySlabB'], along: 'x', spanMin: 12.7, width: 0.9 },
  {
    kind: 'door',
    between: ['laundry', 'mainSanitair'],
    along: 'z',
    spanMin: 5.9,
    width: 0.9,
    why: "Close to the corridor wall (owner); the main sanitair's corridor door moved east instead, so the two leaves no longer share floor.",
  },
  {
    kind: 'door',
    between: ['laundry', 'balconySlabB'],
    along: 'x',
    spanMin: 14.3,
    width: 0.9,
    why: 'Swapped with the window (owner): the door takes the west end of the wall, the glazing the east.',
  },
] as const satisfies readonly PlanPort[]);

/**
 * What a window is for:
 *
 * - `air`   bathroom ventilation, above eye level;
 * - `pass`  hand food and coffee through to the guests, counter height;
 * - `light` daylight; hand level at the kitchen sink.
 */
export type PlanWindowKind = 'air' | 'pass' | 'light';

/** One glazed opening between two spaces, with the height it sits at. */
export interface PlanWindow {
  /** What the window is for, which fixes its sill and head. */
  readonly kind: PlanWindowKind;
  /** The two spaces the window looks between. */
  readonly between: readonly [PlanRoomId, PlanRoomId];
  /** The axis the window's width runs along. */
  readonly along: PlanOpeningAxis;
  /** Start of the window along {@link PlanWindow.along}, in metres. */
  readonly spanMin: number;
  /** Clear width, in metres; the window ends at `spanMin + width`. */
  readonly width: number;
  /** Height of the sill above the finished floor, in metres. */
  readonly sill: number;
  /** Height of the head above the finished floor, in metres. */
  readonly head: number;
  /** Why the window is where it is and the size it is, in the owner's terms. */
  readonly why?: string;
}

/**
 * Every window, declared. v1 derived one 1.20 × 1.20 window per room per
 * glazeable face; the owner's drawing needs purposeful openings instead, so
 * each one carries its kind, sill and head:
 *
 * - `air`   bathroom ventilation, above eye level;
 * - `pass`  hand food and coffee through to the guests, counter height;
 * - `light` daylight; hand level at the kitchen sink.
 */
export const WINDOWS = deepFreeze([
  {
    kind: 'light',
    between: ['controlCenter', 'balconyA'],
    along: 'z',
    spanMin: 7.5,
    width: 0.9,
    sill: 0.9,
    head: 2.1,
  },
  {
    kind: 'pass',
    between: ['guestRoom', 'kitchen'],
    along: 'z',
    spanMin: 6.4,
    width: 0.55,
    sill: 1.0,
    head: 1.8,
    why: "Pass food and ready coffee through to the guests (owner). No longer a hole in a 0.30 wall but the bore of a 1.00 m tunnel: the `passCounter` fixture in FIXTURES builds the other 0.70 out from the guest-room face, so the opening has a mouth at each end and a ledge at 1.00 to stand plates on. Narrowed from 0.65 to 0.55 to pay for that: the host face is 0.75, and 0.55 leaves 0.10 of masonry jamb each side instead of the bare 0.05 minimum, which is what the built-out cheeks are built against. 0.55 × 0.80 still passes a tray. Keeping the pass at all is why the bathroom sits below the walking strip rather than taking the suite's east end: the strip has to reach the kitchen.",
  },
  {
    kind: 'air',
    between: ['guestBathCubicle', 'voidWest'],
    along: 'x',
    spanMin: 8.6,
    width: 0.6,
    sill: 1.9,
    head: 2.3,
  },
  {
    kind: 'light',
    between: ['kitchen', 'voidWest'],
    along: 'x',
    spanMin: 10.1,
    width: 1.4,
    sill: 0.9,
    head: 2.1,
    why: 'Hand level, for light over the sink (owner). 1.40, not the 1.80 first drawn: once the balcony slab moved west to x 11.60, a 1.80 opening straddled the boundary and faced the void at one end and the balcony at the other.',
  },
  // The owner asked for the laundry to be "completely open light" on side B: a
  // door and two big windows. The 3.20 m wall cannot give them width — it already
  // carries 0.90 of door — so they are given height instead: a 0.60 sill and a
  // 2.30 head make each one 1.70 m tall rather than the usual 1.20.
  {
    kind: 'light',
    between: ['laundry', 'voidEast'],
    along: 'x',
    spanMin: 15.4,
    width: 1.9,
    sill: 0.6,
    head: 2.3,
    why: 'The two 0.90 windows merged into one opening (owner). It faces the void along its whole length now that the owner moved the balcony west to end at the laundry door — which is why the slab no longer has to stretch east to carry it.',
  },
  {
    kind: 'air',
    between: ['mainBathCubicle', 'voidEast'],
    along: 'x',
    spanMin: 18.1,
    width: 0.7,
    sill: 1.9,
    head: 2.3,
  },
  {
    kind: 'air',
    between: ['mainShowerCubicle', 'voidEast'],
    along: 'x',
    spanMin: 19.6,
    width: 0.6,
    sill: 1.9,
    head: 2.3,
  },
  {
    kind: 'light',
    between: ['utilityRoom', 'voidEast'],
    along: 'z',
    spanMin: 8.95,
    width: 0.7,
    sill: 0.9,
    head: 2.1,
    why: 'The only utility face that sees daylight.',
  },
] as const satisfies readonly PlanWindow[]);

/**
 * What a fixture is: the sanitary ware, the appliances, and the furniture the
 * owner listed room by room (brief §7).
 *
 * The union is closed on purpose. A kind is not a label a placer invents while
 * furnishing — it is the key {@link FIXTURE_ROLES} classifies and the renderers
 * draw from, so adding one is a decision taken here, where it can be argued
 * about, and not a string typed into a rect.
 *
 * `partition` is deliberately NOT declared. An earlier version of this file
 * reserved a partition kind for a screen standing inside one room — a divider
 * that must stay out of the wall derivation, which works from the room
 * rectangles and would have to split a room in two to express it. No screen is
 * required by this layout: every division the owner asked for is a real wall
 * between two rooms, including the bath and shower cubicles, which are rooms
 * precisely so that they have walls and ports like everything else. A kind with
 * no member is a kind that invites one, so it is not declared until a screen is
 * actually asked for.
 */
export type PlanFixtureKind =
  | 'barbecue'
  | 'bath'
  | 'artwork'
  | 'bed'
  | 'bookcase'
  | 'coffeeTable'
  | 'cooker'
  | 'counter'
  | 'desk'
  | 'diningTable'
  | 'fridge'
  | 'nightstand'
  | 'passCounter'
  | 'serviceChamber'
  | 'shower'
  | 'sideboard'
  | 'sink'
  | 'sofa'
  | 'storageUnit'
  | 'tv'
  | 'wardrobe'
  | 'washingMachine'
  | 'wc';

/** The clearances a fitting is placed by. */
export const FIXTURE_SPEC = deepFreeze({
  /** A standing fitting stands this clear of the wall it backs onto, in metres. */
  wallGap: 0.05,
  /** Clear floor in front of a fitting's working face, in metres. */
  approach: 0.6,
  /** Clear floor inward of a leafless port, in metres, so the passage survives. */
  openingClearance: 0.6,
} as const);

/**
 * How a fixture meets the walls of the room it stands in.
 *
 * Each value is defined against the arithmetic a checker can run, because the
 * whole point of writing it down is that a placed rect either honours the claim
 * or does not. Every face is compared with the corresponding face of the room
 * rect that CONTAINS the fixture — a room with several rects is measured
 * against the one the fixture is in, not against the room's bounding box.
 *
 * - `standing` — the fixture backs onto a wall: at least one of its four faces
 *   is within {@link FIXTURE_SPEC.wallGap} of the corresponding room face.
 *   This is the ordinary case, and the gap is the skirting-and-plaster slack a
 *   real fitting is installed with, not a mistake to be closed to zero.
 * - `mounted` — the fixture is fixed TO a wall: at least one face is flush with
 *   a room face, gap exactly 0. Nothing stands on the floor, so there is no
 *   slack to leave: a television hangs on the wall it is screwed to.
 * - `freestanding` — nothing touches a wall: every face is further than
 *   `wallGap` from the room's faces. This is not an error, it is a claim — a
 *   dining table in the middle of a room is meant to be reachable from all four
 *   sides — so the verifier prints every freestanding item out loud rather than
 *   passing it silently. A fixture that drifted off its wall and one that was
 *   meant to stand in the open look identical in the data; the difference is
 *   that one of them said so.
 */
export type PlanFixtureMount = 'standing' | 'mounted' | 'freestanding';

/** One object standing in a room, with the floor it occupies. */
export interface PlanFixture {
  /** What the fixture is. */
  readonly kind: PlanFixtureKind;
  /** The room it stands in. */
  readonly room: PlanRoomId;
  /** The floor it occupies, as a clear rect. */
  readonly rect: PlanRectCoordinates;
  /** How it meets the walls of that room, and what a checker may assert about it. */
  readonly mount: PlanFixtureMount;
  /**
   * What distinguishes this fixture from an otherwise identical one, e.g. the
   * laundry's `dirty` and `clean` armoires, which are the same box twice and
   * are two entries only because the owner asked for two (brief §7.1).
   */
  readonly note?: string;
  /**
   * Clear floor in front of this fitting's working face, in metres, where the
   * room cannot give {@link FIXTURE_SPEC.approach}.
   *
   * An override, never a restatement: writing the default here again would
   * leave two numbers for one clearance. It is stated only where the room is
   * too tight to honour the default, so that the shortfall is a recorded
   * decision with a figure on it rather than a check quietly skipped.
   */
  readonly approach?: number;
  /**
   * The axis a bore through this fixture runs along, where it has one.
   *
   * **It is the PERPENDICULAR of the opening's own `along`, and the clash of names
   * is worth reading before trusting either.** {@link PlanOpeningAxis} is documented
   * as "the plan axis an opening's WIDTH runs along", and by that reading the food
   * pass is `along: 'z'` — its 0.55 m of width is measured across z. The pass counter
   * built around that very window is `along: 'x'`, because what runs along x is the
   * hole through it. Same field name, same type, two axes at right angles, both
   * correct. A reader who assumes the two rows should agree will "fix" one of them.
   *
   * The name is kept because `boreAxis` on one kind and `along` on the other two
   * would hide the relationship rather than explain it; the relationship is that one
   * is always the other turned 90°, and `fixtures.test.ts` asserts the built cheeks
   * against the window's own span, so a flip fails rather than renders wrong.
   *
   * Only `passCounter` reads it, and it is stated rather than inferred because
   * `fixtures.ts` is handed a rect and nothing else. The pass counter is
   * 0.70 × 0.75, so deducing the bore from the longer side of the rect would
   * turn the whole geometry on a 0.05 m margin — change the opening by a
   * centimetre and the tunnel silently rotates 90°. `heightAt` in `walls.ts`
   * already settled this argument for wall heights ("stated beats inferred"),
   * and `PORTS` and `WINDOWS` already carry a field of this name and type.
   */
  readonly along?: PlanOpeningAxis;
}

/**
 * What a fixture is FOR, as opposed to what it is.
 *
 * - `fitting` — plumbed in and part of the building: it is installed, not moved;
 * - `appliance` — a machine that is delivered, connected and can be replaced;
 * - `furniture` — loose, and the owner may rearrange it the day he moves in;
 * - `joinery` — built in like a fitting, but nothing runs to it: no water, no
 *   drain, no power. The building's carpentry rather than its services;
 * - `services` — the building's own equipment, which is why it is in the room
 *   that centralises the utilities and not in anybody's way.
 *
 * `joinery` was split out of `fitting` on 2026-09-19, and the reason is that a
 * role here is not a label — `isServicedSpace` reads it to decide whether a room
 * gets carpet or marble underfoot (ADR-020: "a room is carpeted unless something
 * in it is plumbed, powered or a riser"). While `fitting` meant both "plumbed in"
 * and "built in", that question could not be answered honestly: the guest room's
 * new pass counter is dry carpentry, and calling it a fitting laid a bathroom
 * floor in a sitting room. The kitchen counter moved with it, because it is the
 * same thing and leaving it behind would have made the new role arbitrary — the
 * kitchen is still marble, serviced by its cooker and its fridge, so nothing on
 * the floor changed finish but the guest room, which is the room that was wrong.
 */
export type PlanFixtureRole = 'fitting' | 'appliance' | 'furniture' | 'joinery' | 'services';

/**
 * What every fixture kind is for, as a TOTAL record over {@link PlanFixtureKind}.
 *
 * Total is the whole point. `satisfies Record<PlanFixtureKind, …>` makes
 * TypeScript fail the build when a kind is added to the union without being
 * classified here, so a new kind cannot slip through unclassified — the
 * compiler asks the question at the moment the kind is invented, which is the
 * only moment anyone knows the answer.
 *
 * That is the opposite of how `scripts/source-of-truth/render-table.mjs`
 * classified a fixture before this record existed: it tested membership of a
 * small list and called everything else a fitting, so an unknown kind was
 * silently reported as plumbing. A default is the wrong shape for this
 * question, and that script now reads the role from here and has no default
 * left to fall through to.
 */
export const FIXTURE_ROLES = deepFreeze({
  // Plumbed in, part of the building.
  sink: 'fitting',
  bath: 'fitting',
  shower: 'fitting',
  wc: 'fitting',
  // Built in, and nothing runs to either of them. The pass counter is masonry's
  // understudy: the owner wanted a 1 m tunnel through a 0.30 wall with a normal
  // wall above it, which no wall in this model can be, so the missing 0.70 is
  // built out as a fixture — installed, not moved, and dry.
  counter: 'joinery',
  passCounter: 'joinery',
  // Delivered, connected, replaceable.
  tv: 'appliance',
  fridge: 'appliance',
  cooker: 'appliance',
  washingMachine: 'appliance',
  barbecue: 'appliance',
  // Loose: the owner may move any of these himself.
  artwork: 'furniture',
  bed: 'furniture',
  bookcase: 'furniture',
  nightstand: 'furniture',
  wardrobe: 'furniture',
  desk: 'furniture',
  sofa: 'furniture',
  coffeeTable: 'furniture',
  diningTable: 'furniture',
  sideboard: 'furniture',
  storageUnit: 'furniture',
  // The building's own equipment.
  serviceChamber: 'services',
} as const satisfies Readonly<Record<PlanFixtureKind, PlanFixtureRole>>);

/**
 * Plan reading order for the fixtures of one room: top to bottom, then left to
 * right — `minZ` first (z runs C→B, so north comes first), then `minX`.
 *
 * WHY a comparator lives in a data file, which is normally a presentation
 * choice made by whoever is presenting: a fixture's X-number is part of its
 * matricule. `F1-R13-BTH-X1` names a particular basin, and which fitting that
 * is depends entirely on the order the room's fixtures are read in — so the
 * order is part of the plan's own identity scheme, exactly like the room
 * numbering and the wall numbering, and it belongs beside them rather than in
 * whichever renderer happened to need it first.
 *
 * It is not an arbitrary pick between z-first and x-first. Sorting the main
 * sanitair this way yields sink, shower, bath and the guest sanitair sink,
 * bath — the owner's own recorded notation for those rooms, `[open sink
 * [shower][bath]]` and `[open sink [bath]]` (ADR-006). Sorting by `minX` first
 * yields bath, sink, shower, which matches nothing he ever said.
 *
 * This ordering used to exist twice, as `byPosition` in
 * `scripts/source-of-truth/render-table.mjs` and inline in `fixturesByRoom` in
 * `scripts/source-of-truth/render-plan.mjs`. Two copies of a rule that decides
 * a matricule is the same defect as two copies of the geometry: the two pages
 * would disagree about which fitting is which while both looked correct. Both
 * now take this function as an argument, so the drawing and the register are
 * sorted by the same comparator or by none.
 *
 * @param a - A fixture of the room.
 * @param b - Another fixture of the same room.
 * @returns Negative when `a` is read first, positive when `b` is, 0 when the
 *   two share a north-west corner — which cannot happen for fixtures that do
 *   not overlap, and is why no third key is needed.
 */
export function compareFixturePosition(a: PlanFixture, b: PlanFixture): number {
  return a.rect[2] - b.rect[2] || a.rect[0] - b.rect[0];
}

/**
 * Fixtures: the things standing in a room, drawn so a room can be judged by what
 * has to fit in it rather than by its area alone. Matricule tag `X`, since `W`,
 * `P` and `G` are taken by walls, ports and glazing.
 *
 * No partition fixture is declared, and {@link PlanFixtureKind} says why: a
 * screen standing inside one room would have to be a fixture rather than a wall,
 * so that it stays out of the wall derivation — but this layout asks for no
 * screen, every division the owner wanted being a real wall between two rooms.
 *
 * The television is here for the same reason the corridor was widened: it hangs
 * on the stair-hall wall facing the living room across the corridor, and that run
 * had to reach x 11.90 so the viewing area is not cut in two.
 */
export const FIXTURES = deepFreeze([
  // A basin stands in the open part of each bathroom; the bath and the shower
  // stand inside their own cubicle rooms. They belong here even though the
  // cubicles are rooms: they are still objects occupying floor, and without them
  // the model holds no sanitary ware at all — the drawing could not show a bath,
  // and the door-swing check would pass every cubicle vacuously because there
  // would be nothing inside it to hit.
  //
  // Every mount below was measured against the rect of the room named on the
  // row, face by face, and the gap that earns the value is written beside it.
  // R13 main sanitair x 17.70–20.35 · z 5.80–7.30: the basin backs east, 0.05
  // clear of the room's east face (its other gaps are 1.90 west, 0.20 north,
  // 0.85 south, all far wider).
  { kind: 'sink', room: 'mainSanitair', rect: [19.6, 20.3, 6.0, 6.45], mount: 'standing' },
  // R21 family bath x 17.70–19.35 · z 7.45–8.60: 0.05 west and 0.05 south, the
  // tub laid along the cubicle's long wall (0.10 east, 0.40 north).
  // A cubicle is stepped into, not stood in front of: the room is the bath's
  // clearance, so the 0.40 left between the tub and the door wall is the whole
  // of it and is declared rather than failed.
  {
    kind: 'bath',
    room: 'mainBathCubicle',
    rect: [17.75, 19.25, 7.85, 8.55],
    mount: 'standing',
    approach: 0.4,
    note: 'entered through its own sliding door; the cubicle is the clearance',
  },
  // R22 family shower x 19.50–20.35 · z 7.45–8.60: 0.05 on three faces — west,
  // east and south — the tray filling the width of its cubicle (0.35 north).
  {
    kind: 'shower',
    room: 'mainShowerCubicle',
    rect: [19.55, 20.3, 7.8, 8.55],
    mount: 'standing',
    approach: 0.35,
    note: 'entered through its own sliding door; the cubicle is the clearance',
  },
  // The guest suite: a short bath and the basin in the open. No shower — brief
  // §7.3's own table asked for `Sink (open) + Bath — NO shower` and the shower was
  // added later against it; §7.3 stayed OPEN on whether the suite worked, the 3D
  // walk-through said it did not, and the owner spent the shower on 2026-09-19.
  //
  // What that bought is not just elbow room in the bathroom. The whole suite slid
  // east onto the floor the shower held — sanitair and bath both x 8.05–9.85 now,
  // where they were 7.05–9.85 and 7.05–8.70 — and the guest room's lower leg grew
  // west-to-east into the metre they left, 2.80 to 3.80. The bath cubicle came out
  // ahead as well: it absorbed the 0.15 partition that used to separate it from the
  // shower, so it is 1.80 wide against the 1.65 it had.
  //
  // R10 guest sanitair x 8.05–9.85 · z 7.20–7.75: still only 0.55 deep, so the basin
  // is still 0.45 and still 0.05 off both faces — dropping the shower gave this room
  // width, not depth, and depth is what it was short of.
  //
  // The basin CHANGED ENDS, and the reason is the same one that put it in a dead-end
  // in the first place: it has to stand where no leaf does. Both leaves are now at the
  // WEST end and face each other across the 0.55 m room — the door in from the guest
  // room at x 8.10–8.80 in the north face, the bath door at x 8.20–8.80 in the south
  // (owner, 2026-09-19). That leaves x 8.80–9.85, a clear 1.05 m, and the basin takes
  // the last 0.35 of it rather than the first: parked at 8.80 it would stand in the
  // 0.60 m of floor the bath leaf is approached across, and check 9 finds that approach
  // on this room's west side. At 9.50 it is out of both leaves' way and out of the
  // approach band between them.
  //
  // (An earlier version of this note put the bath door at x 8.90–9.50 and called
  // x 9.50–9.85 the only free run. That was the span the leaf had for the few hours
  // before the owner moved it, and the paragraph is here precisely to stop the next
  // person moving the basin back — so it is worth more than the average comment that
  // it states the span the schedule actually declares.)
  //
  // It stays a 0.35 × 0.45 corner unit, reached along the room's length rather than
  // across it, because the room is still 0.55 deep and a 0.70 basin would still seal it.
  {
    kind: 'sink',
    room: 'guestSanitair',
    rect: [9.5, 9.85, 7.25, 7.7],
    mount: 'standing',
    note: 'corner basin in the east dead-end; reached along the room, not across it',
  },
  // R19 guest bath x 8.05–9.85 · z 7.90–8.60: the same 1.55 × 0.55 tub, and it no
  // longer fills its cubicle to the plaster. It sits 0.05 off the west face with
  // 0.20 of floor left east of it, and 0.15 between the rim and the doorway wall.
  // That 0.15 is what the old note called out as 0.05 — 'no floor in front of it at
  // all, you step in over the rim from the doorway'. There is floor in front of it
  // now. It is still less than the 0.60 a fitting is normally given, because a
  // cubicle is stepped into rather than stood in front of, so the approach is still
  // declared; it is declared at three times what it was.
  {
    kind: 'bath',
    room: 'guestBathCubicle',
    rect: [8.1, 9.65, 8.05, 8.6],
    mount: 'standing',
    approach: 0.15,
    note: 'entered through its own sliding door; the cubicle is the clearance',
  },

  // ─────────────────────────────── Part 4: the rooms are furnished ─────────
  //
  // Brief §7 room by room, plus the owner's standard bedroom and living-room set.
  // Every rect below is anchored to a named free wall run — what is left of a face
  // once its doors, its windows and their jambs are taken out — and the anchor is
  // written beside it. Nothing here is a guessed coordinate.
  //
  // A note on what is NOT here: the corridor keeps the television and nothing else.
  // It is the route an appliance takes (brief §7.5 sized it at 1.50 m for exactly
  // that), and check 9 would not catch a corridor narrowed by furniture, because
  // blocking a corridor blocks no door swing. The emptiness is deliberate.

  // R02 master bedroom x 1.60–6.60 · z 0.30–3.70. Two leaves swing in: the balcony
  // door over x 1.60–2.50 · z 1.55–2.45, and the corridor door over x 5.65–6.55 ·
  // z 2.80–3.70. The north face is the only unbroken 5.00 m run, so the bed takes
  // it, east of the balcony swing; the wardrobe takes the south run west of the
  // corridor swing; the desk takes the east face, north of it.
  { kind: 'bed', room: 'masterBedroom', rect: [2.7, 4.3, 0.35, 2.35], mount: 'standing' },
  { kind: 'nightstand', room: 'masterBedroom', rect: [2.25, 2.7, 0.35, 0.75], mount: 'standing' },
  { kind: 'nightstand', room: 'masterBedroom', rect: [4.3, 4.75, 0.35, 0.75], mount: 'standing' },
  { kind: 'wardrobe', room: 'masterBedroom', rect: [1.65, 3.65, 3.1, 3.65], mount: 'standing' },
  { kind: 'desk', room: 'masterBedroom', rect: [5.95, 6.55, 0.35, 1.55], mount: 'standing' },

  // R03 living room x 6.90–11.90 · z 0.30–3.85, arranged as the owner asked for it on
  // 2026-09-19: a library along the back, and the seating in THREE — back, left and
  // right — with the front deliberately left open.
  //
  // "Front" is the south face, where the 3.50 m leafless opening at x 7.50–11.00 looks
  // across the corridor at the television. That is the room's whole point, so the 0.60 m
  // band inward of the opening stays clear and every seat faces it. A fourth sofa there
  // would have its back to the one thing the room is pointed at.
  //
  // The sideboard and the dining table that stood here are gone. They were the standard
  // set, chosen before the owner said what he wanted in this room; the library and the
  // third seat need their wall runs, and a room this size cannot hold both.
  { kind: 'bookcase', room: 'livingRoom', rect: [9.85, 11.85, 0.35, 0.75], mount: 'standing' },
  { kind: 'sofa', room: 'livingRoom', rect: [7.0, 9.2, 0.35, 1.25], mount: 'standing' },
  { kind: 'sofa', room: 'livingRoom', rect: [6.95, 7.85, 1.35, 3.15], mount: 'standing' },
  { kind: 'sofa', room: 'livingRoom', rect: [10.95, 11.85, 1.35, 3.15], mount: 'standing' },
  {
    kind: 'coffeeTable',
    room: 'livingRoom',
    rect: [8.6, 9.7, 1.8, 2.4],
    mount: 'freestanding',
  },
  // Flush on the back wall, above the library: a large abstract canvas, which is what
  // carries the one warm colour in an otherwise neutral room.
  { kind: 'artwork', room: 'livingRoom', rect: [7.0, 9.2, 0.3, 0.35], mount: 'mounted' },

  // R04 and R05, the kids' bedrooms, 5.00 × 3.55 each and identical but for their
  // x origin. Two single beds on the north run, the wardrobe on the far side face,
  // the desk on the south run clear of the corridor leaf's swing.
  { kind: 'bed', room: 'bedroomMaleKids', rect: [12.6, 13.5, 0.35, 2.35], mount: 'standing' },
  { kind: 'bed', room: 'bedroomMaleKids', rect: [13.7, 14.6, 0.35, 2.35], mount: 'standing' },
  { kind: 'wardrobe', room: 'bedroomMaleKids', rect: [16.4, 17.0, 0.35, 1.35], mount: 'standing' },
  { kind: 'desk', room: 'bedroomMaleKids', rect: [15.2, 16.6, 3.2, 3.8], mount: 'standing' },
  { kind: 'bed', room: 'bedroomFemaleKids', rect: [17.75, 18.65, 0.35, 2.35], mount: 'standing' },
  { kind: 'bed', room: 'bedroomFemaleKids', rect: [18.85, 19.75, 0.35, 2.35], mount: 'standing' },
  {
    kind: 'wardrobe',
    room: 'bedroomFemaleKids',
    rect: [21.55, 22.15, 0.35, 1.35],
    mount: 'standing',
  },
  { kind: 'desk', room: 'bedroomFemaleKids', rect: [20.35, 21.75, 3.2, 3.8], mount: 'standing' },

  // R08 control center x 1.60–3.80 · z 7.20–9.70. TWO sealed chambers where
  // there used to be one cabinet, which is what that cabinet was declared as one
  // box for: brief §7.4's mandatory split is paid off here (ADR-022).
  //
  // The room now holds the CENTRAL WATER HEATER as well (owner, 2026-09-19), so
  // the full combination — heater, gas, electricity, water — stands in one
  // 5.50 m² room. The owner's instruction was "serious separation": each chamber
  // is a CLOSED box, not a volume, and each breathes to a DIFFERENT outside face,
  // so neither duct crosses the other compartment. The wet one vents west into
  // balcony A through the 0.30 wall at x 1.60–1.30; the electrical one vents east
  // into the control-center balcony through the 0.30 wall at x 3.80–4.10.
  //
  // 0.10 m of air between them. They keep the 0.60 depth and the 1.40 combined
  // width of the cabinet they replace, so nothing that passed check 9 stops
  // passing it: the south face is still the only run clear of both door leaves,
  // and the 1.20 m north leaf is still what a heater is carried in through.
  {
    kind: 'serviceChamber',
    room: 'controlCenter',
    rect: [1.65, 2.3, 9.05, 9.65],
    mount: 'standing',
    note: 'wet and gas: the water heater, the gas cock, the cold and hot manifolds',
  },
  {
    kind: 'serviceChamber',
    room: 'controlCenter',
    rect: [2.4, 3.05, 9.05, 9.65],
    mount: 'standing',
    note: 'electrical: the consumer unit, the meters and the low-voltage patch',
  },

  // R09 guest room, lower leg x 4.10–7.90 · z 7.05–8.60 — a SITTING room now, not a
  // guest bedroom. The owner walked it in 3D on 2026-09-19 and asked for the sofa and
  // the table guests actually sit at; the bed and the wardrobe are what paid for them.
  //
  // The wardrobe went first and by name: a 0.60 × 0.90 × 2.20 oak box against the east
  // wall, and at 2.20 m the tallest thing in a 1.55 m deep room — "the yellow thing".
  // The bed went because arithmetic said so. The leg is 1.55 deep; a bed is 0.90 and a
  // sofa is 0.80, and 0.90 + 0.80 = 1.70 does not fit across it however the two are
  // turned. Widening the leg to 3.80 bought length, not depth, so the choice was a bed
  // or a sofa and the owner chose the sofa. The room keeps its own bathroom suite.
  // (0.80 and 0.90 are the built depths, not round numbers: `verify:plan` prints the
  // sofa as 2.20 × 0.80, and the bed that stood here was 2.00 × 0.90.)
  //
  // NEITHER of these needs an approach override, which is worth saying out loud in a
  // room that has needed one everywhere else. Check 9 asks for 0.60 clear at ONE face:
  // the sofa is reached from its east face, where 1.50 m of open floor runs to x 7.90,
  // and the table from its west face, 0.65 m to x 4.10. The 0.10 m between the sofa and
  // the table is not a clearance failure — it is what a table in front of a sofa is.
  //
  // The table's north edge is at z 7.25 and not a centimetre further north, which is
  // the one number here that was not chosen for comfort. The stairwell leaf at
  // x 4.65–5.55 swings 0.90 into this room, to z 7.20 — 0.15 past the seam, because
  // the strip above it is only 0.75 deep and a 0.90 leaf does not fit in it. Drawn at
  // z 7.15 the table took 0.04 m² of that swing and check 9 caught it. 7.25 leaves the
  // leaf its floor with 0.05 to spare.
  { kind: 'sofa', room: 'guestRoom', rect: [4.2, 6.4, 7.75, 8.55], mount: 'standing' },
  {
    kind: 'coffeeTable',
    room: 'guestRoom',
    rect: [4.75, 5.85, 7.25, 7.65],
    mount: 'freestanding',
  },
  // The north strip (z 6.30–7.05) stays empty AS A ROUTE — it is the only way to the
  // control center, the side-A balcony and the guest bathroom, and ADR-011 accepted the
  // guest room's §6 access rule on the strength of it being circulation. The pass
  // counter below stands past the end of that route, not on it: everything the strip
  // has to reach is west of x 8.80, and the counter starts at x 9.00 in the dead end
  // the strip has always terminated in. The strip is 8.10 m long and the counter takes
  // the last 0.70 of it.
  //
  // It is the tunnel the owner asked for: "not just a window, a tunnel, hosting two
  // windows — one on the kitchen side, one on the guest side — and just the bottom,
  // the top keep it a normal wall." That last clause is why this is a fixture and not
  // masonry. A wall in this model is the gap between two room rects and its thickness
  // is ONE number for its whole height, so moving the guest room's east face west to
  // x 9.00 would have built a 1.00 m wall to the ceiling, and PARAPET_WALLS only lowers
  // a whole wall face, which would have left an open slot over the pass instead of the
  // plain wall the owner asked for. Built out as a unit, the masonry stays 0.30 and the
  // tunnel stops at 1.90: above that there is nothing but the normal wall.
  {
    kind: 'passCounter',
    room: 'guestRoom',
    rect: [9.0, 9.7, 6.3, 7.05],
    along: 'x',
    mount: 'standing',
    note: 'built out from the pass so the opening is a 1.00 m tunnel with a ledge at 1.00; flush to the wall on three faces by necessity, not by drift',
  },

  // R11 kitchen, an L of x 10.00–12.20 · z 6.30–8.60 and x 12.20–14.10 · z 5.80–8.60.
  // A fixture may not straddle the seam between two rects of one room (check 9 tests
  // containment in ONE rect), so the counters break at x 12.20 by construction.
  // The west run sits under the 0.65 m food pass, whose sill is 1.00 m and whose
  // whole purpose is handing food through to the guest room — a 0.90 m counter top
  // passes under it, and the cooker is kept south of it, because a hob does not
  // belong beneath a serving hatch.
  // THE KITCHEN HAD NO SINK. Found while routing Part 5's water and waste: the
  // kitchen held two counters, a cooker and a fridge and nothing to connect
  // either service to. The floor-finish pin found the same hole from the other
  // side — the kitchen reads as a serviced room only because of the cooker and
  // the fridge, never because of a basin. Brief §7.2 assumes one, and a kitchen
  // without one is not a kitchen. The west counter run gave up its south 0.65 m
  // for it, which is a 600 mm sink unit with its worktop margins.
  { kind: 'counter', room: 'kitchen', rect: [10.05, 10.65, 6.35, 7.2], mount: 'standing' },
  {
    kind: 'sink',
    room: 'kitchen',
    rect: [10.05, 10.65, 7.2, 7.85],
    mount: 'standing',
    note: 'found missing in Part 5; the west counter run was shortened for it',
  },
  { kind: 'cooker', room: 'kitchen', rect: [10.05, 10.65, 7.9, 8.5], mount: 'standing' },
  { kind: 'counter', room: 'kitchen', rect: [11.3, 12.15, 7.95, 8.55], mount: 'standing' },
  // The fridge is the tightest thing on the floor. Its rect is set by the two 0.90 m
  // leaves that swing into this leg — the corridor door over z 5.80–6.70 and the
  // balcony door over z 7.70–8.60 — which leave exactly 1.00 m of east wall between
  // them for a 0.90 m appliance.
  { kind: 'fridge', room: 'kitchen', rect: [13.35, 14.05, 6.75, 7.65], mount: 'standing' },

  // R12 laundry x 14.25–17.55 · z 5.80–8.60 — every item of brief §7.1. Its south
  // face carries the balcony door AND a 1.90 m window whose sill is 0.60 m, so that
  // whole face has no free run at all and nothing stands on it: the machine, the
  // hand-wash sink his mother prefers to it and the cleaning store take the north
  // run, and the two armoires take the east one. Dirty and clean stay separate
  // boxes with their own notes, which is the separation the brief asks for — the
  // west face could not hold either of them, since the balcony leaf swings across
  // it and the machine needs its own floor to stand at.
  //
  // The armoires are 0.60 m rather than the 0.90 m first drawn, and they stop at
  // z 8.15. Twice reduced, twice for a measured reason: the east face gives only
  // 1.75 m between the sanitair door's swing and the far wall, and at 0.80 m the
  // clean one reached z 8.55, which put a 2.20 m carcass 0.05 m in front of the
  // 1.90 m window whose sill is 0.60 — blocking 0.40 m of it over its whole height.
  // No check on this floor can see that: check 9 tests footprints, and a fixture's
  // height against a window's sill is a fact only `fixtures.ts` knows. It was found
  // by reading, which is why it is written down here.
  { kind: 'washingMachine', room: 'laundry', rect: [14.3, 14.9, 5.85, 6.45], mount: 'standing' },
  { kind: 'sink', room: 'laundry', rect: [14.95, 15.55, 5.85, 6.3], mount: 'standing' },
  {
    kind: 'storageUnit',
    room: 'laundry',
    rect: [15.6, 16.2, 5.85, 6.45],
    mount: 'standing',
    note: 'cleaning and housekeeping store',
  },
  {
    kind: 'wardrobe',
    room: 'laundry',
    rect: [16.9, 17.5, 6.9, 7.5],
    mount: 'standing',
    note: 'dirty clothes',
  },
  {
    kind: 'wardrobe',
    room: 'laundry',
    rect: [16.9, 17.5, 7.55, 8.15],
    mount: 'standing',
    note: 'clean clothes',
  },

  // R13 main sanitair x 17.70–20.35 · z 5.80–7.30. The floor's ONLY WC (owner,
  // 2026-09-19): the guest suite's open part is 0.55 m deep and cannot take a pan at
  // all, which is recorded on that room's own open list rather than left for someone
  // to rediscover. It stands on the SOUTH strip, in the 0.80 m of it left between
  // the two cubicle doorways — the north-west corner is where the laundry door both
  // swings and lands, and the north-east corner is the basin's.
  { kind: 'wc', room: 'mainSanitair', rect: [18.85, 19.55, 6.85, 7.25], mount: 'standing' },

  // R14 utility room x 20.50–22.20 · z 4.15–9.70, a 1.70 m wide slot 5.55 m long.
  // Two deep runs of shelving on the east face, south of the corridor leaf's swing.
  { kind: 'storageUnit', room: 'utilityRoom', rect: [21.55, 22.15, 5.2, 7.4], mount: 'standing' },
  { kind: 'storageUnit', room: 'utilityRoom', rect: [21.55, 22.15, 7.45, 9.65], mount: 'standing' },

  // R16 side-B balcony slab x 11.65–15.35 · z 8.90–9.70, run as an extension of the
  // kitchen (brief §7.2). The strip is 0.80 m deep and both doors open onto it, so a
  // 0.60 m grill would leave 0.15 m to stand in: this one is 0.40 m deep, built in
  // against the parapet and worked from the side, with what is actually left in front
  // of it declared rather than assumed.
  {
    kind: 'barbecue',
    room: 'balconySlabB',
    rect: [11.7, 12.4, 9.25, 9.65],
    mount: 'standing',
    approach: 0.35,
    note: 'built in against the parapet; worked from the side, not stood in front of',
  },

  // The television wall, facing the living room opening across the corridor.
  // Flush against the corridor's south face at z 6.00, not the 5.90 of the
  // corridor before the stair bay deepened. `tvPanel.ts` derives the panel from
  // that face and ignores this z on purpose, so a stale value here does not move
  // the model — it moves the DRAWING, which reads the fixture, and would have
  // shown the television hanging 0.10 clear of the wall it is mounted on.
  // Gap 0 on the south face: the corridor's second rect is x 5.60–11.90 ·
  // z 5.50–6.00 and the panel's maxZ is that face exactly, which is what
  // `mounted` asserts — it is screwed to the wall, it does not stand on the
  // floor, so it leaves none of the 0.05 a standing fitting leaves.
  { kind: 'tv', room: 'corridor', rect: [7.5, 11.0, 5.92, 6.0], mount: 'mounted' },
] as const satisfies readonly PlanFixture[]);

/** One wall face the owner named off the register as built for isolation. */
export interface InsulatedWall {
  /** Matricule of the named face, as `walls.mjs` derives it. */
  readonly matricule: string;
  /** The length the owner quoted for it, in metres: the tripwire on the numbering. */
  readonly length: number;
}

/**
 * The walls built for real sound and heat isolation, named by the owner off the
 * wall register. Every other wall is a separator: it divides two spaces and
 * nothing more, and does not have to be built heavy.
 *
 * Isolation is a property of the physical wall, not of one room's face, so a
 * named face also insulates whatever backs onto it. That is why the length the
 * owner quoted is kept beside each matricule: three of these — the kitchen,
 * laundry and main sanitair north walls, 1.90 + 3.30 + 2.65 — back onto one
 * 8.40 m corridor wall, so the corridor's face is insulated over 7.80 of its
 * length and plain for the rest. Anything that reads this must union the spans
 * rather than flag whole walls, or it will insulate 0.60 m of corridor that the
 * owner did not ask for.
 *
 * The quoted lengths are also a tripwire: they are checked against the derived
 * walls, so if the numbering ever shifts under the owner's list, the check fails
 * instead of silently insulating a different wall.
 *
 * Isolation IS the wall's thickness: a named wall is built `WALLS.insulated`
 * (0.30) and every other separator `WALLS.partition` (0.15) — the owner's
 * "widther 30cm, widthless 15cm". An earlier version of this block said the
 * opposite, that isolation was a matter of how a wall is made and not of its
 * width; that was reversed, and the rooms were re-laid out so every dimension
 * chain still closes on 22.50 and 10.00 with the wider walls in place.
 */
export const INSULATED_WALLS = deepFreeze([
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
  // The living room and both kids' bedrooms keep a plain wall to the corridor
  // (owner), so only the master bedroom's 1.00 m stretch of that wall is hard.
  // All three are 3.55 deep rather than 3.40, which is what lets the corridor's
  // north face still run straight at z 4.00: the 0.15 each thin wall frees goes
  // into the room instead of stepping the corridor, rather than the wall being
  // thickened end to end to avoid that step. The female bedroom's wall to the
  // utility room stays hard, carried by F1-R14-UTL-W1 below.
  //
  // The rest, named one by one off the register (owner), with his own lengths.
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
  // The guest room, wrapped on every side that is its own boundary (owner). That is
  // FOUR of its eight faces, and the four are listed rather than described because
  // the other four are each left off for their own reason:
  //
  //   W1  8.10  north, to the stairwell and the corridor   insulated, here
  //   W2  0.75  east,  to the kitchen                      insulated, here
  //   W5  3.80  south, to the cc balcony and the void      insulated, here
  //   W6  1.55  west,  to the control center               insulated, here
  //   W3  1.80  south, to the guest sanitair               NOT insulated
  //   W4  1.55  east,  to the guest sanitair and its bath  NOT insulated
  //   W7  2.50  south, to the control center               0.30 of it only
  //   W8        west,  to the side-A balcony               the balcony's own spine
  //
  // W3 and W4 are the two walls to its own bathroom, and they are off the list on
  // purpose: that suite is INSIDE the wrap, so isolating against it would be
  // isolating the suite from itself. It also could not afford the wall — the
  // bathroom has 1.40 m of depth once the walking strip has taken its share, and a
  // 0.30 wall inside one suite costs more floor than the quiet is worth.
  //
  // (An earlier version of this block said "all six faces … including its wall to
  // the bathroom, which the owner asked to be hard", directly above a sentence
  // saying the bathroom walls are deliberately absent, above a list of three. All
  // three claims cannot hold; the data says four faces and no bathroom wall, and
  // `pnpm verify:plan` check 10 is what settles it.)
  { matricule: 'F1-R09-GST-W2', length: 0.75 },
  { matricule: 'F1-R09-GST-W5', length: 3.8 },
  { matricule: 'F1-R09-GST-W6', length: 1.55 },
] as const satisfies readonly InsulatedWall[]);

/** The four side labels of the drawing, A to D. */
export interface PlanSides {
  /** Side A: the entry side, x 0. */
  readonly A: string;
  /** Side B: z 10.00. */
  readonly B: string;
  /** Side C: z 0. */
  readonly C: string;
  /** Side D: x 22.50. */
  readonly D: string;
}

/** A wall built lower than a storey, with the height it actually stands at. */
export interface ParapetWall {
  /** The wall, by matricule. */
  readonly matricule: string;
  /** How high it stands above the finished floor, in metres. */
  readonly height: number;
  /**
   * The wall's length as the owner reads it off the register, in metres.
   *
   * A tripwire, not data: nothing derives from it, and the check fails if it
   * stops matching the derived wall. A matricule can slide onto a different
   * wall when the numbering moves, and here that would silently build a
   * balustrade to full height — so the list is worth pinning to a second fact.
   */
  readonly length?: number;
  /** Why it is not full height. */
  readonly why: string;
}

/**
 * Walls that stop below the ceiling.
 *
 * Every other wall on the floor runs to `HEIGHTS.wall`. This list is the
 * exception, and it is short on purpose: a wall that stops low is a thing you
 * can see over and fall past, so it has to be stated rather than inferred.
 *
 * It used to be inferred. The model classified a wall as a parapet by testing
 * whether its top happened to equal the railing height, which worked only while
 * side B was open air — once side B became a normal exterior wall that heuristic
 * found nothing at all, and a real balustrade would have been built as a
 * full-height wall closing the balcony in.
 */
export const PARAPET_WALLS = deepFreeze([
  {
    matricule: 'F1-R01-BAL-W4',
    height: HEIGHTS.railing,
    length: 9.4,
    why: "The side-A balcony's outer edge (owner). It is a balustrade you look over, not a wall: the balcony is the floor's open side and its 9.40 m face is what makes it one. The owner first gave 1.00 and, shown that HEIGHTS.railing is 1.10 and that 1.10 is the usual minimum for a 9.40 m edge one storey up, chose 1.10 (ADR-011). It is written as the constant, not as a second literal 1.1: two numbers for one balustrade is what went wrong the first time.",
  },
] as const satisfies readonly ParapetWall[]);

/** The side labels of the drawing. Side B is no longer open air. */
export const SIDES = deepFreeze({
  A: 'SIDE A — entry, exterior wall 0.30',
  B: 'SIDE B — exterior wall 0.30, full height like the others (not open air)',
  C: 'SIDE C — blocked, exterior wall 0.30',
  D: 'SIDE D — blocked, exterior wall 0.30',
} as const satisfies PlanSides);

/* ────────────────────────────────────────────────────────────────────────────
 * Building services (Part 5)
 *
 * The floor already says what is BUILT. This section says what RUNS through it:
 * the water, the waste, the gas, the electricity, the low-voltage side and the
 * climate circuit, declared here so that `pnpm verify:plan` can check a pipe the
 * same way it checks a door.
 *
 * One constraint governs the whole section, and it was paid for once already:
 * **a wall is ONE thickness for its whole height** (ADR-021). "0.30 of masonry
 * with a 0.05 chase in it up to 1.20" cannot be declared in this plan, and
 * widening a room's gap builds the wider wall to the ceiling. That is why the
 * food-pass tunnel had to be built as a fixture, and it is why a run here is its
 * own declared solid STANDING ON the wall face rather than a modification of the
 * wall — which is also what the owner asked for ("anything selected is top of
 * the wall"). Do not reopen per-height wall thickness for services.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One build layer: a checkbox in the viewer, and a step in the build order. */
export interface PlanServiceLayer {
  /** Stable key; the store, the palette and the checkbox all use it. */
  readonly key: string;
  /** The label on the checkbox. */
  readonly name: string;
  /**
   * Whether this layer is a building service.
   *
   * `covers`, `furniture` and `finishing` are not: they are the boxing over the
   * runs, the equipment standing in the rooms, and the decorative scheme. They
   * are in this list because the owner asked for one checkbox per build level,
   * not because a sofa is a service.
   */
  readonly service: boolean;
  /** What the layer draws, and why it is where it is in the order. */
  readonly why: string;
}

/**
 * The layers, in the order a building is actually built.
 *
 * This array is both the build order and the order the checkboxes appear in, and
 * that is deliberate: the list reads as a construction sequence from the bottom
 * up. Nothing ticked is NAKED WALLS — structure, slabs and ceiling, no service
 * and no finish. Everything ticked reproduces v1.0.0 pixel for pixel.
 *
 * Additive, never exclusive (owner, 2026-09-19): layers are things you combine.
 * Water over naked walls, then water and gas together, then everything but the
 * finish, is how the floor is read.
 */
export const SERVICE_LAYERS = deepFreeze([
  {
    key: 'drainage',
    name: 'Drainage',
    service: true,
    why: 'Waste and soil. First, because it is the only run that cannot be routed for convenience: it falls, so everything else is laid around it. Its own layer rather than half of `water` for exactly that reason — supply and drainage are one service to a viewer and two to a plumber.',
  },
  {
    key: 'water',
    name: 'Water',
    service: true,
    why: 'Cold and hot supply to the fittings. Hot comes from the heater in the control center and reaches the whole floor; cold reaches the water side only. Drawn as two families in two hues, because which of the two a pipe is, is the first thing anyone asks of it.',
  },
  {
    key: 'gas',
    name: 'Gas',
    service: true,
    why: 'Two destinations only: the heater in the control center and the kitchen cooker. Its own layer because the isolation rule the whole control-center split exists for is meaningless unless gas is modelled as its own thing.',
  },
  {
    key: 'electricity',
    name: 'Electricity',
    service: true,
    why: 'Everywhere. Two circuit families — 2.5 mm² for power and plugs, 1.5 mm² for lighting — carried as data rather than as two colours, because they are the same service and a viewer telling gas from water needs the hue more than a viewer telling a socket from a lamp does.',
  },
  {
    key: 'lowVoltage',
    name: 'Low voltage',
    service: true,
    why: 'Ethernet and the rest of the low-voltage side, with an outlet in every room except the three bath and shower cubicles, so a mesh node or a router can be added anywhere a person would put one. Held clear of the electricity runs by a stated separation, because power interferes with the signal — a distance the verifier checks rather than a sentence in a comment.',
  },
  {
    key: 'climate',
    name: 'Climate',
    service: true,
    why: 'Heating and cooling. Cooling reaches the guest room, the corridor, the bedrooms and the living room and nowhere else (owner); heating is wall heaters on their own flow and return off the same heater the hot water comes from. A radiator is not a tap, which is why it is here and not in `water`.',
  },
  {
    key: 'covers',
    name: 'Covers',
    service: false,
    why: 'The boxing built over a run — the casing that makes a pipe disappear into a corner. Its own checkbox because the owner asked to see it: with covers on and the runs off you see what the finished room looks like; with both on you see what is inside the boxing.',
  },
  {
    key: 'furniture',
    name: 'Furniture',
    service: false,
    why: 'The equipment standing in the rooms. NOT the fittings that are part of the building — the food-pass counter is half a wall and the control-center chambers are the building’s own plant, and hiding either opens a hole in the floor rather than clearing a room.',
  },
  {
    key: 'finishing',
    name: 'Finishing',
    service: false,
    why: 'The decorative scheme of ADR-020 — carpet, marble, oak, bouclé and the artwork. Last, because it is the last thing that happens to a building. With it off, the same geometry is drawn in the building’s plain finish; no box is added or removed by this checkbox, only re-surfaced.',
  },
] as const satisfies readonly PlanServiceLayer[]);

/** A layer key, as the store, the palette and the checkbox all spell it. */
export type PlanServiceLayerKey = (typeof SERVICE_LAYERS)[number]['key'];

/**
 * The sizes every run is built from, in one place.
 *
 * No run writes its own diameter, exactly as no fitting writes its own
 * clearance (`FIXTURE_SPEC`): changing a pipe size here moves every pipe of that
 * family together. Bores are REAL — the owner asked for what a plumber would
 * actually specify, not a schematic thickness — and they are outside diameters,
 * because what a run costs the room is its outside.
 *
 * Two of these numbers are not geometry and would be invented if they were not
 * written down here with their reason:
 *
 * - `narrowingAllowance` — a pipe does not keep its bore. Scale closes it from
 *   the inside over years, and it closes FASTER on hot water, because that is
 *   where the scale comes out of solution. So a supply pipe is specified one
 *   allowance above the flow it must carry, and the hot allowance is the larger
 *   of the two. This is the owner's own instruction ("by the time pipes will get
 *   narrow so we should use like how plumber advise, and this problem become
 *   bigger in the hot water").
 * - `dataToPowerSeparation` — 0.20 m. Mains cable induces noise into an
 *   unshielded twisted pair laid beside it, and the usual guidance for a
 *   PARALLEL run is 200 mm of air (or 50 mm with an earthed barrier, which this
 *   floor does not have). A crossing at right angles is not a parallel run and
 *   is not what this distance is about. Also the owner's instruction, and it is
 *   a verifier check rather than a comment because a comment does not fail.
 */
export const SERVICE_SPEC = deepFreeze({
  /** Outside diameters, in metres, by run family. */
  bore: {
    /** WC soil. 110 mm is the smallest pipe a WC discharges into. */
    soil: 0.11,
    /** Basin, sink, bath and washing-machine waste. */
    waste: 0.04,
    /** Shower and floor gully — wider than a basin waste because it takes a flood, not a bowl. */
    gully: 0.05,
    /** The stack's own vent to open air, so a trap is not siphoned dry. */
    vent: 0.075,
    /**
     * A control-center chamber's ventilation duct to outside.
     *
     * Bigger than a stack vent because it is not venting a pipe, it is venting a
     * room-within-a-room that holds a burner: a sealed cupboard with a heater in
     * it has to breathe, and 125 mm is the smallest duct that is honestly doing
     * that rather than decorating the model.
     */
    chamberVent: 0.125,
    /** Cold supply riser. */
    coldRiser: 0.025,
    /** Cold branch to a fitting. */
    cold: 0.02,
    /** Hot supply riser from the heater. */
    hotRiser: 0.025,
    /** Hot branch to a fitting. */
    hot: 0.02,
    /** Gas, heater and cooker only. */
    gas: 0.02,
    /** Conduit carrying 2.5 mm² power and plug circuits. */
    power: 0.025,
    /** Conduit carrying 1.5 mm² lighting circuits. */
    lighting: 0.02,
    /** Conduit carrying ethernet and the rest of the low-voltage side. */
    data: 0.02,
    /** Cooling duct from the central unit. */
    cooling: 0.16,
    /** Heating flow and return to a wall heater. */
    heating: 0.02,
  },
  /**
   * Minimum fall, as a rise over a run, by drainage family.
   *
   * A drain is the one service that cannot be routed as a flat convenience
   * line. Too shallow and solids stand; too steep and the water outruns them,
   * which is the failure people do not expect.
   */
  fall: {
    /** 1:80 on 110 mm soil. */
    soil: 0.0125,
    /** 1:40 on 40 mm waste. */
    waste: 0.025,
    /** 1:40 on a gully. */
    gully: 0.025,
  },
  /** How much a supply pipe is oversized against closing up in service. */
  narrowingAllowance: {
    /** Cold scales slowly. */
    cold: 0.1,
    /** Hot scales faster, so it carries the larger allowance. */
    hot: 0.2,
  },
  /**
   * The centreline bend radius a corner really needs, as a multiple of the bore.
   *
   * Every polyline in `SERVICE_RUNS` turns a square 90°, and a square 90° is a
   * duct that does not exist: the fitting that actually makes that turn sweeps a
   * radius, and it needs straight pipe on both sides of it to land on. The square
   * corner is therefore a DRAWING CONVENTION, and this number is what the drawing
   * is lying about — stated here so the lie is bounded and checkable rather than
   * invisible.
   *
   * The check it licenses is not "draw an arc" but "is there room for one": both
   * legs meeting at a corner must be at least this long, or the real fitting does
   * not fit and the route has to change. Ducts are the binding case, which is why
   * they carry the larger multiple — a 160 mm duct turning a corner needs a good
   * deal more than a 20 mm pipe with a push-fit elbow on it.
   */
  minBendRadius: {
    /** A rigid duct elbow, centreline radius one diameter. */
    duct: 1,
    /** A bent or elbowed pipe; small bores turn tightly. */
    pipe: 1.5,
  },
  /** Minimum air between a data run and a power run laid parallel to it, in metres. */
  dataToPowerSeparation: 0.2,
  /** Minimum air between a gas run and an electrical run, in metres. */
  gasToPowerSeparation: 0.05,
  /** Minimum air between a water run and an electrical run, in metres. */
  waterToPowerSeparation: 0.05,
  /** A run stands this clear of the wall face it is fixed to, in metres. */
  wallStandoff: 0.02,
  /** The boxing over a run clears it by this much on each side, in metres. */
  coverClearance: 0.02,
  /** The thickness of the boxing itself, in metres. */
  coverThickness: 0.015,
  /**
   * Spare capacity declared rather than implied.
   *
   * The owner asked for an installation built for extension — smart-home kit
   * later, extra outlets later — and "there is room in the conduit" is not a
   * fact unless something states it. Every conduit is sized for this fraction
   * of its cross-section to be free after the declared circuits are in it, so
   * pulling one more cable is a later addition and not a re-route.
   */
  spareCapacityFraction: 0.4,
} as const);

/**
 * A point on a run, in metres: `[x, z, y]`.
 *
 * Three dimensions rather than two, because a run's HEIGHT is not decoration
 * here — it is the difference between a drain that empties and one that stands,
 * between a duct a person walks under and one they trip on, and between a data
 * cable clear of a power cable and one laid against it. A riser is simply two
 * points with the same `x` and `z` and a different `y`, so nothing needs a
 * separate vocabulary for "vertical".
 *
 * `y` is measured from the finished floor of the storey the run belongs to, so
 * a NEGATIVE `y` is inside the floor build-up — which is the 0.30 m between
 * `HEIGHTS.wall` (2.70) and `HEIGHTS.floorToFloor` (3.00), the ceiling void of
 * the storey below. That is where waste actually runs, and because every storey
 * is identical (ADR-014) a run declared once is in the same place on all of them.
 */
export type PlanServicePoint = readonly [x: number, z: number, y: number];

/** What a run belongs to inside its layer — what tells one pipe from another. */
export type PlanServiceFamily =
  | 'soil'
  | 'waste'
  | 'gully'
  | 'vent'
  | 'chamberVent'
  | 'cold'
  | 'hot'
  | 'gas'
  | 'power'
  | 'lighting'
  | 'data'
  | 'cooling'
  | 'heating';

/**
 * Where a run starts or stops.
 *
 * `cap` is the one that matters and the one that is easy to leave out: the
 * building is 1…10 identical storeys, so a riser is automatically in the same
 * place on every one of them — but the ENDS of the stack are not automatic.
 * Floor 0 is undesigned and the roof is not modelled, so a riser that simply
 * stopped would be a pipe ending in mid-air. It stops at a declared cap
 * carrying the reason instead, exactly the way both half-flights at the ends of
 * the stair stack are blocked but still drawn (owner, 2026-09-19).
 */
export type PlanServiceEnd =
  | { readonly at: 'space'; readonly space: PlanRoomId }
  | { readonly at: 'chamber'; readonly chamber: PlanServiceChamberId }
  | {
      readonly at: 'fitting';
      readonly space: PlanRoomId;
      readonly kind: PlanFixtureKind;
    }
  | { readonly at: 'cap'; readonly why: string };

/** One declared run of one service, end to end. */
export interface PlanServiceRun {
  /** The checkbox it appears under. */
  readonly layer: PlanServiceLayerKey;
  /** What it carries; picks its bore out of `SERVICE_SPEC` and its hue. */
  readonly family: PlanServiceFamily;
  /** Where it comes from. */
  readonly from: PlanServiceEnd;
  /** Where it goes. */
  readonly to: PlanServiceEnd;
  /**
   * The centreline, on the centimetre grid, from `from` to `to`.
   *
   * Written in the order the service flows, which is what makes a drain's fall
   * checkable at all: `points[0]` is upstream and the last point is downstream.
   */
  readonly points: readonly PlanServicePoint[];
  /** Why it goes this way, where the route is a choice rather than the only line. */
  readonly why?: string;
}

/** A sealed compartment of the control center. */
export interface PlanServiceChamber {
  /** Stable identifier; a run terminates by naming it. */
  readonly id: string;
  /** As it is printed on the drawing. */
  readonly name: string;
  /** The room it stands in. */
  readonly room: PlanRoomId;
  /** Its footprint — the same rect as its `serviceChamber` fixture. */
  readonly rect: PlanRectCoordinates;
  /** How high the closed box stands, in metres above the finished floor. */
  readonly top: number;
  /** Which layers are allowed to terminate in it. This is the isolation rule. */
  readonly holds: readonly PlanServiceLayerKey[];
  /** Why it is this compartment and not the other. */
  readonly why: string;
}

/**
 * The two compartments of the control center.
 *
 * Brief §7.4 has carried this split as a deferral since plan v2, and the `open`
 * note R08 used to carry said so. It is paid off here, and the reason it could
 * no longer be deferred is that the owner put the CENTRAL WATER HEATER in this
 * room: heater, gas, electricity and water in one 5.50 m² space is the full
 * combination, and "serious separation" was the instruction.
 *
 * `holds` is the whole point of the register. A gas run ending in the electrical
 * compartment is the single failure this part exists to prevent, and it is a
 * check rather than a convention because a convention does not fail a build.
 */
export const SERVICE_CHAMBERS = deepFreeze([
  {
    id: 'wetGasChamber',
    name: 'Wet and gas compartment',
    room: 'controlCenter',
    rect: [1.65, 2.3, 9.05, 9.65],
    top: 2.2,
    holds: ['drainage', 'water', 'gas', 'climate'],
    why: 'The water heater, the gas cock and the cold and hot manifolds. Climate is here because the wall heaters run off the same heater the hot water does, so their flow and return start where it does. It is the WEST chamber and it breathes WEST, into balcony A through the 0.30 wall — a burner in a sealed cupboard has to breathe, and venting it the other way would have carried a gas atmosphere over the electrical compartment.',
  },
  {
    id: 'electricalChamber',
    name: 'Electrical compartment',
    room: 'controlCenter',
    rect: [2.4, 3.05, 9.05, 9.65],
    top: 2.2,
    holds: ['electricity', 'lowVoltage'],
    why: 'The consumer unit, the meters and the low-voltage patch. It is the EAST chamber and it breathes EAST, into the control-center balcony: two ducts to two different outside faces, so neither crosses the other compartment. Low voltage shares this box rather than getting a third, because the thing it must be kept away from is a cable run laid beside it for metres, not a patch panel in the same cupboard.',
  },
] as const satisfies readonly PlanServiceChamber[]);

/** A chamber, by id. */
export type PlanServiceChamberId = (typeof SERVICE_CHAMBERS)[number]['id'];

/**
 * Drainage.
 *
 * Three stacks, not one, and that is the design decision worth stating: the wet
 * rooms of this floor fall into three groups that are metres apart, and one
 * stack would mean a branch crawling the length of the building losing height
 * the whole way. Each stack stands in a VOID — `voidWest` or `voidEast`, the
 * side-B strip `plan.ts` already says carries the risers — never in a room's
 * clear floor and never in `balconySlabB`, which is the one floored part of that
 * row and is walked on.
 *
 * Every branch here is a real fitting's real outlet, at the fitting's real
 * position, falling the whole way (owner: "build everything like reality, even
 * the bathroom-out"). They run at NEGATIVE y — inside the floor build-up, which
 * is where waste actually runs — and because the storeys are identical, a branch
 * declared once is under every floor of the stack.
 */
const DRAINAGE_RUNS = [
  /* ── the three stacks ── */
  {
    layer: 'drainage',
    family: 'soil',
    from: {
      at: 'cap',
      why: 'Floor 0 is undesigned, so the stack stops at the bottom of the lowest storey rather than ending in mid-air. Delete this cap when the ground floor exists and the drain has somewhere real to go.',
    },
    to: {
      at: 'cap',
      why: 'The roof is not modelled, so the stack stops above the top storey. Its vent terminates here; delete this cap when the roof plant exists.',
    },
    points: [
      [11.2, 9.3, -0.28],
      [11.2, 9.3, 2.72],
    ],
    why: 'West stack, in `voidWest`. Takes the guest suite and the kitchen. It stands in the open shaft, which is why a stack vent needs nothing extra here: the void IS open air.',
  },
  {
    layer: 'drainage',
    family: 'soil',
    from: {
      at: 'cap',
      why: 'Floor 0 is undesigned; the stack stops at the bottom of the lowest storey.',
    },
    to: { at: 'cap', why: 'The roof is not modelled; the stack stops above the top storey.' },
    points: [
      [16.2, 9.3, -0.28],
      [16.2, 9.3, 2.72],
    ],
    why: 'Laundry stack, in `voidEast`, directly behind the laundry — the room overlaps this void in x 15.35–17.55, so its waste drops where it is made instead of crawling 5.70 m east to the main stack.',
  },
  {
    layer: 'drainage',
    family: 'soil',
    from: {
      at: 'cap',
      why: 'Floor 0 is undesigned; the stack stops at the bottom of the lowest storey.',
    },
    to: { at: 'cap', why: 'The roof is not modelled; the stack stops above the top storey.' },
    points: [
      [19.9, 9.3, -0.28],
      [19.9, 9.3, 2.72],
    ],
    why: 'Main stack, in `voidEast`. Takes the whole main sanitair group — the only WC on the floor, its basin, the bath and the shower.',
  },

  /* ── main sanitair group → the main stack ── */
  {
    layer: 'drainage',
    family: 'soil',
    from: { at: 'fitting', space: 'mainSanitair', kind: 'wc' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [19.2, 7.25, -0.05],
      [19.2, 9.3, -0.08],
      [19.9, 9.3, -0.09],
    ],
    why: 'The only WC on the floor (owner, Part 4). 110 mm from the back of the pan, falling 1:69 — steeper than the 1:80 a soil pipe needs, and deliberately not much steeper: too shallow and solids stand, too steep and the water outruns them, which is the failure nobody expects.',
  },
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'mainSanitair', kind: 'sink' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [19.9, 6.45, -0.05],
      [19.9, 9.3, -0.14],
    ],
  },
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'mainBathCubicle', kind: 'bath' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [19.25, 8.2, -0.06],
      [19.25, 9.3, -0.09],
      [19.9, 9.3, -0.11],
    ],
    why: 'From the east end of the bath, which is the end its outlet is at and the end nearest the stack.',
  },
  {
    layer: 'drainage',
    family: 'gully',
    from: { at: 'fitting', space: 'mainShowerCubicle', kind: 'shower' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [19.9, 8.15, -0.06],
      [19.9, 9.3, -0.09],
    ],
    why: 'A gully, not a waste: 50 mm, because a shower tray takes a flood rather than a bowlful and a 40 mm trap backs up under one.',
  },

  /* ── laundry → the laundry stack ── */
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'laundry', kind: 'washingMachine' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [14.6, 6.45, -0.05],
      [16.2, 6.45, -0.09],
      [16.2, 9.3, -0.17],
    ],
    why: 'A washing machine discharges into a standpipe with its own trap, so this is a waste like any other and not a hose into a gully.',
  },
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'laundry', kind: 'sink' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [15.25, 6.3, -0.05],
      [16.2, 6.3, -0.08],
      [16.2, 9.3, -0.16],
    ],
    why: "Brief §7.1's hand-wash sink — the fitting that makes the laundry a wet room, which nobody had written down until Part 4 derived it.",
  },

  /* ── guest suite and kitchen → the west stack ── */
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'guestSanitair', kind: 'sink' },
    to: { at: 'space', space: 'voidWest' },
    points: [
      [9.65, 7.7, -0.05],
      [9.65, 9.3, -0.09],
      [11.2, 9.3, -0.14],
    ],
    why: 'The corner basin in the east dead-end — the one that had to be rotated in Part 4 because it stood across its own shower door.',
  },
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'guestBathCubicle', kind: 'bath' },
    to: { at: 'space', space: 'voidWest' },
    points: [
      [9.6, 8.3, -0.05],
      [9.6, 9.3, -0.08],
      [11.2, 9.3, -0.12],
    ],
  },
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'kitchen', kind: 'sink' },
    to: { at: 'space', space: 'voidWest' },
    points: [
      [10.35, 7.85, -0.05],
      [10.35, 9.3, -0.09],
      [11.2, 9.3, -0.12],
    ],
    why: 'The sink this part had to add — the kitchen had none.',
  },
] as const satisfies readonly PlanServiceRun[];

/**
 * The horizontal spine, and the lanes it is divided into.
 *
 * Everything crosses the balcony — the owner's own description of this floor,
 * and the side-B strip is where `plan.ts` already says the risers live. The
 * spine runs west to east through `ccBalcony` → `voidWest` → `balconySlabB` →
 * `voidEast`, out of the two control-center chambers.
 *
 * Three constraints decide the lanes, and none of them is aesthetic:
 *
 * 1. **Above the door head.** The control-center balcony door spans z 8.95–9.65
 *    at x 3.80 with a head at `HEIGHTS.door` (2.10). Every lane is at y ≥ 2.20,
 *    so the spine crosses that wall over the doorway rather than through it.
 * 2. **Above a person.** `balconySlabB` is the one floored part of the side-B
 *    row: it is walked on, it carries the barbecue and two doors open onto it.
 *    The lowest lane at 2.20 m clears a 1.80 m person by 0.40 m, so a pipe
 *    across it is a pipe overhead and not a trip hazard modelled as a feature.
 * 3. **No water over the electrical chamber.** The electrical chamber occupies
 *    z 9.05–9.65, so every water, gas and heating lane is pushed to z 8.95–9.00,
 *    NORTH of it. "Above" is the dangerous case and it is invisible in a plan
 *    view, which is exactly why it is a check and not a habit.
 *
 * Lanes, by (z, y): cold (8.95, 2.35) · hot (8.95, 2.20) · gas (9.00, 2.50) ·
 * heating flow (9.00, 2.35) · heating return (9.00, 2.20) · data (9.35, 2.50) ·
 * cooling (9.45, 2.55) · power (9.60, 2.35) · lighting (9.60, 2.20).
 *
 * Data sits 0.29 m from power and 0.39 m from lighting — both over the 0.20 m
 * `SERVICE_SPEC.dataToPowerSeparation`, which is the distance mains cable stops
 * inducing noise into an unshielded pair laid beside it for metres.
 */
const CHAMBER_VENT_RUNS = [
  {
    layer: 'gas',
    family: 'chamberVent',
    from: { at: 'chamber', chamber: 'wetGasChamber' },
    to: {
      at: 'cap',
      why: 'Discharges to open air over the control-center balcony. Everything leaves this floor through that balcony (owner, 2026-09-20); drainage is the only exception. It crosses ABOVE the balcony door head and runs at z 9.00, north of the electrical chamber, so it still never carries a gas atmosphere over the electrical compartment. A vent terminates; it does not serve what it discharges into.',
    },
    points: [
      [1.98, 9.35, 2.2],
      [1.98, 9.35, 2.35],
      [1.98, 9.0, 2.35],
      [4.1, 9.0, 2.35],
    ],
    why: 'The wet-and-gas chamber breathes WEST, into balcony A through the 0.30 wall. A sealed cupboard with a burner in it has to breathe, and venting it east would have carried a gas atmosphere over the electrical compartment — which is the one thing the split exists to prevent.',
  },
  {
    layer: 'electricity',
    family: 'chamberVent',
    from: { at: 'chamber', chamber: 'electricalChamber' },
    to: {
      at: 'cap',
      why: 'Discharges to open air over the control-center balcony. A vent terminates rather than serving what it discharges into.',
    },
    points: [
      [2.72, 9.35, 2.2],
      [2.72, 9.35, 2.35],
      [4.1, 9.35, 2.35],
    ],
    why: 'The electrical chamber breathes EAST, into the control-center balcony. Two ducts to two different outside faces, so neither crosses the other compartment. It vents because a consumer unit and a meter stack in a sealed box make heat, not because anything in it burns.',
  },
] as const satisfies readonly PlanServiceRun[];

const WATER_RUNS = [
  /* ── the two supply spines, out of the wet chamber ── */
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'chamber', chamber: 'wetGasChamber' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [1.98, 9.35, 1.2],
      [1.98, 9.35, 2.35],
      [1.98, 8.95, 2.35],
      [19.95, 8.95, 2.35],
    ],
    why: 'Cold rises off the manifold inside the chamber, steps north to the z 8.95 lane so it never crosses the electrical chamber, and runs the length of the floor. Sized one `narrowingAllowance` over the flow it carries, because a pipe does not keep its bore — scale closes it from the inside.',
  },
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'chamber', chamber: 'wetGasChamber' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [2.1, 9.35, 1.2],
      [2.1, 9.35, 2.2],
      [2.1, 8.95, 2.2],
      [19.95, 8.95, 2.2],
    ],
    why: 'Hot leaves the same chamber because the heater is in it (owner, 2026-09-19). It carries the LARGER narrowing allowance of the two: hot is where the scale comes out of solution, so it is the pipe that closes up first.',
  },

  /* ── cold branches: every fitting that takes water, at the fitting ── */
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'voidEast' },
    to: { at: 'fitting', space: 'mainSanitair', kind: 'sink' },
    points: [
      [19.75, 8.95, 2.35],
      [19.75, 6.5, 2.35],
      [19.75, 6.5, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'voidEast' },
    to: { at: 'fitting', space: 'mainSanitair', kind: 'wc' },
    points: [
      [19.2, 8.95, 2.35],
      [19.2, 7.3, 2.35],
      [19.2, 7.3, 0.75],
    ],
    why: 'Cold only. A cistern is filled with cold water and nothing else — the one fitting on this floor that gets one pipe rather than two.',
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'voidEast' },
    to: { at: 'fitting', space: 'mainBathCubicle', kind: 'bath' },
    points: [
      [19.25, 8.95, 2.35],
      [19.25, 8.6, 2.35],
      [19.25, 8.6, 0.7],
    ],
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'voidEast' },
    to: { at: 'fitting', space: 'mainShowerCubicle', kind: 'shower' },
    points: [
      [19.9, 8.95, 2.35],
      [19.9, 8.95, 2.45],
      [19.9, 8.5, 2.45],
      [19.9, 8.5, 1.3],
    ],
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'fitting', space: 'laundry', kind: 'sink' },
    points: [
      [15.25, 8.95, 2.35],
      [15.25, 5.85, 2.35],
      [15.25, 5.85, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'fitting', space: 'laundry', kind: 'washingMachine' },
    points: [
      [14.6, 8.95, 2.35],
      [14.6, 5.85, 2.35],
      [14.6, 5.85, 0.85],
    ],
    why: 'Cold only: a washing machine on this floor is cold fill, which is what every machine sold in the last twenty years is.',
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'voidWest' },
    to: { at: 'fitting', space: 'kitchen', kind: 'sink' },
    points: [
      [10.35, 8.95, 2.35],
      [10.35, 7.85, 2.35],
      [10.35, 7.85, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'voidWest' },
    to: { at: 'fitting', space: 'guestSanitair', kind: 'sink' },
    points: [
      [9.65, 8.95, 2.35],
      [9.65, 7.75, 2.35],
      [9.65, 7.75, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'cold',
    from: { at: 'space', space: 'voidWest' },
    to: { at: 'fitting', space: 'guestBathCubicle', kind: 'bath' },
    points: [
      [9.6, 8.95, 2.35],
      [9.6, 8.6, 2.35],
      [9.6, 8.6, 0.7],
    ],
  },

  /* ── hot branches: the same fittings, minus the cistern and the machine ── */
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'space', space: 'voidEast' },
    to: { at: 'fitting', space: 'mainSanitair', kind: 'sink' },
    points: [
      [19.85, 8.95, 2.2],
      [19.85, 8.95, 2.45],
      [19.85, 6.5, 2.45],
      [19.85, 6.5, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'space', space: 'voidEast' },
    to: { at: 'fitting', space: 'mainBathCubicle', kind: 'bath' },
    points: [
      [19.15, 8.95, 2.2],
      [19.15, 8.6, 2.2],
      [19.15, 8.6, 0.7],
    ],
  },
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'space', space: 'voidEast' },
    to: { at: 'fitting', space: 'mainShowerCubicle', kind: 'shower' },
    points: [
      [19.8, 8.95, 2.2],
      [19.8, 8.95, 2.45],
      [19.8, 8.5, 2.45],
      [19.8, 8.5, 1.3],
    ],
  },
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'fitting', space: 'laundry', kind: 'sink' },
    points: [
      [15.15, 8.95, 2.2],
      [15.15, 5.85, 2.2],
      [15.15, 5.85, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'space', space: 'voidWest' },
    to: { at: 'fitting', space: 'kitchen', kind: 'sink' },
    points: [
      [10.25, 8.95, 2.2],
      [10.25, 7.85, 2.2],
      [10.25, 7.85, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'space', space: 'voidWest' },
    to: { at: 'fitting', space: 'guestSanitair', kind: 'sink' },
    points: [
      [9.55, 8.95, 2.2],
      [9.55, 7.75, 2.2],
      [9.55, 7.75, 0.95],
    ],
  },
  {
    layer: 'water',
    family: 'hot',
    from: { at: 'space', space: 'voidWest' },
    to: { at: 'fitting', space: 'guestBathCubicle', kind: 'bath' },
    points: [
      [9.5, 8.95, 2.2],
      [9.5, 8.6, 2.2],
      [9.5, 8.6, 0.7],
    ],
  },
] as const satisfies readonly PlanServiceRun[];

/**
 * Gas: two destinations and no more.
 *
 * The heater, which is inside the wet chamber and therefore needs no run at all,
 * and the kitchen cooker. That is the whole of it (owner, 2026-09-19) — which is
 * also why the isolation rule matters so much for so little pipe: the danger is
 * not the length of the run, it is which compartment it ends in.
 */
/**
 * The water heater's relief and condensate discharge.
 *
 * Found by the room panel's roll-call: the control center held a heater, gas,
 * water, electricity and low voltage and had **no drainage at all**. A stored
 * hot-water heater has a temperature-and-pressure relief that must be able to
 * let go, and there is no stack within ten metres of this room.
 *
 * It discharges over balcony A, and that is the correct answer rather than a
 * convenient one: a relief discharge is required to be VISIBLE, so that a heater
 * quietly relieving itself is something somebody notices instead of something
 * that drains away unseen.
 */
const HEATER_DRAIN_RUNS = [
  {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'chamber', chamber: 'wetGasChamber' },
    to: {
      at: 'cap',
      why: 'Discharges in open air over balcony A, where it can be seen. A relief that drains away unseen is a fault nobody finds.',
    },
    points: [
      [1.75, 9.5, 0.35],
      [1.3, 9.5, 0.32],
    ],
  },
] as const satisfies readonly PlanServiceRun[];

const GAS_RUNS = [
  {
    layer: 'gas',
    family: 'gas',
    from: { at: 'chamber', chamber: 'wetGasChamber' },
    to: { at: 'fitting', space: 'kitchen', kind: 'cooker' },
    points: [
      [2.22, 9.35, 1.2],
      [2.22, 9.35, 2.5],
      [2.22, 9.0, 2.5],
      [10.35, 9.0, 2.5],
      [10.35, 8.3, 2.5],
      [10.35, 8.3, 0.9],
    ],
    why: 'Out of the wet chamber on the highest lane of the spine, north of the electrical chamber the whole way, then down to the cooker. It ends at a fitting the owner can see, which is the point: a gas run that ended vaguely "in the kitchen" would pass every check and mean nothing.',
  },
] as const satisfies readonly PlanServiceRun[];

/**
 * Electricity, low voltage and climate.
 *
 * These reach ROOMS rather than individual accessories, and that is a chosen
 * level of detail rather than a shortcut. The owner asked for an installation
 * built for extension — "installation for extensibility and flexibility in
 * future" — so what the model owes him is the capacity ARRIVING in every room,
 * with `SERVICE_SPEC.spareCapacityFraction` of each conduit left free, not a
 * cable drawn to a socket nobody has chosen yet. Where he named a specific
 * thing, the run ends at that thing instead: every water and waste branch above
 * stops at a real basin, bath, shower, cistern, machine or cooker.
 *
 * TWO distribution spines, not one. The side-B strip carries everything out of
 * the control center, and a corridor spine picks it up through the kitchen and
 * serves the four north rooms and the stair. That second spine is why a cable to
 * the female kids' bedroom is five metres of corridor ceiling instead of twenty
 * metres around the outside of the building.
 *
 * Electricity is two circuit families on one hue: 2.5 mm² for power and plugs,
 * 1.5 mm² for lighting (owner). Low voltage is ethernet, reaching every room
 * that is not a bath or shower cubicle so a mesh node or a router can be added
 * anywhere — held clear of the power lanes the whole way by
 * `SERVICE_SPEC.dataToPowerSeparation`. Climate is heating AND cooling: the wall
 * heaters run off the same chamber the hot water does and reach every room, and
 * the cooling reaches the guest room, the corridor, the bedrooms and the living
 * room, and nowhere else (owner).
 */
const DRY_RUNS = [
  /* power */
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'chamber', chamber: 'electricalChamber' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [2.9, 9.35, 1.2],
      [2.9, 9.35, 2.35],
      [2.9, 9.6, 2.35],
      [20.3, 9.6, 2.35],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [12.45, 9.6, 2.35],
      [12.45, 4.75, 2.35],
      [12.45, 4.75, 2.5],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [5.6, 4.75, 2.5],
      [20.2, 4.75, 2.5],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'livingRoom' },
    points: [
      [11.24, 4.75, 2.5],
      [11.24, 3.85, 2.5],
      [11.24, 3.85, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomMaleKids' },
    points: [
      [13.45, 4.75, 2.5],
      [13.45, 3.85, 2.5],
      [13.45, 3.85, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomFemaleKids' },
    points: [
      [18.75, 4.75, 2.5],
      [18.75, 3.85, 2.5],
      [18.75, 3.85, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'masterBedroom' },
    points: [
      [2.05, 4.75, 2.5],
      [2.05, 3.7, 2.5],
      [2.05, 3.7, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestRoom' },
    points: [
      [5.85, 4.75, 2.5],
      [5.85, 6.3, 2.5],
      [5.85, 6.3, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'kitchen' },
    points: [
      [10.25, 4.75, 2.5],
      [10.25, 6.3, 2.5],
      [10.25, 6.3, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'laundry' },
    points: [
      [14.5, 4.75, 2.5],
      [14.5, 5.8, 2.5],
      [14.5, 5.8, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainSanitair' },
    points: [
      [17.94, 4.75, 2.5],
      [17.94, 5.8, 2.5],
      [17.94, 5.8, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [13.45, 4.75, 2.5],
      [13.45, 4, 2.5],
      [13.45, 4, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'stairs' },
    points: [
      [5.6, 4.75, 2.5],
      [5.6, 4.25, 2.5],
      [5.6, 4.25, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainBathCubicle' },
    points: [
      [17.94, 4.75, 2.5],
      [17.94, 5.8, 2.5],
      [18.97, 5.8, 2.5],
      [18.97, 7.45, 2.5],
      [18.97, 7.45, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainShowerCubicle' },
    points: [
      [17.94, 4.75, 2.5],
      [17.94, 5.8, 2.5],
      [18.97, 5.8, 2.5],
      [18.97, 7.45, 2.5],
      [18.97, 7.7, 2.5],
      [19.5, 7.7, 2.5],
      [19.5, 7.7, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'utilityRoom' },
    points: [
      [17.94, 4.75, 2.5],
      [17.94, 5.8, 2.5],
      [17.94, 6.05, 2.5],
      [20.5, 6.05, 2.5],
      [20.5, 6.05, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestSanitair' },
    points: [
      [5.85, 4.75, 2.5],
      [5.85, 6.3, 2.5],
      [9.04, 6.3, 2.5],
      [9.04, 7.2, 2.5],
      [9.04, 7.2, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestBathCubicle' },
    points: [
      [5.85, 4.75, 2.5],
      [5.85, 6.3, 2.5],
      [5.85, 8.1, 2.5],
      [8.05, 8.1, 2.5],
      [8.05, 8.1, 0.3],
    ],
  },
  {
    layer: 'electricity',
    family: 'power',
    from: { at: 'chamber', chamber: 'electricalChamber' },
    to: { at: 'space', space: 'controlCenter' },
    points: [
      [2.9, 9.35, 1.2],
      [2.9, 9.35, 0.3],
    ],
  },

  /* lighting */
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'chamber', chamber: 'electricalChamber' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [2.78, 9.35, 1.2],
      [2.78, 9.35, 2.2],
      [2.78, 9.6, 2.2],
      [20.3, 9.6, 2.2],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [12.6, 9.6, 2.2],
      [12.6, 4.75, 2.2],
      [12.6, 4.75, 2.6],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [5.6, 4.75, 2.6],
      [20.2, 4.75, 2.6],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'livingRoom' },
    points: [
      [11.38, 4.75, 2.6],
      [11.38, 3.85, 2.6],
      [11.38, 3.85, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomMaleKids' },
    points: [
      [13.6, 4.75, 2.6],
      [13.6, 3.85, 2.6],
      [13.6, 3.85, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomFemaleKids' },
    points: [
      [18.9, 4.75, 2.6],
      [18.9, 3.85, 2.6],
      [18.9, 3.85, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'masterBedroom' },
    points: [
      [2.2, 4.75, 2.6],
      [2.2, 3.7, 2.6],
      [2.2, 3.7, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestRoom' },
    points: [
      [6, 4.75, 2.6],
      [6, 6.3, 2.6],
      [6, 6.3, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'kitchen' },
    points: [
      [10.4, 4.75, 2.6],
      [10.4, 6.3, 2.6],
      [10.4, 6.3, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'laundry' },
    points: [
      [14.65, 4.75, 2.6],
      [14.65, 5.8, 2.6],
      [14.65, 5.8, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainSanitair' },
    points: [
      [18.08, 4.75, 2.6],
      [18.08, 5.8, 2.6],
      [18.08, 5.8, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [13.6, 4.75, 2.6],
      [13.6, 4, 2.6],
      [13.6, 4, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'stairs' },
    points: [
      [5.6, 4.75, 2.6],
      [5.6, 4.4, 2.6],
      [5.6, 4.4, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainBathCubicle' },
    points: [
      [18.08, 4.75, 2.6],
      [18.08, 5.8, 2.6],
      [19.04, 5.8, 2.6],
      [19.04, 7.45, 2.6],
      [19.04, 7.45, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainShowerCubicle' },
    points: [
      [18.08, 4.75, 2.6],
      [18.08, 5.8, 2.6],
      [19.04, 5.8, 2.6],
      [19.04, 7.45, 2.6],
      [19.04, 7.85, 2.6],
      [19.5, 7.85, 2.6],
      [19.5, 7.85, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'utilityRoom' },
    points: [
      [18.08, 4.75, 2.6],
      [18.08, 5.8, 2.6],
      [18.08, 6.2, 2.6],
      [20.5, 6.2, 2.6],
      [20.5, 6.2, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestSanitair' },
    points: [
      [6, 4.75, 2.6],
      [6, 6.3, 2.6],
      [9.18, 6.3, 2.6],
      [9.18, 7.2, 2.6],
      [9.18, 7.2, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestBathCubicle' },
    points: [
      [6, 4.75, 2.6],
      [6, 6.3, 2.6],
      [6, 8.2, 2.6],
      [8.05, 8.2, 2.6],
      [8.05, 8.2, 2.65],
    ],
  },
  {
    layer: 'electricity',
    family: 'lighting',
    from: { at: 'chamber', chamber: 'electricalChamber' },
    to: { at: 'space', space: 'controlCenter' },
    points: [
      [2.78, 9.35, 1.2],
      [2.78, 9.35, 2.65],
    ],
  },

  /* data */
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'chamber', chamber: 'electricalChamber' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [2.52, 9.35, 1.2],
      [2.52, 9.35, 2.5],
      [20.3, 9.35, 2.5],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [14, 9.35, 2.5],
      [14, 4.45, 2.5],
      [14, 4.45, 2.25],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [5.6, 4.45, 2.25],
      [20.2, 4.45, 2.25],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'livingRoom' },
    points: [
      [11.61, 4.45, 2.25],
      [11.61, 3.85, 2.25],
      [11.61, 3.85, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomMaleKids' },
    points: [
      [13.85, 4.45, 2.25],
      [13.85, 3.85, 2.25],
      [13.85, 3.85, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomFemaleKids' },
    points: [
      [19.15, 4.45, 2.25],
      [19.15, 3.85, 2.25],
      [19.15, 3.85, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'masterBedroom' },
    points: [
      [2.45, 4.45, 2.25],
      [2.45, 3.7, 2.25],
      [2.45, 3.7, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestRoom' },
    points: [
      [6.25, 4.45, 2.25],
      [6.25, 6.3, 2.25],
      [6.25, 6.3, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'kitchen' },
    points: [
      [10.65, 4.45, 2.25],
      [10.65, 6.3, 2.25],
      [10.65, 6.3, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'laundry' },
    points: [
      [14.9, 4.45, 2.25],
      [14.9, 5.8, 2.25],
      [14.9, 5.8, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainSanitair' },
    points: [
      [18.31, 4.45, 2.25],
      [18.31, 5.8, 2.25],
      [18.31, 5.8, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [13.85, 4.45, 2.25],
      [13.85, 4, 2.25],
      [13.85, 4, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'stairs' },
    points: [
      [5.6, 4.45, 2.25],
      [5.6, 4.65, 2.25],
      [5.6, 4.65, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'utilityRoom' },
    points: [
      [18.31, 4.45, 2.25],
      [18.31, 5.8, 2.25],
      [18.31, 6.45, 2.25],
      [20.5, 6.45, 2.25],
      [20.5, 6.45, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestSanitair' },
    points: [
      [6.25, 4.45, 2.25],
      [6.25, 6.3, 2.25],
      [9.41, 6.3, 2.25],
      [9.41, 7.2, 2.25],
      [9.41, 7.2, 0.3],
    ],
  },
  {
    layer: 'lowVoltage',
    family: 'data',
    from: { at: 'chamber', chamber: 'electricalChamber' },
    to: { at: 'space', space: 'controlCenter' },
    points: [
      [2.52, 9.35, 1.2],
      [2.52, 9.35, 0.3],
    ],
  },

  /* cooling */
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'ccBalcony' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [4.2, 9.45, 0.9],
      [4.2, 9.45, 2.55],
      [20.3, 9.45, 2.55],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [13.75, 9.45, 2.55],
      [13.75, 5.1, 2.55],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [5.6, 5.1, 2.55],
      [20.2, 5.1, 2.55],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'livingRoom' },
    points: [
      [11.8, 5.1, 2.55],
      [11.8, 3.85, 2.55],
      [11.8, 3.85, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomMaleKids' },
    points: [
      [14.05, 5.1, 2.55],
      [14.05, 3.85, 2.55],
      [14.05, 3.85, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomFemaleKids' },
    points: [
      [19.35, 5.1, 2.55],
      [19.35, 3.85, 2.55],
      [19.35, 3.85, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'masterBedroom' },
    points: [
      [2.65, 5.1, 2.55],
      [2.65, 3.7, 2.55],
      [2.65, 3.7, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestRoom' },
    points: [
      [6.45, 5.1, 2.55],
      [6.45, 6.3, 2.55],
      [6.45, 6.3, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'cooling',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [14.05, 5.1, 2.55],
      [14.05, 4, 2.55],
      [14.05, 4, 2.35],
    ],
  },

  /* heating */
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'chamber', chamber: 'wetGasChamber' },
    to: { at: 'space', space: 'voidEast' },
    points: [
      [2.15, 9.35, 1.2],
      [2.15, 9.35, 2.35],
      [2.15, 9, 2.35],
      [20.3, 9, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'balconySlabB' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [12.3, 9, 2.35],
      [12.3, 5.3, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [5.6, 5.3, 2.35],
      [20.2, 5.3, 2.35],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'livingRoom' },
    points: [
      [11.1, 5.3, 2.35],
      [11.1, 3.85, 2.35],
      [11.1, 3.85, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomMaleKids' },
    points: [
      [13.3, 5.3, 2.35],
      [13.3, 3.85, 2.35],
      [13.3, 3.85, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'bedroomFemaleKids' },
    points: [
      [18.6, 5.3, 2.35],
      [18.6, 3.85, 2.35],
      [18.6, 3.85, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'masterBedroom' },
    points: [
      [1.9, 5.3, 2.35],
      [1.9, 3.7, 2.35],
      [1.9, 3.7, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestRoom' },
    points: [
      [5.7, 5.3, 2.35],
      [5.7, 6.3, 2.35],
      [5.7, 6.3, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'kitchen' },
    points: [
      [10.1, 5.3, 2.35],
      [10.1, 6.3, 2.35],
      [10.1, 6.3, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'laundry' },
    points: [
      [14.35, 5.3, 2.35],
      [14.35, 5.8, 2.35],
      [14.35, 5.8, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainSanitair' },
    points: [
      [17.8, 5.3, 2.35],
      [17.8, 5.8, 2.35],
      [17.8, 5.8, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'corridor' },
    points: [
      [13.3, 5.3, 2.35],
      [13.3, 4, 2.35],
      [13.3, 4, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'stairs' },
    points: [
      [5.6, 5.3, 2.35],
      [5.6, 4.1, 2.35],
      [5.6, 4.1, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainBathCubicle' },
    points: [
      [17.8, 5.3, 2.35],
      [17.8, 5.8, 2.35],
      [18.9, 5.8, 2.35],
      [18.9, 7.45, 2.35],
      [18.9, 7.45, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'mainShowerCubicle' },
    points: [
      [17.8, 5.3, 2.35],
      [17.8, 5.8, 2.35],
      [18.9, 5.8, 2.35],
      [18.9, 7.45, 2.35],
      [18.9, 7.55, 2.35],
      [19.5, 7.55, 2.35],
      [19.5, 7.55, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'utilityRoom' },
    points: [
      [17.8, 5.3, 2.35],
      [17.8, 5.8, 2.35],
      [17.8, 5.9, 2.35],
      [20.5, 5.9, 2.35],
      [20.5, 5.9, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestSanitair' },
    points: [
      [5.7, 5.3, 2.35],
      [5.7, 6.3, 2.35],
      [8.9, 6.3, 2.35],
      [8.9, 7.2, 2.35],
      [8.9, 7.2, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'space', space: 'corridor' },
    to: { at: 'space', space: 'guestBathCubicle' },
    points: [
      [5.7, 5.3, 2.35],
      [5.7, 6.3, 2.35],
      [5.7, 8, 2.35],
      [8.05, 8, 2.35],
      [8.05, 8, 0.6],
    ],
  },
  {
    layer: 'climate',
    family: 'heating',
    from: { at: 'chamber', chamber: 'wetGasChamber' },
    to: { at: 'space', space: 'controlCenter' },
    points: [
      [2.15, 9.35, 1.2],
      [2.15, 9.35, 0.6],
    ],
  },
] as const satisfies readonly PlanServiceRun[];

/**
 * Every declared run of every service, in layer order.
 *
 * Composed from the per-layer arrays above rather than written as one list,
 * because a list this long is only readable in the groups a plumber and an
 * electrician actually think in.
 */
export const SERVICE_RUNS = deepFreeze([
  ...DRAINAGE_RUNS,
  ...WATER_RUNS,
  ...HEATER_DRAIN_RUNS,
  ...GAS_RUNS,
  ...CHAMBER_VENT_RUNS,
  ...DRY_RUNS,
] as const satisfies readonly PlanServiceRun[]);
