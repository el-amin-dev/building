/**
 * Most of this suite runs on injected runs rather than on `SERVICE_RUNS`.
 *
 * The plan's six service layers were authored while this module was being
 * written, and they will go on moving: a suite that measured the real routes
 * would fail every time a branch moved by a centimetre, and would say nothing
 * about the derivation, which is what this module owns. The injected runs are
 * therefore small, hand-placed and chosen to put one rule each under load.
 *
 * The cases that DO read `SERVICE_RUNS` assert a derivation rather than a count
 * — one box per declared leg, one cover per leg out of the floor, one cap per
 * capped end — so they hold at 13 runs and at 116, and they would still catch a
 * run that silently built nothing.
 *
 * The cases against the real plan are only the ones that must hold whatever is
 * declared: that every declared run builds, that the matricules read the way the
 * drawing spells them and are unique, that every leg is contiguous with the one
 * before it, and that nothing buried is boxed in. The routes themselves are
 * `pnpm verify:plan`'s business, not this module's.
 */

import { describe, expect, it } from 'vitest';
import {
  assertRunAxis,
  getServiceRuns,
  getServiceRunsOf,
  getServiceRunsReaching,
} from './services.ts';
import type { BuiltServiceRun } from './services.ts';
import type { PlanBox } from './planBox.ts';
import { SERVICE_CHAMBERS, SERVICE_RUNS, SERVICE_SPEC } from './sourceOfTruth/plan.ts';
import type { PlanServicePoint, PlanServiceRun } from './sourceOfTruth/plan.ts';

const PRECISION_DIGITS = 9;

/** Thickness of a stop-end, as the module builds it, in metres. */
const CAP_THICKNESS = 0.02;

/**
 * Level of the finished floor: a leg at or below it is inside the floor build-up.
 *
 * Restated here rather than imported, so that a case can say what "buried" means
 * without the module being able to change the question and the answer together.
 */
const FLOOR_LEVEL = 0;

/**
 * How many of a run's declared ends are caps: 0, 1 or 2.
 *
 * @param declared - A row of the source of truth.
 * @returns The number of ends declared `at: 'cap'`.
 */
function capEnds(declared: PlanServiceRun): number {
  return [declared.from, declared.to].filter((end) => end.at === 'cap').length;
}

/**
 * How many legs of a run come out of the floor build-up.
 *
 * @param declared - A row of the source of truth.
 * @returns The number of consecutive point pairs whose higher end is above the
 *   finished floor — the legs a person could see, and so the legs boxed in.
 */
function visibleLegs(declared: PlanServiceRun): number {
  return declared.points.filter(
    (point, index) => index > 0 && Math.max(point[2], declared.points[index - 1][2]) > FLOOR_LEVEL,
  ).length;
}

/**
 * Builds a run declaration, so a case can state only what it is about.
 *
 * @param points - The centreline, upstream first.
 * @param over - The fields of the run this case cares about.
 * @returns A declaration shaped like a row of the source of truth.
 */
function run(
  points: readonly PlanServicePoint[],
  over: Partial<PlanServiceRun> = {},
): PlanServiceRun {
  return {
    layer: 'drainage',
    family: 'waste',
    from: { at: 'fitting', space: 'kitchen', kind: 'sink' },
    to: { at: 'space', space: 'voidWest' },
    points,
    ...over,
  };
}

/** Width of a box along x, in metres. */
const width = (box: PlanBox): number => box.rect.maxX - box.rect.minX;

/** Depth of a box along z, in metres. */
const depth = (box: PlanBox): number => box.rect.maxZ - box.rect.minZ;

/** Height of a box, in metres. */
const height = (box: PlanBox): number => box.top - box.bottom;

/**
 * Tells whether two boxes share at least a face.
 *
 * @param a - One box.
 * @param b - The other.
 * @returns `true` when they overlap or touch on all three axes.
 */
function boxesTouch(a: PlanBox, b: PlanBox): boolean {
  const tolerance = 1e-9;
  return (
    Math.max(a.rect.minX, b.rect.minX) <= Math.min(a.rect.maxX, b.rect.maxX) + tolerance &&
    Math.max(a.rect.minZ, b.rect.minZ) <= Math.min(a.rect.maxZ, b.rect.maxZ) + tolerance &&
    Math.max(a.bottom, b.bottom) <= Math.min(a.top, b.top) + tolerance
  );
}

/**
 * Tells whether a box holds a centreline point.
 *
 * @param box - The box to test.
 * @param point - A point of the centreline, as `[x, z, y]`.
 * @returns `true` when the point lies inside the box or on its faces.
 */
function holds(box: PlanBox, point: PlanServicePoint): boolean {
  const tolerance = 1e-9;
  return (
    point[0] >= box.rect.minX - tolerance &&
    point[0] <= box.rect.maxX + tolerance &&
    point[1] >= box.rect.minZ - tolerance &&
    point[1] <= box.rect.maxZ + tolerance &&
    point[2] >= box.bottom - tolerance &&
    point[2] <= box.top + tolerance
  );
}

/** Every segment of every built run, flattened. */
const segmentsOf = (built: readonly BuiltServiceRun[]): readonly PlanBox[] =>
  built.flatMap((one) => one.segments.map((segment) => segment.box));

describe('getServiceRuns', () => {
  it('builds every run the plan declares, one box per leg', () => {
    const built = getServiceRuns();

    expect(built).toHaveLength(SERVICE_RUNS.length);
    expect(built.length).toBeGreaterThan(0);
    built.forEach((one, index) => {
      const declared = SERVICE_RUNS[index];
      expect(one.run).toBe(declared);
      expect(one.segments).toHaveLength(declared.points.length - 1);
      expect(one.cover).toHaveLength(visibleLegs(declared));
      expect(one.caps).toHaveLength(capEnds(declared));
      expect(one.bore).toBe(SERVICE_SPEC.bore[declared.family]);
    });
    expect(segmentsOf(built).length).toBe(
      SERVICE_RUNS.reduce((total, declared) => total + declared.points.length - 1, 0),
    );
  });

  it('numbers the runs within their layer, tagged S, as the drawing spells them', () => {
    const built = getServiceRuns();

    expect(built.map((one) => one.matricule).slice(0, 3)).toStrictEqual([
      'F1-DRN-S1',
      'F1-DRN-S2',
      'F1-DRN-S3',
    ]);
    expect(new Set(built.map((one) => one.matricule)).size).toBe(built.length);
  });

  it('restarts the numbering in each layer, so one layer cannot renumber another', () => {
    const drainage = run([
      [1, 1, 0.5],
      [2, 1, 0.5],
    ]);
    const water = run(
      [
        [1, 1, 0.5],
        [2, 1, 0.5],
      ],
      { layer: 'water', family: 'cold' },
    );
    const built = getServiceRuns([drainage, water, drainage]);

    expect(built.map((one) => one.matricule)).toStrictEqual([
      'F1-DRN-S1',
      'F1-WTR-S1',
      'F1-DRN-S2',
    ]);
  });

  it('refuses a run declared in a layer that carries no service', () => {
    expect(() =>
      getServiceRuns([
        run(
          [
            [1, 1, 0.5],
            [2, 1, 0.5],
          ],
          { layer: 'furniture' },
        ),
      ]),
    ).toThrow(/carries no services/u);
  });

  it('refuses a run with fewer than two points', () => {
    expect(() => getServiceRuns([run([[1, 1, 0.5]])])).toThrow(/at least two/u);
  });

  it('returns a frozen result, frozen run by run', () => {
    const built = getServiceRuns();
    const first = built[0];

    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.segments)).toBe(true);
    expect(Object.isFrozen(first.segments[0])).toBe(true);
    expect(Object.isFrozen(first.cover)).toBe(true);
    expect(Object.isFrozen(first.caps)).toBe(true);
  });
});

describe('the bore', () => {
  it('comes from the spec, whatever the declaration says', () => {
    const misdeclared = {
      ...run([
        [1, 1, 0.5],
        [3, 1, 0.5],
      ]),
      bore: 0.5,
    } as PlanServiceRun;
    const [built] = getServiceRuns([misdeclared]);

    expect(built.bore).toBe(SERVICE_SPEC.bore.waste);
    expect(depth(built.segments[0].box)).toBeCloseTo(SERVICE_SPEC.bore.waste, PRECISION_DIGITS);
    expect(height(built.segments[0].box)).toBeCloseTo(SERVICE_SPEC.bore.waste, PRECISION_DIGITS);
  });

  it('follows the family, so a soil pipe is not a waste pipe', () => {
    const points: readonly PlanServicePoint[] = [
      [1, 1, 0.5],
      [3, 1, 0.5],
    ];
    const [waste, soil] = getServiceRuns([run(points), run(points, { family: 'soil' })]);

    expect(waste.bore).toBe(SERVICE_SPEC.bore.waste);
    expect(soil.bore).toBe(SERVICE_SPEC.bore.soil);
    expect(depth(soil.segments[0].box)).toBeCloseTo(SERVICE_SPEC.bore.soil, PRECISION_DIGITS);
  });
});

describe('a leg', () => {
  it('is a box point to point, of the bore across, centred on the centreline', () => {
    const [built] = getServiceRuns([
      run([
        [1, 2, 0.5],
        [4, 2, 0.5],
      ]),
    ]);
    const { box, axis } = built.segments[0];
    const half = SERVICE_SPEC.bore.waste / 2;

    expect(axis).toBe('x');
    expect(box.rect.minX).toBeCloseTo(1, PRECISION_DIGITS);
    expect(box.rect.maxX).toBeCloseTo(4, PRECISION_DIGITS);
    expect(box.rect.minZ).toBeCloseTo(2 - half, PRECISION_DIGITS);
    expect(box.rect.maxZ).toBeCloseTo(2 + half, PRECISION_DIGITS);
    expect(box.bottom).toBeCloseTo(0.5 - half, PRECISION_DIGITS);
    expect(box.top).toBeCloseTo(0.5 + half, PRECISION_DIGITS);
  });

  it('that only changes y is a riser, with no vocabulary of its own', () => {
    const [built] = getServiceRuns([
      run(
        [
          [1, 2, -0.28],
          [1, 2, 2.72],
        ],
        { family: 'soil' },
      ),
    ]);
    const { box, axis } = built.segments[0];

    expect(axis).toBe('y');
    expect(box.bottom).toBeCloseTo(-0.28, PRECISION_DIGITS);
    expect(box.top).toBeCloseTo(2.72, PRECISION_DIGITS);
    expect(width(box)).toBeCloseTo(SERVICE_SPEC.bore.soil, PRECISION_DIGITS);
    expect(depth(box)).toBeCloseTo(SERVICE_SPEC.bore.soil, PRECISION_DIGITS);
  });

  it('may fall as it runs, which is what a drain does', () => {
    const [built] = getServiceRuns([
      run([
        [1, 2, -0.05],
        [1, 4.05, -0.08],
      ]),
    ]);
    const { box, axis } = built.segments[0];

    expect(axis).toBe('z');
    expect(depth(box)).toBeCloseTo(2.05, PRECISION_DIGITS);
    expect(height(box)).toBeCloseTo(SERVICE_SPEC.bore.waste + 0.03, PRECISION_DIGITS);
  });

  it('may not cut a corner: a diagonal in plan is two legs, not one', () => {
    expect(() =>
      getServiceRuns([
        run([
          [1, 1, 0.5],
          [3, 4, 0.5],
        ]),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      getServiceRuns([
        run([
          [1, 1, 0.5],
          [3, 4, 0.5],
        ]),
      ]),
    ).toThrow(/diagonally in plan/u);
  });

  it('may not stand still', () => {
    expect(() =>
      getServiceRuns([
        run([
          [1, 1, 0.5],
          [1, 1, 0.5],
        ]),
      ]),
    ).toThrow(/repeats its own point/u);
  });

  it('names its axis through a guard the declared runs never reach', () => {
    expect(assertRunAxis([0, 0, 0], [1, 0, 0], 'leg')).toBe('x');
    expect(assertRunAxis([0, 0, 0], [0, 1, 0], 'leg')).toBe('z');
    expect(assertRunAxis([0, 0, 0], [0, 0, 1], 'leg')).toBe('y');
    expect(assertRunAxis([0, 0, 0], [0, 1, -0.02], 'leg')).toBe('z');
    expect(() => assertRunAxis([0, 0, 0], [1, 1, 0], 'leg')).toThrow(RangeError);
  });

  it('is contiguous with the leg before it, all the way along every declared run', () => {
    getServiceRuns().forEach((built) => {
      built.segments.forEach((segment, index) => {
        expect(holds(segment.box, built.run.points[index])).toBe(true);
        expect(holds(segment.box, built.run.points[index + 1])).toBe(true);
        if (index > 0) {
          expect(boxesTouch(built.segments[index - 1].box, segment.box)).toBe(true);
        }
      });
    });
  });
});

describe('the cover', () => {
  it('clears the run and adds its casing, on each side of the leg', () => {
    const [built] = getServiceRuns([
      run([
        [1, 2, 0.5],
        [4, 2, 0.5],
      ]),
    ]);
    const added = 2 * (SERVICE_SPEC.coverClearance + SERVICE_SPEC.coverThickness);
    const [cover] = built.cover;

    expect(built.cover).toHaveLength(1);
    expect(depth(cover)).toBeCloseTo(SERVICE_SPEC.bore.waste + added, PRECISION_DIGITS);
    expect(height(cover)).toBeCloseTo(SERVICE_SPEC.bore.waste + added, PRECISION_DIGITS);
    expect(width(cover)).toBeCloseTo(3, PRECISION_DIGITS);
  });

  it('is not built over a run buried in the floor build-up', () => {
    const [built] = getServiceRuns([
      run([
        [1, 2, -0.05],
        [1, 4.05, -0.08],
        [2.6, 4.05, -0.12],
      ]),
    ]);

    expect(built.segments).toHaveLength(2);
    expect(built.cover).toStrictEqual([]);
  });

  it('is built leg by leg, so a stack is boxed in where it leaves the floor', () => {
    const [built] = getServiceRuns([
      run(
        [
          [1, 2, -0.28],
          [1, 2, -0.1],
          [1, 2, 2.72],
        ],
        { family: 'soil' },
      ),
    ]);

    expect(built.segments).toHaveLength(2);
    expect(built.cover).toHaveLength(1);
    expect(built.cover[0].top).toBeCloseTo(2.72, PRECISION_DIGITS);
  });

  it('is built over no declared leg that stays inside the floor build-up', () => {
    const built = getServiceRuns();
    const buried = built.filter((one) => one.run.points.every((point) => point[2] <= FLOOR_LEVEL));

    expect(buried.length).toBeGreaterThan(0);
    buried.forEach((one) => {
      expect(one.cover).toStrictEqual([]);
    });
    built.forEach((one) => {
      expect(one.cover).toHaveLength(visibleLegs(one.run));
      one.cover.forEach((box) => {
        expect(box.top).toBeGreaterThan(FLOOR_LEVEL);
      });
    });
  });
});

describe('the caps', () => {
  it('are built only where an end is declared as a cap, one per capped end', () => {
    const points: readonly PlanServicePoint[] = [
      [1, 2, -0.28],
      [1, 2, 2.72],
    ];
    const open = run(points, { family: 'soil' });
    const bottom = run(points, {
      family: 'soil',
      from: { at: 'cap', why: 'floor 0 is undesigned' },
    });
    const both = run(points, {
      family: 'soil',
      from: { at: 'cap', why: 'floor 0 is undesigned' },
      to: { at: 'cap', why: 'the roof is not modelled' },
    });
    const [none, one, two] = getServiceRuns([open, bottom, both]);

    expect(none.caps).toStrictEqual([]);
    expect(one.caps).toHaveLength(1);
    expect(two.caps).toHaveLength(2);
  });

  it('plug the bore inside the end of the run, not beyond it', () => {
    const [built] = getServiceRuns([
      run(
        [
          [1, 2, -0.28],
          [1, 2, 2.72],
        ],
        {
          family: 'soil',
          from: { at: 'cap', why: 'floor 0 is undesigned' },
          to: { at: 'cap', why: 'the roof is not modelled' },
        },
      ),
    ]);
    const [start, end] = built.caps;

    expect(start.bottom).toBeCloseTo(-0.28, PRECISION_DIGITS);
    expect(start.top).toBeCloseTo(-0.28 + CAP_THICKNESS, PRECISION_DIGITS);
    expect(end.bottom).toBeCloseTo(2.72 - CAP_THICKNESS, PRECISION_DIGITS);
    expect(end.top).toBeCloseTo(2.72, PRECISION_DIGITS);
    [start, end].forEach((cap) => {
      expect(width(cap)).toBeCloseTo(SERVICE_SPEC.bore.soil, PRECISION_DIGITS);
      expect(depth(cap)).toBeCloseTo(SERVICE_SPEC.bore.soil, PRECISION_DIGITS);
      expect(boxesTouch(built.segments[0].box, cap)).toBe(true);
    });
  });

  it('stop every declared run that stops for want of a storey, and nothing else', () => {
    const built = getServiceRuns();
    const capped = built.filter((one) => one.caps.length > 0);

    expect(capped.length).toBeGreaterThan(0);
    built.forEach((one) => {
      expect(one.caps).toHaveLength(capEnds(one.run));
      one.caps.forEach((cap) => {
        const sides = [width(cap), depth(cap), height(cap)];
        // A plug is the bore across and a stop-end thick, whichever way the run
        // travels; a sloped leg adds its own fall over those two centimetres.
        expect(Math.min(...sides)).toBeLessThanOrEqual(CAP_THICKNESS + 1e-9);
        expect(Math.max(...sides)).toBeLessThanOrEqual(one.bore + CAP_THICKNESS);
        expect(one.segments.some((segment) => boxesTouch(segment.box, cap))).toBe(true);
      });
    });
  });
});

describe('picking runs', () => {
  it('picks a layer, and says nothing is declared in a layer nothing is declared in', () => {
    const built = getServiceRuns();
    const drainage = getServiceRunsOf(built, 'drainage');

    expect(drainage).toHaveLength(SERVICE_RUNS.filter((one) => one.layer === 'drainage').length);
    drainage.forEach((one) => {
      expect(one.layer).toBe('drainage');
    });
    expect(getServiceRunsOf(built, 'covers')).toStrictEqual([]);
    expect(Object.isFrozen(drainage)).toBe(true);
  });

  it('picks the runs that start or stop in a room, and no run that merely crosses it', () => {
    const built = getServiceRuns();
    const kitchen = getServiceRunsReaching(built, 'kitchen');

    expect(kitchen.length).toBeGreaterThan(0);
    kitchen.forEach((one) => {
      const ends = [one.run.from, one.run.to];
      expect(
        ends.some((end) => (end.at === 'space' || end.at === 'fitting') && end.space === 'kitchen'),
      ).toBe(true);
    });
    expect(kitchen.some((one) => one.run.from.at === 'fitting')).toBe(true);
    expect(getServiceRunsReaching(built, 'voidEast').length).toBeGreaterThan(0);
  });

  it('resolves a chamber end to the room the compartment stands in', () => {
    const [chamber] = SERVICE_CHAMBERS;
    const built = getServiceRuns([
      run(
        [
          [2, 9.3, 0.5],
          [2, 9.3, 1.5],
        ],
        { to: { at: 'chamber', chamber: chamber.id } },
      ),
    ]);

    expect(getServiceRunsReaching(built, chamber.room)).toHaveLength(1);
    expect(getServiceRunsReaching(built, 'laundry')).toStrictEqual([]);
  });

  it('refuses a run that ends at a chamber the plan does not hold', () => {
    const built = getServiceRuns([
      {
        ...run([
          [2, 9.3, 0.5],
          [2, 9.3, 1.5],
        ]),
        // Through `unknown`, because the plan's own type will not admit a
        // chamber it does not declare — which is the guard being tested holding
        // at compile time as well as at runtime.
        to: { at: 'chamber', chamber: 'boilerHouse' },
      } as unknown as PlanServiceRun,
    ]);

    expect(() => getServiceRunsReaching(built, 'controlCenter')).toThrow(/does not hold/u);
  });

  it('reaches no room through a cap, which is where a run stops for want of a storey', () => {
    const built = getServiceRuns(SERVICE_RUNS);
    const stacks = built.filter((one) => one.caps.length === 2);

    stacks.forEach((stack) => {
      expect(stack.run.from.at).toBe('cap');
      expect(stack.run.to.at).toBe('cap');
      SERVICE_CHAMBERS.forEach((chamber) => {
        expect(getServiceRunsReaching([stack], chamber.room)).toStrictEqual([]);
      });
    });
  });
});
