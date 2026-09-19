/**
 * Two claims the building has always made about itself, and the one it does not.
 *
 * Brief §7.5 sizes the corridor at 1.50 m "chosen so a fridge (~0.90 m) or a
 * washing machine can be carried through with clearance". ADR-010 spends 0.03 m
 * of going — the stair went from a 0.28 to a 0.25 m tread — on a second
 * 1.00 × 2.00 m landing, explicitly so that an appliance can be turned in it.
 * Neither had ever been measured. Both come out true, and this file is where
 * they are now checked against the plan rather than against the prose:
 *
 * - the corridor's main run measures **1.50 m clear** off the walk field the
 *   page actually walks in, and the 39 built fixtures take nothing off it (the
 *   corridor is deliberately unfurnished — `sourceOfTruth/plan.ts` says so);
 * - the 1.00 × 2.00 m east landing turns the fridge: it fits either way round
 *   and its 1.140 m diagonal clears the 2.00 m side with 0.86 m to spare.
 *
 * **And the claim the building does not make.** Every door an appliance must
 * pass on the way in is exactly 0.90 m, and the fridge is 0.90 m wide. That is
 * zero clearance, so the fridge goes through on its 0.70 m depth and upright
 * only with the leaf taken off its hinges. Brief §7.5 only ever promised
 * clearance for the CORRIDOR, and the assertions below say exactly that and no
 * more: they measure the leaves and state the consequence, rather than reporting
 * a pass that a reader would take for a promise the floor never made.
 *
 * The suite reads `WALK_FIELD` and `BUILT_FLOOR` from `ui/floorInstance.ts`
 * rather than re-deriving them. The question being asked is about the building
 * as it is shipped, and `floorInstance.ts` is the one place that derivation
 * happens (`exteriorFraming.test.ts` reaches across for the same reason).
 */

import { describe, expect, it } from 'vitest';
import { BUILT_FLOOR, WALK_FIELD } from '../ui/floorInstance.ts';
import { canTurn, getApplianceFootprint, getClearWidth } from './applianceRoute.ts';
import type { ApplianceFootprint } from './applianceRoute.ts';
import { makeWalkField } from './collision.ts';
import type { WalkField } from './collision.ts';
import { FLOOR_PLAN, getSpace } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import { getFixtures } from './fixtures.ts';
import { LENGTH_TOLERANCE, makeRect, rectWidth } from './planGeometry.ts';
import type { PlanPoint, PlanRect } from './planGeometry.ts';
import { PORT_SCHEDULE, getPortsOf } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { findSpaceRoute } from './reachability.ts';
import { FIXTURE_ROLES, STAIRS } from './sourceOfTruth/plan.ts';
import type { PlanFixture } from './sourceOfTruth/plan.ts';

const PRECISION_DIGITS = 9;
const HALF = 0.5;

/** Width of the corridor as brief §7.5 sizes it, in metres, and why it is that. */
const CORRIDOR_WIDTH = 1.5;

/** The fridge's larger plan dimension, in metres: the "~0.90 m" of brief §7.5. */
const FRIDGE_WIDTH = 0.9;

/** Its smaller one, in metres: the side it is turned onto to pass an opening. */
const FRIDGE_DEPTH = 0.7;

/** √(0.90² + 0.70²) = √1.30, in metres: the longest reach of the fridge mid-turn. */
const FRIDGE_DIAGONAL = 1.140175425;

/** The clear width of every leaf on the appliance route, in metres (see the header). */
const ROUTE_DOOR_WIDTH = 0.9;

/** The east landing's short side, in metres: one flight width (ADR-010). */
const LANDING_SHORT_SIDE = 1;

/** Its long side, in metres: "a landing turning 180° must be at least as long as the flight is wide". */
const LANDING_LONG_SIDE = 2;

/**
 * An appliance 1.10 m on BOTH sides: a crate that cannot be turned edge-on.
 *
 * Square on purpose. A 1.10 × 0.70 box would pass a 0.90 leaf on its depth like
 * the fridge does, so it would prove nothing about the doorway — the guard has to
 * be something whose NARROW side is over 0.90.
 */
const OVERSIZE_SIDE = 1.1;

/** A 1.00 m run of furniture, the length of a sideboard, pushed into the corridor. */
const INTRUDER_LENGTH = 1;

/** How far it sticks out, in metres: 1.50 − 1.40, the least that breaks the claim. */
const INTRUSION_DEPTH = 0.1;

/** Where the explorer arrives on the floor: the stair's own arrival, never a typed point. */
const ARRIVAL: PlanPoint = Object.freeze({
  x: BUILT_FLOOR.stairs.arrival.x,
  z: BUILT_FLOOR.stairs.arrival.z,
});

/** The fridge, read off the floor as it is built. */
const FRIDGE: ApplianceFootprint = getApplianceFootprint(BUILT_FLOOR.fixtures, 'fridge');

/** The east landing, taken from the key ADR-010 names it by. */
const LANDING_EAST: PlanRect = makeRect(...STAIRS.landingEast);

/** A square landing of one flight width: big enough to stand the fridge on, either way round. */
const SQUARE_LANDING: PlanRect = makeRect(0, LANDING_SHORT_SIDE, 0, LANDING_SHORT_SIDE);

/**
 * The corridor's main run: the rect that reaches from the stair landing to the
 * far end of the floor.
 *
 * Picked as the longest of the corridor's rects rather than by index, so that
 * adding a third rect to the corridor cannot silently move the measurement onto
 * the 0.50 m deep stair-hall widening, which is not a passage anything is
 * carried along.
 */
const CORRIDOR_RUN: PlanRect = getSpace(FLOOR_PLAN, 'corridor').rects.reduce((longest, rect) =>
  rectWidth(rect) > rectWidth(longest) ? rect : longest,
);

/** Middle of that run, in metres: where the mutation guard puts its obstruction. */
const RUN_MIDDLE = (CORRIDOR_RUN.minX + CORRIDOR_RUN.maxX) * HALF;

/**
 * The walk field with every built fixture added as a blocker.
 *
 * `getWalkField` sweeps slabs, walls and railings only, and `builtFloor.ts` says
 * why: a bed at a room's centre would wedge the route follower against a blocker
 * it had been told to walk into. So the shipped field cannot see furniture at
 * all, and measuring the corridor in it would answer a question about masonry
 * while looking like an answer about furniture. This field is what actually
 * settles "did the furnishing narrow the corridor".
 */
const FURNISHED_FIELD: WalkField = makeWalkField(WALK_FIELD.floor, [
  ...WALK_FIELD.blockers,
  ...BUILT_FLOOR.fixtures.map((fixture) => fixture.rect),
]);

/** The same corridor with a sideboard against its south wall: 1.50 drawn, 1.40 clear. */
const NARROWED_FIELD: WalkField = makeWalkField(WALK_FIELD.floor, [
  ...WALK_FIELD.blockers,
  makeRect(
    RUN_MIDDLE - INTRUDER_LENGTH * HALF,
    RUN_MIDDLE + INTRUDER_LENGTH * HALF,
    CORRIDOR_RUN.maxZ - INTRUSION_DEPTH,
    CORRIDOR_RUN.maxZ,
  ),
]);

/**
 * Every space holding a delivered appliance, derived from `FIXTURE_ROLES`.
 *
 * Not a typed list of rooms: `FIXTURE_ROLES` is total over `PlanFixtureKind`, so
 * a new appliance kind put in a new room joins this list without anybody
 * remembering to add it here, and the routes below are then checked for it.
 */
const APPLIANCE_ROOMS: readonly SpaceId[] = Object.freeze([
  ...new Set(
    BUILT_FLOOR.fixtures
      .filter((fixture) => FIXTURE_ROLES[fixture.kind] === 'appliance')
      .map((fixture) => fixture.spaceId),
  ),
]);

/** One step of a route: the two spaces, and the port between them when there is one. */
interface RouteStep {
  /** The space stepped out of. */
  readonly from: SpaceId;
  /** The space stepped into. */
  readonly to: SpaceId;
  /** The port crossed, or `undefined` on a zero-gap join, which has none. */
  readonly port: Port | undefined;
}

/**
 * One door an appliance has to pass, measured by hand off the port schedule.
 *
 * The five of them: the fridge's own leaf, the two the washing machine passes on
 * its way through the main sanitair, and both side-B balcony doors, which are the
 * other way in — a machine hoisted onto the slab rather than carried up the
 * stair still has to get off it.
 */
interface ExpectedDoor {
  /** The two spaces the leaf joins, as the schedule names them. */
  readonly spaces: readonly [SpaceId, SpaceId];
  /** Its clear width, in metres. */
  readonly width: number;
}

/** Every leaf on an appliance route, and every one of them 0.90 m (see the header). */
const EXPECTED_APPLIANCE_DOORS: readonly ExpectedDoor[] = [
  { spaces: ['corridor', 'kitchen'], width: ROUTE_DOOR_WIDTH },
  { spaces: ['corridor', 'mainSanitair'], width: ROUTE_DOOR_WIDTH },
  { spaces: ['laundry', 'mainSanitair'], width: ROUTE_DOOR_WIDTH },
  { spaces: ['kitchen', 'balconySlabB'], width: ROUTE_DOOR_WIDTH },
  { spaces: ['laundry', 'balconySlabB'], width: ROUTE_DOOR_WIDTH },
];

/**
 * The one step of the floor that crosses no port: the stair landing into the
 * corridor.
 *
 * A `JOIN_OVERRIDE` of thickness 0, not a door — the owner's demountable panel
 * there is deliberately not modelled (brief §4.2). It is named so that a step
 * losing its port shows up as a failure rather than as a door quietly dropping
 * out of the count.
 */
const ZERO_GAP_STEP: readonly [SpaceId, SpaceId] = ['stairs', 'corridor'];

/**
 * Finds the port crossed at each step of a space route.
 *
 * @param route - A space sequence, as `findSpaceRoute` returns it.
 * @returns One entry per step, in route order; `port` is `undefined` where the
 *   two spaces meet on a zero-gap join instead of through the schedule.
 */
function getRouteSteps(route: readonly SpaceId[]): readonly RouteStep[] {
  return route.slice(1).map((to, index) => {
    const from = route[index];
    return {
      from,
      to,
      port: PORT_SCHEDULE.find(
        (candidate) => candidate.spaces.includes(from) && candidate.spaces.includes(to),
      ),
    };
  });
}

/**
 * Names a port the way the expectation table does.
 *
 * @param port - The port to name.
 * @returns Its two spaces joined, e.g. `corridor ↔ kitchen`.
 */
function nameOf(port: Port): string {
  return `${port.spaces[0]} ↔ ${port.spaces[1]}`;
}

/**
 * Whether an appliance passes an opening of a given clear width.
 *
 * Its NARROW side, because a rigid box is turned edge-on to go through a
 * doorway — which is the whole reason the fridge passes a leaf exactly as wide
 * as the fridge is. Deliberately not in `applianceRoute.ts`: one comparison
 * carrying a stated assumption belongs beside the assertion that leans on it.
 *
 * @param item - The appliance's footprint.
 * @param clear - Clear width of the opening, in metres.
 * @returns `true` when the item's smaller side fits the opening.
 */
function passesOpening(item: ApplianceFootprint, clear: number): boolean {
  return Math.min(item.width, item.depth) <= clear + LENGTH_TOLERANCE;
}

/**
 * Places one fixture row, as the source of truth writes them.
 *
 * @param rect - Its footprint as `[minX, maxX, minZ, maxZ]`, in metres.
 * @returns A single-row fixture list holding a fridge of that size in the kitchen.
 */
function onlyFridge(rect: PlanFixture['rect']): readonly PlanFixture[] {
  return Object.freeze([{ kind: 'fridge', room: 'kitchen', rect, mount: 'standing' } as const]);
}

/** The routes from the stair arrival to every appliance room, derived once. */
const APPLIANCE_ROUTES: readonly { readonly room: SpaceId; readonly route: readonly SpaceId[] }[] =
  APPLIANCE_ROOMS.map((room) => ({
    room,
    route: findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, ARRIVAL, room),
  }));

describe('the route an appliance takes', () => {
  describe('the footprint, read off the fixture', () => {
    it('measures the fridge 0.90 × 0.70 off its own rect', () => {
      expect(FRIDGE.width).toBeCloseTo(FRIDGE_WIDTH, PRECISION_DIGITS);
      expect(FRIDGE.depth).toBeCloseTo(FRIDGE_DEPTH, PRECISION_DIGITS);
    });

    it('names the longer side first, whichever axis the fixture stands on', () => {
      const [fridge] = BUILT_FLOOR.fixtures.filter((fixture) => fixture.kind === 'fridge');

      // The fixture is 0.70 across x and 0.90 across z — it backs onto the
      // kitchen's east wall — so a footprint that simply reported `rectWidth`
      // would call this a 0.70 m appliance and pass every door on the floor.
      expect(rectWidth(fridge.rect)).toBeCloseTo(FRIDGE_DEPTH, PRECISION_DIGITS);
      expect(FRIDGE.width).toBeGreaterThan(rectWidth(fridge.rect));
    });

    it('follows the plan when the fridge is moved or resized', () => {
      const wider = getApplianceFootprint(
        getFixtures(FLOOR_PLAN, onlyFridge([13.0, 14.05, 6.75, 7.45])),
        'fridge',
      );

      // 1.05 across x, 0.70 across z: the longer side is now the x one, which is
      // what proves nothing in this file remembers 0.90.
      expect(wider.width).toBeCloseTo(1.05, PRECISION_DIGITS);
      expect(wider.depth).toBeCloseTo(FRIDGE_DEPTH, PRECISION_DIGITS);
    });

    it('freezes what it returns', () => {
      expect(Object.isFrozen(FRIDGE)).toBe(true);
    });

    it.each([
      {
        kind: 'tv' as const,
        why: 'numbered by the plan but dropped by getFixtures: tvPanel.ts derives the panel',
      },
      { kind: 'sink' as const, why: 'three of them — main sanitair, guest sanitair, laundry' },
      { kind: 'bed' as const, why: 'six of them, one per bedroom place' },
    ])('refuses to measure "$kind" ($why)', ({ kind }) => {
      expect(() => getApplianceFootprint(BUILT_FLOOR.fixtures, kind)).toThrow(RangeError);
      expect(() => getApplianceFootprint(BUILT_FLOOR.fixtures, kind)).toThrow(
        /can only be read off exactly one/u,
      );
    });
  });

  describe('the route itself, from findSpaceRoute', () => {
    it('walks the fridge from the stair arrival to the kitchen through the corridor', () => {
      expect(findSpaceRoute(FLOOR_PLAN, PORT_SCHEDULE, ARRIVAL, 'kitchen')).toEqual([
        'stairs',
        'corridor',
        'kitchen',
      ]);
    });

    it('starts on the stair landing the explorer actually arrives on', () => {
      // The route's first space is wherever `ARRIVAL` falls, so this is what ties
      // the whole file to the stair rather than to a point somebody typed.
      expect(BUILT_FLOOR.stairs.landingRect).toEqual(LANDING_EAST);
      expect(APPLIANCE_ROUTES.every(({ route }) => route[0] === 'stairs')).toBe(true);
    });

    it('finds a route to every room holding a delivered appliance', () => {
      expect(APPLIANCE_ROOMS).toEqual(['kitchen', 'laundry', 'balconySlabB']);
      APPLIANCE_ROUTES.forEach(({ room, route }) => {
        expect(route.length).toBeGreaterThan(0);
        expect(route[route.length - 1]).toBe(room);
      });
    });
  });

  describe('the corridor, measured off the walk field', () => {
    it('is 1.50 m clear along its whole run', () => {
      const clear = getClearWidth(WALK_FIELD, CORRIDOR_RUN, 'x');

      expect(clear).toBeGreaterThanOrEqual(CORRIDOR_WIDTH - LENGTH_TOLERANCE);
      expect(clear).toBeCloseTo(CORRIDOR_WIDTH, PRECISION_DIGITS);
    });

    it('is 1.50 m still, with all 39 fixtures of the floor standing in it', () => {
      // The corridor keeps the television and nothing else, and the television is
      // not a fixture of the built floor (tvPanel.ts hangs it on the wall). The
      // emptiness is a decision of the plan, so this asserts it rather than
      // assuming it: no fixture stands in the corridor, and none of the ones in
      // the rooms leans into it either.
      expect(BUILT_FLOOR.fixtures.some((fixture) => fixture.spaceId === 'corridor')).toBe(false);
      expect(getClearWidth(FURNISHED_FIELD, CORRIDOR_RUN, 'x')).toBeCloseTo(
        CORRIDOR_WIDTH,
        PRECISION_DIGITS,
      );
    });

    it('leaves the fridge 0.60 m of clearance in it, which is what §7.5 promised', () => {
      expect(CORRIDOR_WIDTH - FRIDGE.width).toBeCloseTo(0.6, PRECISION_DIGITS);
    });

    it('reads the field and not the rect: a sideboard in it measures 1.40 m', () => {
      // Same rect, same corridor, one 1.00 × 0.10 m blocker against its south
      // wall. A `getClearWidth` that measured `rectDepth(CORRIDOR_RUN)` would
      // still answer 1.50 here and this suite would be checking nothing at all.
      const narrowed = getClearWidth(NARROWED_FIELD, CORRIDOR_RUN, 'x');

      expect(narrowed).toBeCloseTo(CORRIDOR_WIDTH - INTRUSION_DEPTH, PRECISION_DIGITS);
      expect(narrowed).toBeLessThan(CORRIDOR_WIDTH);
    });

    it('answers 0 where a blocker crosses the whole rect', () => {
      const sealed = makeWalkField(WALK_FIELD.floor, [
        ...WALK_FIELD.blockers,
        makeRect(RUN_MIDDLE, RUN_MIDDLE + INTRUDER_LENGTH, CORRIDOR_RUN.minZ, CORRIDOR_RUN.maxZ),
      ]);

      expect(getClearWidth(sealed, CORRIDOR_RUN, 'x')).toBe(0);
    });
  });

  describe('turning on the landing (ADR-010)', () => {
    it('turns the fridge on the 1.00 × 2.00 m east landing', () => {
      // Both tests of canTurn, written out: max(0.90, 0.70) = 0.90 ≤ 1.00, so it
      // stands on the landing either way round; √(0.90² + 0.70²) = √1.30 =
      // 1.140 ≤ 2.00, so its longest reach mid-turn clears the long side by 0.86.
      expect(rectWidth(LANDING_EAST)).toBeCloseTo(LANDING_SHORT_SIDE, PRECISION_DIGITS);
      expect(LANDING_EAST.maxZ - LANDING_EAST.minZ).toBeCloseTo(
        LANDING_LONG_SIDE,
        PRECISION_DIGITS,
      );
      expect(Math.hypot(FRIDGE.width, FRIDGE.depth)).toBeCloseTo(FRIDGE_DIAGONAL, PRECISION_DIGITS);
      expect(canTurn(FRIDGE, LANDING_EAST)).toBe(true);
    });

    it('turns the washing machine too, which is the other appliance ADR-010 names', () => {
      expect(
        canTurn(getApplianceFootprint(BUILT_FLOOR.fixtures, 'washingMachine'), LANDING_EAST),
      ).toBe(true);
    });

    it('refuses a 1.00 × 1.00 m landing the fridge still FITS on', () => {
      // The guard that proves canTurn is not `width <= landing.width`. The fridge
      // stands on a metre square either way round — 0.90 ≤ 1.00 on both axes — so
      // the fits-both-ways half passes. Its 1.140 m diagonal does not clear the
      // 1.00 m long side, so the turn does not, which is exactly the 2.00 m the
      // ADR paid a shallower tread for.
      expect(Math.max(FRIDGE.width, FRIDGE.depth)).toBeLessThanOrEqual(rectWidth(SQUARE_LANDING));
      expect(Math.hypot(FRIDGE.width, FRIDGE.depth)).toBeGreaterThan(rectWidth(SQUARE_LANDING));
      expect(canTurn(FRIDGE, SQUARE_LANDING)).toBe(false);
    });

    it('refuses an item that does not fit the landing at all', () => {
      const crate: ApplianceFootprint = Object.freeze({
        width: OVERSIZE_SIDE,
        depth: OVERSIZE_SIDE,
      });

      expect(canTurn(crate, SQUARE_LANDING)).toBe(false);
      expect(canTurn(crate, LANDING_EAST)).toBe(false);
    });
  });

  describe('the doors, which promise less than the corridor does', () => {
    it('crosses one port at every step but the zero-wall stairs ↔ corridor join', () => {
      APPLIANCE_ROUTES.forEach(({ route }) => {
        getRouteSteps(route).forEach(({ from, to, port }) => {
          const isZeroGap = ZERO_GAP_STEP.includes(from) && ZERO_GAP_STEP.includes(to);

          expect(port === undefined).toBe(isZeroGap);
        });
      });
    });

    it('finds exactly the five leaves an appliance has to pass', () => {
      const routeDoors = APPLIANCE_ROUTES.flatMap(({ route }) =>
        getRouteSteps(route).flatMap(({ port }) => (port === undefined ? [] : [port])),
      );
      // Both side-B doors, taken from the slab's own schedule rather than listed:
      // the laundry's leaf is on no route from the stair (the machine goes through
      // the main sanitair), and it is still a door an appliance passes.
      const found = [...new Set([...routeDoors, ...getPortsOf(PORT_SCHEDULE, 'balconySlabB')])];

      expect(found.map(nameOf)).toEqual(
        EXPECTED_APPLIANCE_DOORS.map((door) => `${door.spaces[0]} ↔ ${door.spaces[1]}`),
      );
    });

    it.each(EXPECTED_APPLIANCE_DOORS)('measures $spaces exactly $width m', ({ spaces, width }) => {
      const [first, second] = spaces;
      const port = PORT_SCHEDULE.find(
        (candidate) => candidate.spaces.includes(first) && candidate.spaces.includes(second),
      );

      expect(port?.kind).toBe('door');
      expect(port?.width).toBeCloseTo(width, PRECISION_DIGITS);
    });

    it('passes the fridge on its 0.70 m depth, with nothing at all to spare upright', () => {
      // The honest sentence of this file. 0.90 m of leaf against a 0.90 m
      // appliance is zero clearance, so the fridge goes through edge-on and
      // upright only with the leaf off its hinges. Brief §7.5 claimed clearance
      // for the corridor and never for a doorway, and this pair of assertions is
      // the difference between the two written down.
      expect(passesOpening(FRIDGE, ROUTE_DOOR_WIDTH)).toBe(true);
      expect(FRIDGE.depth).toBeLessThan(ROUTE_DOOR_WIDTH);
      expect(ROUTE_DOOR_WIDTH - FRIDGE.width).toBeCloseTo(0, PRECISION_DIGITS);
    });

    it('stops a 1.10 m appliance at the same 0.90 m leaf', () => {
      // The guard: the doorway rule has to be able to say no. A crate 1.10 m on
      // its narrow side fails every leaf on the route, while the fridge passes
      // every one of them.
      const crate: ApplianceFootprint = Object.freeze({
        width: OVERSIZE_SIDE,
        depth: OVERSIZE_SIDE,
      });

      EXPECTED_APPLIANCE_DOORS.forEach(({ width }) => {
        expect(passesOpening(crate, width)).toBe(false);
        expect(passesOpening(FRIDGE, width)).toBe(true);
      });
    });
  });
});
