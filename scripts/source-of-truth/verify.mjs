/**
 * Self-check of the floor plan source of truth: `node scripts/source-of-truth/verify.mjs`
 *
 * WHY a verifier and not tests: the numbers in the source of truth
 * (`src/features/building/domain/sourceOfTruth/plan.ts`) are the owner's,
 * edited between sessions by hand on a drawing. What breaks is never the code,
 * it is a rectangle moved 5 cm so a wall no longer closes, a door pushed flush
 * against a return, a room that ends up reachable only through the stairwell
 * that has no floor. Those are geometry facts, so they are checked against each
 * other, arithmetically, and printed as numbers the owner can compare with the
 * drawing — not asserted inside a test name he will never read.
 *
 * WHY it must stay runnable with bare Node: it is the gate the drawing and the
 * 3D model are regenerated behind, so it has to work before anything is
 * installed, and its report has to be readable in a terminal.
 *
 * Exit code 0 only when every check passes.
 */

import {
  FLOOR_NUMBER,
  PLOT,
  WALLS,
  HEIGHTS,
  STAIRS,
  ROOMS,
  JOIN_OVERRIDES,
  PORTS,
  WINDOWS,
  FIXTURES,
  FIXTURE_SPEC,
  FIXTURE_ROLES,
  compareFixturePosition,
  INSULATED_WALLS,
  PARAPET_WALLS,
  SIDES,
} from '../../src/features/building/domain/sourceOfTruth/plan.ts';
import {
  getClearanceRect,
  getSwingRect,
} from '../../src/features/building/domain/swingClearance.ts';
import { deriveWalls, wallsByRoom } from './walls.mjs';

/** @import { Axis, DerivedOpening, MutableSpan, PlanSpec, Side, Span, Wall } from './walls.mjs' */
/**
 * @import { InsulatedWall, ParapetWall, PlanFixture, PlanJoinOverride,
 *   PlanRectCoordinates, PlanRoom, PlanRoomId, PlanRoomKind }
 *   from '../../src/features/building/domain/sourceOfTruth/plan.ts'
 */
/** @import { PlanRect, RectSide } from '../../src/features/building/domain/planGeometry.ts' */

/**
 * One of the stairwell's pieces, as {@link STAIR_PIECES} reads it out of STAIRS.
 *
 * @typedef {object} StairPiece
 * @property {string} key The name the piece is declared under in STAIRS.
 * @property {PlanRectCoordinates} rect Its footprint on the plan.
 */

/**
 * A stair piece that is at this storey's level, with the open edge it reaches.
 *
 * @typedef {StairPiece & { edge: Wall }} LevelPiece
 */

/**
 * One stretch of a wall face that looks at one particular neighbour, measured
 * off the room rects by {@link contactsOf}.
 *
 * `room` carries the narrow `PlanRoomId` alongside `PlanRoom`, because
 * `PlanRoom.id` is a plain string while a `JOIN_OVERRIDES` pair is declared in
 * room ids: a room read back as a bare `PlanRoom` could not be asked whether an
 * override names it.
 *
 * @typedef {object} MeasuredContact
 * @property {PlanRoom & { readonly id: PlanRoomId }} room The space behind the stretch.
 * @property {number} gap Clear distance to it: the gap the rects leave, in metres.
 * @property {Span} span The stretch, along the wall's axis.
 */

/**
 * The source of truth, as the whole module namespace `deriveWalls` asks for.
 *
 * `SIDES` is read neither here nor in the derivation; it is listed because
 * `PlanSpec` is `typeof plan`, and a copy missing one of the plan's exports is
 * not that module. The annotation is what makes that a checked claim rather than
 * a hope: without it the literal's `FLOOR_NUMBER` widens to `number` and stops
 * being the plan's `1`.
 *
 * @type {PlanSpec}
 */
const SPEC = {
  FLOOR_NUMBER,
  PLOT,
  WALLS,
  HEIGHTS,
  STAIRS,
  ROOMS,
  JOIN_OVERRIDES,
  PORTS,
  WINDOWS,
  FIXTURES,
  FIXTURE_SPEC,
  FIXTURE_ROLES,
  compareFixturePosition,
  INSULATED_WALLS,
  PARAPET_WALLS,
  SIDES,
};

const EPS = 1e-6;
/**
 * Round to the centimetre — the grid the whole source of truth lives on.
 *
 * @param {number} v Any metre value.
 * @returns {number} It, on the centimetre grid.
 */
const cm = (v) => Math.round(v * 100) / 100;
/**
 * Plain number for chain lines: 12, 4.5, 0.3 — not 12.00.
 *
 * @param {number} v A metre value.
 * @returns {string} It, printed as short as it goes.
 */
const n = (v) => String(cm(v));
/**
 * Two decimals, for every column the owner reads against the drawing.
 *
 * @param {number} v A metre value.
 * @returns {string} It, printed to the centimetre.
 */
const m = (v) => cm(v).toFixed(2);

/** Interior boundary of the plot: the envelope eats 0.30 on every side. */
const INNER = {
  minX: cm(PLOT[0] + WALLS.exterior),
  maxX: cm(PLOT[1] - WALLS.exterior),
  minZ: cm(PLOT[2] + WALLS.exterior),
  maxZ: cm(PLOT[3] - WALLS.exterior),
};
const PLOT_AREA = cm((PLOT[1] - PLOT[0]) * (PLOT[3] - PLOT[2]));

/** The kinds that carry walkable floor, as opposed to a hole or the stair bay. */
const FLOOR_KINDS = new Set(['room', 'circulation', 'openAir']);

/**
 * Is this one of the kinds that carries walkable floor? An id that names no room
 * has no kind at all, and no kind is not a floored one — which is what lets the
 * question be asked of whatever a neighbour list happens to hold.
 *
 * @param {PlanRoomKind | undefined} kind What a space is, when it is a space.
 * @returns {boolean} Whether it carries floor.
 */
const isFloorKind = (kind) => kind !== undefined && FLOOR_KINDS.has(kind);

/**
 * Is this value one of the stairwell's pieces — a rect of four numbers — rather
 * than a riser count or a going? The same three tests STAIR_PIECES has always
 * made, named so that what survives them is known to be a rect.
 *
 * @param {unknown} value Any value read off STAIRS.
 * @returns {value is PlanRectCoordinates} Whether it is a rect.
 */
const isRect = (value) =>
  Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === 'number');

/**
 * The stairwell's pieces, read out of STAIRS by shape rather than by name: every
 * 4-number rect on it except the bay they tile.
 *
 * WHY not a written list: a hand-kept list of piece names is only right until
 * someone adds a fifth piece, and the failure is silent — the missing piece is
 * simply never checked, never drawn, and nobody sees an error. A renderer lost
 * one that way this round. Enumerating the spec cannot miss one.
 *
 * flatMap rather than filter-then-map: the tests and the keeping happen in one
 * pass, so what comes out is a rect the checker has seen proved to be one,
 * instead of a value that still might be the riser count.
 *
 * @type {StairPiece[]}
 */
const STAIR_PIECES = Object.entries(STAIRS).flatMap(([key, value]) =>
  key !== 'bay' && isRect(value) ? [{ key, rect: value }] : [],
);

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];
let currentCheck = '';
/**
 * Record a geometry fact that does not hold, against the check that found it.
 *
 * @param {string} message What is wrong, in the owner's terms.
 * @returns {number} The new length of the failure list, as `push` gives it.
 */
const fail = (message) => failures.push(`${currentCheck}: ${message}`);
/**
 * Open a numbered check, and become the check a failure is attributed to.
 *
 * @param {string} title The check's heading.
 * @returns {void}
 */
const check = (title) => {
  currentCheck = title;
  console.log(`\n── ${title}`);
};
/**
 * One indented line of a check's report.
 *
 * @param {string} text The line.
 * @returns {void}
 */
const line = (text) => console.log(`   ${text}`);

/**
 * Area of one rect, in square metres.
 *
 * @param {PlanRectCoordinates} rect The rect, `[minX, maxX, minZ, maxZ]`.
 * @returns {number} Its area.
 */
const rectArea = ([minX, maxX, minZ, maxZ]) => (maxX - minX) * (maxZ - minZ);
/**
 * Area of one room, its rects added up and rounded to the centimetre.
 *
 * @param {PlanRoom} room The room.
 * @returns {number} Its area in square metres.
 */
const roomArea = (room) => cm(room.rects.reduce((sum, r) => sum + rectArea(r), 0));
/**
 * Do two rects share floor? Touching along an edge is not overlapping.
 *
 * @param {PlanRectCoordinates} a One rect.
 * @param {PlanRectCoordinates} b The other.
 * @returns {boolean} Whether they overlap.
 */
const rectsOverlap = (a, b) =>
  a[0] < b[1] - EPS && b[0] < a[1] - EPS && a[2] < b[3] - EPS && b[2] < a[3] - EPS;
/**
 * Is this coordinate a whole number of centimetres?
 *
 * @param {number} v A metre value.
 * @returns {boolean} Whether it lands on the grid.
 */
const onGrid = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

/**
 * A rect as the domain hands it back, as the four numbers this script speaks.
 *
 * `swingClearance.ts` returns a `PlanRect` object and every rect here is a
 * `[minX, maxX, minZ, maxZ]` tuple, so the two vocabularies meet in exactly one
 * place: this function. Its edges are already on the centimetre grid —
 * `toPlanLength` put them there — and `cm` is applied anyway so that a rect
 * built here is indistinguishable from one built by the arithmetic above it.
 *
 * @param {PlanRect} rect A rectangle as the domain names its faces.
 * @returns {PlanRectCoordinates} The same rectangle, as this script's tuple.
 */
const tupleOf = (rect) => [cm(rect.minX), cm(rect.maxX), cm(rect.minZ), cm(rect.maxZ)];

/**
 * The compass name of a derived wall's face, as the coordinate name the domain
 * uses for the same face.
 *
 * `walls.mjs` names a face by where it looks (`north`), `planGeometry.ts` names
 * it by the coordinate it lies on (`minZ`): a room's north face IS its `minZ`,
 * and inward from it is `+z`. The mapping is stated once, here, and checked by
 * the table in the `swingClearance.ts` module docstring, which was written
 * against the four-branch ternary this replaces.
 *
 * @type {Readonly<Record<Side, RectSide>>}
 */
const FACE_OF_SIDE = Object.freeze({
  north: 'minZ',
  south: 'maxZ',
  east: 'maxX',
  west: 'minX',
});

const walls = deriveWalls(SPEC);
const byRoom = wallsByRoom(walls);

/**
 * Physical walls: which faces back onto which, and where the owner's isolation
 * actually lands along them.
 *
 * WHY at module scope: check 8 (is each stretch built the thickness the rules
 * ask for?) and check 10 (the isolation register) are asking the same question —
 * what is built along this stretch — from two directions. Two copies of that
 * answer would drift the first time the layout moved, and the layout moves every
 * round.
 */
/** @type {Readonly<Record<Side, Side>>} */
const OPPOSITE_SIDE = Object.freeze({ north: 'south', south: 'north', east: 'west', west: 'east' });

/**
 * The two faces of one physical wall: same axis, opposite sides, the second on
 * the outward side of the first and no further than one exterior wall away,
 * spans overlapping. Isolation and thickness are properties of the built wall,
 * so what is true of one face is true of whatever backs onto it.
 *
 * @param {Wall} a One face.
 * @param {Wall} b The other.
 * @returns {boolean} Whether they are the two faces of one built wall.
 */
const facesEachOther = (a, b) => {
  if (a.axis !== b.axis || b.side !== OPPOSITE_SIDE[a.side]) return false;
  const gap =
    a.side === 'north'
      ? a.at - b.at
      : a.side === 'south'
        ? b.at - a.at
        : a.side === 'east'
          ? b.at - a.at
          : a.at - b.at;
  if (gap < -EPS || gap > WALLS.exterior + EPS) return false;
  return Math.min(a.spanMax, b.spanMax) - Math.max(a.spanMin, b.spanMin) > EPS;
};

/**
 * Union of spans, merging anything that touches.
 *
 * @param {readonly Span[]} spans The spans to union, in any order.
 * @returns {MutableSpan[]} The union, sorted and non-overlapping.
 */
const mergeSpans = (spans) => {
  /** @type {MutableSpan[]} */
  const out = [];
  for (const [lo, hi] of [...spans].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
};

/** Wall matricule -> the merged spans of that face that are built for isolation. */
const INSULATED_SPANS = (() => {
  const byMatricule = new Map(walls.map((w) => /** @type {[string, Wall]} */ ([w.matricule, w])));
  /** @type {Map<string, MutableSpan[]>} */
  const spans = new Map(
    walls.map((w) => /** @type {[string, MutableSpan[]]} */ ([w.matricule, []])),
  );
  /**
   * The heavy spans recorded against one face. Every derived wall is seeded
   * above, so this only ever hands back a list that is already there; creating
   * one on demand rather than indexing straight into the map is what keeps that
   * a fact the reader can see instead of an assumption.
   *
   * @param {string} matricule The face to record against.
   * @returns {MutableSpan[]} Its list, ready to be pushed onto.
   */
  const spansOf = (matricule) => {
    let list = spans.get(matricule);
    if (!list) {
      list = [];
      spans.set(matricule, list);
    }
    return list;
  };
  for (const entry of INSULATED_WALLS) {
    const wall = byMatricule.get(entry.matricule);
    if (!wall) continue;
    spansOf(wall.matricule).push([wall.spanMin, wall.spanMax]);
    for (const other of walls) {
      if (other.matricule === wall.matricule || !facesEachOther(wall, other)) continue;
      const lo = Math.max(wall.spanMin, other.spanMin);
      const hi = Math.min(wall.spanMax, other.spanMax);
      if (hi - lo > EPS) spansOf(other.matricule).push([cm(lo), cm(hi)]);
    }
  }
  return new Map(
    [...spans].map(
      ([key, list]) => /** @type {[string, MutableSpan[]]} */ ([key, mergeSpans(list)]),
    ),
  );
})();

/**
 * Is this stretch of that face built heavy? `partly` means the boundary cuts through it.
 *
 * @param {Wall} wall The face to ask about.
 * @param {Span} span The stretch of it, along the wall's axis.
 * @returns {'whole' | 'partly' | 'none'} How much of the stretch is heavy.
 */
const insulationAt = (wall, span) => {
  const list = INSULATED_SPANS.get(wall.matricule) ?? [];
  if (list.some((s) => span[0] >= s[0] - EPS && span[1] <= s[1] + EPS)) return 'whole';
  if (list.some((s) => Math.min(s[1], span[1]) - Math.max(s[0], span[0]) > EPS)) return 'partly';
  return 'none';
};

/**
 * Every stretch of a wall face that looks at one particular neighbour, measured
 * off the rects rather than read off the derived wall: the point of this check is
 * to catch the derivation being wrong, so it must not ask the derivation what
 * the answer is.
 *
 * @param {Wall} wall The face to measure along.
 * @returns {MeasuredContact[]} Its stretches, in order along the axis.
 */
const contactsOf = (wall) => {
  /** @type {MeasuredContact[]} */
  const out = [];
  for (const other of ROOMS) {
    if (other.n === wall.roomN) continue;
    for (const [minX, maxX, minZ, maxZ] of other.rects) {
      const gap =
        wall.side === 'north'
          ? wall.at - maxZ
          : wall.side === 'south'
            ? minZ - wall.at
            : wall.side === 'east'
              ? minX - wall.at
              : wall.at - maxX;
      if (gap < -EPS || gap > WALLS.exterior + EPS) continue;
      const theirSpan = wall.axis === 'x' ? [minX, maxX] : [minZ, maxZ];
      const lo = Math.max(theirSpan[0], wall.spanMin);
      const hi = Math.min(theirSpan[1], wall.spanMax);
      if (hi - lo <= EPS) continue;
      out.push({ room: other, gap: cm(gap), span: [cm(lo), cm(hi)] });
    }
  }
  return out.sort((a, b) => a.span[0] - b.span[0]);
};

console.log(
  `floor plan v2 — self-check (floor ${FLOOR_NUMBER}, plot ${n(PLOT[1])} × ${n(PLOT[3])})`,
);
console.log(
  `${ROOMS.length} spaces · ${walls.length} derived walls · ${PORTS.length} ports · ${WINDOWS.length} windows · ${FIXTURES.length} fixtures`,
);

/* ───────────────────────────── 1. rects ───────────────────────────── */

check('1. Rectangles: no overlap, inside the interior, on the centimetre grid');
{
  for (let i = 0; i < ROOMS.length; i += 1) {
    for (const [ri, rect] of ROOMS[i].rects.entries()) {
      // Intra-room first: two rects of one room may touch but never overlap,
      // or the outline walk in walls.mjs would be meaningless.
      for (let rj = ri + 1; rj < ROOMS[i].rects.length; rj += 1) {
        if (rectsOverlap(rect, ROOMS[i].rects[rj])) {
          fail(`${ROOMS[i].id} rect ${ri} overlaps its own rect ${rj}`);
        }
      }
      for (let j = i + 1; j < ROOMS.length; j += 1) {
        for (const other of ROOMS[j].rects) {
          if (rectsOverlap(rect, other)) {
            fail(
              `${ROOMS[i].id} [${rect.map(n).join(', ')}] overlaps ${ROOMS[j].id} [${other.map(n).join(', ')}]`,
            );
          }
        }
      }
      const [minX, maxX, minZ, maxZ] = rect;
      if (
        minX < INNER.minX - EPS ||
        maxX > INNER.maxX + EPS ||
        minZ < INNER.minZ - EPS ||
        maxZ > INNER.maxZ + EPS
      ) {
        fail(
          `${ROOMS[i].id} rect ${ri} leaves the interior ${n(INNER.minX)}–${n(INNER.maxX)} × ${n(INNER.minZ)}–${n(INNER.maxZ)}`,
        );
      }
      if (maxX - minX < EPS || maxZ - minZ < EPS) fail(`${ROOMS[i].id} rect ${ri} is degenerate`);
    }
  }

  /**
   * Every number STAIRS declares, read off the spec by shape rather than from a
   * written list of piece names: each coordinate of each rect, and each bare
   * number beside them.
   *
   * WHY not the written list it replaces. That list named bay, flightA, flightB
   * and halfLanding — and STAIRS declares a fifth rect, `landingEast`, the
   * arrival landing this storey actually stands on. It was never grid-checked at
   * all, and the failure was silent: a landing nudged half a centimetre would
   * have passed check 1 and gone on to be drawn. It is the same trap
   * {@link STAIR_PIECES} warns about in its own header, sprung a second time four
   * hundred lines away by a list that restates the spec instead of reading it.
   * Enumerating cannot miss a piece: a newly declared rect is on the grid rule
   * the moment it is written, and so is a newly declared going or width.
   *
   * @type {[string, number][]}
   */
  const stairValues = Object.entries(STAIRS).flatMap(([key, value]) =>
    isRect(value)
      ? value.map((v, i) => /** @type {[string, number]} */ ([`STAIRS.${key}[${i}]`, v]))
      : typeof value === 'number'
        ? [/** @type {[string, number]} */ ([`STAIRS.${key}`, value])]
        : [],
  );
  /**
   * The numeric fields of a declared opening that the grid rule applies to.
   *
   * @type {readonly ('spanMin' | 'width' | 'sill' | 'head')[]}
   */
  const openingFields = ['spanMin', 'width', 'sill', 'head'];
  /**
   * Ports and windows, seen as the numbers the grid rule cares about plus the
   * pair of rooms that names them in a failure.
   *
   * WHY not `PlanPort | PlanWindow`: on that union, asking a port for its `sill`
   * is an error before the `undefined` test below can answer it — and walking a
   * field list is the point here, because a list written out per kind is the
   * thing that goes stale when a field is added.
   *
   * @type {readonly (Partial<Record<'spanMin' | 'width' | 'sill' | 'head', number>>
   *   & { readonly between: readonly string[] })[]}
   */
  const openings = [...PORTS, ...WINDOWS];
  /** @type {[string, number][]} */
  const gridValues = [
    ...PLOT.map((v, i) => /** @type {[string, number]} */ ([`PLOT[${i}]`, v])),
    ...Object.entries(WALLS),
    ...Object.entries(HEIGHTS),
    ...ROOMS.flatMap((r) =>
      r.rects.flatMap((rect, ri) =>
        rect.map((v, k) => /** @type {[string, number]} */ ([`${r.id}.rects[${ri}][${k}]`, v])),
      ),
    ),
    ...stairValues,
    // flatMap rather than filter-then-map: a port has no sill and no head, and
    // this way the value that survived the test is the one paired with its
    // label, instead of being read a second time and assumed to be there.
    ...openings.flatMap((o) =>
      openingFields.flatMap((f) => {
        const v = o[f];
        return v === undefined
          ? []
          : [/** @type {[string, number]} */ ([`${o.between.join('↔')}.${f}`, v])];
      }),
    ),
  ];
  const offGrid = gridValues.filter(([, v]) => !onGrid(v));
  for (const [label, v] of offGrid) fail(`${label} = ${v} is not on the centimetre grid`);
  line(
    `${ROOMS.reduce((c, r) => c + r.rects.length, 0)} rects, ${gridValues.length} coordinates checked`,
  );
  line(`interior ${n(INNER.minX)}–${n(INNER.maxX)} (x) × ${n(INNER.minZ)}–${n(INNER.maxZ)} (z)`);
}

/* ───────────────────────────── 2. areas ───────────────────────────── */

check('2. Areas: room table, and the four totals closing on the plot');
{
  for (const room of ROOMS) {
    line(
      `R${String(room.n).padStart(2, '0')} ${room.id.padEnd(18)} ${room.kind.padEnd(11)} ${m(roomArea(room)).padStart(7)} m²`,
    );
  }

  /**
   * Every total here is computed UNROUNDED and rounded only to print.
   *
   * WHY: the rooms sit on the centimetre grid but their AREAS do not — a
   * 2.45 × 2.30 bathroom is 5.6350 m², and a 0.15 m wall makes fractions of a
   * centimetre squared routine. Rounding each room and then summing is therefore
   * a different number from summing and then rounding, and this check used to do
   * one of each and compare them: 225 − 180.65 (rooms rounded first) = 44.35,
   * against a true remainder of 44.3575 that prints as 44.36. It reported that
   * centimetre as "a rect overlaps or leaves the plot" for several rounds. It was
   * reporting its own arithmetic.
   *
   * Like is compared with like now, and the tolerance is a real area rather than
   * float noise, so an actual overlap of half a square centimetre still fails.
   */
  const AREA_TOL = 0.005;
  /**
   * @param {PlanRoom} room A space of the floor.
   * @returns {number} Its area in square metres, unrounded.
   */
  const exactArea = (room) => room.rects.reduce((sum, r) => sum + rectArea(r), 0);
  /**
   * @param {(room: PlanRoom) => boolean} predicate Which spaces to add up.
   * @returns {number} Their total area in square metres, unrounded.
   */
  const exactSum = (predicate) => ROOMS.filter(predicate).reduce((sum, r) => sum + exactArea(r), 0);
  const floor = exactSum((r) => FLOOR_KINDS.has(r.kind));
  const voidArea = exactSum((r) => r.kind === 'void');
  const stairwell = exactSum((r) => r.kind === 'stairwell');

  // The wall area MEASURED rather than inferred: compress the coordinates and
  // add up the cells no rect covers, clamped to the plot so a stray rect outside
  // it cannot be counted as wall.
  const xs = [
    ...new Set([PLOT[0], PLOT[1], ...ROOMS.flatMap((r) => r.rects.flatMap((c) => [c[0], c[1]]))]),
  ].sort((a, b) => a - b);
  const zs = [
    ...new Set([PLOT[2], PLOT[3], ...ROOMS.flatMap((r) => r.rects.flatMap((c) => [c[2], c[3]]))]),
  ].sort((a, b) => a - b);
  let uncovered = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < zs.length - 1; j += 1) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      const mz = (zs[j] + zs[j + 1]) / 2;
      if (mx < PLOT[0] || mx > PLOT[1] || mz < PLOT[2] || mz > PLOT[3]) continue;
      const covered = ROOMS.some((r) =>
        r.rects.some(([a, b, c, d]) => mx > a && mx < b && mz > c && mz < d),
      );
      if (!covered) uncovered += (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]);
    }
  }

  // Two independent routes to the same quantity: the cells nothing covers, and
  // the plot minus every room. They agree only if no two rects overlap and none
  // leaves the plot — an overlapped patch is counted twice in the room sum but
  // once by the cells, so the two routes differ by exactly the overlap, and a
  // rect outside the plot shows up the same way. Both sides unrounded.
  const byRemainder = PLOT_AREA - floor - voidArea - stairwell;
  if (Math.abs(uncovered - byRemainder) > AREA_TOL) {
    fail(
      `wall area is ${byRemainder.toFixed(4)} m² by subtracting the rooms but ${uncovered.toFixed(4)} m² by measuring ` +
        `the cells they leave, a difference of ${Math.abs(uncovered - byRemainder).toFixed(4)} m² — a rect overlaps another or leaves the plot`,
    );
  }

  // Printed figures: the three kinds rounded from their exact values, and WALLS
  // as the residual of those three, so the column the owner reads adds to the
  // plot exactly instead of landing a centimetre out through rounding. WALLS is
  // defined as the remainder, so taking it as the remainder is not a fudge.
  const shownFloor = cm(floor);
  const shownVoid = cm(voidArea);
  const shownStair = cm(stairwell);
  const shownWalls = cm(PLOT_AREA - shownFloor - shownVoid - shownStair);
  const shownTotal = cm(shownFloor + shownVoid + shownStair + shownWalls);

  line('');
  line(`FLOOR     (room/circulation/openAir) ${m(shownFloor).padStart(7)} m²`);
  line(`VOID                                 ${m(shownVoid).padStart(7)} m²`);
  line(`STAIRWELL                            ${m(shownStair).padStart(7)} m²`);
  line(`WALLS     (plot − everything else)   ${m(shownWalls).padStart(7)} m²`);
  line(`                                     ─────────`);
  line(
    `TOTAL                                ${m(shownTotal).padStart(7)} m² (plot ${m(PLOT_AREA)})`,
  );
  // The unrounded figures, because the room column above is rounded per room and
  // will not add to the printed FLOOR to the centimetre.
  line(
    `exact: floor ${floor.toFixed(4)} · void ${voidArea.toFixed(4)} · stairwell ${stairwell.toFixed(4)} · walls ${uncovered.toFixed(4)}`,
  );

  if (Math.abs(shownTotal - PLOT_AREA) > EPS) {
    fail(`the four printed totals sum to ${m(shownTotal)}, not ${m(PLOT_AREA)}`);
  }
  // The printed WALLS is a residual of rounded figures, so it may sit a
  // centimetre from the measured area; further than that and the rounding is
  // hiding something rather than expressing it.
  if (Math.abs(shownWalls - uncovered) > 0.01 + AREA_TOL) {
    fail(
      `printed wall area ${m(shownWalls)} m² is more than a centimetre from the measured ${uncovered.toFixed(4)} m²`,
    );
  }
  if (uncovered <= 0) fail('wall area is not positive');
}

/* ───────────────────────────── 3. chains ───────────────────────────── */

check('3. Depth and width chains: wall + space + wall … closing on the plot');
{
  /**
   * Walk one axis through the plan at a fixed coordinate on the other axis.
   * Half-open containment ([min, max)) so a cut landing exactly on a party wall
   * face — x = 12 is bedroomMaleKids' own west face — belongs to one space only.
   *
   * @param {Axis} axis The axis to walk along.
   * @param {number} at Where the cut sits on the other axis.
   * @returns {void}
   */
  const chain = (axis, at) => {
    /** @type {{ id: string, lo: number, hi: number }[]} */
    const spaces = [];
    for (const room of ROOMS) {
      for (const [minX, maxX, minZ, maxZ] of room.rects) {
        const across = axis === 'z' ? [minX, maxX] : [minZ, maxZ];
        if (at < across[0] - EPS || at >= across[1] - EPS) continue;
        spaces.push(
          axis === 'z' ? { id: room.id, lo: minZ, hi: maxZ } : { id: room.id, lo: minX, hi: maxX },
        );
      }
    }
    // Merge the rects of one room that the cut crosses back to back (the
    // corridor at x = 7 is two rects but one continuous space).
    spaces.sort((a, b) => a.lo - b.lo);
    /** @type {{ id: string, lo: number, hi: number }[]} */
    const merged = [];
    for (const s of spaces) {
      const last = merged[merged.length - 1];
      if (last && last.id === s.id && s.lo <= last.hi + EPS) last.hi = Math.max(last.hi, s.hi);
      else merged.push({ ...s });
    }

    const total = axis === 'z' ? PLOT[3] : PLOT[1];
    /** @type {string[]} */
    const parts = [];
    // Widened off PLOT on purpose: both starts are 0 in the frozen literal, so
    // the checker would fix `pos` at the type `0` and then refuse the far edge
    // of the first space the walk reaches.
    /** @type {number} */
    let pos = axis === 'z' ? PLOT[2] : PLOT[0];
    let sum = 0;
    let broken = false;
    for (const s of merged) {
      const gap = cm(s.lo - pos);
      if (gap < -EPS) {
        fail(
          `${axis === 'z' ? 'x' : 'z'}=${n(at)}: ${s.id} overlaps the space before it by ${m(-gap)}`,
        );
        broken = true;
      }
      if (gap > EPS) {
        parts.push(parts.length === 0 ? `${m(gap)} wall` : m(gap));
        sum = cm(sum + gap);
      }
      parts.push(`${m(s.hi - s.lo)} ${s.id}`);
      sum = cm(sum + (s.hi - s.lo));
      pos = s.hi;
    }
    const tail = cm(total - pos);
    if (tail > EPS) {
      parts.push(parts.length === 0 ? `${m(tail)} wall` : `${m(tail)} wall`);
      sum = cm(sum + tail);
    }
    line(`${axis === 'z' ? 'x' : 'z'}=${n(at)}: ${parts.join(' + ')} = ${m(sum)}`);
    if (!broken && Math.abs(sum - total) > EPS) {
      fail(`${axis === 'z' ? 'x' : 'z'}=${n(at)}: chain sums to ${m(sum)}, not ${m(total)}`);
    }
  };

  line('depth (z from 0 to 10):');
  for (const x of [2, 4.5, 7, 12, 21]) chain('z', x);
  line('');
  line('width (x from 0 to 22.50):');
  for (const z of [2, 7]) chain('x', z);
}

/* ─────────────────────────── 4. openings ─────────────────────────── */

check('4. Openings: one host wall each, 0.05 jambs, 0.10 between neighbours');
{
  const declared = [
    ...PORTS.map((o, i) => ({ o, ref: `PORTS[${i}]`, tag: 'P' })),
    ...WINDOWS.map((o, i) => ({ o, ref: `WINDOWS[${i}]`, tag: 'G' })),
  ];
  const JAMB = 0.05;
  const CLEAR = 0.1;

  for (const { o, ref } of declared) {
    const span = [o.spanMin, cm(o.spanMin + o.width)];
    /**
     * The copy of THIS declared opening that a wall carries, if it carries one.
     * Asked once instead of matched twice: the same predicate was already
     * written into both filters below, and `find` can come up empty — so the
     * answer is a value to be asked about rather than a lookup assumed to hit.
     *
     * @param {Wall} w A derived wall.
     * @returns {DerivedOpening | undefined} Its copy of this opening, or undefined.
     */
    const copyOn = (w) =>
      w.openings.find((op) => op.between === o.between && Math.abs(op.spanMin - o.spanMin) < EPS);
    const hosts = walls.filter((w) => copyOn(w) !== undefined);
    const primary = hosts.filter((w) => !copyOn(w)?.alias);

    if (primary.length !== 1) {
      fail(
        `${ref} ${o.between.join(' ↔ ')} sits in ${primary.length} derived walls, not exactly 1`,
      );
      continue;
    }
    if (hosts.length !== 2) {
      fail(
        `${ref} ${o.between.join(' ↔ ')} is on ${hosts.length} wall face(s): the two rooms' facing walls do not both contain ${m(span[0])}–${m(span[1])}`,
      );
    }
    for (const w of hosts) {
      const head = cm(span[0] - w.spanMin);
      const tailJamb = cm(w.spanMax - span[1]);
      if (head < JAMB - EPS || tailJamb < JAMB - EPS) {
        fail(
          `${ref} ${o.between.join(' ↔ ')} ${m(span[0])}–${m(span[1])} leaves jambs ${m(head)} / ${m(tailJamb)} on ${w.matricule} (${w.roomId} ${w.side}, span ${m(w.spanMin)}–${m(w.spanMax)}) — ${JAMB.toFixed(2)} needed`,
        );
      }
    }
  }

  for (const w of walls) {
    const sorted = [...w.openings].sort((a, b) => a.spanMin - b.spanMin);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = cm(sorted[i].spanMin - cm(sorted[i - 1].spanMin + sorted[i - 1].width));
      if (gap < -EPS)
        fail(
          `${w.matricule}: ${sorted[i - 1].matricule} and ${sorted[i].matricule} overlap by ${m(-gap)}`,
        );
      else if (gap < CLEAR - EPS)
        fail(
          `${w.matricule}: only ${m(gap)} between ${sorted[i - 1].matricule} and ${sorted[i].matricule} (${CLEAR.toFixed(2)} needed)`,
        );
    }
  }

  const placed = walls.flatMap((w) => w.openings).filter((op) => !op.alias).length;
  line(
    `${placed} of ${declared.length} openings named on a primary wall; ${walls.flatMap((w) => w.openings).length} wall faces carry one`,
  );
  for (const w of walls) {
    if (w.openings.length === 0) continue;
    line(
      `${w.matricule.padEnd(16)} ${w.openings.map((op) => `${op.matricule}${op.alias ? '*' : ''} ${m(op.spanMin)}–${m(op.spanMin + op.width)}`).join(' | ')}`,
    );
  }
  line('(* = alias: the same opening, named by the lower-numbered room)');
}

/* ───────────────────────── 5. matricules ───────────────────────── */

check('5. Matricules are unique');
{
  const wallSeen = new Map();
  for (const w of walls) {
    if (wallSeen.has(w.matricule))
      fail(
        `wall matricule ${w.matricule} used twice (${wallSeen.get(w.matricule)} and ${w.roomId} W${w.wallN})`,
      );
    wallSeen.set(w.matricule, `${w.roomId} W${w.wallN}`);
  }
  const openingOwners = new Map();
  for (const w of walls) {
    for (const op of w.openings) {
      if (op.alias) continue;
      if (openingOwners.has(op.matricule)) fail(`opening matricule ${op.matricule} used twice`);
      openingOwners.set(op.matricule, w.matricule);
    }
  }
  // An alias must repeat a real primary matricule, never invent one.
  for (const w of walls) {
    for (const op of w.openings) {
      if (op.alias && !openingOwners.has(op.matricule))
        fail(`${w.matricule} aliases unknown opening ${op.matricule}`);
    }
  }
  line(`${wallSeen.size} wall matricules, ${openingOwners.size} opening matricules, all distinct`);
}

/* ───────────────────────── 6. reachability ───────────────────────── */

check('6. Reachability, and what a port is allowed to open onto');
{
  /**
   * Keyed by plain string, and widened to `PlanRoom`: the frozen literal knows
   * the exact 22 ids it holds, so a map built straight from it would refuse to
   * be asked about an id held in a variable — which is every lookup here.
   *
   * @type {Map<string, PlanRoom>}
   */
  const roomById = new Map(ROOMS.map((r) => /** @type {[string, PlanRoom]} */ ([r.id, r])));
  /**
   * @param {string} id A space's id, which may not name a space.
   * @returns {PlanRoomKind | undefined} What it is, when it is one.
   */
  const kindOf = (id) => roomById.get(id)?.kind;
  const flightRun = cm((STAIRS.riserCount / 2 - 1) * STAIRS.going);
  /**
   * @param {Span} a One span.
   * @param {Span} b The other.
   * @returns {boolean} Whether they share more than a point.
   */
  const spansOverlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS;
  /**
   * @param {PlanRectCoordinates} rect A rect.
   * @param {Axis} axis The axis to measure it on.
   * @returns {Span} Its extent along that axis.
   */
  const extentAlong = (rect, axis) => (axis === 'x' ? [rect[0], rect[1]] : [rect[2], rect[3]]);
  /**
   * Does this rect run right up to that wall's face?
   *
   * @param {PlanRectCoordinates} rect A rect.
   * @param {Wall} wall The face.
   * @returns {boolean} Whether the rect reaches it.
   */
  const reachesWall = (rect, wall) =>
    wall.side === 'east'
      ? Math.abs(rect[1] - wall.at) < EPS
      : wall.side === 'west'
        ? Math.abs(rect[0] - wall.at) < EPS
        : wall.side === 'north'
          ? Math.abs(rect[2] - wall.at) < EPS
          : Math.abs(rect[3] - wall.at) < EPS;

  /**
   * The stairwell's open edges: its walls that carry no wall at all and face
   * floored space. Floors that meet across a zero join are at the same level —
   * that is what "no wall" means physically — so the corridor's level is
   * readable off the geometry rather than off a comment.
   */
  const openEdges = walls.filter(
    (w) =>
      kindOf(w.roomId) === 'stairwell' &&
      Math.abs(w.thickness) < EPS &&
      w.neighbours.length > 0 &&
      w.neighbours.every((id) => isFloorKind(kindOf(id))),
  );

  /**
   * A stair piece is at this storey's level when it reaches an open edge and is
   * not a flight arriving at one. Travel through an edge runs normal to it, so a
   * piece whose extent along that axis is a whole flight run is a flight, however
   * it is named — that guard is what stops an open-tread stair from being read as
   * a landing just because its top tread touches the corridor.
   *
   * Derived, so a second landing, a moved join or a renamed piece is picked up
   * without editing this check. The piece names are never read here; the one
   * thing names still carry is which piece plays which role in check 7.
   */
  /** @type {LevelPiece[]} */
  const atThisLevel = [];
  for (const piece of STAIR_PIECES) {
    for (const edge of openEdges) {
      if (!reachesWall(piece.rect, edge)) continue;
      if (!spansOverlap(extentAlong(piece.rect, edge.axis), [edge.spanMin, edge.spanMax])) continue;
      const travel = edge.axis === 'x' ? 'z' : 'x';
      const [lo, hi] = extentAlong(piece.rect, travel);
      if (Math.abs(cm(hi - lo) - flightRun) < EPS) {
        fail(
          `${piece.key} reaches the open edge ${edge.matricule} but is ${m(hi - lo)} along the way in — a full flight run, so it is a flight, not a landing`,
        );
        continue;
      }
      atThisLevel.push({ ...piece, edge });
      break;
    }
  }
  const levelKeys = new Set(atThisLevel.map((p) => p.key));

  /**
   * A space you can stand on at this storey: floored, or a stairwell with a landing at this level.
   *
   * @param {string} id A space's id.
   * @returns {boolean} Whether it carries floor here.
   */
  const carriesFloor = (id) =>
    isFloorKind(kindOf(id)) || (kindOf(id) === 'stairwell' && atThisLevel.length > 0);

  /**
   * Where a port is allowed to land. A void is always refused: it is a hole, and
   * no door may open onto it. A stairwell is refused unless the span lies wholly
   * inside a piece that is at this storey's level AND that reaches the wall the
   * door sits in.
   *
   * WHY that is sharp: check 7 proves the pieces tile the bay exactly, so a span
   * wholly inside the level piece cannot also be over a flight or over the
   * half-landing. No separate "is it a flight" test is needed to keep the fall
   * out — the tiling does it, and the fall is the whole point: a door onto a
   * flight, or onto a landing half a storey down, opens onto nothing.
   *
   * @param {Wall} wall The stairwell face the door sits in.
   * @param {Span} span The door's span along that face.
   * @returns {LevelPiece | null} The piece that admits it, or `null`.
   */
  const admittingPiece = (wall, span) =>
    atThisLevel.find(
      (piece) =>
        reachesWall(piece.rect, wall) &&
        span[0] >= extentAlong(piece.rect, wall.axis)[0] - EPS &&
        span[1] <= extentAlong(piece.rect, wall.axis)[1] + EPS,
    ) ?? null;

  for (const p of PORTS) {
    /** @type {Span} */
    const span = [p.spanMin, cm(p.spanMin + p.width)];
    for (const id of p.between) {
      if (kindOf(id) === 'void') {
        fail(
          `${p.between.join(' ↔ ')} opens onto ${id}, a void — a hole in the floor is never a doorway`,
        );
        continue;
      }
      if (kindOf(id) !== 'stairwell') continue;
      const wall = walls.find(
        (w) =>
          w.roomId === id &&
          w.openings.some(
            (op) => op.between === p.between && Math.abs(op.spanMin - p.spanMin) < EPS,
          ),
      );
      if (!wall) {
        fail(`${p.between.join(' ↔ ')} touches the stairwell but sits in no derived ${id} wall`);
        continue;
      }
      const piece = admittingPiece(wall, span);
      if (!piece) {
        const over = STAIR_PIECES.filter(
          (q) => reachesWall(q.rect, wall) && spansOverlap(extentAlong(q.rect, wall.axis), span),
        ).map((q) => q.key);
        fail(
          `${p.between.join(' ↔ ')} ${m(span[0])}–${m(span[1])} on ${wall.matricule} does not lie in a stair piece at this storey's level` +
            `${over.length ? `: it is over ${over.join(' and ')}, which ${over.length > 1 ? 'are' : 'is'} not floor here` : ''}`,
        );
        continue;
      }
      const [lo, hi] = extentAlong(piece.rect, wall.axis);
      line(
        `${p.between.join(' ↔ ')} ${m(span[0])}–${m(span[1])} lands on ${piece.key} (${m(lo)}–${m(hi)}), jambs ${m(span[0] - lo)} / ${m(hi - span[1])}`,
      );
    }
  }

  /**
   * Prove the refusal still bites. Every piece that is NOT at this storey's
   * level gets a doorway's worth of span placed in the middle of it, against a
   * stairwell wall it reaches, and must be refused. If this ever goes quiet the
   * rule has gone soft, and the next door onto a flight would pass unseen.
   */
  const stairWalls = walls.filter((w) => kindOf(w.roomId) === 'stairwell');
  const probes = [];
  for (const piece of STAIR_PIECES) {
    if (levelKeys.has(piece.key)) continue;
    for (const wall of stairWalls) {
      if (!reachesWall(piece.rect, wall)) continue;
      const [lo, hi] = extentAlong(piece.rect, wall.axis);
      const mid = cm((lo + hi) / 2);
      /** @type {Span} */
      const probe = [cm(mid - 0.45), cm(mid + 0.45)];
      if (probe[0] < lo - EPS || probe[1] > hi + EPS) continue;
      probes.push(`${piece.key} via ${wall.matricule}`);
      if (admittingPiece(wall, probe)) {
        fail(
          `a 0.90 doorway at ${m(probe[0])}–${m(probe[1])} on ${wall.matricule} lands on ${piece.key}, half a storey off this floor, and the rule admitted it`,
        );
      }
      break;
    }
  }

  /** @type {Map<string, string[]>} */
  const graph = new Map(ROOMS.map((r) => /** @type {[string, string[]]} */ ([r.id, []])));
  /**
   * Join two spaces, in both directions. A name the graph does not hold is
   * simply not linked, which is what the optional calls say.
   *
   * @param {string} a One space's id.
   * @param {string} b The other's.
   * @returns {void}
   */
  const link = (a, b) => {
    graph.get(a)?.push(b);
    graph.get(b)?.push(a);
  };
  for (const p of PORTS) link(p.between[0], p.between[1]);
  // Continuous floors need no door: you walk off the corridor onto the landing.
  // Only where both sides carry floor — a zero join to a void is an unguarded
  // edge, not a route.
  /** @type {Set<string>[]} */
  const joins = [];
  for (const w of walls) {
    if (Math.abs(w.thickness) > EPS) continue;
    for (const id of w.neighbours) {
      if (!carriesFloor(w.roomId) || !carriesFloor(id)) continue;
      if (joins.some((j) => j.has(w.roomId) && j.has(id))) continue;
      joins.push(new Set([w.roomId, id]));
      link(w.roomId, id);
    }
  }

  /** @type {Map<string, string | null>} */
  const from = new Map([['corridor', null]]);
  const queue = ['corridor'];
  // The shift IS the loop's condition, rather than a length test followed by a
  // shift taken on trust: the queue holds room ids and nothing else, so running
  // out of them is exactly the end of the walk.
  for (let here = queue.shift(); here !== undefined; here = queue.shift()) {
    for (const next of graph.get(here) ?? []) {
      if (from.has(next)) continue;
      from.set(next, here);
      queue.push(next);
    }
  }
  /**
   * The hops from the corridor to one space, as the walk above recorded them.
   *
   * @param {string} id The space to walk back from.
   * @returns {string} The route, arrow-joined.
   */
  const pathTo = (id) => {
    /** @type {string[]} */
    const hops = [];
    /** @type {string | null | undefined} */
    let at = id;
    while (at != null) {
      hops.unshift(at);
      at = from.get(at);
    }
    return hops.join(' → ');
  };

  const want = ROOMS.filter((r) => FLOOR_KINDS.has(r.kind));
  const stranded = want.filter((r) => !from.has(r.id));
  for (const r of stranded) fail(`${r.id} (R${r.n}, ${r.kind}) has no route from the corridor`);
  line(
    `${want.length - stranded.length}/${want.length} reachable${stranded.length ? `; stranded: ${stranded.map((r) => r.id).join(', ')}` : ''}`,
  );
  line(
    `at this storey's level: ${atThisLevel.map((p) => `${p.key} (via ${p.edge.matricule}, the 0.00 join to ${p.edge.faces})`).join(', ') || 'nothing'}`,
  );
  line(`walk-through joins, no door: ${joins.map((j) => [...j].join(' ↔ ')).join(', ') || 'none'}`);
  line(`guest room: ${pathTo('guestRoom')}`);
  line(
    `refusal proved on ${probes.length} piece(s) off this level: ${probes.join(', ') || 'none'}`,
  );
}

/* ───────────────────────────── 7. stairs ───────────────────────────── */

check('7. Stair fit: four pieces tiling the bay, two flights between two landings');
{
  const [bayMinX, bayMaxX, bayMinZ, bayMaxZ] = STAIRS.bay;
  const goingsPerFlight = STAIRS.riserCount / 2 - 1;
  const runNeeded = cm(goingsPerFlight * STAIRS.going);
  // Listed in travel order, and the stair runs THROUGH this floor rather than
  // ending on it: arrive on landingEast at this floor's level, climb flightA
  // west to the half-landing half a storey ABOVE, turn 180° there and carry on
  // up. Coming the other way, flightB rises east from the half-landing BELOW
  // onto this landing. Modelling both as descending was the earlier reading and
  // it is wrong twice over — it shows no way up at all, and it puts two flights
  // in one footprint.
  // Enumerated from the spec, not listed here: a fifth piece joins the tiling
  // and the assertions below on its own. The split into flights and landings is
  // the one thing still read off the names — nothing in the data says which a
  // piece is — so every piece lands in exactly one of the two lists and none can
  // fall between them.
  /** @type {[string, PlanRectCoordinates][]} */
  const pieces = STAIR_PIECES.map(
    (p) => /** @type {[string, PlanRectCoordinates]} */ ([p.key, p.rect]),
  );
  /**
   * @param {string} key A piece's name in STAIRS.
   * @returns {boolean} Whether the name says it is a flight.
   */
  const isFlight = (key) => /flight/i.test(key);
  // Kept as pieces rather than reduced to bare names: the rect below is then the
  // one already read out of the spec, instead of being looked up a second time
  // through a key nothing ties back to STAIRS.
  const flights = STAIR_PIECES.filter((p) => isFlight(p.key));
  const landings = STAIR_PIECES.filter((p) => !isFlight(p.key));

  line(
    `bay ${m(bayMaxX - bayMinX)} × ${m(bayMaxZ - bayMinZ)}; ${STAIRS.riserCount} risers of ${m(HEIGHTS.floorToFloor / STAIRS.riserCount)} (${m(HEIGHTS.floorToFloor)} storey), ${STAIRS.riserCount / 2} per flight`,
  );
  for (const [name, [minX, maxX, minZ, maxZ]] of pieces) {
    line(
      `${name.padEnd(11)} x ${m(minX)}–${m(maxX)} (${m(maxX - minX)}) · z ${m(minZ)}–${m(maxZ)} (${m(maxZ - minZ)})`,
    );
  }
  line(
    `each flight needs ${goingsPerFlight} goings of ${m(STAIRS.going)} = ${m(runNeeded)} of run; each landing needs ${m(STAIRS.flightWidth)} to turn in`,
  );

  // WHY the run is (risers/2 − 1) goings and not risers/2: the last riser of a
  // flight lands ON the landing, so the treads that need floor are one fewer.
  // Both flights travel along x, so the run is the x extent and the width the z
  // extent; a landing is crossed along x too, which is the direction a 180°
  // turn has to be at least one flight wide in.
  for (const { key: name, rect } of flights) {
    const [minX, maxX, minZ, maxZ] = rect;
    if (Math.abs(cm(maxX - minX) - runNeeded) > EPS) {
      fail(
        `${name} run is ${m(maxX - minX)}, needs ${goingsPerFlight} × ${m(STAIRS.going)} = ${m(runNeeded)}`,
      );
    }
    if (Math.abs(cm(maxZ - minZ) - STAIRS.flightWidth) > EPS)
      fail(`${name} is ${m(maxZ - minZ)} wide, not ${m(STAIRS.flightWidth)}`);
  }
  for (const { key: name, rect } of landings) {
    const run = cm(rect[1] - rect[0]);
    if (run < STAIRS.flightWidth - EPS) {
      fail(
        `${name} is ${m(run)} long in the direction of travel, less than the ${m(STAIRS.flightWidth)} a 180° turn needs`,
      );
    }
  }

  // Side by side: the same run, touching along their long edge. That is what
  // makes the pair read as one stair two flights wide and the turn a true half
  // turn rather than two unrelated flights sharing a bay.
  const [aMinX, aMaxX, aMinZ, aMaxZ] = STAIRS.flightA;
  const [bMinX, bMaxX, bMinZ, bMaxZ] = STAIRS.flightB;
  if (Math.abs(aMinX - bMinX) > EPS || Math.abs(aMaxX - bMaxX) > EPS) {
    fail(
      `the flights do not share a run: flightA x ${m(aMinX)}–${m(aMaxX)}, flightB x ${m(bMinX)}–${m(bMaxX)}`,
    );
  }
  if (Math.abs(aMaxZ - bMinZ) > EPS && Math.abs(bMaxZ - aMinZ) > EPS) {
    fail(
      `the flights are not side by side: flightA z ${m(aMinZ)}–${m(aMaxZ)} and flightB z ${m(bMinZ)}–${m(bMaxZ)} do not touch`,
    );
  }

  for (const [name, rect] of pieces) {
    if (
      rect[0] < bayMinX - EPS ||
      rect[1] > bayMaxX + EPS ||
      rect[2] < bayMinZ - EPS ||
      rect[3] > bayMaxZ + EPS
    ) {
      fail(`${name} leaves the bay`);
    }
  }
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      if (rectsOverlap(pieces[i][1], pieces[j][1]))
        fail(`${pieces[i][0]} overlaps ${pieces[j][0]}`);
    }
  }
  // Inside the bay + no overlap + areas summing to the bay is an exact tiling:
  // there is nowhere for a gap to hide once all three hold.
  const piecesArea = cm(pieces.reduce((s, [, r]) => s + rectArea(r), 0));
  const bayArea = cm(rectArea(STAIRS.bay));
  if (Math.abs(piecesArea - bayArea) > EPS) {
    fail(
      `the ${pieces.length} pieces cover ${m(piecesArea)} of the ${m(bayArea)} bay — they do not tile it`,
    );
  }
  line(`pieces ${m(piecesArea)} m² = bay ${m(bayArea)} m², inside it, no overlap`);

  const bayRoom = ROOMS.find((r) => r.id === 'stairs');
  if (
    bayRoom &&
    bayRoom.rects.length === 1 &&
    bayRoom.rects[0].some((v, i) => Math.abs(v - STAIRS.bay[i]) > EPS)
  ) {
    fail(
      `STAIRS.bay [${STAIRS.bay.map(n).join(', ')}] is not the R${bayRoom.n} rect [${bayRoom.rects[0].map(n).join(', ')}]`,
    );
  }
}

/* ──────── 8. derived thickness against the gap actually drawn ──────── */

check('8. Wall thickness, per contact: every stretch built what the rules ask');
{
  /**
   * WHY per contact and not per wall: a nominal wall used to have one thickness
   * for its whole length, and it does not any more. Isolation is now width — a
   * named wall is built 0.30, a plain separator 0.15 — so one face can be heavy
   * where it faces weather or an isolated room and thin where it faces an
   * ordinary one, with the rooms behind it at different depths as a result. The
   * control center's east face is 0.15 to the guest room and 0.30 to its own
   * balcony; the utility's west face is 0.30, 0.15 and 0.20 along its length.
   * Both are right. Comparing one derived number to one measured gap called them
   * both wrong, which is the check being coarse, not the floor being broken.
   */
  /**
   * Keyed by plain string, and widened to `PlanRoom`: the frozen literal knows
   * the exact ids it holds, so a map built straight from it would refuse to be
   * asked about an id held in a variable.
   *
   * @type {Map<string, PlanRoom>}
   */
  const roomById = new Map(ROOMS.map((r) => /** @type {[string, PlanRoom]} */ ([r.id, r])));
  /**
   * @param {PlanRoomKind | undefined} kind What the space on the far side is.
   * @returns {boolean} Whether the weather rule applies.
   */
  const exposed = (kind) => kind === 'openAir' || kind === 'void';
  /**
   * Widened to the declared interface: `JOIN_OVERRIDES` is a frozen literal, so
   * each `between` is a pair of two exact names and `includes` would accept only
   * those two — which is the opposite of the question asked of it below.
   * `PlanJoinOverride` says what the rule needs: a pair of room ids.
   *
   * @type {readonly PlanJoinOverride[]}
   */
  const joinOverrides = JOIN_OVERRIDES;

  /**
   * Precedence, highest first: a join override states a gap the geometry would
   * not predict; then weather exposure, which the brief fixes at 0.30 whatever
   * is behind it; then the owner's isolation list, which is now a width; then a
   * plain separator. Every value is read from the spec — none is written here —
   * so the day the owner changes a width, this check moves with him.
   *
   * @param {Wall} wall The face the stretch is on.
   * @param {MeasuredContact} contact The stretch, and what it looks at.
   * @returns {{ t: number, why: string }} The width the rules ask for, and which rule.
   */
  const ruleFor = (wall, contact) => {
    const override = joinOverrides.find(
      (o) => o.between.includes(wall.roomId) && o.between.includes(contact.room.id),
    );
    if (override) return { t: override.thickness, why: 'join override' };
    if (exposed(contact.room.kind) || exposed(roomById.get(wall.roomId)?.kind)) {
      return { t: WALLS.voidFacing, why: 'weather-exposed' };
    }
    if (insulationAt(wall, contact.span) === 'whole') {
      return { t: WALLS.insulated ?? WALLS.exterior, why: 'isolation (owner)' };
    }
    return { t: WALLS.partition, why: 'plain separator' };
  };

  /** @type {Map<string, string[]>} */
  const disagreements = new Map();
  /** @type {{ wall: Wall, contacts: MeasuredContact[] }[]} */
  const varying = [];
  /** @type {Map<string, number>} */
  const built = new Map();
  let contactCount = 0;

  for (const w of walls) {
    if (w.exterior) continue;
    const contacts = contactsOf(w);
    if (contacts.length === 0) continue;
    contactCount += contacts.length;

    for (const contact of contacts) {
      const rule = ruleFor(w, contact);
      const run = cm(contact.span[1] - contact.span[0]);
      built.set(m(contact.gap), cm((built.get(m(contact.gap)) ?? 0) + run));

      if (insulationAt(w, contact.span) === 'partly') {
        notes.push(
          `${w.matricule} ${m(contact.span[0])}–${m(contact.span[1])} (facing ${contact.room.id}): the isolation boundary cuts through this contact, so the stretch is part heavy and part plain`,
        );
      }
      if (Math.abs(contact.gap - rule.t) <= EPS) continue;
      // Grouped by the disagreement itself: nineteen stretches all off by the
      // same constant is one fact about the spec, not nineteen faults.
      const key = `${rule.why}|${m(rule.t)}|${m(contact.gap)}`;
      // `get` then fill, rather than `has` then `get`: one lookup instead of two,
      // and the list is a value the reader can see is present.
      let where = disagreements.get(key);
      if (!where) {
        where = [];
        disagreements.set(key, where);
      }
      where.push(`${w.matricule} ${m(contact.span[0])}–${m(contact.span[1])} → ${contact.room.id}`);
    }

    const distinct = [...new Set(contacts.map((c) => m(c.gap)))];
    if (distinct.length > 1) varying.push({ wall: w, contacts });
  }

  for (const [key, where] of disagreements) {
    const [why, expected, actual] = key.split('|');
    fail(
      `${where.length} contact stretch(es) as a ${why} should be ${expected} but the rects leave ${actual}: ` +
        `${where.slice(0, 6).join('; ')}${where.length > 6 ? `; …and ${where.length - 6} more` : ''}`,
    );
  }

  /**
   * The derived `contacts` must agree with what was just measured, and must tile
   * every face. Both renderers are about to draw from this field, so a stretch
   * it gets wrong is a wall drawn wrong — and it is derived independently of the
   * measurement above, which is what makes the agreement worth something.
   */
  for (const w of walls) {
    const list = w.contacts ?? [];
    const covered = cm(list.reduce((sum, d) => sum + d.length, 0));
    if (Math.abs(covered - w.length) > EPS) {
      fail(
        `${w.matricule} contacts[] covers ${m(covered)} of a ${m(w.length)} face — the list has to tile it`,
      );
    }
    for (let i = 1; i < list.length; i += 1) {
      if (Math.abs(list[i].spanMin - list[i - 1].spanMax) > EPS) {
        fail(
          `${w.matricule} contacts[] jumps from ${m(list[i - 1].spanMax)} to ${m(list[i].spanMin)} — stretches must run end to end`,
        );
      }
    }
    if (w.exterior) continue;
    for (const contact of contactsOf(w)) {
      const match = list.find(
        (d) =>
          d.neighbourId === contact.room.id &&
          contact.span[0] >= d.spanMin - EPS &&
          contact.span[1] <= d.spanMax + EPS,
      );
      if (!match) {
        fail(
          `${w.matricule} contacts[] has no stretch covering ${m(contact.span[0])}–${m(contact.span[1])} facing ${contact.room.id}`,
        );
      } else if (Math.abs(match.thickness - contact.gap) > EPS) {
        fail(
          `${w.matricule} contacts[] says ${m(match.thickness)} facing ${contact.room.id} where the rects leave ${m(contact.gap)}`,
        );
      }
    }
  }

  line(
    `${contactCount} contact stretches across ${walls.filter((w) => !w.exterior).length} interior faces`,
  );
  line(`contacts[] tiles all ${walls.length} faces and agrees with the measured gaps`);

  /**
   * The two faces of one wall have to agree about isolation over the stretch
   * they share. A wall built heavy as seen from one room and plain as seen from
   * the other is not a thing that can exist, and the junction rule is the first
   * pass able to invent one: it spreads along a face and around a corner rather
   * than straight across the wall, so the two faces are no longer reached by the
   * same route.
   */
  /**
   * Widened to the declared interface: `INSULATED_WALLS` is a frozen literal, so
   * a set of its matricules knows the exact faces the owner named today and
   * would refuse to be asked about any other wall — and every wall asks here.
   *
   * @type {readonly InsulatedWall[]}
   */
  const insulatedList = INSULATED_WALLS;
  const namedFaces = new Set(insulatedList.map((entry) => entry.matricule));
  /**
   * How much of `lo`–`hi` on this face is built heavy.
   *
   * @param {Wall} wall The face.
   * @param {number} lo Start of the shared stretch.
   * @param {number} hi End of it.
   * @returns {number} The heavy run inside that stretch, in metres.
   */
  const heavyOver = (wall, lo, hi) => {
    if (namedFaces.has(wall.matricule)) return cm(hi - lo);
    const spans = mergeSpans(
      (wall.contacts ?? [])
        .filter((c) => c.reason === 'isolation')
        .map((c) => /** @type {Span} */ ([c.spanMin, c.spanMax])),
    );
    return cm(
      spans.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, hi) - Math.max(a, lo)), 0),
    );
  };
  let lopsided = 0;
  for (const a of walls) {
    for (const b of walls) {
      if (a.matricule >= b.matricule || !facesEachOther(a, b)) continue;
      const lo = Math.max(a.spanMin, b.spanMin);
      const hi = Math.min(a.spanMax, b.spanMax);
      if (hi - lo <= EPS) continue;
      const heavyA = heavyOver(a, lo, hi);
      const heavyB = heavyOver(b, lo, hi);
      if (Math.abs(heavyA - heavyB) <= EPS) continue;
      lopsided += 1;
      fail(
        `${a.matricule} and ${b.matricule} are the two faces of one wall but disagree about isolation over ` +
          `${m(lo)}–${m(hi)}: ${m(heavyA)} heavy from ${a.roomId}, ${m(heavyB)} from ${b.roomId}`,
      );
    }
  }
  line(
    lopsided
      ? `${lopsided} wall(s) isolated on one face and plain on the other`
      : 'no wall is isolated on one face and plain on the other',
  );
  // Two numbers, because one of them is a trap. The contact figure counts only
  // stretches that look at another room, so it leaves out the whole exterior
  // envelope — quoting it as "how much of the floor is heavy" would lose every
  // metre of the 0.30 envelope. The all-faces figure walks `contacts`, which
  // tiles all 80 faces, so it is the one to quote; both count every FACE, which
  // means an interior wall twice, once from each side, and the envelope once.
  /** @type {Map<string, number>} */
  const everyFace = new Map();
  for (const w of walls) {
    for (const c of w.contacts ?? []) {
      everyFace.set(m(c.thickness), cm((everyFace.get(m(c.thickness)) ?? 0) + c.length));
    }
  }
  const totalFace = cm(walls.reduce((sum, w) => sum + w.length, 0));
  line(
    `built, every face (${m(totalFace)} m of face, interior walls counted from both sides): ` +
      `${[...everyFace.entries()]
        .sort()
        .map(([t, run]) => `${t} over ${m(run)} m`)
        .join(', ')}`,
  );
  line(
    `of which stretches facing another room: ${[...built.entries()]
      .sort()
      .map(([t, run]) => `${t} over ${m(run)} m`)
      .join(', ')}`,
  );

  // Real information for the builder now, not an anomaly to suppress: these are
  // the faces that change thickness partway along.
  if (varying.length) {
    line(`${varying.length} face(s) vary in thickness along their length:`);
    for (const { wall, contacts } of varying) {
      line(
        `   ${wall.matricule.padEnd(16)} ${wall.axis} ${m(wall.spanMin)}–${m(wall.spanMax)}  ` +
          contacts
            .map((c) => `${m(c.gap)} over ${m(c.span[0])}–${m(c.span[1])} (${c.room.id})`)
            .join(', '),
      );
      notes.push(
        `${wall.matricule} (${wall.roomId} ${wall.side}) is not one thickness: ` +
          contacts
            .map((c) => `${m(c.gap)} for ${m(c.span[1] - c.span[0])} facing ${c.room.id}`)
            .join(', '),
      );
    }
  } else {
    line('no face varies in thickness along its length');
  }
}

/* ───────────────────────────── 9. fixtures ───────────────────────────── */

check('9. Fixtures: inside their room, clear of each other and of every door swing');
{
  /**
   * The fixtures and the rooms, widened from the frozen `as const` literals to
   * the interfaces the plan declares for them.
   *
   * WHY, and it is not a formality: `as const` gives `approach`, `note` and
   * `open` only to the entries that happen to carry one today, so a checker
   * reading the literal type can ask after an override only where an override
   * already exists — which is precisely the case it does not need to check. They
   * are optional fields of EVERY fixture and EVERY room, the interfaces say so,
   * and these two aliases are what make the rules below hold for a fixture that
   * has not been written yet.
   *
   * @type {readonly PlanFixture[]}
   */
  const fixtures = FIXTURES;
  /** @type {readonly PlanRoom[]} */
  const rooms = ROOMS;

  /**
   * Keyed by plain string, and widened to `PlanRoom`: a fixture names its room
   * as data, and check 9's first failure is precisely a name the plan does not
   * hold — so the lookup has to be askable with any string.
   *
   * @type {Map<string, PlanRoom>}
   */
  const roomById = new Map(rooms.map((r) => /** @type {[string, PlanRoom]} */ ([r.id, r])));
  /**
   * @param {PlanRectCoordinates} rect The rect to test.
   * @param {PlanRectCoordinates} bounds The rect it has to sit wholly inside.
   * @returns {boolean} Whether it does.
   */
  const inside = (rect, [minX, maxX, minZ, maxZ]) =>
    rect[0] >= minX - EPS &&
    rect[1] <= maxX + EPS &&
    rect[2] >= minZ - EPS &&
    rect[3] <= maxZ + EPS;

  /**
   * One opening on one wall face, in the terms `swingClearance.ts` takes: which
   * face of the room it is hung in, where that face lies, and the stretch of it
   * the opening covers. Inward is into the room the wall belongs to, which is
   * why this is asked of a derived wall rather than of a PORTS entry — a port
   * is a pair of rooms, a wall face is one of them.
   *
   * @param {Wall} wall The face the opening sits on.
   * @param {DerivedOpening} op The opening.
   * @returns {import('../../src/features/building/domain/swingClearance.ts').ClearanceFace}
   *   The face, ready for `getSwingRect` or `getClearanceRect`.
   */
  const faceOf = (wall, op) => ({
    side: FACE_OF_SIDE[wall.side],
    at: wall.at,
    spanMin: op.spanMin,
    width: op.width,
  });

  /**
   * The clear distance from each face of a fixture to the corresponding face of
   * the room rect it stands in, in metres.
   *
   * Named in the compass terms the rest of the report uses, so a gap can be read
   * against the wall register without translating: a fixture's `west` gap is the
   * one measured to the room's west face.
   *
   * @param {PlanRectCoordinates} rect The fixture's rect.
   * @param {PlanRectCoordinates} bounds The room rect that contains it.
   * @returns {Record<'west' | 'east' | 'north' | 'south', number>} The four gaps.
   */
  const gapsTo = (rect, [minX, maxX, minZ, maxZ]) => ({
    west: cm(rect[0] - minX),
    east: cm(maxX - rect[1]),
    north: cm(rect[2] - minZ),
    south: cm(maxZ - rect[3]),
  });

  /**
   * The four faces of a fixture, in the order the approach rule breaks ties in —
   * minZ, maxZ, minX, maxX — each with the gap that measures it and the
   * room-side face `getClearanceRect` reaches the band from.
   *
   * The third column is the one that repays reading twice. `getClearanceRect`
   * reaches INWARD of the face it is given, and the floor a fixture is reached
   * across lies OUTWARD of the fixture — so the band in front of a fixture's
   * `minZ` face is the inward clearance of a `maxZ` face standing at the same
   * coordinate. The opposite face is not a trick: it is what "outward" means
   * when the only derivation available speaks inward.
   *
   * @type {ReadonlyArray<[RectSide, 'west' | 'east' | 'north' | 'south', RectSide]>}
   */
  const FIXTURE_FACES = [
    ['minZ', 'north', 'maxZ'],
    ['maxZ', 'south', 'minZ'],
    ['minX', 'west', 'maxX'],
    ['maxX', 'east', 'minX'],
  ];

  /** Room rect a fixture was found wholly inside, by its index in FIXTURES. */
  /** @type {Map<number, PlanRectCoordinates>} */
  const hostRect = new Map();

  for (const [i, f] of fixtures.entries()) {
    const room = roomById.get(f.room);
    if (!room) {
      fail(`FIXTURES[${i}] ${f.kind} names room '${f.room}', which does not exist`);
      continue;
    }
    // One rect, not the union: a fixture straddling two rects of an L-shaped
    // room would sit across the internal seam, which is a corner in the room,
    // not a wall — nothing stands there.
    const host = room.rects.find((r) => inside(f.rect, r));
    if (!host) {
      fail(
        `FIXTURES[${i}] ${f.kind} [${f.rect.map(n).join(', ')}] is not wholly inside any rect of ${f.room}`,
      );
    } else {
      // Kept, because every rule below — the mount claim, the approach band —
      // is measured against THIS rect and not against the room's bounding box:
      // the seam between two rects of an L-shaped room is a corner, not a wall,
      // and nothing backs onto it.
      hostRect.set(i, host);
    }
    const offGrid = f.rect.filter((v) => !onGrid(v));
    if (offGrid.length)
      fail(
        `FIXTURES[${i}] ${f.kind} in ${f.room} is off the centimetre grid: ${offGrid.join(', ')}`,
      );
  }

  for (let i = 0; i < fixtures.length; i += 1) {
    for (let j = i + 1; j < fixtures.length; j += 1) {
      if (rectsOverlap(fixtures[i].rect, fixtures[j].rect)) {
        fail(
          `${fixtures[i].kind} (${fixtures[i].room}) overlaps ${fixtures[j].kind} (${fixtures[j].room})`,
        );
      }
    }
  }

  /**
   * The mount claim, and the floor a fixture is reached across.
   *
   * `mount` is a claim about the walls — the arithmetic each value stands for is
   * written out in the `PlanFixtureMount` docstring, and this is where the claim
   * is either honoured or not. `approach` is a claim about the room: SOME face
   * of the fixture has to have clear floor in front of it, or nobody can use the
   * thing.
   *
   * Both are measured against the room rect the fixture was found inside, not
   * against the room's bounding box, for the reason the containment test gives.
   */
  /** Freestanding fixtures, listed out loud: the claim is not an error, but it is not silent either. */
  /** @type {string[]} */
  const freestanding = [];
  /** Fixtures reached across less than the default, each with the room that forced it. */
  /** @type {string[]} */
  const reduced = [];
  /** The face each fixture's approach was satisfied at, for the per-room register. */
  /** @type {Map<PlanFixture, string>} */
  const reachedFrom = new Map();
  for (const [i, f] of fixtures.entries()) {
    const host = hostRect.get(i);
    // No host rect means the fixture is not in the room it names, which has
    // already failed above. Measuring it against a room it is not in would add
    // a second, derived failure saying nothing new.
    if (!host) continue;
    const gaps = gapsTo(f.rect, host);
    const printed = FIXTURE_FACES.map(([, name]) => `${name} ${m(gaps[name])}`).join(', ');
    /** @type {'west' | 'east' | 'north' | 'south'} */
    let nearestName = 'north';
    let nearest = Infinity;
    for (const [, name] of FIXTURE_FACES) {
      if (gaps[name] < nearest) {
        nearest = gaps[name];
        nearestName = name;
      }
    }
    const slack = FIXTURE_SPEC.wallGap;
    if (f.mount === 'mounted' && nearest > EPS) {
      fail(
        `${f.kind} in ${f.room} is declared 'mounted' but hangs on nothing: its nearest face is ` +
          `${m(nearest)} from the room's ${nearestName} face, and a mounted fixture is flush (gaps ${printed})`,
      );
    } else if (f.mount === 'standing' && nearest > slack + EPS) {
      fail(
        `${f.kind} in ${f.room} is declared 'standing' but backs onto nothing: its nearest face is ` +
          `${m(nearest)} from the room's ${nearestName} face, over the ${m(slack)} wall gap (gaps ${printed})`,
      );
    } else if (f.mount === 'freestanding' && nearest <= slack + EPS) {
      fail(
        `${f.kind} in ${f.room} is declared 'freestanding' but its ${nearestName} face is ` +
          `${m(nearest)} from the room, within the ${m(slack)} wall gap (gaps ${printed})`,
      );
    }
    if (f.mount === 'freestanding') {
      freestanding.push(
        `${f.kind} in ${f.room} (nearest wall ${m(nearest)} ${nearestName}${f.note ? `, ${f.note}` : ''})`,
      );
    }

    // The depth of the band. `approach` is an override and not a restatement, so
    // the default is read here and the override only where the room could not
    // give it — which is exactly the case that must be printed out loud.
    const depth = f.approach ?? FIXTURE_SPEC.approach;
    if (f.approach !== undefined && f.approach < FIXTURE_SPEC.approach - EPS) {
      reduced.push(
        `${f.kind} in ${f.room}: ${m(f.approach)} instead of ${m(FIXTURE_SPEC.approach)}, ` +
          `in a rect ${m(host[1] - host[0])} × ${m(host[3] - host[2])}`,
      );
    }
    // Every face, and one of them has to give. NOT the face with the largest gap
    // to the room: that was a guess at which way a fixture faces, and `rect`
    // carries no orientation to guess from — a bed against the north wall with a
    // nightstand either side has its largest gap to the east, so the guess
    // measured the band along the bed's SIDE, found the nightstand, and failed a
    // layout that is correct. Moving the bed moves the guess to the other side;
    // centring it hands the choice to a tie-break. The honest rule with the data
    // we have is that a fixture is usable when there is clear floor of the
    // required depth at SOME face, and unusable when there is none at any —
    // which is still exactly the case worth catching: a fitting boxed in on all
    // four sides.
    /** What each face gives, for the failure message: the reader needs all four. */
    /** @type {string[]} */
    const offered = [];
    /** The face that satisfied the rule, deepest first, ties in FIXTURE_FACES order. */
    /** @type {{ name: RectSide, got: number } | null} */
    let reached = null;
    for (const [name, , outward] of FIXTURE_FACES) {
      const alongX = name === 'minZ' || name === 'maxZ';
      const at =
        name === 'minZ'
          ? f.rect[2]
          : name === 'maxZ'
            ? f.rect[3]
            : name === 'minX'
              ? f.rect[0]
              : f.rect[1];
      const band = tupleOf(
        getClearanceRect(
          {
            side: outward,
            at,
            spanMin: alongX ? f.rect[0] : f.rect[2],
            width: alongX ? cm(f.rect[1] - f.rect[0]) : cm(f.rect[3] - f.rect[2]),
          },
          depth,
        ),
      );
      /** @type {PlanRectCoordinates} */
      const clipped = [
        cm(Math.max(band[0], host[0])),
        cm(Math.min(band[1], host[1])),
        cm(Math.max(band[2], host[2])),
        cm(Math.min(band[3], host[3])),
      ];
      const got = cm(alongX ? clipped[3] - clipped[2] : clipped[1] - clipped[0]);
      /** @type {string[]} */
      const blockers = [];
      for (const [j, other] of fixtures.entries()) {
        if (j === i || !rectsOverlap(clipped, other.rect)) continue;
        const ox = cm(Math.min(clipped[1], other.rect[1]) - Math.max(clipped[0], other.rect[0]));
        const oz = cm(Math.min(clipped[3], other.rect[3]) - Math.max(clipped[2], other.rect[2]));
        blockers.push(
          `${other.kind}${other.room === f.room ? '' : ` in ${other.room}`} covers ` +
            `${m(ox)} × ${m(oz)} = ${m(ox * oz)} m²`,
        );
      }
      offered.push(
        `${name} ${m(Math.max(got, 0))}${blockers.length ? ` (blocked: ${blockers.join(', ')})` : ''}`,
      );
      if (got >= depth - EPS && blockers.length === 0 && (!reached || got > reached.got)) {
        reached = { name, got };
      }
    }
    if (reached) {
      // Carried into the register, so a reader sees that the bath is reached
      // from the north and the basin from the west without re-deriving it.
      reachedFrom.set(f, `${reached.name} ${m(reached.got)}`);
    } else {
      fail(
        `${f.kind} in ${f.room} cannot be reached from any face: it needs ${m(depth)} clear at one ` +
          `of them, and inside the room rect [${host.map(n).join(', ')}] it finds ${offered.join('; ')}`,
      );
    }
  }

  /**
   * Door swing. The clear rectangle is the leaf's width by its own width deep,
   * measured into the room from the wall face: a leaf has to be able to stand
   * at 90° with nothing under it.
   *
   * Taken off the derived walls rather than off PORTS, because a wall already
   * knows which room it belongs to and which way is inward — so each face of a
   * shared door is tested in its own room, with no second copy of that logic.
   *
   * Doors only. The living-room port is declared leafless, and what stands
   * across the corridor from it is the television, on purpose (FIXTURES header)
   * — swinging a leaf that does not exist would condemn the one arrangement the
   * owner asked for by name.
   */
  /** @type {{ wall: Wall, op: DerivedOpening, rect: PlanRectCoordinates }[]} */
  const swings = [];
  /** @type {Map<string, string>} */
  const exempt = new Map();
  /** @type {Map<string, string>} */
  const undirected = new Map();
  for (const w of walls) {
    for (const op of w.openings) {
      if (op.kind !== 'door') continue;
      // A leaf that does not swing inward needs no floor to open into. `swing`
      // absent means an inward swing, which is how every port behaved before the
      // field existed, so the default stays conservative: tested on BOTH faces,
      // because nothing says which room an inward leaf opens into.
      if (op.swing === 'slide') {
        exempt.set(op.matricule, 'sliding leaf, needs no floor to open into');
        continue;
      }
      if (op.swing && op.swing !== 'in') {
        // 'out' of WHICH room? `between` is a pair, not a direction, so an
        // outward leaf is still tested inward on both faces — the conservative
        // reading — until the field names the room it opens into.
        undirected.set(op.matricule, op.swing);
      }
      // One derivation, two callers. This used to be a four-branch ternary over
      // `w.side`, and `ports/queries.ts` needed the same rectangle on the
      // TypeScript side; the second copy would have been the one to drift. The
      // compass vocabulary is this script's, the face vocabulary is the
      // domain's, and FACE_OF_SIDE is the whole of the translation.
      swings.push({ wall: w, op, rect: tupleOf(getSwingRect(faceOf(w, op))) });
    }
  }

  for (const swing of swings) {
    for (const f of fixtures) {
      if (f.room !== swing.wall.roomId) continue;
      if (!rectsOverlap(f.rect, swing.rect)) continue;
      const ox = cm(Math.min(f.rect[1], swing.rect[1]) - Math.max(f.rect[0], swing.rect[0]));
      const oz = cm(Math.min(f.rect[3], swing.rect[3]) - Math.max(f.rect[2], swing.rect[2]));
      fail(
        `${f.kind} in ${f.room} blocks ${swing.op.matricule}: its ${m(swing.op.width)} × ${m(swing.op.width)} clear rectangle ` +
          `[${swing.rect.map(n).join(', ')}] is covered ${m(ox)} × ${m(oz)} = ${m(ox * oz)} m²`,
      );
    }
  }

  /**
   * A leafless port has no leaf to swing, and that is precisely why it needs
   * this: nothing in the swing test above would ever look at it, so a sofa could
   * be stood in the living room's 3.50 m opening and the floor would still read
   * as closing. The band is `FIXTURE_SPEC.openingClearance` deep on BOTH faces —
   * a passage is only a passage if you can walk out of it as well as into it.
   *
   * @type {{ wall: Wall, op: DerivedOpening, rect: PlanRectCoordinates }[]}
   */
  const passages = [];
  for (const w of walls) {
    for (const op of w.openings) {
      if (op.kind !== 'opening') continue;
      passages.push({
        wall: w,
        op,
        rect: tupleOf(getClearanceRect(faceOf(w, op), FIXTURE_SPEC.openingClearance)),
      });
    }
  }

  for (const passage of passages) {
    for (const f of fixtures) {
      if (f.room !== passage.wall.roomId) continue;
      if (!rectsOverlap(f.rect, passage.rect)) continue;
      const ox = cm(Math.min(f.rect[1], passage.rect[1]) - Math.max(f.rect[0], passage.rect[0]));
      const oz = cm(Math.min(f.rect[3], passage.rect[3]) - Math.max(f.rect[2], passage.rect[2]));
      fail(
        `${f.kind} in ${f.room} stands in ${passage.op.matricule}: the ${m(FIXTURE_SPEC.openingClearance)} ` +
          `passage [${passage.rect.map(n).join(', ')}] is covered ${m(ox)} × ${m(oz)} = ${m(ox * oz)} m²`,
      );
    }
  }

  /**
   * How thick the wall is where an opening sits.
   *
   * `wall.thickness` is the THICKEST contact of the face, kept for quantities; a
   * face that wraps one neighbour heavy and divides another thin is two
   * thicknesses, and the doorway is as deep as the stretch it is actually cut
   * through. So the contact under the opening's midpoint is the one asked.
   *
   * @param {Wall} wall The face the opening is cut in.
   * @param {DerivedOpening} op The opening.
   * @returns {number} Built width of the wall there, in metres.
   */
  const thicknessAt = (wall, op) => {
    const mid = op.spanMin + op.width / 2;
    const contact = wall.contacts.find((c) => mid >= c.spanMin - EPS && mid <= c.spanMax + EPS);
    return contact ? contact.thickness : wall.thickness;
  };

  /**
   * The doorway itself: the hole in the wall you walk through.
   *
   * A DIFFERENT question from the swing band above, and the reason it has to be
   * asked separately is a real defect this caught. The guest sanitair's shower
   * door is a sliding leaf, and a sliding leaf is rightly exempt from the swing
   * test — it needs no floor to open into. But a fitting parked in the doorway
   * blocks the door just as completely as one parked in a leaf's arc, and until
   * this check existed nothing asked after it: the basin stood squarely across
   * the shower doorway and the floor read as closing.
   *
   * So it applies to EVERY port kind — leaves that swing, leaves that slide, and
   * the leafless opening — and it is the opening's own span by the built
   * thickness of the wall there, taken inward on each face, because a fixture
   * stands in a room and the hole is in the wall between two of them.
   *
   * @type {{ wall: Wall, op: DerivedOpening, built: number, rect: PlanRectCoordinates }[]}
   */
  const doorways = [];
  for (const w of walls) {
    for (const op of w.openings) {
      if (op.kind !== 'door' && op.kind !== 'opening') continue;
      const built = thicknessAt(w, op);
      // A zero-thickness join is not a wall, so it has no doorway to stand in —
      // and `getClearanceRect` rejects a depth of zero rather than inventing one.
      if (built <= EPS) continue;
      doorways.push({ wall: w, op, built, rect: tupleOf(getClearanceRect(faceOf(w, op), built)) });
    }
  }

  for (const doorway of doorways) {
    for (const f of fixtures) {
      if (f.room !== doorway.wall.roomId) continue;
      if (!rectsOverlap(f.rect, doorway.rect)) continue;
      const ox = cm(Math.min(f.rect[1], doorway.rect[1]) - Math.max(f.rect[0], doorway.rect[0]));
      const oz = cm(Math.min(f.rect[3], doorway.rect[3]) - Math.max(f.rect[2], doorway.rect[2]));
      fail(
        `${f.kind} in ${f.room} stands in the doorway of ${doorway.op.matricule}: the opening itself ` +
          `— ${m(doorway.op.width)} wide by the ${m(doorway.built)} wall ` +
          `[${doorway.rect.map(n).join(', ')}] — is covered ${m(ox)} × ${m(oz)} = ${m(ox * oz)} m²`,
      );
    }
  }

  /** @type {Map<string, PlanFixture[]>} */
  const byFixtureRoom = new Map();
  for (const f of fixtures) {
    // `get` then fill, rather than `has` then `get`: one lookup instead of two,
    // and the list is a value the reader can see is present.
    let list = byFixtureRoom.get(f.room);
    if (!list) {
      list = [];
      byFixtureRoom.set(f.room, list);
    }
    list.push(f);
  }
  /**
   * The room half of a fixture's matricule, built the way `walls.mjs` builds it
   * for a wall: floor, room number, room type. `F1-R12-LND-X3` is then that
   * prefix and the fixture's place in `compareFixturePosition` order — the same
   * number the drawing prints beside the shape and the Registers page prints in
   * its MATRICULE column, because all three sort by the same comparator.
   *
   * @param {PlanRoom} room The room the fixture stands in.
   * @returns {string} e.g. `F1-R12-LND`.
   */
  const roomPrefix = (room) => `F${FLOOR_NUMBER}-R${String(room.n).padStart(2, '0')}-${room.type}`;

  // Room by room, in matricule order. At forty-odd fixtures the old flat list
  // was a
  // wall of rectangles: what makes it readable is that each row carries the name
  // the rest of the drawing calls it by, and each room closes with how much of
  // its floor is standing under something.
  const registers = [...byFixtureRoom].sort(
    ([a], [b]) =>
      (roomById.get(a)?.n ?? Number.MAX_SAFE_INTEGER) -
      (roomById.get(b)?.n ?? Number.MAX_SAFE_INTEGER),
  );
  for (const [roomId, list] of registers) {
    const room = roomById.get(roomId);
    const area = room ? roomArea(room) : 0;
    line(`${room ? `${room.name} (${m(area)} m²)` : roomId}:`);
    const ordered = [...list].sort(compareFixturePosition);
    const taken = cm(ordered.reduce((sum, f) => sum + rectArea(f.rect), 0));
    ordered.forEach((f, index) => {
      const matricule = `${room ? roomPrefix(room) : roomId}-X${index + 1}`;
      line(
        `   ${matricule.padEnd(17)} ${f.kind.padEnd(15)} ` +
          `${m(f.rect[1] - f.rect[0])} × ${m(f.rect[3] - f.rect[2])}` +
          `  at x ${m(f.rect[0])}–${m(f.rect[1])}, z ${m(f.rect[2])}–${m(f.rect[3])}` +
          `  reached from ${reachedFrom.get(f) ?? 'nowhere'}` +
          (f.note ? `  — ${f.note}` : ''),
      );
    });
    line(
      `   occupancy: ${m(taken)} m² of ${m(area)} m²` +
        `${area > EPS ? ` (${Math.round((taken / area) * 100)}%)` : ''}`,
    );
  }
  line(
    `${fixtures.length} fixtures, ${swings.length} door faces checked for swing, ` +
      `${passages.length} leafless port faces checked for a clear ${m(FIXTURE_SPEC.openingClearance)} passage, ` +
      `${doorways.length} port faces checked for a fixture standing in the doorway itself`,
  );
  // Named out loud so an exemption is never silent.
  line(
    exempt.size
      ? `exempt from the swing test: ${[...exempt].map(([mat, why]) => `${mat} (${why})`).join('; ')}`
      : 'no door is exempt from the swing test',
  );
  if (undirected.size) {
    line(
      `swing given but not directional, so still tested inward on both faces: ${[...undirected].map(([mat, s]) => `${mat} (swing '${s}')`).join('; ')}`,
    );
  }
  // A freestanding fixture is a claim, not an error — a dining table is MEANT to
  // stand clear. But one that drifted off its wall and one that was meant to
  // stand in the open are the same four numbers, so the claim is read back out.
  line(
    freestanding.length
      ? `freestanding by declaration, reachable from all four sides: ${freestanding.join('; ')}`
      : 'nothing is declared freestanding: every fixture backs onto a wall',
  );
  // A reduced approach is a recorded decision with a figure on it. Printed every
  // run, because the one way it could become a mistake is by going unread.
  line(
    reduced.length
      ? `approach reduced below the ${m(FIXTURE_SPEC.approach)} default: ${reduced.join('; ')}`
      : `no fixture asks for less than the ${m(FIXTURE_SPEC.approach)} default approach`,
  );

  // The swing inventory. `src/features/building/domain/ports/queries.test.ts`
  // pins the same rectangles on the TypeScript side, derived from PORTS and the
  // room rects rather than from the wall register — two routes to one number.
  // This is the list a human compares the two by, so it prints every door face,
  // including both faces of a shared door, which is what the test also holds.
  line('swing inventory — the floor each leaf needs, by door face:');
  for (const swing of [...swings].sort((a, b) =>
    a.op.matricule === b.op.matricule
      ? a.wall.roomId.localeCompare(b.wall.roomId)
      : a.op.matricule.localeCompare(b.op.matricule),
  )) {
    line(
      `   ${swing.op.matricule.padEnd(17)} ${swing.wall.roomId.padEnd(18)} ` +
        `${m(swing.op.width)} × ${m(swing.op.width)} inward of ${swing.wall.side}` +
        `  [${swing.rect.map(n).join(', ')}]`,
    );
  }

  // The owner's own unresolved items, on the rooms they belong to. They live on
  // PlanRoom rather than only in the brief because the brief is a document you
  // have to know to open; printing them here is what puts them in front of him
  // in the same run that proves the floor closes.
  const unsettled = rooms.filter((room) => (room.open?.length ?? 0) > 0);
  line(
    unsettled.length
      ? `OPEN ITEMS — ${unsettled.length} room(s) carry something the owner has not settled:`
      : 'OPEN ITEMS — none: no room carries an unresolved item',
  );
  for (const room of unsettled) {
    line(`   ${roomPrefix(room)} ${room.name}:`);
    for (const item of room.open ?? []) line(`      · ${item}`);
  }
}

/* ────────────────────── 10. insulated walls ────────────────────── */

check("10. Insulated walls: the owner's list, and the physical walls it actually builds");
{
  // The backing geometry and the isolation spans are derived once at module
  // scope and shared with check 8, so the register and the thickness check can
  // never disagree about what is built along a stretch.
  const byMatricule = new Map(walls.map((w) => /** @type {[string, Wall]} */ ([w.matricule, w])));
  /** @type {Wall[]} */
  const listed = [];
  /** @type {Set<string>} */
  const seenMatricules = new Set();
  for (const [i, entry] of INSULATED_WALLS.entries()) {
    if (seenMatricules.has(entry.matricule)) {
      fail(`INSULATED_WALLS[${i}] lists ${entry.matricule} twice`);
      continue;
    }
    seenMatricules.add(entry.matricule);
    const wall = byMatricule.get(entry.matricule);
    if (!wall) {
      fail(
        `INSULATED_WALLS[${i}] ${entry.matricule} is not a derived wall — the list points at a wall that does not exist`,
      );
      continue;
    }
    // The tripwire the owner built into his own list: he quoted a length beside
    // every matricule, so a renumbering or a re-split that silently slides the
    // list onto a different wall shows up here as a length that stopped matching.
    if (Math.abs(wall.length - entry.length) > EPS) {
      fail(
        `INSULATED_WALLS[${i}] ${entry.matricule} is quoted ${m(entry.length)} but derives ${m(wall.length)} ` +
          `(${wall.roomId} ${wall.side}, ${m(wall.spanMin)}–${m(wall.spanMax)}) — the numbering has moved under the list`,
      );
    }
    if (Math.abs(wall.thickness) < EPS) {
      fail(
        `INSULATED_WALLS[${i}] ${entry.matricule} is a zero-thickness join (${wall.roomId} → ${wall.faces}) — there is no wall there to insulate`,
      );
    }
    listed.push(wall);
  }

  // Sourced from `contacts` — the same field the plan renderer draws from — so
  // the register and the drawing cannot disagree about what is built heavy. That
  // includes the junction returns, which are isolation because the run carries
  // through the corner. Heavy is `reason === 'isolation'` OR the face being
  // named, the same both-halves rule the renderer paints red on: an exterior or
  // weather-exposed stretch keeps the reason that explains its depth, so the
  // named list is the only record that the owner wants it isolated.
  /**
   * Widened to the declared interface, for the same reason as in check 8: a set
   * built from the frozen literal's matricules would only answer about the faces
   * named today, and here every derived wall has to be able to ask.
   *
   * @type {readonly InsulatedWall[]}
   */
  const insulatedList = INSULATED_WALLS;
  const namedFaces = new Set(insulatedList.map((entry) => entry.matricule));
  /** @type {{ wall: Wall, spans: MutableSpan[], insulated: number, partial: boolean }[]} */
  const register = [];
  for (const w of walls) {
    /** @type {Span[]} */
    const heavy = namedFaces.has(w.matricule)
      ? [[w.spanMin, w.spanMax]]
      : (w.contacts ?? [])
          .filter((c) => c.reason === 'isolation')
          .map((c) => /** @type {Span} */ ([c.spanMin, c.spanMax]));
    const spans = mergeSpans(heavy);
    if (spans.length === 0) continue;
    const insulated = cm(spans.reduce((sum, [lo, hi]) => sum + (hi - lo), 0));
    register.push({ wall: w, spans, insulated, partial: insulated < w.length - EPS });
  }

  const totalWall = cm(walls.reduce((sum, w) => sum + w.length, 0));
  const totalInsulated = cm(register.reduce((sum, r) => sum + r.insulated, 0));
  const partials = register.filter((r) => r.partial);

  line(
    `${INSULATED_WALLS.length} faces named, ${listed.length} resolved; ${register.length} faces carry isolation once the backing is followed`,
  );
  for (const r of register) {
    line(
      `${r.wall.matricule.padEnd(16)} ${m(r.wall.length).padStart(5)} long  ${m(r.insulated).padStart(5)} insulated  ` +
        `${r.spans.map(([lo, hi]) => `${m(lo)}–${m(hi)}`).join(', ')}` +
        `${r.partial ? `  ← partial, plain for ${m(r.wall.length - r.insulated)}` : ''}`,
    );
  }

  // Deliberately not a failure: a wall heavy over part of its run is the owner's
  // list doing exactly what he asked, not an error. It is a buildability
  // question, so it is said out loud here and repeated in the notes rather than
  // rounded up to whole walls.
  for (const r of partials) {
    notes.push(
      `${r.wall.matricule} (${r.wall.roomId} ${r.wall.side}, backs onto ${r.wall.faces}) is insulated ` +
        `${m(r.insulated)} of ${m(r.wall.length)} — built heavy for part of its run and plain for ${m(r.wall.length - r.insulated)}`,
    );
  }
  line(
    partials.length
      ? `partially insulated: ${partials.map((r) => `${r.wall.matricule} ${m(r.insulated)}/${m(r.wall.length)}`).join(', ')}`
      : 'no partially insulated wall',
  );
  line(
    `insulated ${m(totalInsulated)} m of ${m(totalWall)} m of wall face (every face counted, both sides of each wall)`,
  );
}

/* ────────────────────── 11. parapet walls ────────────────────── */

check('11. Parapet walls: the faces built lower than a storey');
{
  /**
   * WHY this list needs a check at all, and a strict one.
   *
   * A parapet used to be INFERRED: the model asked whether a wall's top happened
   * to equal the railing height. That worked only while side B was open air, and
   * once side B became a normal exterior wall the test matched nothing — a real
   * balustrade would have been built full height, closing the balcony in. The
   * inference is now deleted, so this list is the only thing standing between the
   * owner's balcony and a solid wall. If an entry silently stops pointing at the
   * wall it means, the balcony closes and nothing says so.
   *
   * Same exposure as INSULATED_WALLS, and the same answer: resolve the matricule,
   * and check the stated height against what the wall actually is.
   */
  const byMatricule = new Map(walls.map((w) => /** @type {[string, Wall]} */ ([w.matricule, w])));
  /** @type {{ entry: ParapetWall, wall: Wall }[]} */
  const listed = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const [i, entry] of PARAPET_WALLS.entries()) {
    if (seen.has(entry.matricule)) {
      fail(`PARAPET_WALLS[${i}] lists ${entry.matricule} twice`);
      continue;
    }
    seen.add(entry.matricule);

    const wall = byMatricule.get(entry.matricule);
    if (!wall) {
      fail(
        `PARAPET_WALLS[${i}] ${entry.matricule} is not a derived wall — a stated height has to point at a wall that exists`,
      );
      continue;
    }

    // A parapet at zero is not a wall, and one at storey height is not a parapet.
    if (!(entry.height > EPS)) {
      fail(
        `PARAPET_WALLS[${i}] ${entry.matricule} stands at ${m(entry.height)} — that is not a wall`,
      );
    } else if (entry.height >= HEIGHTS.wall - EPS) {
      fail(
        `PARAPET_WALLS[${i}] ${entry.matricule} stands at ${m(entry.height)} against a ${m(HEIGHTS.wall)} storey — ` +
          `a parapet at full height is a contradiction`,
      );
    }

    // Nothing can stand at any height where no masonry is built.
    if (Math.abs(wall.thickness) < EPS) {
      fail(
        `PARAPET_WALLS[${i}] ${entry.matricule} is a zero-thickness join (${wall.roomId} → ${wall.faces}) — ` +
          `there is no masonry there to build low`,
      );
    }

    // The owner's own tripwire, active the moment an entry quotes a length: a
    // matricule can slide onto a different wall when the numbering moves, and a
    // list pointing at the wrong wall fails silently. A quoted length stops
    // matching instead.
    if (entry.length !== undefined && Math.abs(wall.length - entry.length) > EPS) {
      fail(
        `PARAPET_WALLS[${i}] ${entry.matricule} is quoted ${m(entry.length)} but derives ${m(wall.length)} ` +
          `(${wall.roomId} ${wall.side}, ${m(wall.spanMin)}–${m(wall.spanMax)}) — the numbering has moved under the list`,
      );
    }

    listed.push({ entry, wall });
  }

  // One piece of masonry cannot stand at two heights. Two entries naming the two
  // faces of one wall have to agree.
  for (const a of listed) {
    for (const b of listed) {
      if (a.wall.matricule >= b.wall.matricule) continue;
      if (!facesEachOther(a.wall, b.wall)) continue;
      if (Math.abs(a.entry.height - b.entry.height) <= EPS) continue;
      fail(
        `${a.wall.matricule} at ${m(a.entry.height)} and ${b.wall.matricule} at ${m(b.entry.height)} are the two faces ` +
          `of one wall — one piece of masonry cannot stand at two heights`,
      );
    }
  }

  line(
    `${PARAPET_WALLS.length} face(s) stated lower than a storey; a storey wall is ${m(HEIGHTS.wall)}, the railing constant ${m(HEIGHTS.railing)}`,
  );
  for (const { entry, wall } of listed) {
    const partner = walls.find((w) => w.matricule !== wall.matricule && facesEachOther(wall, w));
    line(
      `${wall.matricule.padEnd(16)} ${m(wall.length).padStart(5)} long  ${m(entry.height)} high  ` +
        `(${m(HEIGHTS.wall - entry.height)} below a storey)  faces ${wall.faces}` +
        `${partner ? `  · other face ${partner.matricule}` : ''}`,
    );
  }
  line(
    `${listed.length} of ${walls.length} faces stand low; the other ${walls.length - listed.length} are full height at ${m(HEIGHTS.wall)}`,
  );

  // Not a failure: the owner said one metre and it is his balustrade. But the
  // plan carries a railing height too, and the two numbers describe the same
  // thing — worth saying out loud which one will actually be built.
  for (const { entry, wall } of listed) {
    if (Math.abs(entry.height - HEIGHTS.railing) > EPS) {
      notes.push(
        `${wall.matricule} is stated at ${m(entry.height)} while HEIGHTS.railing is ${m(HEIGHTS.railing)} — ` +
          `two numbers for the same balustrade, and the stated one is what gets built`,
      );
    }
  }
}

/* ──────── 12. isolation is a width, so it cannot be built thin ──────── */

check('12. Isolation is a width: nothing reads heavy while being built thin');
{
  /**
   * WHY this is a check of its own, and why check 8 structurally cannot be it.
   *
   * Check 8 compares a stretch against the gap the rects leave. A junction return
   * has no gap to compare against — backing onto nothing is exactly what makes it
   * a return — so the one place the two halves of "thick win" can come apart is
   * the one place check 8 is blind by construction.
   *
   * Isolation on this floor IS a width: a wall the owner named is built
   * `WALLS.insulated` and a plain separator `WALLS.partition`. A stretch reading
   * 'isolation' at the partition width therefore claims a sound and heat barrier
   * while being built as a thin partition — and both renderers paint the isolated
   * runs red, so the drawing paints a thin wall red and the owner reads a barrier
   * that is not there. It happened at two corners, both where one of the guest
   * suite's 0.30 walls lands in a 0.15 wall to a space the owner deliberately
   * left out of the thick wrap, and it survived every other check here.
   *
   * The rule is the owner's own — "in thick wall when X wall meet Y wall and both
   * this the XY point is RED thick win" — and thick winning means the junction is
   * widened, not merely coloured.
   *
   * Only `reason === 'isolation'` is asked. A face on the owner's list can
   * legitimately carry a stretch thinner than 0.30 where a join override forces
   * the depth, and saying so is check 8's and check 10's business; what cannot
   * exist is a stretch whose own stated reason for its width is a width it was
   * not built to.
   */
  const insulated = WALLS.insulated ?? WALLS.exterior;
  /** @type {{ wall: Wall, span: Span, thickness: number }[]} */
  const claiming = [];
  for (const w of walls) {
    for (const c of w.contacts ?? []) {
      if (c.reason !== 'isolation') continue;
      claiming.push({ wall: w, span: [c.spanMin, c.spanMax], thickness: c.thickness });
      if (c.thickness >= insulated - EPS) continue;
      fail(
        `${w.matricule} ${m(c.spanMin)}–${m(c.spanMax)} (${w.roomId} ${w.side}, facing ${c.neighbourId ?? 'nothing — a junction return'}) ` +
          `reads 'isolation' but is built ${m(c.thickness)}: isolation is a width here, so a stretch the drawing paints red ` +
          `has to be at least ${m(insulated)} — thick wins where a thick wall meets a thin one`,
      );
    }
  }

  const returns = claiming.filter((c) => c.wall.contacts.some((x) => x.neighbourId === null));
  const thinnest = claiming.reduce((lo, c) => Math.min(lo, c.thickness), Infinity);
  const run = cm(claiming.reduce((sum, c) => sum + (c.span[1] - c.span[0]), 0));
  line(
    `${claiming.length} stretch(es) read 'isolation', ${m(run)} m of face in all; isolation means at least ${m(insulated)} ` +
      `(partition ${m(WALLS.partition)})`,
  );
  line(
    claiming.length
      ? `thinnest stretch reading 'isolation': ${m(thinnest)}${thinnest >= insulated - EPS ? ' — at or above the insulated width, as it must be' : ''}`
      : 'no stretch reads isolation at all',
  );
  line(
    `${returns.length} of them on a face that carries a junction return, which is where the reason and the width can come apart`,
  );
}

/* ───────────────────────────── report ───────────────────────────── */

console.log('\n── walls per room');
for (const [roomN, list] of byRoom) {
  const room = ROOMS.find((r) => r.n === roomN);
  // Every wall came from a room of ROOMS, so the name is always there. Falling
  // back to the id the walls themselves carry, rather than asserting, keeps the
  // report printable either way — the same shape check 9 uses for a fixture
  // whose room is missing.
  console.log(
    `   R${String(roomN).padStart(2, '0')} ${room ? room.name : list[0].roomId} — ${list.length} walls`,
  );
  for (const w of list) {
    console.log(
      `      ${w.matricule.padEnd(16)} ${w.side.padEnd(5)} ${w.axis} ${m(w.at).padStart(6)} ` +
        `${m(w.spanMin).padStart(6)}–${m(w.spanMax).padStart(6)} (${m(w.length).padStart(5)}) ` +
        `t=${m(w.thickness)}  ${w.faces}`,
    );
  }
}

if (notes.length) {
  console.log('\n── notes');
  for (const note of notes) console.log(`   ${note}`);
}

console.log('');
if (failures.length === 0) {
  console.log(
    `PASS — 12 checks, ${walls.length} walls, ${PORTS.length + WINDOWS.length} openings, ${FIXTURES.length} fixtures, everything closes.`,
  );
  process.exit(0);
}
console.log(`FAIL — ${failures.length} problem(s):`);
for (const f of failures) console.log(`   ✗ ${f}`);
process.exit(1);
