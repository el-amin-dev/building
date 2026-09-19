/**
 * Most of this suite runs on injected fixture lists rather than on `FIXTURES`.
 *
 * The plan's fixture list is being filled room by room while this module is
 * written, so a suite that measured the real placements would fail every time a
 * bed moved by a centimetre — and would say nothing about the derivation, which
 * is what this module owns. The injected lists are therefore small, hand-placed
 * and deliberately out of reading order, and the cases against the real plan are
 * only the ones that must hold whatever is placed: that every kind of the plan
 * has a profile, that the television is skipped, and that the matricules read the
 * way the drawing spells them.
 *
 * The injected footprints are not checked against the rooms they name, because
 * nothing in this module checks that either: `pnpm verify:plan` owns containment
 * and clearance, and `getFixtures` owns the third dimension.
 */

import { describe, expect, it } from 'vitest';
import {
  FIXTURE_PROFILES,
  SERVICING_ROLES,
  assertFixtureFitsStorey,
  getFixtures,
  getFixturesOf,
  isServicedSpace,
  isWetSpace,
} from './fixtures.ts';
import type { BuiltFixture, FixtureSurface } from './fixtures.ts';
import { FLOOR_PLAN, getSpace } from './floorPlan/index.ts';
import type { SpaceId } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import { makeRect, rectContainsRect } from './planGeometry.ts';
import { FIXTURES, FIXTURE_ROLES, WINDOWS, compareFixturePosition } from './sourceOfTruth/plan.ts';
import type {
  PlanFixture,
  PlanFixtureKind,
  PlanFixtureRole,
  PlanOpeningAxis,
} from './sourceOfTruth/plan.ts';

const PRECISION_DIGITS = 9;

/**
 * The kinds of `PlanFixtureKind`, which the profile table must cover.
 *
 * Twenty-two once the owner asked for a library and a canvas in the living room, and
 * twenty-three since the food pass became a tunnel: `passCounter` is the 0.70 m of it
 * that masonry could not be asked to build (see the pass counter section below).
 */
const EXPECTED_PROFILE_COUNT = 23;

/** The kind `getFixtures` leaves to `tvPanel.ts`. */
const SKIPPED_KIND: PlanFixtureKind = 'tv';

/** The six surface families a part may be drawn with. */
const SURFACES: readonly FixtureSurface[] = Object.freeze([
  'sanitaryWare',
  'appliance',
  'joinery',
  'worktop',
  'softFurnishing',
  // A hung canvas is none of the others: it is not upholstery, not joinery and not stone,
  // and it is the one surface in the building whose job is to carry a colour.
  'artwork',
]);

/** Shape of a fixture matricule: the space's own, then its X number. */
const MATRICULE_PATTERN = /^R\d{2}\/[A-Z]{3,4}-X\d+$/u;

/** Every kind, read off the table rather than written out again. */
const ALL_KINDS = Object.keys(FIXTURE_PROFILES) as readonly PlanFixtureKind[];

/**
 * Places one fixture for a test.
 *
 * @param kind - What it is.
 * @param room - The space it stands in; a real space of `FLOOR_PLAN`.
 * @param rect - Its footprint as `[minX, maxX, minZ, maxZ]`, in metres.
 * @param note - What distinguishes it, when the case is about the note.
 * @returns A fixture row of the shape the source of truth writes.
 */
function place(
  kind: PlanFixtureKind,
  room: PlanFixture['room'],
  rect: PlanFixture['rect'],
  note?: string,
): PlanFixture {
  return { kind, room, rect, mount: 'standing', ...(note === undefined ? {} : { note }) };
}

/**
 * A furnished laundry, written out of reading order on purpose.
 *
 * Read top to bottom then left to right, the room is basin (z 1.00), washing
 * machine (z 2.00, x 1.00), storage unit (z 2.00, x 2.00) — so the X numbers are
 * 1, 2, 3 in that order and not in the order of the array.
 */
const LAUNDRY_FIXTURES: readonly PlanFixture[] = Object.freeze([
  place('storageUnit', 'laundry', [2.0, 2.6, 2.0, 2.6]),
  place('washingMachine', 'laundry', [1.0, 1.6, 2.0, 2.6], 'dirty'),
  place('sink', 'laundry', [0.2, 0.9, 1.0, 1.45]),
]);

/** The laundry's fixtures in reading order: what `getFixtures` must produce. */
const LAUNDRY_ORDER: readonly PlanFixtureKind[] = Object.freeze([
  'sink',
  'washingMachine',
  'storageUnit',
]);

/**
 * Two rooms and a television, to pin the plan order and the skip.
 *
 * The corridor rows come first in the array and the corridor comes after the
 * master bedroom in `plan.spaces`, so a result in plan order starts with the
 * bedroom. The television is the corridor's first fixture by reading order
 * (z 4.00 against the sofa's 5.00), so the sofa must come out as X2 even though
 * the television is not built: the drawing numbers it, and the two have to agree.
 */
const TWO_ROOM_FIXTURES: readonly PlanFixture[] = Object.freeze([
  place('tv', 'corridor', [7.5, 11.0, 4.0, 4.08]),
  place('sofa', 'corridor', [7.0, 9.0, 5.0, 5.9]),
  place('bed', 'masterBedroom', [1.0, 3.0, 1.0, 3.0]),
]);

/**
 * A pair that the two candidate orderings disagree about.
 *
 * `compareFixturePosition` reads z first, so the nightstand at z 1.00 is X1 and
 * the desk at z 2.00 is X2. An ordering that sorted on `minX` first would put the
 * desk (x 1.00) before the nightstand (x 5.00) and hand both of them the other
 * one's matricule.
 */
const ORDER_PROBE: readonly PlanFixture[] = Object.freeze([
  place('desk', 'bedroomMaleKids', [1.0, 2.4, 2.0, 2.7]),
  place('nightstand', 'bedroomMaleKids', [5.0, 5.4, 1.0, 1.4]),
]);

/** The three levels carried over unchanged from `ui/floorLayout.ts`, in metres. */
const PRESERVED_LEVELS: readonly {
  readonly kind: PlanFixtureKind;
  readonly bottom: number;
  readonly top: number;
}[] = Object.freeze([
  { kind: 'sink', bottom: 0.72, top: 0.88 },
  { kind: 'bath', bottom: 0, top: 0.55 },
  { kind: 'shower', bottom: 0, top: 0.1 },
]);

/** A metre-square footprint, for measuring a profile without placing it. */
const UNIT_RECT = makeRect(0, 1, 0, 1);

/**
 * The axis a kind has to be built with, for the cases that sweep every kind.
 *
 * Exactly one kind is directional, and it does not guess: a pass counter REFUSES to
 * build without an axis rather than falling back to x, because its rect is 0.70 × 0.75
 * and a fallback would rotate the tunnel 90° the first time the opening moved a
 * centimetre. So a case that walks `ALL_KINDS` has to state one for it, and only for it
 * — a helper that handed every profile an axis would hide the fact that the others
 * ignore it, which the section on the counter is what tests.
 *
 * @param kind - The kind about to be built.
 * @returns `'x'` for the pass counter, `undefined` for every other kind.
 */
function axisFor(kind: PlanFixtureKind): PlanOpeningAxis | undefined {
  return kind === PASS_COUNTER_KIND ? 'x' : undefined;
}

/** The fixtures of the real plan, built once. */
const BUILT = getFixtures(FLOOR_PLAN);

/**
 * The kind the food pass is built out with, and the one profile that is directional.
 *
 * The owner asked for the pass to be a tunnel rather than a hole — a mouth on each side
 * and a ledge to stand plates on — while the wall above it stayed a normal 0.30 m wall.
 * A wall in this model is the gap between two room rects and its thickness is one number
 * for its whole height, so that wall cannot be declared; the missing 0.70 m is built out
 * as this fixture instead. It has a section of its own below because it is the first
 * profile whose parts are not concentric and the first that has to be told which way it
 * faces.
 */
const PASS_COUNTER_KIND: PlanFixtureKind = 'passCounter';

/** The boxes a pass counter is drawn as: carcass, ledge, two cheeks and a lintel. */
const PASS_COUNTER_PART_COUNT = 5;

/**
 * Every role, and whether it means a service runs to the thing.
 *
 * A total `Record<PlanFixtureRole, …>` rather than a list, which is the technique
 * `FIXTURE_ROLES` itself uses: the compiler asks the question at the moment a role is
 * invented, which is the only moment anyone knows the answer. That matters here more
 * than it does for a count, because the answer decides a floor finish — `joinery` was
 * split out of `fitting` on 2026-09-19 precisely because a role that had never been
 * asked about carpeted-or-marble was being read as if it had.
 */
const ROLE_IS_SERVICING: Readonly<Record<PlanFixtureRole, boolean>> = Object.freeze({
  // Plumbed in: water goes to it or comes away from it.
  fitting: true,
  // Powered, and connected on delivery.
  appliance: true,
  // The building's own risers.
  services: true,
  // Loose, and nothing runs to it.
  furniture: false,
  // Built in, and still nothing runs to it: the pass counter and the kitchen counter.
  joinery: false,
});

/**
 * The guest room in reading order, now that it is a sitting room.
 *
 * `plan.ts` writes these three rows the other way round — sofa, coffee table, pass
 * counter — so this list is not the array order restated, and the case that uses it
 * asserts both directions.
 */
const GUEST_ROOM_ORDER: readonly PlanFixtureKind[] = Object.freeze([
  'passCounter',
  'coffeeTable',
  'sofa',
]);

/**
 * The most boxes any other kind is drawn as.
 *
 * Three was the ceiling for every kind until the pass counter, and the pass counter is
 * not a loosening of it: the case below holds every other kind to three exactly as it
 * did, and holds the counter to five exactly rather than to "at most five", so a bed
 * that grew a fourth box would still be caught.
 */
const MAX_PARTS = 3;

/**
 * Returns the single member of a list, failing by name when there is not exactly one.
 *
 * Used where an assertion depends on there being one row and only one — the food pass,
 * the counter built around it — so that a second one is a named failure rather than a
 * silent `[0]` measuring the wrong thing.
 *
 * @param items - The candidates.
 * @param what - What they are, for the message.
 * @returns The one member.
 */
function only<T>(items: readonly T[], what: string): T {
  if (items.length !== 1) {
    throw new Error(`expected exactly one ${what}, found ${items.length}`);
  }
  return items[0];
}

describe('fixtures', () => {
  describe('the profile table', () => {
    it('covers every kind, and nothing else', () => {
      expect(ALL_KINDS).toHaveLength(EXPECTED_PROFILE_COUNT);
      // Totality is enforced by the compiler, not here: the table is annotated
      // with and checked against `Readonly<Record<PlanFixtureKind, …>>`, so a
      // 24th kind fails `tsc -b` at the literal (the technique of
      // `FIXTURE_ROLES`). This case only pins the count the compiler is holding.
      expect(new Set(ALL_KINDS).size).toBe(EXPECTED_PROFILE_COUNT);
      // The newest of them, named rather than only counted: a kind can be added
      // to the union and to the table and still be missed by every case in this
      // file, which is what the pass counter section below exists to stop.
      expect(ALL_KINDS).toContain(PASS_COUNTER_KIND);
    });

    it('gives every kind of the real plan a profile', () => {
      FIXTURES.forEach((fixture) => {
        expect(FIXTURE_PROFILES[fixture.kind]).toBeDefined();
      });
    });

    it.each(ALL_KINDS.map((kind) => ({ kind })))(
      'builds $kind as a small number of boxes inside its own footprint',
      ({ kind }) => {
        const profile = FIXTURE_PROFILES[kind];
        // Every profile but the pass counter takes the rect alone, and is handed
        // nothing else here; the counter is handed the axis it refuses to build
        // without, so that this sweep measures its shape and not its refusal (the
        // refusal has its own case in the pass counter section below).
        const parts = profile.build(UNIT_RECT, axisFor(kind));

        if (kind === PASS_COUNTER_KIND) {
          // Exactly five, not "at most five": the counter is the one kind allowed
          // past three, and letting it be any number up to five would let the
          // cheeks quietly disappear without a case noticing.
          expect(parts).toHaveLength(PASS_COUNTER_PART_COUNT);
        } else {
          expect(parts.length).toBeGreaterThanOrEqual(1);
          expect(parts.length).toBeLessThanOrEqual(MAX_PARTS);
        }
        expect(SURFACES).toContain(profile.surface);
        parts.forEach((piece) => {
          expect(SURFACES).toContain(piece.surface);
          expect(piece.box.bottom).toBeGreaterThanOrEqual(0);
          expect(piece.box.top).toBeLessThanOrEqual(profile.top);
          // A part never overhangs the footprint the plan checked for clearance.
          expect(rectContainsRect(UNIT_RECT, piece.box.rect)).toBe(true);
        });
        expect(Math.max(...parts.map((piece) => piece.box.top))).toBeCloseTo(
          profile.top,
          PRECISION_DIGITS,
        );
      },
    );

    it.each(ALL_KINDS.map((kind) => ({ kind })))('stands $kind clear of the storey', ({ kind }) => {
      expect(FIXTURE_PROFILES[kind].top).toBeGreaterThan(0);
      expect(FIXTURE_PROFILES[kind].top).toBeLessThan(FLOOR_HEIGHTS.wall);
    });

    it.each(PRESERVED_LEVELS)(
      'keeps the drawn $kind at $bottom–$top m',
      ({ kind, bottom, top }) => {
        const parts = FIXTURE_PROFILES[kind].build(UNIT_RECT);

        // These three are pinned by two committed screenshot baselines, so they
        // are the numbers `ui/floorLayout.ts` drew, to the centimetre.
        expect(parts).toHaveLength(1);
        expect(parts[0].box.bottom).toBeCloseTo(bottom, PRECISION_DIGITS);
        expect(parts[0].box.top).toBeCloseTo(top, PRECISION_DIGITS);
        expect(parts[0].surface).toBe('sanitaryWare');
        expect(FIXTURE_PROFILES[kind].top).toBeCloseTo(top, PRECISION_DIGITS);
      },
    );

    it('makes exactly the plumbed-in kinds wet', () => {
      const wet = ALL_KINDS.filter((kind) => FIXTURE_PROFILES[kind].wet);

      expect([...wet].sort()).toEqual(['bath', 'shower', 'sink', 'wc']);
    });
  });

  describe('numbering', () => {
    it('numbers a room in plan reading order, not in array order', () => {
      const built = getFixtures(FLOOR_PLAN, LAUNDRY_FIXTURES);

      expect(built.map((fixture) => fixture.kind)).toEqual(LAUNDRY_ORDER);
      expect(built.map((fixture) => fixture.index)).toEqual([1, 2, 3]);
    });

    it('spells a matricule as the space matricule and the X number', () => {
      const laundry = getSpace(FLOOR_PLAN, 'laundry');
      const built = getFixtures(FLOOR_PLAN, LAUNDRY_FIXTURES);

      expect(built.map((fixture) => fixture.matricule)).toEqual([
        `${laundry.matricule}-X1`,
        `${laundry.matricule}-X2`,
        `${laundry.matricule}-X3`,
      ]);
    });

    it('reads z before x, so the two candidate orderings do not agree', () => {
      const built = getFixtures(FLOOR_PLAN, ORDER_PROBE);
      const byX = [...ORDER_PROBE].sort((a, b) => a.rect[0] - b.rect[0]);

      expect(built.map((fixture) => fixture.kind)).toEqual(['nightstand', 'desk']);
      // The mutation guard: an x-first ordering is a different answer, not the
      // same one arrived at differently.
      expect(byX.map((fixture) => fixture.kind)).toEqual(['desk', 'nightstand']);
      expect([...ORDER_PROBE].sort(compareFixturePosition).map((fixture) => fixture.kind)).toEqual([
        'nightstand',
        'desk',
      ]);
    });

    it('lists rooms in plan order, whatever order the rows arrive in', () => {
      const built = getFixtures(FLOOR_PLAN, TWO_ROOM_FIXTURES);

      expect(built.map((fixture) => fixture.spaceId)).toEqual(['masterBedroom', 'corridor']);
    });

    it('carries the note of a row that has one, and none otherwise', () => {
      const built = getFixtures(FLOOR_PLAN, LAUNDRY_FIXTURES);
      const machine = built.find((fixture) => fixture.kind === 'washingMachine');

      expect(machine?.note).toBe('dirty');
      expect(built.find((fixture) => fixture.kind === 'sink')).not.toHaveProperty('note');
    });
  });

  describe('the television', () => {
    it('builds no box for a tv fixture', () => {
      const built = getFixtures(FLOOR_PLAN, TWO_ROOM_FIXTURES);

      expect(built.map((fixture) => fixture.kind)).toEqual(['bed', 'sofa']);
    });

    it('still counts the tv when numbering its room', () => {
      const built = getFixtures(FLOOR_PLAN, TWO_ROOM_FIXTURES);
      const sofa = built.find((fixture) => fixture.kind === 'sofa');

      // The television is the corridor's X1 by reading order; dropping it must
      // not renumber the sofa to X1, or this module and the drawing would
      // disagree about what the corridor's X2 is.
      expect(sofa?.index).toBe(2);
      expect(sofa?.matricule.endsWith('-X2')).toBe(true);
    });

    it('skips the tv of the real plan and builds every other row', () => {
      const televisions = FIXTURES.filter((fixture) => fixture.kind === SKIPPED_KIND);

      expect(televisions).toHaveLength(1);
      expect(BUILT.map((fixture) => fixture.kind)).not.toContain(SKIPPED_KIND);
      expect(BUILT).toHaveLength(FIXTURES.length - televisions.length);
    });

    it('declares a tv profile anyway, at the panel levels of tvPanel.ts', () => {
      // Declared for totality and for the drawing, never built here.
      expect(FIXTURE_PROFILES[SKIPPED_KIND].top).toBeCloseTo(FLOOR_HEIGHTS.door, PRECISION_DIGITS);
      expect(FIXTURE_PROFILES[SKIPPED_KIND].build(UNIT_RECT)[0].box.bottom).toBeCloseTo(
        FLOOR_HEIGHTS.railing,
        PRECISION_DIGITS,
      );
    });
  });

  describe('the pass counter', () => {
    const profile = FIXTURE_PROFILES[PASS_COUNTER_KIND];
    /** The one food pass of the floor, read off the schedule rather than restated here. */
    const passWindow = only(
      WINDOWS.filter((window) => window.kind === 'pass'),
      'pass window',
    );
    /** The one counter built out under it, likewise read off the plan. */
    const passRow: PlanFixture = only(
      FIXTURES.filter((fixture) => fixture.kind === PASS_COUNTER_KIND),
      'pass counter',
    );
    const passRect = makeRect(passRow.rect[0], passRow.rect[1], passRow.rect[2], passRow.rect[3]);
    const built = profile.build(passRect, passRow.along);
    const [carcass, ledge, ...rest] = built;
    const cheeks = rest.slice(0, 2);
    const lintel = rest[2];
    /**
     * The face the pass is cut in, in metres: the cross-axis span of the counter itself.
     *
     * 0.75 m of guest-room wall, and it is measured off the row rather than written down
     * because the row is what the profile is actually handed. The window's jamb below is
     * computed from it, so a counter drawn 0.80 wide against an unchanged window would
     * change what this file expects the cheek to be, and the cheek would not follow.
     */
    const hostFace = passRect.maxZ - passRect.minZ;
    /** The masonry the pass leaves at each end of that face: `(0.75 − 0.55) / 2`, so 0.10. */
    const jamb = (hostFace - passWindow.width) / 2;
    /** Depth of the lintel over the bore, in metres: what stops the tunnel being a channel. */
    const lintelDepth = 0.1;
    /** Thickness of the ledge slab, in metres: the worktop plates are stood on. */
    const ledgeThickness = 0.04;
    /**
     * The guest room's east face, in metres: the masonry the counter is built out from.
     *
     * Read off the plan rather than written down, because the whole point of the unit is
     * that it touches THIS number. The guest room's first rect is its north strip, the
     * one the pass is cut in; its `maxX` is the inside face of the wall to the kitchen.
     */
    const guestRoomEastFace = getSpace(FLOOR_PLAN, 'guestRoom').rects[0].maxX;
    /** The kitchen's west face: the other side of the same wall, likewise read off the plan. */
    const kitchenWestFace = getSpace(FLOOR_PLAN, 'kitchen').rects[0].minX;
    /** The masonry the bore is drilled through: the gap between those two faces, so 0.30. */
    const masonry = kitchenWestFace - guestRoomEastFace;
    /** What the fixture builds out from the face, in metres: the other 0.70 of the tunnel. */
    const counterDepth = passRect.maxX - passRect.minX;
    /** The tunnel the owner asked for, end to end: 1.00 m, built in two pieces. */
    const tunnelDepth = 1;

    it('stands the counter across the pass, with its bore along the wall it pierces', () => {
      // Stated, not inferred, and the plan has to keep stating it: the unit is
      // 0.70 × 0.75, so a profile that read the bore off the longer side of the rect
      // would hang the whole shape on a 0.05 m margin. If this ever reads `undefined`
      // the profile silently falls back to x and this file would stop testing anything.
      expect(passRow.along).toBe('x');
      expect(passRow.room).toBe('guestRoom');
      expect(passWindow.between).toContain('guestRoom');
      expect(passWindow.between).toContain('kitchen');
    });

    it('refuses to build at all when the plan states no axis, rather than guessing one', () => {
      // The other half of "stated, not inferred". Every other profile takes the rect
      // alone, so the sweep over `ALL_KINDS` hands nothing else to any of them; this one
      // throws, because a silent fallback to x is a tunnel that reads correctly today
      // and turns 90° the day the opening moves a centimetre, with no case failing.
      expect(() => profile.build(passRect)).toThrow(RangeError);
      expect(() => profile.build(passRect, passRow.along)).not.toThrow();
    });

    it('abuts the masonry it builds out from, so the two halves are ONE 1.00 m tunnel', () => {
      // The one thing every other case in this section cannot see. Each of them computes
      // the host face, the jamb and the cheek ends from the row's OWN z span, so the row
      // could be slid west off the wall — `[8.80, 9.50, …]` instead of `[9.00, 9.70, …]`
      // — and every one of them would still pass, check 9 included, because a counter
      // standing in open floor is a legal fixture. In 3D it is a mouth with a 0.20 m gap
      // behind it and the masonry bore hanging in the air past the end of it.
      //
      // So the deep face of the unit is pinned to the room's east face, and both are read
      // off the plan: move either and this fails rather than drifting apart quietly.
      expect(passRect.maxX).toBeCloseTo(guestRoomEastFace, PRECISION_DIGITS);
      // And the counter really is on the guest side of it, not built through the wall.
      expect(passRect.minX).toBeLessThan(guestRoomEastFace);

      // The sum is the owner's number: 0.70 built out plus 0.30 of masonry is the 1.00 m
      // the tunnel is. Derived from the two faces rather than restated, so that widening
      // the wall without narrowing the counter is a failure and not a longer tunnel.
      expect(masonry).toBeCloseTo(0.3, PRECISION_DIGITS);
      expect(counterDepth).toBeCloseTo(0.7, PRECISION_DIGITS);
      expect(counterDepth + masonry).toBeCloseTo(tunnelDepth, PRECISION_DIGITS);
    });

    it('builds a carcass, a ledge, two cheeks and a lintel, in one unbroken stack', () => {
      expect(built).toHaveLength(PASS_COUNTER_PART_COUNT);
      expect(built.map((piece) => piece.surface)).toEqual([
        'joinery',
        // The ledge is the one worktop of the five: it is the surface a plate is put
        // down on, and it reads as stone for the same reason a kitchen counter does.
        'worktop',
        'joinery',
        'joinery',
        'joinery',
      ]);

      // Unbroken from the floor to the top: a gap anywhere in this stack is a slot of
      // daylight through the unit, which is the one thing a tunnel mouth may not have
      // anywhere except between the cheeks.
      expect(carcass.box.bottom).toBeCloseTo(0, PRECISION_DIGITS);
      expect(carcass.box.top).toBeCloseTo(ledge.box.bottom, PRECISION_DIGITS);
      cheeks.forEach((cheek) => {
        expect(ledge.box.top).toBeCloseTo(cheek.box.bottom, PRECISION_DIGITS);
        expect(cheek.box.top).toBeCloseTo(lintel.box.bottom, PRECISION_DIGITS);
      });
      expect(lintel.box.top).toBeCloseTo(profile.top, PRECISION_DIGITS);

      // The carcass, the ledge and the lintel are the whole footprint; only the cheeks
      // are not, which is what makes this the first profile with non-concentric parts.
      [carcass, ledge, lintel].forEach((piece) => {
        expect(piece.box.rect).toEqual(passRect);
      });
    });

    it('takes all four of its levels from the pass window it is built around', () => {
      // Four constants in `fixtures.ts` quietly agreeing with a window declared in
      // another file is exactly the agreement that stops being true without anyone
      // noticing, so it is asserted rather than left to the docblock that states it.
      // Narrowing the window from 0.65 to 0.55 is what paid for the 0.10 cheeks; if
      // somebody widens it back, this case fails before the geometry is drawn wrong.
      expect(ledge.box.top).toBeCloseTo(passWindow.sill, PRECISION_DIGITS);
      expect(ledge.box.top - ledge.box.bottom).toBeCloseTo(ledgeThickness, PRECISION_DIGITS);
      cheeks.forEach((cheek) => {
        expect(cheek.box.bottom).toBeCloseTo(passWindow.sill, PRECISION_DIGITS);
        expect(cheek.box.top).toBeCloseTo(passWindow.head, PRECISION_DIGITS);
      });
      expect(lintel.box.bottom).toBeCloseTo(passWindow.head, PRECISION_DIGITS);
      expect(lintel.box.top - lintel.box.bottom).toBeCloseTo(lintelDepth, PRECISION_DIGITS);
      expect(profile.top).toBeCloseTo(passWindow.head + lintelDepth, PRECISION_DIGITS);
    });

    it('makes its cheeks the masonry jamb, so the mouth is the width of the bore', () => {
      expect(jamb).toBeCloseTo(0.1, PRECISION_DIGITS);
      cheeks.forEach((cheek) => {
        expect(cheek.box.rect.maxZ - cheek.box.rect.minZ).toBeCloseTo(jamb, PRECISION_DIGITS);
      });
      // The clincher: the opening the built-out mouth leaves IS the opening the
      // masonry behind it has. A cheek off by a centimetre either pinches the tray
      // through the pass or stands proud of the hole with nothing behind it.
      expect(cheeks[1].box.rect.minZ - cheeks[0].box.rect.maxZ).toBeCloseTo(
        passWindow.width,
        PRECISION_DIGITS,
      );
      // Same width is not the same opening: two 0.55 m holes 0.20 m apart along z are
      // also the same width. The window's `spanMin` is a position on the floor, so the
      // mouth's two inner edges are held to the bore's two edges and not merely to the
      // distance between them — slide the counter along the wall and this is what says so.
      expect(cheeks[0].box.rect.maxZ).toBeCloseTo(passWindow.spanMin, PRECISION_DIGITS);
      expect(cheeks[1].box.rect.minZ).toBeCloseTo(
        passWindow.spanMin + passWindow.width,
        PRECISION_DIGITS,
      );
      // And the two cheeks really are at the two ends, not both at one of them.
      expect(cheeks[0].box.rect.minZ).toBeCloseTo(passRect.minZ, PRECISION_DIGITS);
      expect(cheeks[1].box.rect.maxZ).toBeCloseTo(passRect.maxZ, PRECISION_DIGITS);
    });

    it.each([
      { along: 'x' as PlanOpeningAxis, bore: 'x', cheekEnds: 'z' },
      { along: 'z' as PlanOpeningAxis, bore: 'z', cheekEnds: 'x' },
    ])(
      'honours a bore stated along $bore, standing its cheeks at the ends of $cheekEnds',
      ({ along }) => {
        // Measured on a SQUARE footprint, so nothing about the rect can stand in for the
        // answer: if the profile dropped the parameter on the floor the two builds would
        // be identical, and a case that asserted only "the cheeks are 0.10 wide" would
        // pass either way. This repo's ledger says a test that excludes something needs
        // its own assertion; the exclusion here is "the axis is not ignored".
        const cheeksOf = (axis: PlanOpeningAxis) =>
          profile
            .build(UNIT_RECT, axis)
            .slice(2, 4)
            .map((piece) => piece.box.rect);
        const alongX = cheeksOf('x');
        const alongZ = cheeksOf('z');

        expect(alongX).not.toStrictEqual(alongZ);

        const subject = along === 'x' ? alongX : alongZ;
        subject.forEach((cheek) => {
          if (along === 'x') {
            // Bore along x: each cheek is a band at one END of z, running the full depth
            // of x, so a tray travelling along x passes between them untouched.
            expect(cheek.minX).toBeCloseTo(UNIT_RECT.minX, PRECISION_DIGITS);
            expect(cheek.maxX).toBeCloseTo(UNIT_RECT.maxX, PRECISION_DIGITS);
            expect(cheek.maxZ - cheek.minZ).toBeCloseTo(jamb, PRECISION_DIGITS);
          } else {
            expect(cheek.minZ).toBeCloseTo(UNIT_RECT.minZ, PRECISION_DIGITS);
            expect(cheek.maxZ).toBeCloseTo(UNIT_RECT.maxZ, PRECISION_DIGITS);
            expect(cheek.maxX - cheek.minX).toBeCloseTo(jamb, PRECISION_DIGITS);
          }
        });
        // The bands sit at the two ends of the cross axis, in order.
        const spans =
          along === 'x'
            ? subject.map((cheek) => [cheek.minZ, cheek.maxZ])
            : subject.map((cheek) => [cheek.minX, cheek.maxX]);
        expect(spans[0][0]).toBeCloseTo(0, PRECISION_DIGITS);
        expect(spans[1][1]).toBeCloseTo(1, PRECISION_DIGITS);
        expect(spans[0][1]).toBeLessThan(spans[1][0]);
      },
    );

    it('leaves the bore clear between the ledge and the head, because that gap IS the tunnel', () => {
      const centre = (passRect.minZ + passRect.maxZ) / 2;
      /** Tells whether a part covers the middle of the cross axis — i.e. blocks the bore. */
      const blocksBore = (piece: (typeof built)[number]): boolean =>
        piece.box.rect.minZ < centre && piece.box.rect.maxZ > centre;
      // Everything standing in the band the pass is cut through.
      const inBore = built.filter(
        (piece) => piece.box.bottom < passWindow.head && piece.box.top > passWindow.sill,
      );

      expect(inBore).toStrictEqual(cheeks);
      inBore.forEach((piece) => {
        expect(blocksBore(piece)).toBe(false);
      });
      // The positive half, without which the case above would pass on an empty unit:
      // below the sill and above the head the counter is solid right across, so what
      // is being measured is a clear gap between 1.00 and 1.80 and not a missing part.
      [carcass, ledge, lintel].forEach((piece) => {
        expect(blocksBore(piece)).toBe(true);
      });
    });
  });

  describe('the real plan', () => {
    it('gives every built fixture a well-formed matricule, unique on the floor', () => {
      const matricules = BUILT.map((fixture) => fixture.matricule);

      expect(matricules.length).toBeGreaterThan(0);
      matricules.forEach((matricule) => {
        expect(matricule).toMatch(MATRICULE_PATTERN);
      });
      expect(new Set(matricules).size).toBe(matricules.length);
    });

    it('takes each built top from the profile of its kind', () => {
      BUILT.forEach((fixture) => {
        expect(fixture.top).toBeCloseTo(FIXTURE_PROFILES[fixture.kind].top, PRECISION_DIGITS);
        expect(fixture.parts.length).toBeGreaterThan(0);
      });
    });

    it('keeps each footprint exactly as the plan draws it', () => {
      BUILT.forEach((fixture) => {
        const row = FIXTURES.find(
          (candidate) =>
            candidate.kind === fixture.kind &&
            candidate.rect[0] === fixture.rect.minX &&
            candidate.rect[2] === fixture.rect.minZ,
        );

        expect(row).toBeDefined();
        expect(fixture.rect.maxX).toBeCloseTo(row?.rect[1] ?? Number.NaN, PRECISION_DIGITS);
        expect(fixture.rect.maxZ).toBeCloseTo(row?.rect[3] ?? Number.NaN, PRECISION_DIGITS);
      });
    });
  });

  describe('getFixturesOf', () => {
    it('returns the fixtures of one room, in reading order', () => {
      const built = getFixtures(FLOOR_PLAN, TWO_ROOM_FIXTURES);

      expect(getFixturesOf(built, 'corridor').map((fixture) => fixture.kind)).toEqual(['sofa']);
      expect(getFixturesOf(built, 'masterBedroom').map((fixture) => fixture.kind)).toEqual(['bed']);
    });

    it('numbers the guest room in reading order, which is its array order reversed', () => {
      const rows = FIXTURES.filter((fixture) => fixture.room === 'guestRoom');
      const room = getFixturesOf(BUILT, 'guestRoom');

      // The guest room stopped being a bedroom on 2026-09-19: the bed and the
      // wardrobe went, a sofa and a coffee table came, and the food pass grew a
      // counter. Every X number in the room therefore moved, and the reading order
      // is z first — the counter on the north strip at z 6.30, then the table at
      // z 7.25, then the sofa at z 7.75 behind it.
      expect(room.map((fixture) => fixture.kind)).toEqual(GUEST_ROOM_ORDER);
      expect(room.map((fixture) => fixture.index)).toEqual([1, 2, 3]);
      // Checked against the comparator itself, not against the list above, so the
      // two cannot drift into agreeing with each other and with nothing else.
      expect([...rows].sort(compareFixturePosition).map((fixture) => fixture.kind)).toEqual(
        GUEST_ROOM_ORDER,
      );
      // The mutation guard, and this room happens to give the sharpest one on the
      // floor: `plan.ts` writes the three rows in exactly the opposite order, so a
      // derivation that numbered them as they were typed would hand every one of
      // them another one's matricule.
      expect(rows.map((fixture) => fixture.kind)).toEqual([...GUEST_ROOM_ORDER].reverse());
    });

    it('returns a frozen empty list for an unfurnished space', () => {
      const built = getFixtures(FLOOR_PLAN, LAUNDRY_FIXTURES);
      const none = getFixturesOf(built, 'voidWest');

      expect(none).toEqual([]);
      expect(Object.isFrozen(none)).toBe(true);
    });
  });

  describe('wet rooms', () => {
    it('calls a room with a basin wet and a room with a bed dry', () => {
      const built = getFixtures(FLOOR_PLAN, [
        ...LAUNDRY_FIXTURES,
        place('bed', 'masterBedroom', [1.0, 3.0, 1.0, 3.0]),
      ]);

      // The mutation guard for the wet rule: the laundry is wet because of one
      // basin among a washing machine and a storage unit, so the answer is not
      // "the room has fixtures" — and the bedroom is dry with a fixture in it.
      expect(isWetSpace(built, 'laundry')).toBe(true);
      expect(isWetSpace(built, 'masterBedroom')).toBe(false);
      expect(isWetSpace(built, 'kitchen')).toBe(false);
    });

    it('is not decided by the name or the kind of the space', () => {
      const dryBathroom = getFixtures(FLOOR_PLAN, [
        place('storageUnit', 'mainSanitair', [18.0, 18.6, 6.0, 6.6]),
      ]);

      expect(isWetSpace(dryBathroom, 'mainSanitair')).toBe(false);
    });

    it('finds the sanitair of the real plan wet and the bedrooms dry', () => {
      expect(isWetSpace(BUILT, 'mainSanitair')).toBe(true);
      expect(isWetSpace(BUILT, 'guestSanitair')).toBe(true);
      expect(isWetSpace(BUILT, 'masterBedroom')).toBe(false);
    });
  });

  describe('serviced rooms', () => {
    it('names the three roles that mean a service, and leaves the other two out by name', () => {
      // The exclusion is the whole change, so it gets its own assertions rather than
      // riding on the behaviour below. `isServicedSpace` used to ask "is anything here
      // NOT furniture?", and a negation like that sweeps in every role invented after
      // it — which is exactly what happened: `joinery` appeared, the guest room's pass
      // counter fell into it, and a sitting room was floored in marble (2026-09-19).
      expect([...SERVICING_ROLES].sort()).toEqual(['appliance', 'fitting', 'services']);
      expect(SERVICING_ROLES.includes('joinery')).toBe(false);
      expect(SERVICING_ROLES.includes('furniture')).toBe(false);

      // And the same again from the other end, against a table the compiler keeps
      // total: a sixth role cannot be added to `PlanFixtureRole` without a line here
      // saying whether a service runs to it, so it cannot be swept in silently.
      Object.entries(ROLE_IS_SERVICING).forEach(([role, servicing]) => {
        expect(SERVICING_ROLES.includes(role as PlanFixtureRole), role).toBe(servicing);
      });
      expect(SERVICING_ROLES).toHaveLength(
        Object.values(ROLE_IS_SERVICING).filter((servicing) => servicing).length,
      );
      // Every role in that table is one the plan actually uses, so the table cannot
      // drift into describing roles that no longer exist.
      expect([...new Set(Object.values(FIXTURE_ROLES))].sort()).toEqual(
        Object.keys(ROLE_IS_SERVICING).sort(),
      );
    });

    it('cannot be added to at runtime, which is why it is an array and not a Set', () => {
      // The reason the shape changed. `Object.freeze(new Set([…]))` seals the Set's own
      // properties and leaves its CONTENTS writable, so `SERVICING_ROLES.add('joinery')`
      // succeeded silently and re-laid the guest room in marble for the rest of the
      // process — and `ReadonlySet` said otherwise at compile time and could not enforce
      // it, so this case could not have been written against the old shape at all.
      // Three members do not need a hash, and a frozen array is frozen all the way down.
      expect(Object.isFrozen(SERVICING_ROLES)).toBe(true);
      expect(() => (SERVICING_ROLES as PlanFixtureRole[]).push('joinery')).toThrow(TypeError);
      expect(SERVICING_ROLES.includes('joinery')).toBe(false);
    });

    it('leaves a room carpeted when all it holds is dry carpentry', () => {
      const carpentryOnly = getFixtures(FLOOR_PLAN, [
        { ...place(PASS_COUNTER_KIND, 'guestRoom', [9.0, 9.7, 6.3, 7.05]), along: 'x' },
        place('sofa', 'guestRoom', [4.2, 6.4, 7.75, 8.55]),
      ]);
      const oneAppliance = getFixtures(FLOOR_PLAN, [
        place('counter', 'kitchen', [10.1, 12.1, 6.4, 7.0]),
        place('fridge', 'kitchen', [10.1, 10.8, 7.2, 7.9]),
      ]);

      // A pass counter and a sofa are a lounge, not a wet room. The counter is built
      // in and the sofa is not, and under the old "anything but furniture" rule that
      // difference alone was enough to lay marble here.
      expect(isServicedSpace(carpentryOnly, 'guestRoom')).toBe(false);
      // The mutation guard: the rule is not "no room with a counter is serviced"
      // either. The kitchen counter is the same dry joinery, and the kitchen is
      // serviced all the same — by the fridge standing next to it.
      expect(isServicedSpace(oneAppliance, 'kitchen')).toBe(true);
    });

    it('carpets the guest room of the real plan and floors the kitchen in marble', () => {
      expect(isServicedSpace(BUILT, 'guestRoom')).toBe(false);
      expect(isServicedSpace(BUILT, 'kitchen')).toBe(true);
      expect(isServicedSpace(BUILT, 'controlCenter')).toBe(true);
      expect(isServicedSpace(BUILT, 'guestSanitair')).toBe(true);
      expect(isServicedSpace(BUILT, 'masterBedroom')).toBe(false);
    });
  });

  describe('immutability', () => {
    it('freezes the list, every fixture, its rect, its parts and their boxes', () => {
      const built = getFixtures(FLOOR_PLAN, LAUNDRY_FIXTURES);

      expect(Object.isFrozen(built)).toBe(true);
      built.forEach((fixture) => {
        expect(Object.isFrozen(fixture)).toBe(true);
        expect(Object.isFrozen(fixture.rect)).toBe(true);
        expect(Object.isFrozen(fixture.parts)).toBe(true);
        fixture.parts.forEach((piece) => {
          expect(Object.isFrozen(piece)).toBe(true);
          expect(Object.isFrozen(piece.box)).toBe(true);
          expect(Object.isFrozen(piece.box.rect)).toBe(true);
        });
      });
    });

    it('freezes the profile table and every profile in it', () => {
      expect(Object.isFrozen(FIXTURE_PROFILES)).toBe(true);
      ALL_KINDS.forEach((kind) => {
        expect(Object.isFrozen(FIXTURE_PROFILES[kind])).toBe(true);
      });
    });
  });

  describe('data errors', () => {
    it('rejects a fixture standing in a space the plan does not hold', () => {
      const orphan = [
        place('bed', 'masterBedroom' as PlanFixture['room'], [1.0, 3.0, 1.0, 3.0]),
      ].map((fixture) => ({ ...fixture, room: 'attic' as PlanFixture['room'] }));

      expect(() => getFixtures(FLOOR_PLAN, orphan)).toThrow(RangeError);
    });

    it('rejects a kind with no profile', () => {
      // Only reachable from untyped data — which is exactly the case worth a
      // message, since the compiler already covers the typed one.
      const unknown = [
        { ...place('bed', 'masterBedroom', [1.0, 3.0, 1.0, 3.0]), kind: 'gazebo' },
      ] as unknown as readonly PlanFixture[];

      expect(() => getFixtures(FLOOR_PLAN, unknown)).toThrow(/no profile/u);
    });

    it.each([
      { axis: 'width', rect: [1.0, 1.0, 2.0, 2.6] },
      { axis: 'depth', rect: [1.0, 1.6, 2.0, 2.0] },
    ] as const)('rejects a footprint with no $axis', ({ rect }) => {
      expect(() => getFixtures(FLOOR_PLAN, [place('bed', 'masterBedroom', rect)])).toThrow(
        /no footprint/u,
      );
    });

    it.each([[0], [-0.5], [FLOOR_HEIGHTS.wall], [3.2], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'rejects a fitting rising to %p m',
      (top) => {
        expect(() => {
          assertFixtureFitsStorey('wardrobe', top);
        }).toThrow(RangeError);
      },
    );

    it('accepts a fitting that stays under the wall', () => {
      expect(() => {
        assertFixtureFitsStorey('wardrobe', FLOOR_HEIGHTS.wall - 0.5);
      }).not.toThrow();
    });
  });

  describe('mutation guard', () => {
    it('gives the kinds different heights, so one constant would not do', () => {
      const tops = new Set(ALL_KINDS.map((kind) => FIXTURE_PROFILES[kind].top));

      // A single height for every fitting is the simpler derivation this one has
      // to differ from: a wardrobe is four times a bed, and a shower tray is a
      // tenth of either.
      expect(tops.size).toBeGreaterThan(5);
      expect(FIXTURE_PROFILES.wardrobe.top).toBeGreaterThan(FIXTURE_PROFILES.bed.top);
      expect(FIXTURE_PROFILES.shower.top).toBeLessThan(FIXTURE_PROFILES.bath.top);
      expect(FIXTURE_PROFILES.sink.top).not.toBeCloseTo(
        FIXTURE_PROFILES.counter.top,
        PRECISION_DIGITS,
      );
    });

    it('draws some kinds as more than one box, so one box per fixture would not do', () => {
      const counts = new Set(
        ALL_KINDS.map((kind) => FIXTURE_PROFILES[kind].build(UNIT_RECT, axisFor(kind)).length),
      );

      expect(counts.size).toBeGreaterThan(1);
      expect(FIXTURE_PROFILES.wardrobe.build(UNIT_RECT)).toHaveLength(1);
      expect(FIXTURE_PROFILES.bed.build(UNIT_RECT)).toHaveLength(2);
      expect(FIXTURE_PROFILES.washingMachine.build(UNIT_RECT)).toHaveLength(3);
      expect(FIXTURE_PROFILES[PASS_COUNTER_KIND].build(UNIT_RECT, 'x')).toHaveLength(
        PASS_COUNTER_PART_COUNT,
      );
    });

    it('gives the parts of one fixture different surfaces where the thing has them', () => {
      const bed = FIXTURE_PROFILES.bed.build(UNIT_RECT);

      // A base and a mattress, not two slices of the same block: a derivation
      // that copied the profile's surface onto every part would pass every other
      // case in this file.
      expect(bed.map((piece) => piece.surface)).toEqual(['joinery', 'softFurnishing']);
      expect(FIXTURE_PROFILES.counter.build(UNIT_RECT).map((piece) => piece.surface)).toEqual([
        'joinery',
        'worktop',
      ]);
    });

    it('scales a shrunken part with the footprint rather than fixing its size', () => {
      const small = FIXTURE_PROFILES.bed.build(makeRect(0, 1, 0, 1))[1].box.rect;
      const large = FIXTURE_PROFILES.bed.build(makeRect(0, 2, 0, 2))[1].box.rect;

      expect(large.maxX - large.minX).toBeCloseTo((small.maxX - small.minX) * 2, PRECISION_DIGITS);
    });

    it('spans the longer axis of a sofa, whichever axis that is', () => {
      const alongX = FIXTURE_PROFILES.sofa.build(makeRect(0, 2, 0, 0.9))[1].box.rect;
      const alongZ = FIXTURE_PROFILES.sofa.build(makeRect(0, 0.9, 0, 2))[1].box.rect;

      expect(alongX.minX).toBeCloseTo(0, PRECISION_DIGITS);
      expect(alongX.maxX).toBeCloseTo(2, PRECISION_DIGITS);
      expect(alongZ.minZ).toBeCloseTo(0, PRECISION_DIGITS);
      expect(alongZ.maxZ).toBeCloseTo(2, PRECISION_DIGITS);
    });
  });
});

/** Every space that holds at least one built fixture on the real plan. */
const FURNISHED: readonly SpaceId[] = Object.freeze([
  ...new Set(BUILT.map((fixture: BuiltFixture) => fixture.spaceId)),
]);

describe('fixtures of the real plan, room by room', () => {
  it.each(FURNISHED.map((spaceId) => ({ spaceId })))(
    'numbers $spaceId from 1 without a gap',
    ({ spaceId }) => {
      const room = getFixturesOf(BUILT, spaceId);
      const tvs = FIXTURES.filter(
        (fixture) => fixture.room === spaceId && fixture.kind === SKIPPED_KIND,
      );

      expect(room.length).toBeGreaterThan(0);
      // Indices run 1…n, except where the skipped television takes one of them.
      expect(Math.max(...room.map((fixture) => fixture.index))).toBe(room.length + tvs.length);
      expect(new Set(room.map((fixture) => fixture.index)).size).toBe(room.length);
    },
  );
});
