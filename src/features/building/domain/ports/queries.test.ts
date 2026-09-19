/**
 * Tests of the port queries, and — in `getSwingClearance` below — the tripwire
 * between the two ways this repository derives which face a door leaf hangs in.
 *
 * `scripts/source-of-truth/verify.mjs` check 9 takes that face off the derived
 * walls of `scripts/source-of-truth/walls.mjs`: a wall already knows which room
 * it belongs to and which way is inward, so the script reads `side` and `at` off
 * the wall. `getSwingClearance` never sees a derived wall; it takes the face off
 * the plan's own rects, through `getPortContact`. Two routes, one fact, and
 * nothing made them agree.
 *
 * {@link EXPECTED_SWINGS} is what makes them agree: every face of every leaf
 * that needs floor, written out by hand from the clear rects of
 * `sourceOfTruth/plan.ts` with the arithmetic beside it. If the two derivations
 * ever disagree about which face a leaf is hung in — or about which way inward
 * is — the rectangle moves and this table fails, naming the door. It is a pinned
 * inventory rather than a property test on purpose: a property test written off
 * the same query cannot catch the query being wrong.
 *
 * Check 9 counts the same inventory from the other side and prints it, so the
 * two can be compared by eye: `28 door faces checked for swing`, plus the four
 * sliding leaves named out loud as exempt. That is this table's 28 rows — 14
 * swinging leaves of the 18 doors in the schedule, each tested from both of its
 * two spaces — and this file's `needsSwingClearance` tests are the same four
 * exemptions plus the leafless living-room opening.
 */
import { describe, expect, it } from 'vitest';
import { FLOOR_HEIGHTS } from '../heights.ts';
import type { FloorHeights } from '../heights.ts';
import { FLOOR_PLAN, getSpace } from '../floorPlan/index.ts';
import type { SpaceId } from '../floorPlan/index.ts';
import { LENGTH_TOLERANCE, makeRect, rectArea, rectsOverlap } from '../planGeometry.ts';
import type { PlanRect, RectSide } from '../planGeometry.ts';
import { FIXTURES } from '../sourceOfTruth/plan.ts';
import { PORT_SCHEDULE } from './portSchedule.ts';
import {
  getOpeningClearances,
  getPortContact,
  getPortOpening,
  getPortPartners,
  getPortSpan,
  getPortsOf,
  getSwingClearance,
  getSwingClearances,
  needsSwingClearance,
} from './queries.ts';
import type { Port, PortAxis, PortKind } from './types.ts';

const PRECISION_DIGITS = 9;
const FLOOR_LEVEL = 0;
const DOOR_WIDTH = 0.9;
const LIVING_OPENING_WIDTH = 3.5;
const EXPECTED_CORRIDOR_PORT_COUNT = 7;
const EXPECTED_KITCHEN_PORT_COUNT = 2;
const EXPECTED_SWING_CLEARANCE_COUNT = 14;

/** Vertical sizes with a lower door head, to prove the parameter is honoured. */
const LOW_HEIGHTS: FloorHeights = Object.freeze({ ...FLOOR_HEIGHTS, door: 1.95 });

/**
 * Builds a port for a query test.
 *
 * @param spaces - The two spaces, in the order the query walks them.
 * @param kind - Kind of the passage.
 * @param along - Axis the width runs along.
 * @param spanMin - Start of the port along `along`, in metres.
 * @param width - Clear width, in metres.
 * @returns A plain {@link Port}.
 */
function makePort(
  spaces: readonly [SpaceId, SpaceId],
  kind: PortKind,
  along: PortAxis,
  spanMin: number,
  width: number,
): Port {
  return { spaces, kind, along, spanMin, width };
}

/**
 * Looks a scheduled port up by its pair of spaces.
 *
 * @param first - One space of the port.
 * @param second - The other space.
 * @returns The scheduled port connecting them.
 * @throws RangeError naming the pair when the schedule has no such port.
 */
function findPort(first: SpaceId, second: SpaceId): Port {
  const port = PORT_SCHEDULE.find(
    ({ spaces }) => spaces.includes(first) && spaces.includes(second),
  );
  if (port === undefined) {
    throw new RangeError(`the schedule has no port between "${first}" and "${second}"`);
  }
  return port;
}

/** Hand-computed spans of a few ports, from `spanMin` and `width`. */
const EXPECTED_SPANS: readonly (readonly [string, SpaceId, SpaceId, number, number])[] = [
  ['balconyA ↔ masterBedroom', 'balconyA', 'masterBedroom', 1.55, 2.45],
  ['livingRoom ↔ corridor', 'livingRoom', 'corridor', 7.5, 11.0],
  ['balconyA ↔ guestRoom', 'balconyA', 'guestRoom', 6.35, 7.0],
  ['guestRoom ↔ guestSanitair', 'guestRoom', 'guestSanitair', 8.1, 8.8],
  ['mainSanitair ↔ mainShowerCubicle', 'mainSanitair', 'mainShowerCubicle', 19.6, 20.25],
];

/** One contact a port must resolve to, measured off the plan rects. */
interface ExpectedContact {
  /** The pair and axis, for the test name. */
  readonly label: string;
  /** The port to locate. */
  readonly port: Port;
  /** Face of the first space's rect that faces the second space. */
  readonly side: RectSide;
  /** Index of the first space's rect. */
  readonly rectIndex: number;
  /** Index of the second space's rect. */
  readonly neighbourRectIndex: number;
  /** Wall thickness between the two faces, in metres. */
  readonly gap: number;
}

/**
 * The pairs that touch on both axes, which is why `Port.along` is stored.
 *
 * There are exactly three on this plan, and `Port.along` names them: the
 * corridor meets the kitchen across the kitchen's north wall and across the
 * corridor's east end; the control center meets the guest room across its own
 * north wall and across the guest-room strip's west end; and the guest room
 * meets the guest sanitair across that room's north wall and across the guest
 * room's east face. For each, the scheduled door fixes one axis and a probe port
 * on the other axis proves the stored axis is what resolves the ambiguity —
 * without it, either contact would match.
 *
 * The old table's first two rows covered `linkCorridor ↔ guestRoom`, the L-shape
 * ambiguity of the previous plan: the link corridor met the guest room both
 * across the guest room's north wall and across the link corridor's own end
 * wall, so a port between them was ambiguous on its own. Those rows are deleted
 * rather than adapted because the situation is now unreachable: the owner
 * deleted `linkCorridor` and absorbed it into the guest room's north strip, so
 * the two spaces that produced the ambiguity are one space and no port can be
 * drawn between them at all. The corridor ↔ kitchen and controlCenter ↔
 * guestRoom rows below are the new plan's own both-axes pairs and carry the same
 * proof.
 */
const AMBIGUOUS_CONTACTS: readonly ExpectedContact[] = [
  {
    label: 'corridor ↔ kitchen along x (the scheduled door)',
    port: findPort('corridor', 'kitchen'),
    side: 'maxZ',
    rectIndex: 0,
    neighbourRectIndex: 1,
    gap: 0.3,
  },
  {
    label: 'corridor ↔ kitchen along z (the other axis)',
    port: makePort(['corridor', 'kitchen'], 'door', 'z', 5.8, 0.2),
    side: 'maxX',
    rectIndex: 1,
    neighbourRectIndex: 1,
    gap: 0.3,
  },
  {
    label: 'controlCenter ↔ guestRoom along x (the scheduled door)',
    port: findPort('controlCenter', 'guestRoom'),
    side: 'minZ',
    rectIndex: 0,
    neighbourRectIndex: 0,
    gap: 0.15,
  },
  {
    label: 'controlCenter ↔ guestRoom along z (the other axis)',
    port: makePort(['controlCenter', 'guestRoom'], 'door', 'z', 7.2, DOOR_WIDTH),
    side: 'maxX',
    rectIndex: 0,
    neighbourRectIndex: 1,
    gap: 0.3,
  },
  {
    label: 'guestRoom ↔ guestSanitair along x (the scheduled door)',
    port: findPort('guestRoom', 'guestSanitair'),
    side: 'maxZ',
    rectIndex: 0,
    neighbourRectIndex: 0,
    gap: 0.15,
  },
  {
    label: 'guestRoom ↔ guestSanitair along z (the other axis)',
    port: makePort(['guestRoom', 'guestSanitair'], 'door', 'z', 7.2, 0.5),
    side: 'maxX',
    rectIndex: 1,
    neighbourRectIndex: 0,
    gap: 0.15,
  },
];

/** One opening footprint, measured off the clear rects of the plan. */
interface ExpectedOpening {
  /** The pair, for the test name. */
  readonly label: string;
  /** One space of the scheduled port. */
  readonly first: SpaceId;
  /** The other space. */
  readonly second: SpaceId;
  /** Expected footprint as `[minX, maxX, minZ, maxZ]`, in metres. */
  readonly rect: readonly [number, number, number, number];
}

/**
 * Openings covering every rect face the schedule actually sits in, and both wall
 * thicknesses the plan uses: 0.30 where a face is weather-exposed or insulated,
 * 0.15 where it is a plain separator.
 *
 * Three faces, not the four this comment used to claim. `getPortContact` walks
 * the contacts of `port.spaces[0]`, so which face a port sits in follows from the
 * order the source of truth names its pair in, and no scheduled port is named in
 * the order that would put it on a `minX` face. The test below pins that over the
 * whole schedule rather than over this list alone, so the shortfall is a measured
 * fact about the plan and not a gap in the list. The fourth face is reached by
 * naming a pair the other way round, which is what `SWAPPED_PORTS` is for.
 *
 * The `minZ` row rests on a single port, the control-center door, which is also
 * the only port of the floor wider than 0.90: it is 1.20 for the risers, so its
 * footprint is 1.20 long, x 1.70–2.90.
 */
const EXPECTED_OPENINGS: readonly ExpectedOpening[] = [
  {
    label: 'balconyA ↔ masterBedroom',
    first: 'balconyA',
    second: 'masterBedroom',
    rect: [1.3, 1.6, 1.55, 2.45],
  },
  {
    label: 'livingRoom ↔ corridor',
    first: 'livingRoom',
    second: 'corridor',
    rect: [7.5, 11.0, 3.85, 4.0],
  },
  {
    label: 'corridor ↔ utilityRoom',
    first: 'corridor',
    second: 'utilityRoom',
    rect: [20.2, 20.5, 4.2, 5.1],
  },
  {
    label: 'stairs ↔ guestRoom',
    first: 'stairs',
    second: 'guestRoom',
    rect: [4.65, 5.55, 6.0, 6.3],
  },
  {
    label: 'controlCenter ↔ guestRoom',
    first: 'controlCenter',
    second: 'guestRoom',
    rect: [1.7, 2.9, 7.05, 7.2],
  },
  {
    label: 'controlCenter ↔ ccBalcony',
    first: 'controlCenter',
    second: 'ccBalcony',
    rect: [3.8, 4.1, 8.95, 9.65],
  },
  {
    label: 'guestRoom ↔ guestSanitair',
    first: 'guestRoom',
    second: 'guestSanitair',
    rect: [8.1, 8.8, 7.05, 7.2],
  },
  {
    // The guest suite's one cubicle leaf, which took the shower's place in this
    // list when the shower was dropped. It sits in the sanitair's maxZ face at
    // 7.75, against the bath's minZ at 7.90, the 0.15 partition between them —
    // and at the WEST end of the run, almost directly across the 0.55 m open
    // part from the room door in the north face.
    label: 'guestSanitair ↔ guestBathCubicle',
    first: 'guestSanitair',
    second: 'guestBathCubicle',
    rect: [8.2, 8.8, 7.75, 7.9],
  },
  {
    label: 'laundry ↔ mainSanitair',
    first: 'laundry',
    second: 'mainSanitair',
    rect: [17.55, 17.7, 5.9, 6.8],
  },
  {
    label: 'kitchen ↔ balconySlabB',
    first: 'kitchen',
    second: 'balconySlabB',
    rect: [12.7, 13.6, 8.6, 8.9],
  },
];

/** Ports the schedule swaps, to exercise the `minX` and `minZ` faces. */
const SWAPPED_PORTS: readonly (readonly [string, Port, Port])[] = [
  [
    'balconyA ↔ masterBedroom across the side-A wall',
    findPort('balconyA', 'masterBedroom'),
    makePort(['masterBedroom', 'balconyA'], 'door', 'z', 1.55, DOOR_WIDTH),
  ],
  [
    'livingRoom ↔ corridor across the top-row wall',
    findPort('livingRoom', 'corridor'),
    makePort(['corridor', 'livingRoom'], 'opening', 'x', 7.5, LIVING_OPENING_WIDTH),
  ],
  [
    'stairs ↔ guestRoom across the stair-landing wall',
    findPort('stairs', 'guestRoom'),
    makePort(['guestRoom', 'stairs'], 'door', 'x', 4.65, DOOR_WIDTH),
  ],
];

/** The four sliding leaves, which need no floor to open into. */
const SLIDING_PAIRS: readonly (readonly [SpaceId, SpaceId])[] = [
  ['guestRoom', 'guestSanitair'],
  ['guestSanitair', 'guestBathCubicle'],
  ['mainSanitair', 'mainBathCubicle'],
  ['mainSanitair', 'mainShowerCubicle'],
];

/** One face of one leaf: the floor it needs, measured by hand off the plan rects. */
interface ExpectedSwing {
  /** The pair, as the schedule names it, for the test name. */
  readonly label: string;
  /** One space of the scheduled port. */
  readonly first: SpaceId;
  /** The other space. */
  readonly second: SpaceId;
  /** The space the leaf is measured into — either of the two, both are tested. */
  readonly id: SpaceId;
  /** Face of that space's rect the leaf is hung in. */
  readonly side: RectSide;
  /** Expected clear floor as `[minX, maxX, minZ, maxZ]`, in metres. */
  readonly rect: readonly [number, number, number, number];
}

/**
 * Every face of every leaf that needs floor: 14 swinging doors, each from both
 * of its spaces, 28 rows, in schedule order.
 *
 * Each rectangle is the leaf's own width square — a leaf has to be able to stand
 * at 90° with nothing under it — laid along the opening's span and reaching that
 * width INTO the room from the face it is hung in. The span is the port's
 * `spanMin` → `spanMin + width`, the same interval from either room; only the
 * face and the direction differ, and the comment on each door does that
 * arithmetic from the clear rects of `sourceOfTruth/plan.ts`.
 *
 * The four sliding leaves and the living-room opening are absent, because
 * `needsSwingClearance` exempts them; they are pinned in their own tests below.
 */
const EXPECTED_SWINGS: readonly ExpectedSwing[] = [
  // R01 side-A balcony x 0.30–1.30 · R02 master bedroom x 1.60–6.60, the 0.90
  // leaf centred on the wall at z 1.55–2.45.
  // Balcony: its maxX face 1.30, inward is −x → 1.30 − 0.90 = 0.40.
  // Bedroom: its minX face 1.60, inward is +x → 1.60 + 0.90 = 2.50.
  {
    label: 'balconyA ↔ masterBedroom',
    first: 'balconyA',
    second: 'masterBedroom',
    id: 'balconyA',
    side: 'maxX',
    rect: [0.4, 1.3, 1.55, 2.45],
  },
  {
    label: 'balconyA ↔ masterBedroom',
    first: 'balconyA',
    second: 'masterBedroom',
    id: 'masterBedroom',
    side: 'minX',
    rect: [1.6, 2.5, 1.55, 2.45],
  },
  // R02 master bedroom z 0.30–3.70 · R07 corridor rect 0 z 4.00–5.50, the 0.90
  // leaf at x 5.65–6.55.
  // Bedroom: its maxZ face 3.70, inward is −z → 3.70 − 0.90 = 2.80.
  // Corridor: its minZ face 4.00, inward is +z → 4.00 + 0.90 = 4.90.
  {
    label: 'masterBedroom ↔ corridor',
    first: 'masterBedroom',
    second: 'corridor',
    id: 'masterBedroom',
    side: 'maxZ',
    rect: [5.65, 6.55, 2.8, 3.7],
  },
  {
    label: 'masterBedroom ↔ corridor',
    first: 'masterBedroom',
    second: 'corridor',
    id: 'corridor',
    side: 'minZ',
    rect: [5.65, 6.55, 4.0, 4.9],
  },
  // R04 male kids z 0.30–3.85 · R07 corridor rect 0, the 0.90 leaf at
  // x 12.30–13.20. Bedroom: 3.85 − 0.90 = 2.95. Corridor: 4.00 + 0.90 = 4.90.
  {
    label: 'bedroomMaleKids ↔ corridor',
    first: 'bedroomMaleKids',
    second: 'corridor',
    id: 'bedroomMaleKids',
    side: 'maxZ',
    rect: [12.3, 13.2, 2.95, 3.85],
  },
  {
    label: 'bedroomMaleKids ↔ corridor',
    first: 'bedroomMaleKids',
    second: 'corridor',
    id: 'corridor',
    side: 'minZ',
    rect: [12.3, 13.2, 4.0, 4.9],
  },
  // R05 female kids z 0.30–3.85 · R07 corridor rect 0, the 0.90 leaf at
  // x 17.60–18.50. Same two faces as the male kids' door, 5.30 further east.
  {
    label: 'bedroomFemaleKids ↔ corridor',
    first: 'bedroomFemaleKids',
    second: 'corridor',
    id: 'bedroomFemaleKids',
    side: 'maxZ',
    rect: [17.6, 18.5, 2.95, 3.85],
  },
  {
    label: 'bedroomFemaleKids ↔ corridor',
    first: 'bedroomFemaleKids',
    second: 'corridor',
    id: 'corridor',
    side: 'minZ',
    rect: [17.6, 18.5, 4.0, 4.9],
  },
  // R07 corridor rect 0 x 5.60–20.20 · R14 utility room x 20.50–22.20, the 0.90
  // leaf at z 4.20–5.10.
  // Corridor: its maxX face 20.20, inward is −x → 20.20 − 0.90 = 19.30.
  // Utility: its minX face 20.50, inward is +x → 20.50 + 0.90 = 21.40.
  {
    label: 'corridor ↔ utilityRoom',
    first: 'corridor',
    second: 'utilityRoom',
    id: 'corridor',
    side: 'maxX',
    rect: [19.3, 20.2, 4.2, 5.1],
  },
  {
    label: 'corridor ↔ utilityRoom',
    first: 'corridor',
    second: 'utilityRoom',
    id: 'utilityRoom',
    side: 'minX',
    rect: [20.5, 21.4, 4.2, 5.1],
  },
  // R06 stairwell z 4.00–6.00 · R09 guest room rect 0 z 6.30–7.05, the 0.90 leaf
  // at x 4.65–5.55 in the east landing's run.
  // Stairs: its maxZ face 6.00, inward is −z → 6.00 − 0.90 = 5.10.
  // Guest room: its minZ face 6.30, inward is +z → 6.30 + 0.90 = 7.20, which
  // crosses out of the 0.75 strip into rect 1 (x 4.10–7.90, z 7.05–8.60) — the
  // room is L-shaped there, so the floor is continuous and the rect is inside it.
  {
    label: 'stairs ↔ guestRoom',
    first: 'stairs',
    second: 'guestRoom',
    id: 'stairs',
    side: 'maxZ',
    rect: [4.65, 5.55, 5.1, 6.0],
  },
  {
    label: 'stairs ↔ guestRoom',
    first: 'stairs',
    second: 'guestRoom',
    id: 'guestRoom',
    side: 'minZ',
    rect: [4.65, 5.55, 6.3, 7.2],
  },
  // R07 corridor rect 0 z 4.00–5.50 · R11 kitchen rect 1 z 5.80–8.60, the 0.90
  // leaf at x 12.70–13.60. The contact is the corridor's maxZ, not its east end:
  // these two spaces touch on both axes, which is what `along: 'x'` settles.
  // Corridor: 5.50 − 0.90 = 4.60. Kitchen: 5.80 + 0.90 = 6.70.
  {
    label: 'corridor ↔ kitchen',
    first: 'corridor',
    second: 'kitchen',
    id: 'corridor',
    side: 'maxZ',
    rect: [12.7, 13.6, 4.6, 5.5],
  },
  {
    label: 'corridor ↔ kitchen',
    first: 'corridor',
    second: 'kitchen',
    id: 'kitchen',
    side: 'minZ',
    rect: [12.7, 13.6, 5.8, 6.7],
  },
  // R07 corridor rect 0 · R13 main sanitair z 5.80–7.30, the 0.90 leaf at
  // x 18.60–19.50, moved east so it no longer shares floor with the laundry's.
  // Corridor: 5.50 − 0.90 = 4.60. Sanitair: 5.80 + 0.90 = 6.70.
  {
    label: 'corridor ↔ mainSanitair',
    first: 'corridor',
    second: 'mainSanitair',
    id: 'corridor',
    side: 'maxZ',
    rect: [18.6, 19.5, 4.6, 5.5],
  },
  {
    label: 'corridor ↔ mainSanitair',
    first: 'corridor',
    second: 'mainSanitair',
    id: 'mainSanitair',
    side: 'minZ',
    rect: [18.6, 19.5, 5.8, 6.7],
  },
  // R01 side-A balcony · R09 guest room rect 0 x 1.60–9.70, the 0.65 leaf at
  // z 6.35–7.00 — 0.65 because the strip it opens into is only 0.75 deep.
  // Balcony: 1.30 − 0.65 = 0.65. Guest room: 1.60 + 0.65 = 2.25, which fits the
  // 0.75 strip with 0.10 to spare. That is what the narrow leaf bought.
  {
    label: 'balconyA ↔ guestRoom',
    first: 'balconyA',
    second: 'guestRoom',
    id: 'balconyA',
    side: 'maxX',
    rect: [0.65, 1.3, 6.35, 7.0],
  },
  {
    label: 'balconyA ↔ guestRoom',
    first: 'balconyA',
    second: 'guestRoom',
    id: 'guestRoom',
    side: 'minX',
    rect: [1.6, 2.25, 6.35, 7.0],
  },
  // R08 control center z 7.20–9.70 · R09 guest room rect 0 z 6.30–7.05, the
  // 1.20 leaf at x 1.70–2.90 — the widest of the floor, so a riser can pass.
  // Control center: its minZ face 7.20, inward is +z → 7.20 + 1.20 = 8.40.
  // Guest room: its maxZ face 7.05, inward is −z → 7.05 − 1.20 = 5.85, which is
  // 0.45 MORE than the 0.75 strip has. See KNOWN_OVERSPILL: the rect is right,
  // the leaf simply cannot swing that way.
  {
    label: 'controlCenter ↔ guestRoom',
    first: 'controlCenter',
    second: 'guestRoom',
    id: 'controlCenter',
    side: 'minZ',
    rect: [1.7, 2.9, 7.2, 8.4],
  },
  {
    label: 'controlCenter ↔ guestRoom',
    first: 'controlCenter',
    second: 'guestRoom',
    id: 'guestRoom',
    side: 'maxZ',
    rect: [1.7, 2.9, 5.85, 7.05],
  },
  // R08 control center x 1.60–3.80 · R15 cc balcony x 4.10–4.90, the 0.70 leaf
  // at z 8.95–9.65 — 0.70 because the balcony is only 0.80 deep.
  // Control center: its maxX face 3.80, inward is −x → 3.80 − 0.70 = 3.10.
  // Balcony: its minX face 4.10, inward is +x → 4.10 + 0.70 = 4.80.
  {
    label: 'controlCenter ↔ ccBalcony',
    first: 'controlCenter',
    second: 'ccBalcony',
    id: 'controlCenter',
    side: 'maxX',
    rect: [3.1, 3.8, 8.95, 9.65],
  },
  {
    label: 'controlCenter ↔ ccBalcony',
    first: 'controlCenter',
    second: 'ccBalcony',
    id: 'ccBalcony',
    side: 'minX',
    rect: [4.1, 4.8, 8.95, 9.65],
  },
  // R11 kitchen rect 1 z 5.80–8.60 · R16 side-B slab z 8.90–9.70, the 0.90 leaf
  // at x 12.70–13.60.
  // Kitchen: its maxZ face 8.60, inward is −z → 8.60 − 0.90 = 7.70.
  // Slab: its minZ face 8.90, inward is +z → 8.90 + 0.90 = 9.80, which is 0.10
  // past the railed edge at 9.70. See KNOWN_OVERSPILL.
  {
    label: 'kitchen ↔ balconySlabB',
    first: 'kitchen',
    second: 'balconySlabB',
    id: 'kitchen',
    side: 'maxZ',
    rect: [12.7, 13.6, 7.7, 8.6],
  },
  {
    label: 'kitchen ↔ balconySlabB',
    first: 'kitchen',
    second: 'balconySlabB',
    id: 'balconySlabB',
    side: 'minZ',
    rect: [12.7, 13.6, 8.9, 9.8],
  },
  // R12 laundry x 14.25–17.55 · R13 main sanitair x 17.70–20.35, the 0.90 leaf
  // at z 5.90–6.80, kept close to the corridor wall.
  // Laundry: its maxX face 17.55, inward is −x → 17.55 − 0.90 = 16.65.
  // Sanitair: its minX face 17.70, inward is +x → 17.70 + 0.90 = 18.60.
  {
    label: 'laundry ↔ mainSanitair',
    first: 'laundry',
    second: 'mainSanitair',
    id: 'laundry',
    side: 'maxX',
    rect: [16.65, 17.55, 5.9, 6.8],
  },
  {
    label: 'laundry ↔ mainSanitair',
    first: 'laundry',
    second: 'mainSanitair',
    id: 'mainSanitair',
    side: 'minX',
    rect: [17.7, 18.6, 5.9, 6.8],
  },
  // R12 laundry z 5.80–8.60 · R16 side-B slab, the 0.90 leaf at x 14.30–15.20,
  // at the west end of the wall with the glazing east of it.
  // Laundry: 8.60 − 0.90 = 7.70. Slab: 8.90 + 0.90 = 9.80, again 0.10 past the
  // edge. See KNOWN_OVERSPILL.
  {
    label: 'laundry ↔ balconySlabB',
    first: 'laundry',
    second: 'balconySlabB',
    id: 'laundry',
    side: 'maxZ',
    rect: [14.3, 15.2, 7.7, 8.6],
  },
  {
    label: 'laundry ↔ balconySlabB',
    first: 'laundry',
    second: 'balconySlabB',
    id: 'balconySlabB',
    side: 'minZ',
    rect: [14.3, 15.2, 8.9, 9.8],
  },
];

/** Every face of every swinging leaf: 14 doors seen from both of their spaces. */
const EXPECTED_SWING_FACE_COUNT = EXPECTED_SWING_CLEARANCE_COUNT * 2;

/**
 * The three faces whose conservative rectangle does not fit the space it is
 * measured into, as `"pair → space"`.
 *
 * Not a derivation bug, which is why they are named here rather than fixed: the
 * face and the direction are right in all three, and what does not fit is the
 * LEAF. `swing` absent means "swings", not "swings into this room", so both
 * faces are measured — and for these three the plan itself says the leaf goes
 * the other way:
 *
 * - `controlCenter ↔ guestRoom → guestRoom`: a 1.20 m leaf against a 0.75 m
 *   strip (z 6.30–7.05), short by 0.45. The owner widened this door to 1.20 for
 *   the risers; it opens into the control center, which is 2.50 m deep.
 * - `kitchen ↔ balconySlabB → balconySlabB` and
 *   `laundry ↔ balconySlabB → balconySlabB`: a 0.90 m leaf against the 0.80 m
 *   side-B strip, short by 0.10 each. The strip is 0.80 because it carries the
 *   risers and a drying line; both leaves open inwards, into the room.
 *
 * The list is pinned so a FOURTH one cannot appear unnoticed — a new overspill
 * is either a moved door or a derivation that has started reading the wrong
 * face, and both want a human.
 */
const KNOWN_OVERSPILL: readonly string[] = [
  'controlCenter ↔ guestRoom → guestRoom',
  'kitchen ↔ balconySlabB → balconySlabB',
  'laundry ↔ balconySlabB → balconySlabB',
];

/**
 * The corridor's own six swinging leaves, in schedule order, read off the table
 * above rather than written a third time.
 */
const CORRIDOR_SWINGS: readonly PlanRect[] = EXPECTED_SWINGS.filter(
  ({ id }) => id === 'corridor',
).map(({ rect }) => makeRect(...rect));

/** Depth of clear floor Part 4 keeps in front of a leafless opening, in metres. */
const OPENING_DEPTH = 0.6;

/** A second depth, to prove the band follows the argument and the swings do not. */
const DEEPER_OPENING_DEPTH = 1.2;

/** Gap between the corridor band at {@link OPENING_DEPTH} and the television, in metres. */
const TELEVISION_GAP = 1.32;

/**
 * Sums the area of a rectangle that lies on the floor of one space.
 *
 * The rects of a space touch and never overlap, so the intersections can simply
 * be added: the total equals the rectangle's own area exactly when the rectangle
 * is inside the space, whether it sits in one rect or straddles two — which the
 * stairs door does, across the guest room's L.
 *
 * @param id - Identifier of the space.
 * @param rect - The rectangle to measure.
 * @returns The covered area, in square metres.
 */
function coveredArea(id: SpaceId, rect: PlanRect): number {
  return getSpace(FLOOR_PLAN, id).rects.reduce((total, part) => {
    const overlapX = Math.min(part.maxX, rect.maxX) - Math.max(part.minX, rect.minX);
    const overlapZ = Math.min(part.maxZ, rect.maxZ) - Math.max(part.minZ, rect.minZ);
    return overlapX > 0 && overlapZ > 0 ? total + overlapX * overlapZ : total;
  }, 0);
}

/**
 * Returns the swing rectangle of a scheduled port inside one of its spaces.
 *
 * @param row - The row of {@link EXPECTED_SWINGS} to resolve.
 * @returns The rectangle the query gives for that face.
 * @throws Error when the query gives none, which would mean the row names a port
 *   that needs no clearance or a space the port does not touch.
 */
function swingOf({ first, second, id }: ExpectedSwing): PlanRect {
  const rect = getSwingClearance(FLOOR_PLAN, findPort(first, second), id);
  if (rect === undefined) {
    throw new Error(`no swing clearance for "${first}" ↔ "${second}" in "${id}"`);
  }
  return rect;
}

describe('getPortSpan', () => {
  it.each(EXPECTED_SPANS)('spans %s from %s to %s', (_label, first, second, spanMin, spanMax) => {
    const [actualMin, actualMax] = getPortSpan(findPort(first, second));

    expect(actualMin).toBeCloseTo(spanMin, PRECISION_DIGITS);
    expect(actualMax).toBeCloseTo(spanMax, PRECISION_DIGITS);
  });

  it('ends every scheduled port exactly its width after its start', () => {
    const offenders = PORT_SCHEDULE.filter((port) => {
      const [spanMin, spanMax] = getPortSpan(port);
      return Math.abs(spanMax - spanMin - port.width) > LENGTH_TOLERANCE;
    });

    expect(offenders).toEqual([]);
  });
});

describe('getPortContact', () => {
  it.each(PORT_SCHEDULE.map((port) => ({ label: port.spaces.join(' ↔ '), port })))(
    'finds the wall of $label',
    ({ port }) => {
      const contact = getPortContact(FLOOR_PLAN, port);
      const [spanMin, spanMax] = getPortSpan(port);
      const contactAxis: PortAxis = contact.side === 'minX' || contact.side === 'maxX' ? 'z' : 'x';

      expect(contact.neighbourId).toBe(port.spaces[1]);
      expect(contactAxis).toBe(port.along);
      expect(contact.gap).toBeGreaterThan(0);
      expect(contact.spanMin).toBeLessThanOrEqual(spanMin);
      expect(contact.spanMax).toBeGreaterThanOrEqual(spanMax);
    },
  );

  it('has a both-axes pair for every ambiguity the table claims to resolve', () => {
    const pairs = AMBIGUOUS_CONTACTS.map(({ port }) => [...port.spaces].sort().join('|'));

    expect(new Set(pairs).size).toBe(AMBIGUOUS_CONTACTS.length / 2);
  });

  it.each(AMBIGUOUS_CONTACTS)(
    'uses the stored axis to resolve $label',
    ({ port, side, rectIndex, neighbourRectIndex, gap }) => {
      const contact = getPortContact(FLOOR_PLAN, port);

      expect(contact.side).toBe(side);
      expect(contact.rectIndex).toBe(rectIndex);
      expect(contact.neighbourRectIndex).toBe(neighbourRectIndex);
      expect(contact.gap).toBeCloseTo(gap, PRECISION_DIGITS);
    },
  );

  it('throws when the two spaces do not share a wall', () => {
    const port = makePort(['livingRoom', 'kitchen'], 'door', 'x', 10.5, DOOR_WIDTH);

    expect(() => getPortContact(FLOOR_PLAN, port)).toThrow(RangeError);
    expect(() => getPortContact(FLOOR_PLAN, port)).toThrow(/"livingRoom" ↔ "kitchen"/);
  });

  it('throws when the span runs past the end of the wall', () => {
    const tooWide = makePort(['masterBedroom', 'corridor'], 'door', 'x', 5.65, 1.5);

    expect(() => getPortContact(FLOOR_PLAN, tooWide)).toThrow(/matched 0/);
  });

  it('throws when the stored axis matches no contact', () => {
    const wrongAxis = makePort(['masterBedroom', 'corridor'], 'door', 'z', 1.0, DOOR_WIDTH);

    expect(() => getPortContact(FLOOR_PLAN, wrongAxis)).toThrow(/matched 0/);
  });
});

describe('getPortOpening', () => {
  it.each(EXPECTED_OPENINGS)('cuts the wall of $label', ({ first, second, rect }) => {
    const [minX, maxX, minZ, maxZ] = rect;
    const opening = getPortOpening(FLOOR_PLAN, findPort(first, second));

    expect(opening.rect.minX).toBeCloseTo(minX, PRECISION_DIGITS);
    expect(opening.rect.maxX).toBeCloseTo(maxX, PRECISION_DIGITS);
    expect(opening.rect.minZ).toBeCloseTo(minZ, PRECISION_DIGITS);
    expect(opening.rect.maxZ).toBeCloseTo(maxZ, PRECISION_DIGITS);
    expect(opening.bottom).toBe(FLOOR_LEVEL);
    expect(opening.top).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
  });

  it('cuts a wall for every scheduled port, from the floor to the door head', () => {
    const openings = PORT_SCHEDULE.map((port) => getPortOpening(FLOOR_PLAN, port));
    const offenders = openings.filter(
      (opening) => opening.bottom !== FLOOR_LEVEL || opening.top !== FLOOR_HEIGHTS.door,
    );

    expect(openings).toHaveLength(PORT_SCHEDULE.length);
    expect(offenders).toEqual([]);
  });

  it('covers every face the schedule sits in across the pinned openings', () => {
    const sides = EXPECTED_OPENINGS.map(
      ({ first, second }) => getPortContact(FLOOR_PLAN, findPort(first, second)).side,
    );
    const scheduled = PORT_SCHEDULE.map((port) => getPortContact(FLOOR_PLAN, port).side);

    expect([...new Set(sides)].sort()).toEqual(['maxX', 'maxZ', 'minZ']);
    // The pinned list leaves no face of the schedule out: the whole schedule sits
    // in these same three. "All four faces" was never true of it.
    expect([...new Set(scheduled)].sort()).toEqual(['maxX', 'maxZ', 'minZ']);
  });

  it('reaches the fourth face, minX, only by naming a pair the other way round', () => {
    const [, scheduled, swapped] = SWAPPED_PORTS[0];

    expect(swapped.spaces).toEqual(['masterBedroom', 'balconyA']);
    expect(getPortContact(FLOOR_PLAN, swapped).side).toBe('minX');
    expect(getPortContact(FLOOR_PLAN, scheduled).side).toBe('maxX');
  });

  it('honours the heights it is given', () => {
    const opening = getPortOpening(FLOOR_PLAN, findPort('corridor', 'kitchen'), LOW_HEIGHTS);

    expect(opening.top).toBeCloseTo(LOW_HEIGHTS.door, PRECISION_DIGITS);
  });

  it.each(SWAPPED_PORTS)('cuts the same wall for %s in either order', (_label, port, swapped) => {
    expect(getPortOpening(FLOOR_PLAN, swapped).rect).toEqual(getPortOpening(FLOOR_PLAN, port).rect);
  });

  it('freezes the opening and its footprint', () => {
    const opening = getPortOpening(FLOOR_PLAN, findPort('corridor', 'kitchen'));

    expect(Object.isFrozen(opening)).toBe(true);
    expect(Object.isFrozen(opening.rect)).toBe(true);
  });

  it('throws when the two spaces join with no wall', () => {
    const noWall = makePort(['stairs', 'corridor'], 'opening', 'z', 4.2, DOOR_WIDTH);

    expect(() => getPortOpening(FLOOR_PLAN, noWall)).toThrow(RangeError);
    expect(() => getPortOpening(FLOOR_PLAN, noWall)).toThrow(/no wall to cut/);
  });
});

describe('needsSwingClearance', () => {
  it('needs clear floor for every swinging leaf, and there are fourteen', () => {
    const swinging = PORT_SCHEDULE.filter((port) => needsSwingClearance(port));

    expect(swinging).toHaveLength(EXPECTED_SWING_CLEARANCE_COUNT);
    expect(swinging.every((port) => port.kind === 'door' && port.swing === undefined)).toBe(true);
  });

  it('exempts the living-room opening, which has no leaf', () => {
    expect(needsSwingClearance(findPort('livingRoom', 'corridor'))).toBe(false);
  });

  it.each(SLIDING_PAIRS)('exempts the sliding leaf %s ↔ %s', (first, second) => {
    const port = findPort(first, second);

    expect(port.swing).toBe('slide');
    expect(needsSwingClearance(port)).toBe(false);
  });

  it('exempts exactly the opening and the four sliding leaves, and nothing else', () => {
    const exempt = PORT_SCHEDULE.filter((port) => !needsSwingClearance(port));

    expect(exempt).toHaveLength(PORT_SCHEDULE.length - EXPECTED_SWING_CLEARANCE_COUNT);
    expect(exempt.filter((port) => port.kind === 'opening')).toHaveLength(1);
    expect(exempt.filter((port) => port.swing === 'slide')).toHaveLength(SLIDING_PAIRS.length);
  });
});

describe('getSwingClearance', () => {
  it.each(EXPECTED_SWINGS)('hangs $label in the $side face of $id', (row) => {
    const [minX, maxX, minZ, maxZ] = row.rect;
    const actual = swingOf(row);
    // The face itself: the rect starts ON the face it is hung in, so that edge
    // is a face of one of the space's own rects. This is the half of the row the
    // derived walls of `walls.mjs` state directly and `getPortContact` infers.
    const hangsInThatFace = getSpace(FLOOR_PLAN, row.id).rects.some(
      (part) => Math.abs(part[row.side] - actual[row.side]) <= LENGTH_TOLERANCE,
    );

    expect(actual.minX).toBeCloseTo(minX, PRECISION_DIGITS);
    expect(actual.maxX).toBeCloseTo(maxX, PRECISION_DIGITS);
    expect(actual.minZ).toBeCloseTo(minZ, PRECISION_DIGITS);
    expect(actual.maxZ).toBeCloseTo(maxZ, PRECISION_DIGITS);
    expect(hangsInThatFace).toBe(true);
  });

  it('pins every face of every swinging leaf, in schedule order, and nothing else', () => {
    const scheduled = PORT_SCHEDULE.filter((port) => needsSwingClearance(port)).flatMap((port) =>
      port.spaces.map((id) => `${port.spaces.join(' ↔ ')} → ${id}`),
    );
    const pinned = EXPECTED_SWINGS.map(({ label, id }) => `${label} → ${id}`);

    expect(pinned).toEqual(scheduled);
    expect(pinned).toHaveLength(EXPECTED_SWING_FACE_COUNT);
  });

  it('gives each leaf a square of its own width', () => {
    const offenders = EXPECTED_SWINGS.filter(({ first, second, id }) => {
      const port = findPort(first, second);
      const rect = getSwingClearance(FLOOR_PLAN, port, id);
      return (
        rect === undefined ||
        Math.abs(rect.maxX - rect.minX - port.width) > LENGTH_TOLERANCE ||
        Math.abs(rect.maxZ - rect.minZ - port.width) > LENGTH_TOLERANCE
      );
    });

    expect(offenders).toEqual([]);
  });

  it('keeps every leaf on the floor of the room it is measured into, but for three', () => {
    const overspilling = EXPECTED_SWINGS.filter((row) => {
      const rect = swingOf(row);
      return Math.abs(coveredArea(row.id, rect) - rectArea(rect)) > LENGTH_TOLERANCE;
    }).map(({ label, id }) => `${label} → ${id}`);

    expect(overspilling).toEqual(KNOWN_OVERSPILL);
  });

  it.each(SLIDING_PAIRS)(
    'gives the sliding leaf %s ↔ %s no floor on either side',
    (first, second) => {
      const port = findPort(first, second);

      expect(getSwingClearance(FLOOR_PLAN, port, first)).toBeUndefined();
      expect(getSwingClearance(FLOOR_PLAN, port, second)).toBeUndefined();
    },
  );

  it('gives the leafless living-room opening no floor on either side', () => {
    const port = findPort('livingRoom', 'corridor');

    expect(getSwingClearance(FLOOR_PLAN, port, 'livingRoom')).toBeUndefined();
    expect(getSwingClearance(FLOOR_PLAN, port, 'corridor')).toBeUndefined();
  });

  it('gives nothing for a space the port does not name', () => {
    expect(
      getSwingClearance(FLOOR_PLAN, findPort('corridor', 'kitchen'), 'laundry'),
    ).toBeUndefined();
  });

  it('freezes the rectangle', () => {
    expect(Object.isFrozen(swingOf(EXPECTED_SWINGS[0]))).toBe(true);
  });
});

describe('getSwingClearances', () => {
  it('lists the six corridor leaves, in schedule order', () => {
    expect(getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor')).toEqual(CORRIDOR_SWINGS);
  });

  it('leaves out the ports that need no floor', () => {
    // The living room has one port and it is the leafless opening; the guest
    // sanitair has two — the room door and the bath door — and both slide.
    expect(getPortsOf(PORT_SCHEDULE, 'livingRoom')).toHaveLength(1);
    expect(getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, 'livingRoom')).toEqual([]);
    expect(getPortsOf(PORT_SCHEDULE, 'guestSanitair')).toHaveLength(2);
    expect(getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, 'guestSanitair')).toEqual([]);
  });

  it('lists nothing for a space with no port', () => {
    expect(getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, 'voidWest')).toEqual([]);
  });

  it('accounts for every face of the pinned inventory across the floor', () => {
    const total = FLOOR_PLAN.spaces.reduce(
      (count, space) => count + getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, space.id).length,
      0,
    );

    expect(total).toBe(EXPECTED_SWING_FACE_COUNT);
  });

  it('freezes the returned list', () => {
    expect(Object.isFrozen(getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor'))).toBe(true);
  });
});

describe('getOpeningClearances', () => {
  it('keeps the living-room band on the room side: z 3.85 − 0.60 = 3.25', () => {
    const bands = getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'livingRoom', OPENING_DEPTH);

    expect(bands).toHaveLength(1);
    expect(bands[0]).toEqual(makeRect(7.5, 11.0, 3.25, 3.85));
  });

  it('keeps the same band on the corridor side: z 4.00 + 0.60 = 4.60', () => {
    const bands = getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor', OPENING_DEPTH);

    expect(bands).toHaveLength(1);
    expect(bands[0]).toEqual(makeRect(7.5, 11.0, 4.0, 4.6));
  });

  it('leaves the television clear of the corridor band, as the plan intends', () => {
    // The one fitting that faces an opening across a room. It is mounted on the
    // corridor's south face at z 5.92–6.00, the far side of a 2.00 m corridor,
    // so the 0.60 band in front of the opening stops well short of it — the
    // arrangement the owner asked for by name, asserted rather than assumed.
    const television = FIXTURES.find((fixture) => fixture.kind === 'tv');
    if (television === undefined) {
      throw new Error('the plan has no television fixture');
    }
    const [band] = getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor', OPENING_DEPTH);
    const rect = makeRect(...television.rect);

    expect(television.room).toBe('corridor');
    expect(rectsOverlap(band, rect)).toBe(false);
    expect(rect.minZ - band.maxZ).toBeCloseTo(TELEVISION_GAP, PRECISION_DIGITS);
  });

  it('lists nothing for a space whose ports all have leaves, and never reads the depth', () => {
    expect(getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'kitchen', 0)).toEqual([]);
  });

  it('throws when the depth is not a positive length', () => {
    expect(() => getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor', 0)).toThrow(
      RangeError,
    );
    expect(() => getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor', 0)).toThrow(
      /depth must be a finite positive number/,
    );
  });

  it('moves the band with the depth and leaves the swing rectangles alone', () => {
    const before = getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor');
    const shallow = getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor', OPENING_DEPTH);
    const deeper = getOpeningClearances(
      FLOOR_PLAN,
      PORT_SCHEDULE,
      'corridor',
      DEEPER_OPENING_DEPTH,
    );
    const after = getSwingClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor');

    expect(shallow[0].maxZ).toBeCloseTo(4.6, PRECISION_DIGITS);
    expect(deeper[0].maxZ).toBeCloseTo(5.2, PRECISION_DIGITS);
    expect(shallow[0]).not.toEqual(deeper[0]);
    // A swing rectangle is the leaf's own width deep, whatever depth was asked
    // of the openings: the two are separate questions and share no state.
    expect(after).toEqual(before);
    expect(after).toEqual(CORRIDOR_SWINGS);
  });

  it('freezes the returned list', () => {
    const bands = getOpeningClearances(FLOOR_PLAN, PORT_SCHEDULE, 'corridor', OPENING_DEPTH);

    expect(Object.isFrozen(bands)).toBe(true);
    expect(Object.isFrozen(bands[0])).toBe(true);
  });
});

describe('getPortsOf', () => {
  it('lists the seven corridor ports', () => {
    expect(getPortsOf(PORT_SCHEDULE, 'corridor')).toHaveLength(EXPECTED_CORRIDOR_PORT_COUNT);
  });

  it('lists nothing for a space with no port', () => {
    expect(getPortsOf(PORT_SCHEDULE, 'voidWest')).toEqual([]);
  });

  it('only returns ports that name the space, in schedule order', () => {
    const ports = getPortsOf(PORT_SCHEDULE, 'kitchen');

    expect(ports).toHaveLength(EXPECTED_KITCHEN_PORT_COUNT);
    expect(ports.every((port) => port.spaces.includes('kitchen'))).toBe(true);
    expect(ports).toEqual(PORT_SCHEDULE.filter((port) => port.spaces.includes('kitchen')));
  });

  it('freezes the returned list', () => {
    expect(Object.isFrozen(getPortsOf(PORT_SCHEDULE, 'corridor'))).toBe(true);
  });
});

describe('getPortPartners', () => {
  it('names the other space of every port, whichever side it is scheduled on', () => {
    expect([...getPortPartners(PORT_SCHEDULE, 'laundry')].sort()).toEqual([
      'balconySlabB',
      'mainSanitair',
    ]);
  });

  it('names nothing for a space with no port', () => {
    expect(getPortPartners(PORT_SCHEDULE, 'voidEast')).toEqual([]);
  });

  it('never names the space itself', () => {
    const offenders = FLOOR_PLAN.spaces.filter((space) =>
      getPortPartners(PORT_SCHEDULE, space.id).includes(space.id),
    );

    expect(offenders).toEqual([]);
  });

  it('freezes the returned list', () => {
    expect(Object.isFrozen(getPortPartners(PORT_SCHEDULE, 'corridor'))).toBe(true);
  });
});
