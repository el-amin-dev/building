/**
 * The fixtures of a floor: the things standing in a room, given their third
 * dimension.
 *
 * The source of truth places every fixture as a **footprint** — a clear rect on
 * the floor, checked room by room by `pnpm verify:plan` (`sourceOfTruth/plan.ts`,
 * brief §7). Nothing in the plan says how tall any of them is, because a
 * footprint is a planning question and a height is a building one. This module
 * answers the second half: for each of the twenty-three {@link PlanFixtureKind}s, how
 * tall the thing is and which low-poly boxes it is drawn as.
 *
 * **The sizes are local constants of this module, on purpose.** `heights.ts` is
 * the single source of truth for the vertical dimensions of the *building* —
 * floor-to-floor, wall, door, railing — and says in as many words that a
 * fitting's own height does not belong there. The precedents are already in the
 * domain: `railings.ts` carries its rail profile and `tvPanel.ts` its panel
 * depth. A basin rim at 0.88 m is the same kind of number, so it lives here,
 * beside the thing it describes, with the reason it was chosen written next to
 * it.
 *
 * **What a fixture is drawn as.** One to three axis-aligned boxes, stacked, each
 * one either the whole footprint or a centred part of it — with one stated
 * exception, `passCounter`, which is five boxes and whose two cheeks are neither
 * the whole footprint nor centred on it. It is the tunnel mouth built out from the
 * food pass, so the gap it leaves between two off-centre boxes IS the thing it is
 * for; see {@link passCounter}. Every other kind still obeys the rule, and
 * `fixtures.test.ts` holds each of them to one-to-three and holds that one to
 * exactly five, so the exception cannot spread quietly. That is enough for the
 * only view that matters — a walking eye at 1.68 m (`person.ts`) — and it needs
 * no external asset, no mesh to load and no licence to check: a bed is a base and
 * a mattress, a cooker is a body and a hob, a washing machine is a body with a
 * door band across it, a wardrobe is one box.
 *
 * Every profile is **orientation-free**, and that is a consequence of the data
 * rather than a preference: {@link FixtureProfile.build} is handed a rect and
 * nothing else, so there is no way to tell a sofa's front from its back or a
 * washing machine's door from its side panel. A part that has to face somewhere
 * is therefore drawn as a band or a centred mass, which is right from every side,
 * instead of being pinned to a guessed face, which would be wrong from half of
 * them.
 *
 * That day came, for one kind, and the facing did NOT come from where this
 * paragraph used to forecast it would. The guess was `PlanFixture.mount`, which
 * knows which wall a fitting backs onto — but `passCounter` needs the axis its
 * BORE runs along, and a mount tells you a wall, not a direction through it. The
 * plan states the axis instead, as `PlanFixture.along`, and `build` takes it as a
 * second argument that every other profile ignores. The reasoning is at
 * `plan.ts`'s `PlanFixture.along`: this unit is 0.70 × 0.75, so reading the bore
 * off the longer side of the rect would hang the whole shape on a 0.05 m margin.
 * If a second kind ever needs a facing, `mount` is still the candidate for a
 * fitting that backs onto a wall — but it was not the answer here.
 *
 * **`getFixtures` never builds the `tv` fixture.** The television already has a
 * domain module: `tvPanel.ts` re-derives the panel from the corridor's south wall
 * face and ignores the fixture's own z on purpose, so that the screen stays flush
 * however the corridor moves. Building it here as well would hang two televisions
 * on one wall. Its profile is still declared below — the table is total over the
 * kinds, and the drawing numbers the television like any other fixture — it is
 * only skipped when the floor is built.
 *
 * Pure geometry, in metres above the finished floor, with the plan conventions of
 * `floorPlan/types.ts`: no rendering, no scene objects, no palette key, nothing
 * mutated.
 */

import { getSpace } from './floorPlan/index.ts';
import type { FloorPlan, Space, SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect, rectDepth, rectWidth, toPlanLength } from './planGeometry.ts';
import type { PlanRect } from './planGeometry.ts';
import { FIXTURES, FIXTURE_ROLES, compareFixturePosition } from './sourceOfTruth/plan.ts';
import type {
  PlanFixture,
  PlanFixtureKind,
  PlanFixtureRole,
  PlanOpeningAxis,
} from './sourceOfTruth/plan.ts';

/** Half of a span: the distance from a rectangle's centre to one of its faces. */
const HALF = 0.5;

/** Level of the finished floor of the storey, in metres: what a fitting stands on. */
const FLOOR_LEVEL = 0;

/**
 * The kind this module leaves to another: the television.
 *
 * `tvPanel.ts` owns it, and owns it from the wall rather than from the fixture's
 * z, so a second box built from the same row would be a second television.
 */
const DERIVED_ELSEWHERE: PlanFixtureKind = 'tv';

/** Matricule tag of a fixture: `W`, `P` and `G` are taken by walls, ports and glazing. */
const FIXTURE_TAG = 'X';

/**
 * The surface family a fixture part is drawn with.
 *
 * A family, not a colour and not a palette key: the domain says a bath is glazed
 * ware and a worktop is a worktop, and the renderer decides what that looks like
 * (`floorMaterials.ts`). Six families rather than twenty-three, because every box that
 * shares one is merged into a single mesh and costs one draw call between them.
 *
 * - `sanitaryWare` — glazed white ceramic: basins, baths, trays, pans;
 * - `appliance` — the enamelled or steel body of a machine;
 * - `joinery` — carcasses, plinths, doors: the made-of-board family;
 * - `worktop` — a horizontal working slab: a counter top, a table top, a hob;
 * - `softFurnishing` — upholstery: a mattress, a seat, a back;
 * - `artwork` — a painted face hung on a wall, which is none of the above.
 */
export type FixtureSurface =
  'sanitaryWare' | 'appliance' | 'joinery' | 'worktop' | 'softFurnishing' | 'artwork';

/** One low-poly box of a fixture, in metres above the finished floor. */
export interface FixturePart {
  /** The box itself: a footprint between two levels. */
  readonly box: PlanBox;
  /** The family the box is drawn with. */
  readonly surface: FixtureSurface;
}

/** How one kind is built: its own sizes, as local constants of this module. */
export interface FixtureProfile {
  /** Overall height above the finished floor, in metres: the top of the tallest part. */
  readonly top: number;
  /** The family of its main body, i.e. what the thing reads as at a glance. */
  readonly surface: FixtureSurface;
  /** Whether this kind makes the room it stands in a wet room. */
  readonly wet: boolean;
  /**
   * Builds the boxes of one placed fixture.
   *
   * @param rect - The footprint the plan gives it. Orientation is unknown: a rect
   *   does not say which face is the front (see the module docblock).
   * @param along - The axis a bore through the fixture runs along, where the plan
   *   states one. Every profile but `passCounter` ignores it, and is written to
   *   take only the rect — the parameter exists so that the ONE kind whose shape
   *   is directional does not have to guess a direction the rect cannot give it.
   * @returns Its frozen parts, lowest first.
   */
  readonly build: (rect: PlanRect, along?: PlanOpeningAxis) => readonly FixturePart[];
}

/** One placed fixture: its footprint, its matricule number, and the boxes it is drawn as. */
export interface BuiltFixture {
  /** What the fixture is. */
  readonly kind: PlanFixtureKind;
  /** The space it stands in. */
  readonly spaceId: SpaceId;
  /** Its X number within that room, counted in plan reading order from 1. */
  readonly index: number;
  /** Its matricule, e.g. `R12/LND-X3`: the space's matricule, then the X number. */
  readonly matricule: string;
  /** The floor it occupies, as the plan draws it. */
  readonly rect: PlanRect;
  /** What distinguishes it from an otherwise identical fixture, when the plan says. */
  readonly note?: string;
  /** The low-poly boxes it is drawn as, lowest first. */
  readonly parts: readonly FixturePart[];
  /** Height of its tallest part above the finished floor, in metres. */
  readonly top: number;
}

/* ------------------------------------------------------------------ *
 * Sizes. Every one of them is a fitting's own dimension, never a
 * building dimension (`heights.ts`), and every one carries its reason.
 * ------------------------------------------------------------------ */

/** Underside of a basin, in metres: the counter slab it is set into starts here. */
const SINK_UNDERSIDE = 0.72;

/** Rim of a basin, in metres: ordinary domestic washing height. */
const SINK_RIM = 0.88;

/** Rim of a bath, in metres: the tub a body steps over. */
const BATH_RIM = 0.55;

/** Top of a shower tray, in metres: a tray is a lip, not a step. */
const SHOWER_TRAY_TOP = 0.1;

/** Top of a WC pan, in metres: seat height. */
const WC_PAN_TOP = 0.42;

/** Top of a WC cistern, in metres: the cistern behind the seat. */
const WC_CISTERN_TOP = 0.78;

/** How much of the pan footprint the cistern keeps: a block sitting on the pan. */
const WC_CISTERN_PART = 0.4;

/**
 * Top of a library: shelving that reads as a wall of books without becoming a wall.
 *
 * Deliberately short of the 2.20 m wardrobes. A library stands in the room the owner looks
 * at rather than in a bedroom corner, and a shelf above eye level is a shelf nobody reaches.
 */
const BOOKCASE_TOP = 1.8;
/** Height of a library's plinth, so the shelving reads as joinery and not as a block. */
const BOOKCASE_PLINTH_TOP = 0.1;
/**
 * Level the bottom of a hung canvas sits at, in metres above the finished floor.
 *
 * Gallery convention hangs a picture's CENTRE near 1.45 m, so a canvas of this size starts
 * a little under 0.90 m — above the library below it rather than behind it.
 */
const ARTWORK_BOTTOM = 0.9;
/** Level the top of a hung canvas reaches: large-scale, as the owner's scheme asks for. */
const ARTWORK_TOP = 2.0;

/** Top of a bed base, in metres: the divan the mattress lies on. */
const BED_BASE_TOP = 0.3;

/** Top of a made bed, in metres: base plus a domestic mattress. */
const BED_TOP = 0.55;

/** How much of the base footprint a mattress keeps: it overhangs nothing, it insets a little. */
const MATTRESS_PART = 0.96;

/** Top of a sofa seat, in metres: sitting height with the cushion on it. */
const SOFA_SEAT_TOP = 0.42;

/** Top of a sofa back, in metres: a back to lean on, low enough to see over. */
const SOFA_TOP = 0.8;

/** How much of the seat's short side the back keeps: a spine along its long axis. */
const SOFA_BACK_PART = 0.4;

/** Underside of a coffee-table top, in metres. */
const COFFEE_TABLE_UNDERSIDE = 0.38;

/** Top of a coffee table, in metres: low enough to reach over from a sofa. */
const COFFEE_TABLE_TOP = 0.42;

/** Underside of a desk or dining top, in metres: knee clearance under the slab. */
const TABLE_UNDERSIDE = 0.7;

/** Top of a desk or dining table, in metres: standard working and eating height. */
const TABLE_TOP = 0.75;

/** How much of the footprint a table's legs keep: a centred base, not four sticks. */
const TABLE_BASE_PART = 0.45;

/** How much of the footprint a desk pedestal keeps: drawers on one side, knees on the other. */
const DESK_PEDESTAL_PART = 0.55;

/** Top of a kitchen carcass, in metres: the cabinet the worktop is laid on. */
const COUNTER_CARCASS_TOP = 0.86;

/** Top of a kitchen worktop, in metres: the standard working height of brief §7. */
const COUNTER_TOP = 0.9;

/**
 * Thickness of a worktop slab, in metres: the stone laid on a carcass.
 *
 * It is the 0.04 m the kitchen counter has always been finished with (0.86 → 0.90),
 * named here because a second thing now has to be finished the same way — the pass
 * ledge a plate is stood on is the far end of the worktop it is handed from, and
 * two literals for one detail is how they drift apart.
 */
const WORKTOP_SLAB = toPlanLength(COUNTER_TOP - COUNTER_CARCASS_TOP);

/**
 * The pass counter, in metres: the unit built out from the guest-room face of the
 * food pass so that a 0.30 m hole becomes a 1.00 m tunnel.
 *
 * Every one of these numbers answers to something already declared, and none of
 * them may drift from it:
 *
 * - the ledge top is the pass window's `sill`, because the ledge IS the sill —
 *   carried 0.70 m out into the room so plates can be stood on it;
 * - the head is the pass window's `head`, so the bore is one straight tunnel
 *   rather than a hole that steps;
 * - the cheek is the masonry jamb the pass leaves at each end of its 0.75 m host
 *   face (0.75 − 0.55, halved), so the built-out mouth lines up with the bore
 *   instead of pinching it or standing proud of it;
 * - the cap is 0.10 of lintel over the bore, which is what stops the tunnel
 *   being an open-topped channel while leaving everything above 1.90 plain wall;
 * - the carcass top is the ledge top less {@link WORKTOP_SLAB}, the same 0.04 m of
 *   stone the kitchen counter is finished with (0.86 → 0.90), because the ledge a
 *   plate is stood on and the worktop it is handed from are one detail.
 *
 * `fixtures.test.ts` pins all four against `WINDOWS`, because four constants
 * quietly agreeing with a window in another file is exactly the kind of
 * agreement that stops being true without anyone noticing.
 */
/** Top of the pass ledge, in metres: the pass window's sill, carried into the room. */
const PASS_COUNTER_LEDGE_TOP = 1.0;

/** Underside of the pass ledge, in metres: its top less one worktop slab. */
const PASS_COUNTER_CARCASS_TOP = toPlanLength(PASS_COUNTER_LEDGE_TOP - WORKTOP_SLAB);

/** Underside of the pass lintel, in metres: the pass window's head. */
const PASS_COUNTER_HEAD = 1.8;

/** Top of the pass counter, in metres: 0.10 of lintel closing the tunnel. */
const PASS_COUNTER_TOP = 1.9;

/** Width of a pass cheek, in metres: the masonry jamb the bore leaves beside it. */
const PASS_COUNTER_CHEEK = 0.1;

/** Top of a sideboard carcass, in metres. */
const SIDEBOARD_CARCASS_TOP = 0.8;

/** Top of a sideboard, in metres: waist height, so the room is still seen over it. */
const SIDEBOARD_TOP = 0.85;

/** Top of a nightstand, in metres: level with a made bed, within arm's reach of it. */
const NIGHTSTAND_TOP = 0.55;

/** Top of a storage unit, in metres: chest height, reachable without a stool. */
const STORAGE_UNIT_TOP = 1.2;

/** Top of a wardrobe, in metres: tall, and still clear of the 2.70 m wall behind it. */
const WARDROBE_TOP = 2.2;

/** Top of a services cabinet, in metres: a meter and consumer-unit enclosure. */
const SERVICES_CABINET_TOP = 1.8;

/** Top of an appliance plinth, in metres: the recess a machine stands back over. */
const PLINTH_TOP = 0.1;

/** Top of a fridge-freezer, in metres: a tall column, its freezer under its fridge. */
const FRIDGE_TOP = 1.75;

/** Top of a cooker body, in metres: the oven under the hob. */
const COOKER_BODY_TOP = 0.88;

/** Top of a cooker, in metres: its hob sits a hair proud of the worktop line. */
const COOKER_TOP = 0.92;

/** Bottom of a washing-machine door band, in metres. */
const WASHING_MACHINE_DOOR_BOTTOM = 0.25;

/** Top of a washing-machine door band, in metres: the drum the door opens onto. */
const WASHING_MACHINE_DOOR_TOP = 0.65;

/** Top of a washing machine, in metres: it slides under a 0.90 m worktop. */
const WASHING_MACHINE_TOP = 0.85;

/** Top of a barbecue base, in metres: the masonry the grill is bedded in. */
const BARBECUE_BASE_TOP = 0.85;

/** Top of a barbecue, in metres: grill bed and its rim, at cooking height. */
const BARBECUE_TOP = 1.0;

/** How much of a machine's footprint its lid or grill bed keeps: a set-back top. */
const APPLIANCE_TOP_PART = 0.9;

/* ------------------------------------------------------------------ *
 * The box vocabulary: full, centred part, centred spine.
 * ------------------------------------------------------------------ */

/**
 * Builds one frozen part.
 *
 * @param rect - Footprint of the box.
 * @param surface - The family it is drawn with.
 * @param bottom - Level of its underside, in metres.
 * @param top - Level of its top, in metres.
 * @returns The frozen {@link FixturePart}.
 * @throws RangeError when the two levels leave no box to draw (`makeBox`).
 */
function part(rect: PlanRect, surface: FixtureSurface, bottom: number, top: number): FixturePart {
  return Object.freeze({ box: makeBox(rect, bottom, top), surface });
}

/**
 * Shrinks a rect towards its own centre, keeping its proportions.
 *
 * The faces are left unrounded: a fraction of a grid length is not itself a whole
 * number of centimetres, and snapping it would push the part off centre — the
 * same reasoning as the rail profile of `railings.ts` and the light panel of
 * `floorLayout.ts`.
 *
 * @param rect - The footprint to shrink.
 * @param fraction - How much of each side to keep, between 0 and 1.
 * @returns A frozen rect centred on `rect`.
 */
function centredPart(rect: PlanRect, fraction: number): PlanRect {
  const centreX = (rect.minX + rect.maxX) * HALF;
  const centreZ = (rect.minZ + rect.maxZ) * HALF;
  const halfWidth = rectWidth(rect) * fraction * HALF;
  const halfDepth = rectDepth(rect) * fraction * HALF;
  return makeRect(
    centreX - halfWidth,
    centreX + halfWidth,
    centreZ - halfDepth,
    centreZ + halfDepth,
  );
}

/**
 * Builds a band running the full length of a rect's longer axis, centred on its
 * shorter one.
 *
 * This is how a part that ought to face somewhere is drawn — a sofa back, say.
 * A footprint does not say which of the two long faces is the front, so the band
 * is centred: right seen from either side, rather than right from one and
 * backwards from the other.
 *
 * @param rect - The footprint to band.
 * @param fraction - How much of the shorter side the band keeps, between 0 and 1.
 * @returns A frozen rect spanning `rect` along its longer axis.
 */
function centredSpine(rect: PlanRect, fraction: number): PlanRect {
  const width = rectWidth(rect);
  const depth = rectDepth(rect);
  if (width >= depth) {
    const centreZ = (rect.minZ + rect.maxZ) * HALF;
    const half = depth * fraction * HALF;
    return makeRect(rect.minX, rect.maxX, centreZ - half, centreZ + half);
  }
  const centreX = (rect.minX + rect.maxX) * HALF;
  const half = width * fraction * HALF;
  return makeRect(centreX - half, centreX + half, rect.minZ, rect.maxZ);
}

/**
 * Builds a profile for a kind drawn as a single box over its whole footprint.
 *
 * @param top - Level of its top, in metres.
 * @param surface - The family it is drawn with.
 * @param wet - Whether it makes its room a wet room.
 * @returns The frozen {@link FixtureProfile}.
 */
function oneBox(top: number, surface: FixtureSurface, wet: boolean): FixtureProfile {
  return Object.freeze({
    top,
    surface,
    wet,
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([part(rect, surface, FLOOR_LEVEL, top)]),
  });
}

/**
 * Builds a profile for a kind drawn as a carcass with a slab laid on it, both
 * over the whole footprint.
 *
 * The two boxes meet face to face rather than overlapping, so their sides are
 * adjacent and never coplanar in the same slice: what reads is a stripe of one
 * family under a stripe of the other, which is exactly what a worktop on a
 * cabinet looks like.
 *
 * @param carcassTop - Level of the top of the carcass, in metres.
 * @param top - Level of the top of the slab, in metres.
 * @param carcassSurface - The family of the carcass below the slab.
 * @param slabSurface - The family of the slab laid on it.
 * @param surface - The family of the main body: which of the two the thing reads
 *   as. A counter is its worktop; a cooker is a machine with a hob on it.
 * @returns The frozen {@link FixtureProfile}.
 */
function slabOnCarcass(
  carcassTop: number,
  top: number,
  carcassSurface: FixtureSurface,
  slabSurface: FixtureSurface,
  surface: FixtureSurface,
): FixtureProfile {
  return Object.freeze({
    top,
    surface,
    wet: false,
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, carcassSurface, FLOOR_LEVEL, carcassTop),
        part(rect, slabSurface, carcassTop, top),
      ]),
  });
}

/**
 * Builds the pass counter: a ledge with a tunnel mouth standing on it.
 *
 * This is the ONE profile whose parts are not concentric, and the one that needs
 * to know which way it faces. Both exceptions have the same cause. A wall in this
 * model is the gap between two room rects and its thickness is one number for its
 * whole height (`walls.ts`), so "1.00 m thick up to the pass head, 0.30 m above it"
 * is not a wall that can be declared — the owner asked for exactly that, and the
 * missing 0.70 m is therefore built out as a fixture standing against the wall.
 *
 * Five boxes, and the bore is the space between them:
 *
 *   carcass   floor → 0.96   joinery   the whole footprint
 *   ledge     0.96  → 1.00   worktop   the whole footprint — plates stand here
 *   cheek ×2  1.00  → 1.80   joinery   a 0.10 band at each end of the cross axis
 *   lintel    1.80  → 1.90   joinery   the whole footprint, closing the top
 *
 * The gap the two cheeks leave between them is the tunnel, and it lines up with
 * the masonry bore behind it because the cheek is the same 0.10 the window's jamb
 * is. Above 1.90 there is nothing: plain wall, which was the point.
 *
 * @param along - The axis the bore runs along, from the plan. The cheeks stand at
 *   the two ends of the OTHER axis. It is a parameter and not a deduction because
 *   this unit is 0.70 × 0.75 m: reading the bore off the longer side of the rect
 *   would hang the whole shape on a 0.05 m margin, and a centimetre's edit
 *   somewhere else would silently rotate the tunnel through 90°.
 * @returns The frozen {@link FixtureProfile}.
 */
function passCounter(): FixtureProfile {
  return Object.freeze({
    top: PASS_COUNTER_TOP,
    surface: 'joinery' as const,
    wet: false,
    build: (rect: PlanRect, along?: PlanOpeningAxis): readonly FixturePart[] => {
      // Both of these refuse rather than guess, and both refuse something that the
      // types allow. `along` is optional on PlanFixture because 22 of the 23 kinds
      // have no bore; left off HERE it would have silently bored along x, so a
      // second pass counter added without it would have come out at right angles to
      // its own window with nothing to say so. And `makeRect` does no min/max
      // check, so a footprint narrower than two cheeks would fold the cheeks
      // through each other into negative-width boxes.
      if (along === undefined) {
        throw new RangeError(
          'a passCounter needs `along`: the plan must state which axis its bore runs along, because a 0.70 × 0.75 rect cannot be asked',
        );
      }
      const across = along === 'z' ? rectWidth(rect) : rectDepth(rect);
      if (across <= 2 * PASS_COUNTER_CHEEK) {
        throw new RangeError(
          `a passCounter is ${String(across)} m across its bore, which two ${String(PASS_COUNTER_CHEEK)} m cheeks cannot leave an opening in`,
        );
      }
      // Snapped, not merely added. `6.3 + 0.1` is 6.399999999999999 in binary
      // floating point, and the cheek's inner edge has to land on the pass
      // window's own 6.40 for the built-out mouth and the masonry bore to be one
      // straight tunnel. `LENGTH_TOLERANCE` would forgive the difference in a
      // comparison; the geometry handed to the renderer should not need forgiving.
      const nearCheek = toPlanLength((along === 'z' ? rect.minX : rect.minZ) + PASS_COUNTER_CHEEK);
      const farCheek = toPlanLength((along === 'z' ? rect.maxX : rect.maxZ) - PASS_COUNTER_CHEEK);
      const cheeks: readonly PlanRect[] =
        along === 'z'
          ? [
              makeRect(rect.minX, nearCheek, rect.minZ, rect.maxZ),
              makeRect(farCheek, rect.maxX, rect.minZ, rect.maxZ),
            ]
          : [
              makeRect(rect.minX, rect.maxX, rect.minZ, nearCheek),
              makeRect(rect.minX, rect.maxX, farCheek, rect.maxZ),
            ];
      return Object.freeze([
        part(rect, 'joinery', FLOOR_LEVEL, PASS_COUNTER_CARCASS_TOP),
        part(rect, 'worktop', PASS_COUNTER_CARCASS_TOP, PASS_COUNTER_LEDGE_TOP),
        ...cheeks.map((cheek) => part(cheek, 'joinery', PASS_COUNTER_LEDGE_TOP, PASS_COUNTER_HEAD)),
        part(rect, 'joinery', PASS_COUNTER_HEAD, PASS_COUNTER_TOP),
      ]);
    },
  });
}

/**
 * Builds a profile for a table: a centred base under a top slab spanning the
 * whole footprint.
 *
 * Four legs are four boxes for something that reads, from a walking eye, as a
 * shadow under a slab; one centred base says the same thing in one box.
 *
 * @param underside - Level of the underside of the top slab, in metres.
 * @param top - Level of the top, in metres.
 * @param basePart - How much of the footprint the base keeps, between 0 and 1.
 * @returns The frozen {@link FixtureProfile}.
 */
function table(underside: number, top: number, basePart: number): FixtureProfile {
  return Object.freeze({
    top,
    surface: 'worktop' as const,
    wet: false,
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(centredPart(rect, basePart), 'joinery', FLOOR_LEVEL, underside),
        part(rect, 'worktop', underside, top),
      ]),
  });
}

/**
 * Builds a profile for a machine standing on a plinth: a recessed joinery plinth
 * under the body that is delivered and plugged in.
 *
 * @param top - Level of the top of the body, in metres.
 * @returns The frozen {@link FixtureProfile}.
 */
function plinthedAppliance(top: number): FixtureProfile {
  return Object.freeze({
    top,
    surface: 'appliance' as const,
    wet: false,
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, 'joinery', FLOOR_LEVEL, PLINTH_TOP),
        part(rect, 'appliance', PLINTH_TOP, top),
      ]),
  });
}

/* ------------------------------------------------------------------ *
 * The table itself.
 * ------------------------------------------------------------------ */

/**
 * How each of the twenty fixture kinds is built, as a TOTAL record over
 * {@link PlanFixtureKind}.
 *
 * Total is the whole point, and the technique is the one `FIXTURE_ROLES` already
 * uses in the source of truth: the `Readonly<Record<PlanFixtureKind, …>>` the
 * literal is both annotated with and checked against makes TypeScript fail the
 * build the moment a kind joins the union without being given a profile here. A
 * lookup that could return `undefined` would instead let a new kind reach the
 * renderer as an invisible fixture, which is the one failure nobody would report.
 *
 * The three sanitary levels below are carried over unchanged from the
 * `SANITARY_FIXTURE_LEVELS` map of `ui/floorLayout.ts`, which this module
 * replaces: two committed screenshot baselines are pinned on those exact
 * numbers, so moving a basin rim by a centimetre is a change to the pinned
 * frames and not a tidy-up.
 */
export const FIXTURE_PROFILES: Readonly<Record<PlanFixtureKind, FixtureProfile>> = Object.freeze({
  // Plumbed in. These four are what makes a room a wet room.
  sink: Object.freeze({
    top: SINK_RIM,
    surface: 'sanitaryWare' as const,
    wet: true,
    // One box, from the underside of the counter slab to its rim: a basin set
    // into a slab, exactly as `floorLayout.ts` drew it. It is the one profile
    // that does not start at the floor, because a wash basin does not.
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([part(rect, 'sanitaryWare', SINK_UNDERSIDE, SINK_RIM)]),
  }),
  bath: oneBox(BATH_RIM, 'sanitaryWare', true),
  shower: oneBox(SHOWER_TRAY_TOP, 'sanitaryWare', true),
  wc: Object.freeze({
    top: WC_CISTERN_TOP,
    surface: 'sanitaryWare' as const,
    wet: true,
    // A pan over the whole footprint, and the cistern as a block sitting on it:
    // centred, because the footprint does not say which face the seat opens to.
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, 'sanitaryWare', FLOOR_LEVEL, WC_PAN_TOP),
        part(centredPart(rect, WC_CISTERN_PART), 'sanitaryWare', WC_PAN_TOP, WC_CISTERN_TOP),
      ]),
  }),
  // Worktops: a slab is what you see, whatever holds it up.
  counter: slabOnCarcass(COUNTER_CARCASS_TOP, COUNTER_TOP, 'joinery', 'worktop', 'worktop'),
  passCounter: passCounter(),
  desk: table(TABLE_UNDERSIDE, TABLE_TOP, DESK_PEDESTAL_PART),
  diningTable: table(TABLE_UNDERSIDE, TABLE_TOP, TABLE_BASE_PART),
  coffeeTable: table(COFFEE_TABLE_UNDERSIDE, COFFEE_TABLE_TOP, TABLE_BASE_PART),
  // Machines: delivered, connected, replaceable.
  fridge: plinthedAppliance(FRIDGE_TOP),
  cooker: slabOnCarcass(COOKER_BODY_TOP, COOKER_TOP, 'appliance', 'worktop', 'appliance'),
  washingMachine: Object.freeze({
    top: WASHING_MACHINE_TOP,
    surface: 'appliance' as const,
    wet: false,
    // Body, door, lid. The door is a band right round the machine rather than a
    // panel on one face: a rect does not say which way the drum opens, and a
    // guessed face would open into the wall half the time.
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, 'appliance', FLOOR_LEVEL, WASHING_MACHINE_DOOR_BOTTOM),
        part(rect, 'joinery', WASHING_MACHINE_DOOR_BOTTOM, WASHING_MACHINE_DOOR_TOP),
        part(rect, 'appliance', WASHING_MACHINE_DOOR_TOP, WASHING_MACHINE_TOP),
      ]),
  }),
  barbecue: Object.freeze({
    top: BARBECUE_TOP,
    surface: 'appliance' as const,
    wet: false,
    // A masonry base with the grill bed set back on top of it.
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, 'joinery', FLOOR_LEVEL, BARBECUE_BASE_TOP),
        part(centredPart(rect, APPLIANCE_TOP_PART), 'appliance', BARBECUE_BASE_TOP, BARBECUE_TOP),
      ]),
  }),
  // The television: declared for totality and for the drawing's numbering, never
  // built by `getFixtures`. The levels mirror `tvPanel.ts`, which owns it.
  tv: Object.freeze({
    top: FLOOR_HEIGHTS.door,
    surface: 'appliance' as const,
    wet: false,
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([part(rect, 'appliance', FLOOR_HEIGHTS.railing, FLOOR_HEIGHTS.door)]),
  }),
  // Loose furniture.
  bed: Object.freeze({
    top: BED_TOP,
    surface: 'softFurnishing' as const,
    wet: false,
    // A divan base with the mattress just inside its faces, which is what gives
    // the bed a visible edge instead of one 0.55 m block.
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, 'joinery', FLOOR_LEVEL, BED_BASE_TOP),
        part(centredPart(rect, MATTRESS_PART), 'softFurnishing', BED_BASE_TOP, BED_TOP),
      ]),
  }),
  bookcase: Object.freeze({
    top: BOOKCASE_TOP,
    surface: 'joinery' as const,
    wet: false,
    // A plinth and the shelving above it: two boxes rather than one, so the thing has a
    // base line at the floor the way real joinery does.
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, 'joinery', FLOOR_LEVEL, BOOKCASE_PLINTH_TOP),
        part(rect, 'joinery', BOOKCASE_PLINTH_TOP, BOOKCASE_TOP),
      ]),
  }),
  artwork: Object.freeze({
    top: ARTWORK_TOP,
    surface: 'artwork' as const,
    wet: false,
    // One thin box hung on a wall. A canvas has no depth worth modelling, so its footprint
    // is the face it lies flat against and its LEVELS are what place it, not its rect.
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([part(rect, 'artwork', ARTWORK_BOTTOM, ARTWORK_TOP)]),
  }),
  sofa: Object.freeze({
    top: SOFA_TOP,
    surface: 'softFurnishing' as const,
    wet: false,
    // A seat over the whole footprint and a back along its long axis, centred
    // for want of a front (see the module docblock).
    build: (rect: PlanRect): readonly FixturePart[] =>
      Object.freeze([
        part(rect, 'softFurnishing', FLOOR_LEVEL, SOFA_SEAT_TOP),
        part(centredSpine(rect, SOFA_BACK_PART), 'softFurnishing', SOFA_SEAT_TOP, SOFA_TOP),
      ]),
  }),
  sideboard: slabOnCarcass(SIDEBOARD_CARCASS_TOP, SIDEBOARD_TOP, 'joinery', 'worktop', 'joinery'),
  nightstand: oneBox(NIGHTSTAND_TOP, 'joinery', false),
  storageUnit: oneBox(STORAGE_UNIT_TOP, 'joinery', false),
  wardrobe: oneBox(WARDROBE_TOP, 'joinery', false),
  // The building's own equipment.
  servicesCabinet: oneBox(SERVICES_CABINET_TOP, 'joinery', false),
} satisfies Readonly<Record<PlanFixtureKind, FixtureProfile>>);

/**
 * Rejects a fitting that reaches the storey it stands in.
 *
 * A fixture taller than the wall it backs onto is a mistake in this table, not a
 * box to clip quietly: it would push through the ceiling of the interior view and
 * read as a bug in the renderer rather than as a wrong number here. The limit is
 * the production wall height, because a fitting's own size is not a floor height
 * (`heights.ts`) and `getFixtures` therefore takes no heights to scale it by.
 *
 * Exported so that the guard itself can be tested: every profile in
 * {@link FIXTURE_PROFILES} clears it by construction, so a suite that could only
 * reach it through the table could never see it fail.
 *
 * @param kind - What the fixture is, for the message.
 * @param top - Level of the top of the fixture or of one of its parts, in metres.
 * @throws RangeError naming the kind and the two numbers when `top` is not a
 *   finite height below the wall.
 */
export function assertFixtureFitsStorey(kind: string, top: number): void {
  if (!Number.isFinite(top) || top <= FLOOR_LEVEL || top >= FLOOR_HEIGHTS.wall) {
    throw new RangeError(
      `the ${kind} rises to ${String(top)} m, which must be above 0 and below the ${String(FLOOR_HEIGHTS.wall)} m wall it stands against`,
    );
  }
}

/**
 * Builds one placed fixture.
 *
 * @param space - The space it stands in, which gives it its matricule.
 * @param fixture - The row of the source of truth.
 * @param index - Its X number within that room, counted from 1.
 * @returns The frozen {@link BuiltFixture}.
 * @throws RangeError naming the fixture when its kind has no profile, when its
 *   footprint has no width or no depth, or when it reaches the storey
 *   ({@link assertFixtureFitsStorey}).
 */
function buildFixture(space: Space, fixture: PlanFixture, index: number): BuiltFixture {
  const matricule = `${space.matricule}-${FIXTURE_TAG}${String(index)}`;
  const profile: FixtureProfile | undefined = FIXTURE_PROFILES[fixture.kind];
  if (profile === undefined) {
    throw new RangeError(`fixture ${matricule} has kind "${fixture.kind}", which has no profile`);
  }
  const rect = makeRect(...fixture.rect);
  if (rectWidth(rect) <= LENGTH_TOLERANCE || rectDepth(rect) <= LENGTH_TOLERANCE) {
    throw new RangeError(
      `fixture ${matricule} has no footprint: ${String(rectWidth(rect))} × ${String(rectDepth(rect))} m`,
    );
  }
  assertFixtureFitsStorey(fixture.kind, profile.top);
  const parts: readonly FixturePart[] = Object.freeze(profile.build(rect, fixture.along));
  parts.forEach((piece) => {
    assertFixtureFitsStorey(fixture.kind, piece.box.top);
  });
  return Object.freeze({
    kind: fixture.kind,
    spaceId: space.id,
    index,
    matricule,
    rect,
    ...(fixture.note === undefined ? {} : { note: fixture.note }),
    parts,
    top: profile.top,
  });
}

/**
 * Builds every fixture of a plan.
 *
 * The fixtures of a room are numbered by {@link compareFixturePosition}, the
 * plan's own reading order, imported rather than rewritten so that this module
 * and the generated drawing agree about which basin is `X3` — an X number is part
 * of a matricule, and two orderings would mean two answers to the same name. The
 * numbering counts **every** fixture of the room, the television included, and
 * only then drops the television: the drawing numbers it like anything else, so
 * skipping it before counting would renumber every fixture behind it.
 *
 * The result is in plan order — the order of `plan.spaces`, then reading order
 * within each room — which is the order the rest of the domain lists things in.
 *
 * `kind: 'tv'` is skipped, and that is the point of the paragraph above: the
 * panel is re-derived from the corridor's south wall by `tvPanel.ts`, which
 * ignores the fixture's own z, so building it here as well would hang two
 * televisions on one wall.
 *
 * @param plan - The floor plan the fixtures stand in; not mutated.
 * @param fixtures - The fixture rows of the source of truth; defaults to
 *   `FIXTURES`. Not mutated.
 * @returns A frozen array of frozen fixtures, each with frozen parts.
 * @throws RangeError naming the fixture when it stands in a space the plan does
 *   not hold (`getSpace`), when its kind has no profile, when its footprint has
 *   no width or no depth, or when it reaches the storey
 *   ({@link assertFixtureFitsStorey}).
 */
export function getFixtures(
  plan: FloorPlan,
  fixtures: readonly PlanFixture[] = FIXTURES,
): readonly BuiltFixture[] {
  const byRoom = new Map<SpaceId, PlanFixture[]>();
  fixtures.forEach((fixture) => {
    // Resolved for every row, the television included, so that a fixture placed
    // in a room this plan does not have fails loudly rather than vanishing from
    // a walk over `plan.spaces`.
    const space = getSpace(plan, fixture.room);
    const placed = byRoom.get(space.id);
    if (placed === undefined) {
      byRoom.set(space.id, [fixture]);
    } else {
      placed.push(fixture);
    }
  });
  return Object.freeze(
    plan.spaces.flatMap((space) =>
      [...(byRoom.get(space.id) ?? [])]
        .sort(compareFixturePosition)
        .map((fixture, position) => ({ fixture, index: position + 1 }))
        .filter(({ fixture }) => fixture.kind !== DERIVED_ELSEWHERE)
        .map(({ fixture, index }) => buildFixture(space, fixture, index)),
    ),
  );
}

/**
 * Picks the fixtures standing in one space.
 *
 * @param built - The fixtures of the floor, as {@link getFixtures} built them.
 * @param id - Identifier of the space to look in.
 * @returns A frozen array of the fixtures of that space, in plan reading order;
 *   empty when the space is unfurnished.
 */
export function getFixturesOf(
  built: readonly BuiltFixture[],
  id: SpaceId,
): readonly BuiltFixture[] {
  return Object.freeze(built.filter((fixture) => fixture.spaceId === id));
}

/**
 * Tells whether a space is a wet room.
 *
 * A wet room is not a space kind and not a flag on the plan: the two bathrooms
 * and the four bath and shower cubicles are all ordinary `room` spaces, so
 * nothing about a space says it is tiled. What says it is the furniture — a room
 * with a basin, a bath, a tray or a pan in it is wet, and one without is not —
 * which is why the answer is derived from the fixtures rather than from a list of
 * room ids somebody has to keep up to date.
 *
 * @param built - The fixtures of the floor, as {@link getFixtures} built them.
 * @param id - Identifier of the space to test.
 * @returns `true` when at least one fixture of that space is of a kind whose
 *   profile is `wet`.
 */
export function isWetSpace(built: readonly BuiltFixture[], id: SpaceId): boolean {
  return built.some((fixture) => fixture.spaceId === id && FIXTURE_PROFILES[fixture.kind].wet);
}

/**
 * The roles that mean a service runs to the thing: plumbed, powered, or a riser.
 *
 * `furniture` is out because it is loose, and `joinery` because it is dry — a
 * wardrobe and a pass counter are both just carpentry standing on the floor, and
 * neither is a reason to lay marble instead of carpet.
 *
 * A frozen array and not a `Set`, which is the shape it was first written as:
 * `Object.freeze` seals a Set's own properties and leaves its contents writable,
 * so `SERVICING_ROLES.add('joinery')` would have succeeded at runtime and re-laid
 * the guest room's floor in marble for the rest of the process. A `ReadonlySet`
 * type says otherwise and cannot enforce it. Three members do not need a hash.
 */
export const SERVICING_ROLES: readonly PlanFixtureRole[] = Object.freeze([
  'fitting',
  'appliance',
  'services',
] as const);

/**
 * Tells whether a space is serviced: whether anything in it is plumbed, powered
 * or a riser, rather than merely standing there.
 *
 * The broader sibling of {@link isWetSpace}, and it exists because a floor
 * finish answers a broader question than a wet room does. A kitchen is not a wet
 * room on this floor — it has no basin, only a counter, a cooker and a fridge —
 * and a control center is not either, holding one services cabinet. Neither
 * should be carpeted, and neither is distinguishable by space kind: all three of
 * them are ordinary `room` spaces, exactly as the bathrooms are.
 *
 * So the question is asked of `FIXTURE_ROLES`, the plan's own classification of
 * what a kind IS. That keeps it derived from the plan: a cooker added to a room
 * makes the room serviced with no list to edit, and a kind invented tomorrow
 * cannot dodge the question, because `FIXTURE_ROLES` is total over the kind union
 * and will not compile until somebody classifies it.
 *
 * It asks for the roles that CARRY something, and this used to be written the
 * other way round — "anything that is not furniture" — which is not the same
 * sentence once a role exists for a thing that is built in and dry. The guest
 * room's pass counter is exactly that, and under the old wording it laid a
 * bathroom floor in a sitting room (owner, 2026-09-19). Naming the three roles
 * that mean a service also makes the omission visible: `joinery` is left out
 * deliberately and `SERVICING_ROLES` is pinned in the tests, so a fourth role
 * invented later has to be argued about rather than swept in by a negation.
 *
 * @param built - The fixtures of the floor, as {@link getFixtures} built them.
 * @param id - Identifier of the space to test.
 * @returns `true` when at least one fixture of that space has a servicing role.
 */
export function isServicedSpace(built: readonly BuiltFixture[], id: SpaceId): boolean {
  return built.some(
    (fixture) => fixture.spaceId === id && SERVICING_ROLES.includes(FIXTURE_ROLES[fixture.kind]),
  );
}
