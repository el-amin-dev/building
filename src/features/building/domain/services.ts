/**
 * The service runs of a floor: the declared centrelines, given their bore.
 *
 * The source of truth declares a run as a POLYLINE — a family, two ends and a
 * list of `[x, z, y]` points on the centimetre grid (`sourceOfTruth/plan.ts`,
 * {@link PlanServiceRun}). Nothing in the plan says how thick any of them is,
 * because a route is a planning question and a diameter is a building one. This
 * module answers the second half: for each declared run, which axis-aligned
 * boxes it is drawn as, what is boxed in over it, and where it is stopped.
 *
 * **The bore never comes from the run.** It is read out of
 * `SERVICE_SPEC.bore[family]`, which is the whole reason that table exists: a
 * run that carried its own diameter would let two soil pipes disagree about what
 * a soil pipe is, and changing a pipe size would become a sweep over every
 * declaration of that family instead of one edit. It is the rule `fixtures.ts`
 * follows with `FIXTURE_SPEC`, and `services.test.ts` holds it by building a run whose
 * declaration carries a bogus diameter and checking the box ignores it.
 *
 * **The sizes that are NOT in the plan are local constants of this module**, on
 * purpose and with the precedent stated: `heights.ts` owns the vertical
 * dimensions of the BUILDING and says in as many words that a fitting's own
 * height does not belong there, `fixtures.ts` therefore carries its own basin
 * rim and worktop slab, and ADR-015 records the pattern. The thickness of a
 * stop-end is the same kind of number, so it lives here, beside the thing it
 * describes, with the reason it was chosen written next to it. Consequently
 * {@link getServiceRuns} takes **no heights argument**: every level a run is at
 * is already in its own declared points, measured from the finished floor of the
 * storey, and the only levels this module invents are thicknesses.
 *
 * **What a run is drawn as.** One box per polyline segment, of cross-section
 * `bore × bore`, centred on the centreline and spanning point to point along the
 * axis it runs on. A segment that changes only `y` is a riser and needs no
 * separate vocabulary for it — it is an `axis: 'y'` segment like any other. That
 * is enough for the only view that matters, a walking eye at 1.68 m
 * (`person.ts`), and it needs no mesh, no asset and no licence.
 *
 * **A drain falls, and a falling leg is not a diagonal.** This is the one place
 * where the obvious rule — "a segment may change exactly one axis" — is the
 * wrong rule, and it would reject the plan as it stands. `SERVICE_SPEC.fall`
 * states a minimum gradient per drainage family precisely because a drain
 * cannot be routed as a flat convenience line, and every drainage branch in
 * `SERVICE_RUNS` duly loses height along its length: the WC branch runs north
 * and drops as it goes. Every sloped leg the plan declares is buildable — a
 * pipe laid to a fall is what a plumber builds. What is NOT buildable is a
 * segment that changes **x and z together**: a pipe cutting a room corner to
 * corner, which has to be declared as two legs. That is the case
 * {@link assertRunAxis} throws a `RangeError` for, together with a segment that
 * repeats its own point and so has no direction at all.
 *
 * **A sloped leg is drawn as the level box that ENCLOSES it**, spanning both of
 * its end heights: its vertical extent is the fall plus the bore, so the box is
 * as tall as the drop and cannot silently flatten a drain onto the height of its
 * first point. The alternatives were a sheared solid, which is not an axis-
 * aligned box and so not the vocabulary the rest of this domain is drawn in
 * (`planBox.ts`), and a staircase of level boxes, which would invent steps in a
 * pipe that has none. Over the drops the plan declares — a few centimetres
 * against bores of 0.04 m to 0.11 m — the enclosing box reads as the pipe it is,
 * and in a plan view the fall is visible as the box's own height.
 *
 * **A buried run gets no cover.** The cover is the boxing built over a run — the
 * casing that makes a pipe disappear into a corner — and it is only ever built
 * where somebody would otherwise see the pipe. A run at NEGATIVE `y` is inside
 * the floor build-up (the 0.30 m between `HEIGHTS.wall` and
 * `HEIGHTS.floorToFloor`, which is where waste actually runs), so it is already
 * buried under the screed, and boxing it in would be drawing a casing nobody
 * would ever build. This is said here because it is exactly the kind of rule a
 * reviewer "fixes" into consistency: every segment gets a cover, surely. No —
 * and the test pins it. The rule is asked per SEGMENT rather than per run, so
 * that a stack which starts under the floor and rises three metres through an
 * open void is boxed over the part of it a person can see.
 *
 * **A cap is not decoration.** The building is 1…10 identical storeys (ADR-014),
 * so a riser declared once is automatically in the same place on every one of
 * them — but the ENDS of the stack are not automatic. Floor 0 is undesigned and
 * the roof is not modelled, so a stack that simply stopped would be a pipe
 * ending in mid-air; it stops at a declared `cap` carrying its reason instead,
 * exactly the way both half-flights at the ends of the stair stack are blocked
 * but still drawn. A cap is built here as a short solid plug across the bore,
 * set INSIDE the last {@link CAP_THICKNESS} of the run rather than beyond its
 * end, so that nothing protrudes into the slab below or the storey above.
 *
 * Pure geometry, in metres, with the plan conventions of `floorPlan/types.ts`
 * and `planBox.ts`: no rendering, no scene objects, no palette key, nothing
 * mutated. Plan coordinates arrive on the centimetre grid and the boxes derived
 * here deliberately do NOT stay on it — half of a 0.11 m bore is 0.055 m, and
 * snapping that to a centimetre would make a soil pipe a different size
 * depending on where it was laid.
 */

import { makeBox } from './planBox.ts';
import type { PlanBox } from './planBox.ts';
import { LENGTH_TOLERANCE, makeRect } from './planGeometry.ts';
import {
  FLOOR_NUMBER,
  SERVICE_CHAMBERS,
  SERVICE_RUNS,
  SERVICE_SPEC,
} from './sourceOfTruth/plan.ts';
import type {
  PlanRoomId,
  PlanServiceEnd,
  PlanServiceFamily,
  PlanServiceLayerKey,
  PlanServicePoint,
  PlanServiceRun,
} from './sourceOfTruth/plan.ts';

/* ------------------------------------------------------------------ *
 * Sizes and names. Every one of them is a run's own dimension, never a
 * building dimension (`heights.ts`), and every one carries its reason.
 * ------------------------------------------------------------------ */

/**
 * Matricule tag of a run: `S`, for service.
 *
 * `W`, `P`, `G` and `X` are taken — by walls, ports, glazing and fixtures — and
 * the plan's own note beside `FIXTURES` is where that list is kept.
 */
const SERVICE_TAG = 'S';

/**
 * The layer part of a matricule, by layer key.
 *
 * Three letters, because that is the width the plan already numbers rooms in
 * (`R11/KIT`, `F1-R11-KIT-W3`) and a matricule that mixes widths stops lining up
 * in a register. `ELV` rather than `LVO` for low voltage: extra-low voltage is
 * what the trade calls it, and a code nobody has to be taught is worth more than
 * a code derived mechanically from a camel-case key.
 *
 * Total over {@link PlanServiceLayerKey} rather than over the six layers that
 * carry runs, and the three `undefined`s are the point: `covers`, `furniture`
 * and `finishing` are drawn layers, not services, and nothing runs in them. A
 * layer invented tomorrow cannot dodge the question — the record will not
 * compile until somebody decides whether it carries runs — and a run declared
 * under one of the three fails loudly in {@link buildServiceRun} instead of
 * being numbered into a layer that has no pipes.
 */
const LAYER_CODES: Readonly<Record<PlanServiceLayerKey, string | undefined>> = {
  drainage: 'DRN',
  water: 'WTR',
  gas: 'GAS',
  electricity: 'ELE',
  lowVoltage: 'ELV',
  climate: 'CLM',
  covers: undefined,
  furniture: undefined,
  finishing: undefined,
};

/** Level of the finished floor, in metres: the datum every declared `y` is measured from. */
const FLOOR_LEVEL = 0;

/**
 * Thickness of a cap, in metres: the stop-end plugging a run that stops.
 *
 * 0.02 m is a moulded socket cap rather than a disc — the thing a plumber
 * actually pushes onto the end of a pipe. Thinner would read as a sheet of paper
 * across the bore at any distance a room is looked at from, and thicker would
 * read as a lump on the end of the stack. It is not derived from the bore on
 * purpose: a 110 mm stop-end and a 20 mm one are the same depth of fitting, not
 * five times apart.
 */
const CAP_THICKNESS = 0.02;

/** Index of each axis inside a {@link PlanServicePoint}, which is `[x, z, y]`. */
const AXIS_INDEX = { x: 0, z: 1, y: 2 } as const;

/* ------------------------------------------------------------------ *
 * What a built run is.
 * ------------------------------------------------------------------ */

/** The direction one segment of a run travels in; `y` is a riser. */
export type ServiceAxis = keyof typeof AXIS_INDEX;

/** One straight leg of a run: the box it is drawn as and the axis it travels on. */
export interface ServiceSegment {
  /** The box, of cross-section `bore × bore` about the centreline. */
  readonly box: PlanBox;
  /** Which of `x`, `z` or `y` the leg travels along; a leg may also fall, in `y`. */
  readonly axis: ServiceAxis;
}

/** One declared run, given its third dimension. */
export interface BuiltServiceRun {
  /** The checkbox it appears under. */
  readonly layer: PlanServiceLayerKey;
  /** What it carries, which is what picked its bore. */
  readonly family: PlanServiceFamily;
  /** Its matricule, e.g. `F1-DRN-S4`: floor, layer code, then the S number. */
  readonly matricule: string;
  /** Outside diameter, in metres, from `SERVICE_SPEC.bore` and never from the run. */
  readonly bore: number;
  /** The run itself, one box per declared leg, upstream first. */
  readonly segments: readonly ServiceSegment[];
  /** The boxing over it, leg by leg; empty where the run is buried in the floor. */
  readonly cover: readonly PlanBox[];
  /** The plugs stopping it, only where an end is `at: 'cap'`; `from` first. */
  readonly caps: readonly PlanBox[];
  /** The declaration it was built from, untouched. */
  readonly run: PlanServiceRun;
}

/* ------------------------------------------------------------------ *
 * Geometry.
 * ------------------------------------------------------------------ */

/**
 * Names the axis a leg travels along, and rejects a leg that cannot be built.
 *
 * A leg may change one horizontal axis, or `y` alone, or one horizontal axis and
 * `y` together — the last of those being a pipe laid to a fall, which is what
 * `SERVICE_SPEC.fall` exists to size and what every drainage branch in the plan
 * does. What it may not do is change `x` and `z` together: that is a pipe cut
 * across a room corner to corner, which nobody builds and which has to be
 * declared as two legs.
 *
 * Exported so that the guard can be tested directly: the declared runs all clear
 * it by construction, so a suite that could only reach it through `SERVICE_RUNS`
 * could never see it fail.
 *
 * @param from - Upstream end of the leg.
 * @param to - Downstream end of the leg.
 * @param where - How to name the leg in a message, e.g. `F1-DRN-S4 leg 2`.
 * @returns The axis the leg travels along; `y` when it only rises or drops.
 * @throws RangeError naming the leg and both points when it changes `x` and `z`
 *   together, or when it moves on no axis at all.
 */
export function assertRunAxis(
  from: PlanServicePoint,
  to: PlanServicePoint,
  where: string,
): ServiceAxis {
  const movedX = Math.abs(to[0] - from[0]) > LENGTH_TOLERANCE;
  const movedZ = Math.abs(to[1] - from[1]) > LENGTH_TOLERANCE;
  const movedY = Math.abs(to[2] - from[2]) > LENGTH_TOLERANCE;
  const points = `[${from.join(', ')}] → [${to.join(', ')}]`;
  if (movedX && movedZ) {
    throw new RangeError(
      `${where} runs diagonally in plan, ${points}: a leg may change x or z, not both — declare it as two legs`,
    );
  }
  if (!movedX && !movedZ && !movedY) {
    throw new RangeError(`${where} repeats its own point, ${points}: a leg must have a direction`);
  }
  return movedX ? 'x' : movedZ ? 'z' : 'y';
}

/**
 * Builds the box between two centreline points.
 *
 * The extent on the travelling axis is point to point; the other two axes are
 * padded by `half` either side of the centreline. A falling leg therefore pads
 * `y` as well — the box spans the fall plus the bore, which is a level box
 * containing a sloped pipe rather than a sheared one (see the module docblock).
 *
 * @param from - One end of the leg, as `[x, z, y]`.
 * @param to - The other end.
 * @param axis - The axis it travels along, from {@link assertRunAxis}.
 * @param half - Half the cross-section to pad the other two axes by, in metres.
 * @returns A frozen {@link PlanBox}.
 * @throws RangeError from `makeBox` when the box has no height.
 */
function boxBetween(
  from: PlanServicePoint,
  to: PlanServicePoint,
  axis: ServiceAxis,
  half: number,
): PlanBox {
  const pad = (index: number): number => (AXIS_INDEX[axis] === index ? 0 : half);
  const low = (index: 0 | 1 | 2): number => Math.min(from[index], to[index]) - pad(index);
  const high = (index: 0 | 1 | 2): number => Math.max(from[index], to[index]) + pad(index);
  return makeBox(makeRect(low(0), high(0), low(1), high(1)), low(2), high(2));
}

/**
 * Walks a short way along a leg from one of its ends.
 *
 * Used to place a cap inside the run rather than beyond it. The distance is
 * clamped to the length of the leg, so that a leg shorter than a stop-end is
 * plugged over its whole length instead of having the plug stick out the far
 * side of it.
 *
 * @param end - The point to start from.
 * @param neighbour - The next point along the leg, which gives the direction.
 * @param axis - The axis the leg travels along.
 * @param distance - How far to walk, in metres.
 * @returns A point `distance` along the leg from `end`, or `neighbour` when the
 *   leg is shorter than that.
 */
function alongFrom(
  end: PlanServicePoint,
  neighbour: PlanServicePoint,
  axis: ServiceAxis,
  distance: number,
): PlanServicePoint {
  const index = AXIS_INDEX[axis];
  const travel = neighbour[index] - end[index];
  if (Math.abs(travel) <= distance) {
    return neighbour;
  }
  const moved: [number, number, number] = [end[0], end[1], end[2]];
  moved[index] = end[index] + Math.sign(travel) * distance;
  return moved;
}

/**
 * Tells whether a leg is buried in the floor build-up.
 *
 * Asked of the HIGHEST point of the leg, not of the run: a stack that starts at
 * −0.28 and rises to 2.72 is visible for three metres of its length and is boxed
 * in over that part, while a waste branch whose every point is negative is under
 * the screed from end to end and is boxed in nowhere.
 *
 * @param from - One end of the leg.
 * @param to - The other end.
 * @returns `true` when the whole leg lies at or below the finished floor.
 */
function isBuried(from: PlanServicePoint, to: PlanServicePoint): boolean {
  return Math.max(from[2], to[2]) <= FLOOR_LEVEL + LENGTH_TOLERANCE;
}

/**
 * Builds the cap plugging one end of a run.
 *
 * @param end - The point the run stops at.
 * @param neighbour - The next point along, which gives the direction to plug in.
 * @param half - Half the bore, in metres.
 * @param where - How to name the end in a message.
 * @returns A frozen {@link PlanBox}: a solid plug across the bore, set inside the
 *   last {@link CAP_THICKNESS} of the run.
 * @throws RangeError when the leg the cap sits on cannot be built.
 */
function capAt(
  end: PlanServicePoint,
  neighbour: PlanServicePoint,
  half: number,
  where: string,
): PlanBox {
  const axis = assertRunAxis(end, neighbour, where);
  return boxBetween(end, alongFrom(end, neighbour, axis, CAP_THICKNESS), axis, half);
}

/* ------------------------------------------------------------------ *
 * Building a run.
 * ------------------------------------------------------------------ */

/**
 * Builds one declared run.
 *
 * @param run - The row of the source of truth.
 * @param index - Its S number within its layer, counted from 1.
 * @returns The frozen {@link BuiltServiceRun}.
 * @throws RangeError naming the run when its layer carries no services, when it
 *   declares fewer than two points, or when one of its legs cannot be built
 *   ({@link assertRunAxis}).
 */
function buildServiceRun(run: PlanServiceRun, index: number): BuiltServiceRun {
  const code = LAYER_CODES[run.layer];
  if (code === undefined) {
    throw new RangeError(
      `a run is declared in layer "${run.layer}", which carries no services — it is a drawn layer, not a service`,
    );
  }
  const matricule = `F${String(FLOOR_NUMBER)}-${code}-${SERVICE_TAG}${String(index)}`;
  const { points } = run;
  if (points.length < 2) {
    throw new RangeError(
      `run ${matricule} declares ${String(points.length)} point(s): a run needs at least two`,
    );
  }
  const bore = SERVICE_SPEC.bore[run.family];
  const half = bore / 2;
  const coverHalf = half + SERVICE_SPEC.coverClearance + SERVICE_SPEC.coverThickness;

  const segments: ServiceSegment[] = [];
  const cover: PlanBox[] = [];
  points.slice(0, -1).forEach((from, leg) => {
    const to = points[leg + 1];
    const axis = assertRunAxis(from, to, `run ${matricule} leg ${String(leg + 1)}`);
    segments.push(Object.freeze({ box: boxBetween(from, to, axis, half), axis }));
    if (!isBuried(from, to)) {
      cover.push(boxBetween(from, to, axis, coverHalf));
    }
  });

  const caps: PlanBox[] = [];
  const last = points.length - 1;
  if (run.from.at === 'cap') {
    caps.push(capAt(points[0], points[1], half, `run ${matricule} start cap`));
  }
  if (run.to.at === 'cap') {
    caps.push(capAt(points[last], points[last - 1], half, `run ${matricule} end cap`));
  }

  return Object.freeze({
    layer: run.layer,
    family: run.family,
    matricule,
    bore,
    segments: Object.freeze(segments),
    cover: Object.freeze(cover),
    caps: Object.freeze(caps),
    run,
  });
}

/**
 * Builds every declared run of every service.
 *
 * The runs are numbered **within their layer, in declaration order**, which is
 * the same shape as every other matricule on this floor: a fixture is numbered
 * within its room (`R13/BTH-X1`) and a wall within its room (`F1-R11-KIT-W3`),
 * so a run is numbered within the thing it belongs to, which is its layer. One
 * global sequence would have made `S14` the first water run only for as long as
 * drainage had thirteen runs, and renumbered the whole installation the day a
 * branch was added to a bathroom. `F1-DRN-S4` survives that; it names a
 * particular drain, and which drain it names does not depend on what any other
 * layer declares.
 *
 * The result is in declaration order — the order of `SERVICE_RUNS`, which is
 * layer by layer — as `getFixtures` returns its fixtures in plan order.
 *
 * @param runs - The run rows of the source of truth; defaults to `SERVICE_RUNS`.
 *   Not mutated.
 * @returns A frozen array of frozen runs, each with frozen segments, covers and
 *   caps.
 * @throws RangeError naming the run when its layer carries no services, when it
 *   declares fewer than two points, or when one of its legs runs diagonally in
 *   plan or repeats its own point ({@link assertRunAxis}).
 */
export function getServiceRuns(
  runs: readonly PlanServiceRun[] = SERVICE_RUNS,
): readonly BuiltServiceRun[] {
  const counted = new Map<PlanServiceLayerKey, number>();
  return Object.freeze(
    runs.map((run) => {
      const index = (counted.get(run.layer) ?? 0) + 1;
      counted.set(run.layer, index);
      return buildServiceRun(run, index);
    }),
  );
}

/**
 * Picks the runs of one layer.
 *
 * @param built - The runs of the floor, as {@link getServiceRuns} built them.
 * @param layer - The layer to look in, as the store and the checkbox spell it.
 * @returns A frozen array of the runs of that layer, in declaration order; empty
 *   when nothing is declared in it yet.
 */
export function getServiceRunsOf(
  built: readonly BuiltServiceRun[],
  layer: PlanServiceLayerKey,
): readonly BuiltServiceRun[] {
  return Object.freeze(built.filter((run) => run.layer === layer));
}

/**
 * Tells whether one end of a run lands in a given room.
 *
 * A `chamber` end is resolved through `SERVICE_CHAMBERS` to the room the
 * compartment stands in, because a chamber IS in a room — both compartments of
 * the control center stand in `controlCenter` — and a caller asking what serves
 * the control center means the heater and the consumer unit in it. A `cap` end
 * lands nowhere: it is where the run stops for want of a storey to go to.
 *
 * @param end - One end of a declared run.
 * @param id - Identifier of the room to test.
 * @returns `true` when the end is in that room.
 * @throws RangeError when the end names a chamber the plan does not declare.
 */
function endReaches(end: PlanServiceEnd, id: PlanRoomId): boolean {
  switch (end.at) {
    case 'space':
      return end.space === id;
    case 'fitting':
      return end.space === id;
    case 'chamber': {
      const chamber = SERVICE_CHAMBERS.find((candidate) => candidate.id === end.chamber);
      if (chamber === undefined) {
        throw new RangeError(
          `a run ends at chamber "${end.chamber}", which the plan does not hold`,
        );
      }
      return chamber.room === id;
    }
    case 'cap':
      return false;
  }
}

/**
 * Picks the runs that reach one room.
 *
 * Asked of the two declared ENDS and not of the geometry, which is the answer to
 * the question a reader of this function will have: a branch crosses the void it
 * falls into and the wall it passes through, and neither of those is a room it
 * serves. What serves a room is what starts or stops there — a fitting's outlet,
 * a run declared into the space, or a chamber standing in it.
 *
 * @param built - The runs of the floor, as {@link getServiceRuns} built them.
 * @param spaceId - Identifier of the room to look at.
 * @returns A frozen array of the runs with an end in that room, in declaration
 *   order; empty when nothing serves it.
 * @throws RangeError when a run ends at a chamber the plan does not declare.
 */
export function getServiceRunsReaching(
  built: readonly BuiltServiceRun[],
  spaceId: PlanRoomId,
): readonly BuiltServiceRun[] {
  return Object.freeze(
    built.filter((run) => endReaches(run.run.from, spaceId) || endReaches(run.run.to, spaceId)),
  );
}
