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
  SERVICE_LAYERS,
  SERVICE_SPEC,
  SERVICE_CHAMBERS,
  SERVICE_RUNS,
} from '../../src/features/building/domain/sourceOfTruth/plan.ts';
import {
  getClearanceRect,
  getSwingRect,
} from '../../src/features/building/domain/swingClearance.ts';
import { deriveWalls, wallsByRoom } from './walls.mjs';

/** @import { Axis, DerivedOpening, MutableSpan, PlanSpec, Side, Span, Wall } from './walls.mjs' */
/**
 * @import { InsulatedWall, ParapetWall, PlanFixture, PlanJoinOverride,
 *   PlanRectCoordinates, PlanRoom, PlanRoomId, PlanRoomKind,
 *   PlanServiceEnd, PlanServiceFamily, PlanServicePoint, PlanServiceRun }
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
  SERVICE_LAYERS,
  SERVICE_SPEC,
  SERVICE_CHAMBERS,
  SERVICE_RUNS,
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

/* ──────────────────── the services, read as segments ──────────────────── */

/**
 * One straight piece of one declared run: two consecutive points of its
 * centreline, and the single axis it moves along.
 *
 * WHY the segment and not the run is the unit every service check works in: a
 * run is a polyline, and every physical question asked of one — does this piece
 * fall, does this piece lie beside that cable, does this piece stand over the
 * electrical box, does a person walk under this piece — is a question about ONE
 * straight piece. Flattening once, here, is what stops checks 13 to 19 each
 * re-deriving the same list slightly differently, which is the same defect the
 * stair-piece list in {@link STAIR_PIECES} warns about.
 *
 * @typedef {object} ServiceSegment
 * @property {PlanServiceRun} run The run this piece belongs to.
 * @property {number} runIndex Its run's index in SERVICE_RUNS, so a failure can name it.
 * @property {number} index Its own index along that run, 1 for `points[0]→points[1]`.
 * @property {PlanServicePoint} a Upstream end — the service flows a → b.
 * @property {PlanServicePoint} b Downstream end.
 * @property {'x' | 'z' | 'y' | 'none'} axis The axis it moves along, `none` when it is
 *   two copies of the same point. A piece that moves in both x and z reads `x` here
 *   and is failed by check 13 as a plan diagonal, so nothing downstream ever sees one.
 */

/** Where each axis sits inside a `PlanServicePoint`, which is `[x, z, y]`. */
const AXIS_INDEX = Object.freeze({ x: 0, z: 1, y: 2 });

/**
 * Outside diameters and minimum falls, by family, as maps rather than by
 * indexing the spec: `SERVICE_SPEC.fall` is declared for the three drainage
 * families only, so asking it about `power` has to be a question with an
 * answer — `undefined` — instead of a type error at the one place the code
 * legitimately wants to ask.
 */
const BORE = new Map(Object.entries(SERVICE_SPEC.bore));
/** Minimum fall as a rise over a run, by drainage family; empty for anything else. */
const FALL = new Map(Object.entries(SERVICE_SPEC.fall));

/**
 * Half the outside diameter of a run of this family — what it costs the space
 * around its centreline. 0 for a family with no declared bore, which check 13
 * fails separately rather than letting a missing size read as a zero-width pipe.
 *
 * @param {PlanServiceFamily} family What the run carries.
 * @returns {number} Its outside radius, in metres.
 */
const radiusOf = (family) => (BORE.get(family) ?? 0) / 2;

/**
 * The one axis a piece of centreline moves along.
 *
 * @param {PlanServicePoint} a One end.
 * @param {PlanServicePoint} b The other.
 * @returns {'x' | 'z' | 'y' | 'none'} The axis, or `none` for a zero-length piece.
 */
const axisOfSegment = (a, b) =>
  Math.abs(b[0] - a[0]) > EPS
    ? 'x'
    : Math.abs(b[1] - a[1]) > EPS
      ? 'z'
      : Math.abs(b[2] - a[2]) > EPS
        ? 'y'
        : 'none';

/** Every declared run, cut into its straight pieces. @type {ServiceSegment[]} */
const SERVICE_SEGMENTS = SERVICE_RUNS.flatMap((run, runIndex) =>
  run.points.slice(1).map((b, i) => ({
    run,
    runIndex,
    index: i + 1,
    a: run.points[i],
    b,
    axis: axisOfSegment(run.points[i], b),
  })),
);

/**
 * Where a run end is, in the words the drawing uses.
 *
 * A cap's `why` is a paragraph — it has to be, because it is the reason a pipe
 * is allowed to stop in mid-air — so it is cut to its opening clause here. The
 * whole sentence belongs in the file beside the cap, not in every line of a
 * report that mentions the run.
 *
 * @param {PlanServiceEnd} end One end of a run.
 * @returns {string} It, named.
 */
const endLabel = (end) =>
  end.at === 'space'
    ? end.space
    : end.at === 'chamber'
      ? `chamber ${end.chamber}`
      : end.at === 'fitting'
        ? `${end.space} ${end.kind}`
        : `cap (${end.why.length > 48 ? `${end.why.slice(0, 48).trimEnd()}…` : end.why})`;

/**
 * One run, named the way a failure has to name it: by the index that finds it in
 * the file, and by what it is and where it goes.
 *
 * @param {PlanServiceRun} run The run.
 * @param {number} runIndex Its index in SERVICE_RUNS.
 * @returns {string} Its label.
 */
const runLabel = (run, runIndex) =>
  `SERVICE_RUNS[${runIndex}] ${run.layer}/${run.family} ${endLabel(run.from)} → ${endLabel(run.to)}`;

/**
 * One piece of one run, named.
 *
 * @param {ServiceSegment} seg The piece.
 * @returns {string} Its label.
 */
const segLabel = (seg) => `${runLabel(seg.run, seg.runIndex)} segment ${seg.index}`;

/**
 * Is this plan point inside that rect? An edge counts as inside: a riser stood
 * exactly on a void's boundary is in the void, and a pipe grazing the electrical
 * chamber's edge is over it.
 *
 * @param {number} x Plan x.
 * @param {number} z Plan z.
 * @param {PlanRectCoordinates} rect The rect.
 * @returns {boolean} Whether the point is in it.
 */
const pointInRect = (x, z, [minX, maxX, minZ, maxZ]) =>
  x >= minX - EPS && x <= maxX + EPS && z >= minZ - EPS && z <= maxZ + EPS;

/**
 * Does the PLAN projection of this piece touch that rect — at any height?
 * Height is exactly what the question is not about where it is asked (check 16:
 * water above an electrical box is still water above an electrical box).
 *
 * Every piece is axis-aligned in plan, check 13 having failed anything that is
 * not, so its projection is a segment along one axis and the overlap is the
 * ordinary interval test on both.
 *
 * @param {ServiceSegment} seg The piece.
 * @param {PlanRectCoordinates} rect The rect.
 * @returns {boolean} Whether the piece passes over it.
 */
const segmentOverRect = (seg, [minX, maxX, minZ, maxZ]) =>
  Math.max(seg.a[0], seg.b[0]) >= minX - EPS &&
  Math.min(seg.a[0], seg.b[0]) <= maxX + EPS &&
  Math.max(seg.a[1], seg.b[1]) >= minZ - EPS &&
  Math.min(seg.a[1], seg.b[1]) <= maxZ + EPS;

/**
 * The rects of one named space.
 *
 * @param {string} id The space's id.
 * @returns {readonly PlanRectCoordinates[]} Its rects, empty when nothing is named that.
 */
const rectsOfSpace = (id) => ROOMS.find((r) => r.id === id)?.rects ?? [];

/**
 * Where a riser may stand: the two service voids, and the two chambers of the
 * control center. Nowhere else on this floor is a hole through the slab.
 *
 * @type {{ where: string, rect: PlanRectCoordinates }[]}
 */
const RISER_FOOTPRINTS = [
  ...['voidWest', 'voidEast'].flatMap((id) =>
    rectsOfSpace(id).map((rect) => ({ where: id, rect })),
  ),
  ...SERVICE_CHAMBERS.map((chamber) => ({ where: chamber.id, rect: chamber.rect })),
];

/** The kinds of space the programme is delivered to: everything a person uses. */
const PROGRAMME_KINDS = new Set(['room', 'circulation', 'stairwell']);
/** Every space a service is expected to reach. @type {PlanRoomId[]} */
const PROGRAMME_SPACES = ROOMS.filter((r) => PROGRAMME_KINDS.has(r.kind)).map((r) => r.id);

/** The bottom of this storey's build-up: the 0.30 ceiling void of the storey below. */
const STOREY_BOTTOM = cm(HEIGHTS.wall - HEIGHTS.floorToFloor);
/** The finished floor of the storey above, where a riser leaves this one. */
const STOREY_TOP = cm(HEIGHTS.floorToFloor);

/**
 * Every coordinate the services declare, labelled, so that check 1 grid-checks
 * them with everything else.
 *
 * WHY this lives here and is appended to check 1 rather than being a grid test
 * inside check 13: `stairValues` in check 1 carries the warning, and this is the
 * third time it would have been earned — a plan array that is not appended to
 * `gridValues` is SILENTLY ungridded. A service point nudged half a centimetre
 * would be drawn, boxed and quantified without one line of output anywhere. So
 * the services join the same list the rects, the stair pieces and the openings
 * are on, and check 13 is left to ask the questions only a pipe raises.
 *
 * Only real plan geometry is on this list. `SERVICE_SPEC` is deliberately NOT:
 * a 75 mm vent and a 1:80 fall are a bore and a gradient, not points on the
 * plan, and putting them here would fail check 1 for being what they are.
 *
 * @type {[string, number][]}
 */
const SERVICE_COORDS = [
  ...SERVICE_RUNS.flatMap((run, i) =>
    run.points.flatMap((p, k) =>
      ['x', 'z', 'y'].map(
        (name, j) =>
          /** @type {[string, number]} */ ([`SERVICE_RUNS[${i}].points[${k}].${name}`, p[j]]),
      ),
    ),
  ),
  ...SERVICE_CHAMBERS.flatMap((chamber) => [
    ...chamber.rect.map(
      (v, i) => /** @type {[string, number]} */ ([`${chamber.id}.rect[${i}]`, v]),
    ),
    /** @type {[string, number]} */ ([`${chamber.id}.top`, chamber.top]),
  ]),
];

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
    // The services, built above: every point of every run and both chamber
    // footprints. See SERVICE_COORDS for why they are on THIS list and not
    // grid-checked inside check 13 — the warning above is about exactly this.
    ...SERVICE_COORDS,
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

/* ──────── 13. a service run is geometry, not a sketch of one ──────── */

check('13. Service runs: real geometry, inside the plot, with ends that resolve');
{
  /**
   * WHY a run gets a geometry check of its own, and why the diagonal rule reads
   * the way it does.
   *
   * A run is drawn by hand from a route in the owner's head, the way the rects
   * are. The failures are the same failures: a point half a centimetre off the
   * grid, a point typed twice so a segment has no length, a route that cuts a
   * corner. The last one is the one worth spelling out, because it is the only
   * rule here that is not simply "be a number".
   *
   * A building service is installed along the building. A pipe runs along a
   * wall, turns at a corner and runs along the next one; it does not cross a
   * room corner to corner, because there is nothing there to fix it to and
   * nothing to box it in. So a segment may change ONE horizontal axis. What it
   * may also do at the same time is change y — that is a drain falling as it
   * runs, or a duct climbing over a door head, and check 18 REQUIRES exactly
   * that of every drainage segment. A rule that banned all three-dimensional
   * movement would ban the falls this file also insists on.
   *
   * What cannot exist is a segment that changes x AND z: a plan diagonal, a pipe
   * crossing open floor at 45°.
   */
  const layers = new Map(
    SERVICE_LAYERS.map((l) => /** @type {[string, boolean]} */ ([l.key, l.service])),
  );
  for (const [i, run] of SERVICE_RUNS.entries()) {
    if (!layers.has(run.layer)) fail(`${runLabel(run, i)} names no declared layer`);
    else if (!layers.get(run.layer)) {
      fail(`${runLabel(run, i)} is on '${run.layer}', which is not a service layer`);
    }
    if (!BORE.has(run.family))
      fail(`${runLabel(run, i)} is a '${run.family}' with no declared bore`);
    if (run.points.length < 2) fail(`${runLabel(run, i)} has ${run.points.length} point(s)`);
    for (const [k, p] of run.points.entries()) {
      if (
        p[0] < PLOT[0] - EPS ||
        p[0] > PLOT[1] + EPS ||
        p[1] < PLOT[2] - EPS ||
        p[1] > PLOT[3] + EPS
      ) {
        fail(
          `${runLabel(run, i)} point ${k} (${m(p[0])}, ${m(p[1])}) is outside the plot ` +
            `${n(PLOT[0])}–${n(PLOT[1])} × ${n(PLOT[2])}–${n(PLOT[3])}`,
        );
      }
      if (p[2] < STOREY_BOTTOM - EPS || p[2] > STOREY_TOP + EPS) {
        fail(
          `${runLabel(run, i)} point ${k} is at y ${m(p[2])}, outside this storey's ` +
            `${m(STOREY_BOTTOM)}–${m(STOREY_TOP)} — below the floor build-up or above the next finished floor`,
        );
      }
    }
    // Both ends have to name something that is actually in the plan, or the run
    // is connected to a word. A fitting end is the strict one: the kind has to
    // be a FIXTURES row OF THAT ROOM, so a tap declared to a sink in a room with
    // no sink is caught rather than drawn to the middle of the floor.
    for (const [which, end] of /** @type {[string, PlanServiceEnd][]} */ ([
      ['from', run.from],
      ['to', run.to],
    ])) {
      const its = `its '${which}' end`;
      if (end.at === 'space' && !ROOMS.some((r) => r.id === end.space)) {
        fail(`${runLabel(run, i)} — ${its} names no space '${end.space}'`);
      } else if (end.at === 'chamber' && !SERVICE_CHAMBERS.some((c) => c.id === end.chamber)) {
        fail(`${runLabel(run, i)} — ${its} names no chamber '${end.chamber}'`);
      } else if (end.at === 'fitting') {
        if (!ROOMS.some((r) => r.id === end.space)) {
          fail(`${runLabel(run, i)} — ${its} names no space '${end.space}'`);
        } else if (!FIXTURES.some((f) => f.room === end.space && f.kind === end.kind)) {
          fail(
            `${runLabel(run, i)} — ${its} asks for a ${end.kind} and ${end.space} has none in FIXTURES`,
          );
        }
      } else if (end.at === 'cap' && end.why.trim() === '') {
        fail(`${runLabel(run, i)} — ${its} is a cap with no reason: a pipe ending in mid-air`);
      }
    }
  }
  let planLength = 0;
  for (const seg of SERVICE_SEGMENTS) {
    if (seg.axis === 'none') {
      fail(`${segLabel(seg)} is zero length: (${seg.a.map(n).join(', ')}) twice`);
    }
    if (Math.abs(seg.b[0] - seg.a[0]) > EPS && Math.abs(seg.b[1] - seg.a[1]) > EPS) {
      fail(
        `${segLabel(seg)} is a plan diagonal: (${m(seg.a[0])}, ${m(seg.a[1])}) → ` +
          `(${m(seg.b[0])}, ${m(seg.b[1])}) moves ${m(Math.abs(seg.b[0] - seg.a[0]))} in x and ` +
          `${m(Math.abs(seg.b[1] - seg.a[1]))} in z — a run turns at a corner, it does not cut one`,
      );
    }
    planLength += Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
  }
  const ys = SERVICE_RUNS.flatMap((run) => run.points.map((p) => p[2]));
  const byAxis = { x: 0, z: 0, y: 0, none: 0 };
  for (const seg of SERVICE_SEGMENTS) byAxis[seg.axis] += 1;
  line(
    `${SERVICE_RUNS.length} runs, ${SERVICE_SEGMENTS.length} segments, ${m(planLength)} m of run on plan`,
  );
  line(`${byAxis.x} along x, ${byAxis.z} along z, ${byAxis.y} vertical`);
  line(
    `y from ${m(Math.min(...ys))} to ${m(Math.max(...ys))}, within this storey's ${m(STOREY_BOTTOM)}–${m(STOREY_TOP)}`,
  );
  line(
    `${SERVICE_COORDS.length} service coordinates were grid-checked by check 1, with every other number in the plan`,
  );
}

/* ──────── 14. a run ends in a chamber that is allowed to hold it ──────── */

check('14. Chamber ends: a run terminates only in a compartment that holds its layer');
{
  /**
   * WHAT THIS CHECK IS, AND WHAT IT DELIBERATELY IS NOT.
   *
   * It is: a run that ENDS AT A CHAMBER ends at one whose `holds` lists its
   * layer. A GAS RUN ENDING IN THE ELECTRICAL COMPARTMENT IS THE SINGLE FAILURE
   * THIS PART EXISTS TO PREVENT — the whole control-center split, two boxes and
   * two ducts to two different outside faces, buys nothing if a gas line can be
   * terminated next to the consumer unit. `holds` is the isolation rule written
   * as data, and this is the line of code that makes it one.
   *
   * It is NOT "every layer traces back to a chamber". That rule is wrong here
   * and would fail correct geometry:
   *
   * - Drainage reaches no chamber at all. It falls to three stacks that cap at
   *   floor 0 and at the roof, because floor 0 is undesigned and the roof is not
   *   modelled. A drain that ended in a cupboard would be the defect.
   * - COOLING is the deliberate exception, and it is the one to leave alone. Its
   *   trunk starts at `{ at: 'space', space: 'ccBalcony' }` because the
   *   condenser is an OUTDOOR UNIT. A condenser rejects heat: it cannot sit in a
   *   sealed box, which is what both compartments are. And the only box it could
   *   otherwise go in is the wet-and-gas one, which would put a refrigeration
   *   unit beside a burner. So cooling starting on a balcony is the correct
   *   answer twice over. It is reported as a note below, not as a failure.
   *
   * The chamber END POINT is checked too: naming a chamber and then putting the
   * last point of the run somewhere else is a run that terminates in a word.
   */
  /** @type {Map<string, string[]>} */
  const terminating = new Map(SERVICE_CHAMBERS.map((c) => [c.id, []]));
  for (const [i, run] of SERVICE_RUNS.entries()) {
    for (const [end, point] of /** @type {[PlanServiceEnd, PlanServicePoint][]} */ ([
      [run.from, run.points[0]],
      [run.to, run.points[run.points.length - 1]],
    ])) {
      if (end.at !== 'chamber') continue;
      const chamber = SERVICE_CHAMBERS.find((c) => c.id === end.chamber);
      if (!chamber) continue; // check 13 already said so
      terminating.get(chamber.id)?.push(run.layer);
      // Widened on purpose: `holds` is a literal tuple, so asking it about a
      // layer it does not list is a type error rather than the `false` this
      // check exists to act on — the question has to be askable to be answered.
      if (!(/** @type {readonly string[]} */ (chamber.holds).includes(run.layer))) {
        fail(
          `${runLabel(run, i)} terminates in the ${chamber.name}, which holds ` +
            `${chamber.holds.join(', ')} — not ${run.layer}. That is the isolation rule, ` +
            `and it is the rule the two-compartment control center exists for`,
        );
      }
      if (!pointInRect(point[0], point[1], chamber.rect)) {
        fail(
          `${runLabel(run, i)} says it terminates in ${chamber.id} but its end point ` +
            `(${m(point[0])}, ${m(point[1])}) is outside [${chamber.rect.map(n).join(', ')}]`,
        );
      }
    }
  }
  for (const chamber of SERVICE_CHAMBERS) {
    const held = terminating.get(chamber.id) ?? [];
    const counts = [...new Set(held)].map((l) => `${l}×${held.filter((x) => x === l).length}`);
    line(
      `${chamber.name} [${chamber.rect.map(n).join(', ')}] holds ${chamber.holds.join(', ')}: ` +
        `${held.length} run end(s) — ${counts.join(', ') || 'none'}`,
    );
  }
  // Families that reach no chamber. Said out loud rather than failed: for the
  // three drainage families and for cooling this is the design, and the note is
  // there so that a family which QUIETLY stopped reaching its chamber one day is
  // not indistinguishable from these four.
  for (const family of [...new Set(SERVICE_RUNS.map((r) => r.family))]) {
    const runs = SERVICE_RUNS.filter((r) => r.family === family);
    // Both ends read as `PlanServiceEnd` rather than as the literal types the
    // file happens to hold today: no run is currently declared TO a chamber, so
    // the literal type of `to.at` cannot be `'chamber'` and the test would be
    // a compile error that silently stops being a test the day one is.
    /** @type {PlanServiceEnd[]} */
    const ends = runs.flatMap((r) => [r.from, r.to]);
    if (ends.some((e) => e.at === 'chamber')) continue;
    const starts = [...new Set(runs.map((r) => r.from.at))];
    const why =
      family === 'cooling'
        ? ' — deliberate: the condenser is an outdoor unit, and a refrigeration unit cannot share the burner box'
        : runs.every((r) => r.layer === 'drainage')
          ? ' — deliberate: a drain falls to a capped stack, it does not end in a cupboard'
          : '';
    notes.push(
      `no ${family} run terminates in a chamber; the family starts at a ${starts.join(' or a ')} instead${why}`,
    );
  }
}

/* ──────── 15. separation, where two runs are parallel ──────── */

check('15. Separation: data, gas and water clear of the electrical runs where they run PARALLEL');
{
  /**
   * WHY "parallel" is the whole check, and the thing a reviewer gets wrong.
   *
   * The 0.20 m between a data cable and a power cable is about INDUCTION PICKED
   * UP ALONG A SHARED LENGTH: mains cable induces noise into an unshielded
   * twisted pair laid beside it for metres. A CROSSING AT RIGHT ANGLES IS NOT A
   * PARALLEL RUN. Two runs that cross are beside each other for the width of one
   * conduit and then gone, and no separation rule has ever been about that — the
   * spec says so in `dataToPowerSeparation`'s own docstring.
   *
   * So a pair is measured only where BOTH pieces move along the SAME AXIS and
   * their extents on that axis ACTUALLY OVERLAP. A piece running x against a
   * piece running z is skipped ON PURPOSE. It is not an omission, and a future
   * reader who "fixes" it will get a report full of failures that are not
   * defects and will then loosen the distances to make them go away, which is
   * how a real check becomes a decorative one.
   *
   * Distance is centre to centre in the plane perpendicular to the shared axis,
   * MINUS BOTH OUTSIDE RADII — what matters is the air between the two pipes,
   * not between two mathematical lines — and it is taken at its MINIMUM over the
   * shared stretch, because a run that falls or climbs while its neighbour stays
   * level is closest at one end and that end is the one that matters.
   */
  const electrical = new Set(['power', 'lighting']);
  /**
   * @type {{ name: string, need: number,
   *   a: (f: PlanServiceFamily) => boolean, b: (f: PlanServiceFamily) => boolean }[]}
   */
  const rules = [
    {
      name: 'data ↔ power/lighting',
      need: SERVICE_SPEC.dataToPowerSeparation,
      a: (f) => f === 'data',
      b: (f) => electrical.has(f),
    },
    {
      name: 'gas ↔ power/lighting',
      need: SERVICE_SPEC.gasToPowerSeparation,
      a: (f) => f === 'gas',
      b: (f) => electrical.has(f),
    },
    {
      name: 'water ↔ power/lighting',
      need: SERVICE_SPEC.waterToPowerSeparation,
      a: (f) => f === 'cold' || f === 'hot',
      b: (f) => electrical.has(f),
    },
  ];
  /**
   * Where one piece is on one axis, at a given station along the axis they share.
   *
   * @param {ServiceSegment} seg The piece.
   * @param {number} along Index of the shared axis in `[x, z, y]`.
   * @param {number} other Index of the axis being read off.
   * @param {number} t The station on the shared axis.
   * @returns {number} That coordinate of the centreline there.
   */
  const coordAt = (seg, along, other, t) => {
    const d = seg.b[along] - seg.a[along];
    return Math.abs(d) < EPS
      ? seg.a[other]
      : seg.a[other] + ((seg.b[other] - seg.a[other]) * (t - seg.a[along])) / d;
  };
  /**
   * Closest the two centrelines come, over the stretch of the shared axis they
   * both occupy — or `null` when they do not overlap on it, which is a crossing
   * and not a parallel run.
   *
   * @param {ServiceSegment} p One piece.
   * @param {ServiceSegment} q The other.
   * @param {'x' | 'z' | 'y'} axis The axis they share.
   * @returns {number | null} Centre-to-centre distance, in metres.
   */
  const closestApproach = (p, q, axis) => {
    const along = AXIS_INDEX[axis];
    const lo = Math.max(Math.min(p.a[along], p.b[along]), Math.min(q.a[along], q.b[along]));
    const hi = Math.min(Math.max(p.a[along], p.b[along]), Math.max(q.a[along], q.b[along]));
    if (hi - lo <= EPS) return null;
    const others = [0, 1, 2].filter((j) => j !== along);
    /**
     * The two perpendicular offsets between the centrelines at one station.
     *
     * @param {number} t The station on the shared axis.
     * @returns {number[]} The offsets, one per perpendicular axis.
     */
    const offsets = (t) => others.map((j) => coordAt(q, along, j, t) - coordAt(p, along, j, t));
    // Each offset is linear in t, so the distance is convex: its minimum is at
    // an end of the shared stretch, or where one offset passes through zero.
    const stations = [lo, hi];
    const atLo = offsets(lo);
    const atHi = offsets(hi);
    for (const k of [0, 1]) {
      if (atLo[k] > 0 !== atHi[k] > 0) {
        stations.push(
          lo + ((hi - lo) * Math.abs(atLo[k])) / (Math.abs(atLo[k]) + Math.abs(atHi[k])),
        );
      }
    }
    return Math.min(...stations.map((t) => Math.hypot(...offsets(t))));
  };
  for (const rule of rules) {
    let pairs = 0;
    /** @type {{ clear: number, p: ServiceSegment, q: ServiceSegment } | null} */
    let tightest = null;
    for (const p of SERVICE_SEGMENTS) {
      if (p.axis === 'none' || !rule.a(p.run.family)) continue;
      for (const q of SERVICE_SEGMENTS) {
        if (q.axis !== p.axis || !rule.b(q.run.family)) continue;
        const distance = closestApproach(p, q, p.axis);
        if (distance === null) continue;
        pairs += 1;
        const clear = distance - radiusOf(p.run.family) - radiusOf(q.run.family);
        if (!tightest || clear < tightest.clear) tightest = { clear, p, q };
        if (clear < rule.need - EPS) {
          fail(
            `${rule.name}: ${segLabel(p)} runs parallel to ${segLabel(q)} along ${p.axis} ` +
              `with only ${m(clear)} of air between their outsides — ${m(rule.need)} is asked`,
          );
        }
      }
    }
    line(
      `${rule.name}: ${pairs} parallel overlapping pair(s), ${m(rule.need)} asked; ` +
        (tightest
          ? `tightest ${m(tightest.clear)} — ${segLabel(tightest.p)} vs ${segLabel(tightest.q)}`
          : 'none run parallel at all'),
    );
  }
}

/* ──────── 16. no water over the electrical compartment ──────── */

check('16. No water above the electrical chamber, at any height');
{
  /**
   * The one rule that is about PLAN position and not about distance. A leak
   * finds the floor, so a pipe two metres above the consumer unit is a pipe over
   * the consumer unit; height is no defence and is not asked here. Drainage
   * counts as water: a waste pipe carries more of it than a supply does, and
   * carries it at atmospheric pressure through joints.
   *
   * Separate from check 15 because check 15 measures air between two runs, and
   * no amount of air fixes being overhead.
   */
  const chamber = SERVICE_CHAMBERS.find((c) => c.id === 'electricalChamber');
  if (!chamber) {
    fail('there is no electricalChamber to keep water off');
  } else {
    let wet = 0;
    for (const seg of SERVICE_SEGMENTS) {
      const family = seg.run.family;
      if (!(family === 'cold' || family === 'hot' || seg.run.layer === 'drainage')) continue;
      wet += 1;
      if (segmentOverRect(seg, chamber.rect)) {
        fail(
          `${segLabel(seg)} passes over the ${chamber.name} ` +
            `[${chamber.rect.map(n).join(', ')}] at y ${m(seg.a[2])}–${m(seg.b[2])} — ` +
            `a leak finds the floor, so height is not a defence`,
        );
      }
    }
    line(
      `${wet} cold, hot and drainage segment(s) tested against ${chamber.name} ` +
        `[${chamber.rect.map(n).join(', ')}], none overhead`,
    );
  }
}

/* ──────── 17. a riser stands where a riser may ──────── */

check('17. Risers: a run leaving this storey does it through a void or a chamber');
{
  /**
   * WHAT COUNTS AS A RISER, which is the whole difficulty of this check.
   *
   * Not every vertical segment. Most of them are a DROP: the last half-metre of
   * a branch coming down a wall to a tap, a socket or a radiator, and it lives
   * inside the room it serves because that is where the thing it feeds is. There
   * are 90-odd of those and every one of them is correct.
   *
   * A RISER is a vertical segment that LEAVES THIS STOREY — one that goes below
   * the finished floor into the build-up, or above the wall head into the
   * ceiling. That is a hole through a slab, and a hole through a slab may only
   * be where the plan put one: `voidWest`, `voidEast`, or a control-center
   * chamber. Anywhere else it is a hole in a room's clear floor, and on
   * `balconySlabB` it is a hole in a surface that is WALKED ON — which is why
   * the balcony slab is not on the permitted list and must never be added to it.
   *
   * The permitted list is read off the plan (the two void spaces and the
   * declared chambers) rather than written out, so a void that is renamed or
   * removed cannot leave this check quietly permitting the old footprint.
   */
  const slabB = rectsOfSpace('balconySlabB');
  if (RISER_FOOTPRINTS.length === 0) fail('no void or chamber footprint to stand a riser in');
  if (slabB.length === 0) fail('balconySlabB is not in ROOMS, so nothing is protecting it');
  let risers = 0;
  let drops = 0;
  for (const seg of SERVICE_SEGMENTS) {
    if (seg.axis !== 'y') continue;
    const leaves =
      Math.min(seg.a[2], seg.b[2]) < -EPS || Math.max(seg.a[2], seg.b[2]) > HEIGHTS.wall + EPS;
    if (!leaves) {
      drops += 1;
      continue;
    }
    risers += 1;
    const home = RISER_FOOTPRINTS.find((f) => pointInRect(seg.a[0], seg.a[1], f.rect));
    if (!home) {
      const onSlab = slabB.some((rect) => pointInRect(seg.a[0], seg.a[1], rect));
      fail(
        `${segLabel(seg)} rises through the slab at (${m(seg.a[0])}, ${m(seg.a[1])}) ` +
          `from y ${m(seg.a[2])} to ${m(seg.b[2])}, which is in no void and no chamber` +
          (onSlab
            ? ' — it is in balconySlabB, which is walked on'
            : " — that is a hole in a room's clear floor"),
      );
    }
  }
  line(
    `${risers} riser(s) leave this storey, ${drops} vertical drop(s) stay inside it ` +
      `(a drop to a tap or a socket is not a riser and is not asked to stand in a void)`,
  );
  line(
    `permitted footprints: ${RISER_FOOTPRINTS.map((f) => `${f.where} [${f.rect.map(n).join(', ')}]`).join('; ')}`,
  );
}

/* ──────── 18. a drain falls ──────── */

check('18. Drains fall: every drainage segment at or above its declared gradient');
{
  /**
   * The one service that cannot be routed as a flat convenience line. Measured
   * against the horizontal length, not the sloped length, because a gradient is
   * a rise over a RUN — that is what 1:80 means and what a spirit level reads.
   *
   * `points[0]` is upstream by the declared contract of `PlanServiceRun.points`,
   * so the drop is `a.y - b.y` and a negative one is a drain running uphill.
   */
  /** @type {{ margin: number, seg: ServiceSegment, drop: number, run: number, need: number } | null} */
  let shallowest = null;
  let falling = 0;
  for (const seg of SERVICE_SEGMENTS) {
    if (seg.run.layer !== 'drainage') continue;
    const horizontal = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
    if (horizontal < EPS) continue;
    const gradient = FALL.get(seg.run.family);
    if (gradient === undefined) {
      fail(
        `${segLabel(seg)} runs ${m(horizontal)} horizontally and '${seg.run.family}' declares no fall`,
      );
      continue;
    }
    falling += 1;
    const drop = seg.a[2] - seg.b[2];
    const need = gradient * horizontal;
    const margin = drop - need;
    if (margin < -EPS) {
      fail(
        `${segLabel(seg)} runs ${m(horizontal)} and ${drop < 0 ? 'RISES' : 'drops'} ` +
          `${Math.abs(drop).toFixed(4)} — ${seg.run.family} asks 1:${Math.round(1 / gradient)}, ` +
          `so ${need.toFixed(4)} over that length`,
      );
    }
    if (!shallowest || margin < shallowest.margin) {
      shallowest = { margin, seg, drop, run: horizontal, need };
    }
  }
  line(
    `${falling} drainage segment(s) with horizontal length, each measured against its own gradient`,
  );
  // A margin inside EPS is a margin of zero: the shallowest drain on this floor
  // is laid at EXACTLY its gradient, and printing that as -0.0000 would read as
  // a failure the check did not make.
  const margin = shallowest && Math.abs(shallowest.margin) < EPS ? 0 : (shallowest?.margin ?? 0);
  line(
    shallowest
      ? `shallowest: ${segLabel(shallowest.seg)} — ${shallowest.drop.toFixed(4)} over ${m(shallowest.run)}, ` +
          `needs ${shallowest.need.toFixed(4)} (1:${Math.round(1 / (FALL.get(shallowest.seg.run.family) ?? 1))}), ` +
          `margin ${margin >= 0 ? '+' : ''}${margin.toFixed(4)} m${margin === 0 ? ' — laid at exactly its gradient' : ''}`
      : 'no drainage segment runs horizontally at all',
  );
}

/* ──────── 19. head clearance over the balcony ──────── */

check('19. Head clearance: anything crossing balconySlabB is above door height');
{
  /**
   * `balconySlabB` is walked on. A duct or a pipe crossing it is something a
   * person passes under, so it is held at or above `HEIGHTS.door` — the height
   * the whole floor already agrees a person passes through.
   *
   * The whole segment's lowest point is taken rather than only the part over the
   * slab: a run that dips under door height a few centimetres past the balcony
   * edge is still the thing someone walks into on their way in.
   */
  const slabB = rectsOfSpace('balconySlabB');
  if (slabB.length === 0) fail('balconySlabB is not in ROOMS, so nothing is being checked');
  /** @type {{ y: number, seg: ServiceSegment } | null} */
  let lowest = null;
  let crossings = 0;
  for (const seg of SERVICE_SEGMENTS) {
    if (!slabB.some((rect) => segmentOverRect(seg, rect))) continue;
    crossings += 1;
    const y = Math.min(seg.a[2], seg.b[2]);
    if (!lowest || y < lowest.y) lowest = { y, seg };
    if (y < HEIGHTS.door - EPS) {
      fail(
        `${segLabel(seg)} crosses balconySlabB at y ${m(y)}, under the ${m(HEIGHTS.door)} ` +
          `a person passes through — the balcony is walked on`,
      );
    }
  }
  line(`${crossings} segment(s) cross balconySlabB; the bar is ${m(HEIGHTS.door)} (HEIGHTS.door)`);
  line(
    lowest
      ? `lowest crossing: ${m(lowest.y)} — ${segLabel(lowest.seg)}`
      : 'nothing crosses the balcony slab',
  );
}

/* ──────── 20. the programme is delivered ──────── */

check('20. The programme: every space and every fitting actually reached');
{
  /**
   * WHY A SPACE COUNTS AS SERVED ONLY WHERE A RUN ENDS THERE.
   *
   * Every trunk on this floor passes through `voidWest`, `voidEast` or
   * `balconySlabB` on its way somewhere else, and several cross rooms overhead.
   * Counting a space because a pipe went over it would mark the whole floor
   * served by everything and this check would pass forever without meaning
   * anything. A service is delivered to a space when a run TERMINATES there —
   * that is the socket, the lamp, the outlet, the radiator, the grille.
   *
   * The five programmes are the owner's, not a default:
   * - power and lighting everywhere a person goes;
   * - data everywhere EXCEPT the three bath and shower cubicles, where an
   *   ethernet outlet is a thing to explain rather than a thing to use;
   * - heating everywhere;
   * - cooling in exactly six spaces, stated as an exact set in both directions,
   *   so a seventh room quietly gaining a duct fails here;
   * - gas at exactly one appliance: the kitchen cooker.
   *
   * Cold reaches every fitting that takes water. Hot reaches those minus the
   * two that never want it: a WC cistern and a washing machine, which takes its
   * own cold and heats it.
   */
  /**
   * The spaces one family terminates in, restricted to the programme — a trunk
   * ending in a void or on the balcony slab is not a delivery.
   *
   * @param {PlanServiceFamily} family The family to roll-call.
   * @returns {Set<string>} The programme spaces it ends in.
   */
  const reached = (family) => {
    /** @type {Set<string>} */
    const out = new Set();
    for (const run of SERVICE_RUNS) {
      if (run.family !== family) continue;
      for (const end of [run.from, run.to]) {
        if ((end.at === 'space' || end.at === 'fitting') && PROGRAMME_SPACES.includes(end.space)) {
          out.add(end.space);
        }
      }
    }
    return out;
  };
  const cubicles = ['guestBathCubicle', 'mainBathCubicle', 'mainShowerCubicle'];
  /**
   * THE STAIRWELL TAKES LIGHTING AND NOTHING ELSE (owner, 2026-09-20).
   *
   * It is an escape route with a moving stair in it: a pipe there is a pipe somebody has to
   * service standing on a flight, and a leak there runs down the one way out. So it is
   * subtracted from every programme but the light, and the light is exactly why the
   * exception exists — an unlit stair is more dangerous than any of this.
   */
  const STAIRWELL = 'stairs';
  const walkedButTheStair = PROGRAMME_SPACES.filter((space) => space !== STAIRWELL);

  /** @type {{ family: PlanServiceFamily, column: string, want: string[], why: string }[]} */
  const programmes = [
    {
      family: 'power',
      column: 'power',
      want: [...walkedButTheStair],
      why: 'everywhere a person goes but the stairwell',
    },
    {
      family: 'lighting',
      column: 'light',
      want: [...PROGRAMME_SPACES],
      why: 'everywhere a person goes',
    },
    {
      family: 'data',
      column: 'data',
      want: walkedButTheStair.filter((s) => !cubicles.includes(s)),
      why: 'everywhere but the stairwell and the three bath and shower cubicles',
    },
    {
      family: 'heating',
      column: 'heat',
      want: [...walkedButTheStair],
      why: 'everywhere a person goes but the stairwell',
    },
    {
      family: 'cooling',
      column: 'cool',
      want: [
        'guestRoom',
        'corridor',
        'masterBedroom',
        'bedroomMaleKids',
        'bedroomFemaleKids',
        'livingRoom',
      ],
      why: "exactly six spaces, the owner's list",
    },
  ];
  for (const { family, want, why } of programmes) {
    const got = reached(family);
    for (const space of want) {
      if (!got.has(space)) fail(`${family} reaches no ${space} — the programme is ${why}`);
    }
    for (const space of got) {
      if (!want.includes(space)) {
        fail(`${family} terminates in ${space}, which is not on its programme (${why})`);
      }
    }
  }
  // The roll-call, as a table: one row per space a person uses, one column per
  // service, so the owner reads the floor rather than five sentences about it.
  line(`${'space'.padEnd(20)} ${programmes.map((p) => p.column.padStart(5)).join(' ')}`);
  const reachedBy = new Map(
    programmes.map((p) => /** @type {[string, Set<string>]} */ ([p.family, reached(p.family)])),
  );
  for (const space of PROGRAMME_SPACES) {
    line(
      `${space.padEnd(20)} ` +
        programmes
          .map((p) => (reachedBy.get(p.family)?.has(space) ? '✓' : '·').padStart(5))
          .join(' '),
    );
  }
  // Water and gas are delivered to FITTINGS, not to spaces: two taps in one room
  // are two deliveries, and a room with a sink and no cold feed is not half
  // served.
  const takesWater = new Set(['sink', 'bath', 'shower', 'wc', 'washingMachine']);
  const fittings = FIXTURES.filter((f) => takesWater.has(f.kind)).map((f) => `${f.room} ${f.kind}`);
  /**
   * The fittings one family terminates at.
   *
   * @param {PlanServiceFamily} family The family.
   * @returns {Set<string>} The fittings it reaches.
   */
  const fittingsReached = (family) => {
    /** @type {Set<string>} */
    const out = new Set();
    for (const run of SERVICE_RUNS) {
      if (run.family !== family) continue;
      for (const end of [run.from, run.to])
        if (end.at === 'fitting') out.add(`${end.space} ${end.kind}`);
    }
    return out;
  };
  const noHot = fittings.filter((f) => f.endsWith(' wc') || f.endsWith(' washingMachine'));
  /** @type {{ family: PlanServiceFamily, want: string[], why: string }[]} */
  const supplies = [
    { family: 'cold', want: fittings, why: 'every fitting that takes water' },
    {
      family: 'hot',
      want: fittings.filter((f) => !noHot.includes(f)),
      why: `every fitting that takes water except ${noHot.join(' and ')}`,
    },
    { family: 'gas', want: ['kitchen cooker'], why: 'the cooker, and nothing else' },
  ];
  for (const { family, want, why } of supplies) {
    const got = fittingsReached(family);
    for (const fitting of want)
      if (!got.has(fitting)) fail(`${family} reaches no ${fitting} — ${why}`);
    for (const fitting of got) {
      if (!want.includes(fitting))
        fail(`${family} is run to ${fitting}, which is not on its programme (${why})`);
    }
    line(`${family}: ${got.size}/${want.length} — ${why}`);
  }
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

/* ──────── 21. nothing at body height out in the open ──────── */

check('21. A run crosses a walking way overhead, or comes down a wall — never through the middle');
{
  /**
   * THE OWNER'S RULE, IN HIS OWN WORDS: "never pipes or something in middle of
   * walking way -> always in walls or top."
   *
   * It is a rule about where a person's body is, so it is stated in those terms:
   * below `HEIGHTS.door` a run is in the way, above it a person walks under.
   * Between the floor and that head height, a run has to be hugging a face of
   * the space it is in, or standing inside something solid.
   *
   * Three exemptions, each for a reason rather than for convenience:
   *
   * - **Above head height** is the whole point of the spine. It crosses
   *   `balconySlabB` at 2.20 m and over the corridor at 2.35–2.60 m, which
   *   check 19 already measures from the other side.
   * - **Below the finished floor** is buried. Every drainage branch runs at a
   *   negative `y`, inside the floor build-up, and nobody walks through a slab.
   * - **Inside a solid** — a service chamber or a fitting — is not in the open.
   *   A pipe standing in a sealed cupboard, or dropping down the back of a
   *   basin, is exactly where a pipe belongs; the floor it would otherwise be
   *   "crossing" is floor nobody can stand on.
   *
   * A CEILING FITTING IS NOT AN EXCEPTION, it simply never triggers this: a
   * light at 2.65 m and a cooling diffuser at 2.35 m are both above head height,
   * so the rule leaves them in the middle of the room where a room needs them.
   * What it moves to the walls is what arrives low — sockets at 0.30 m, ethernet
   * at 0.30 m, wall heaters at 0.60 m, taps at 0.95 m.
   *
   * It caught ten runs the day it was written, and every one of them was a route
   * a person would have walked into: three crossing the control center at chest
   * height, sockets and data dropping down the middle of the corridor and the
   * stairwell, and a radiator feed standing 0.70 m out into the utility room.
   */
  const WALKED_KINDS = new Set(['room', 'circulation', 'stairwell', 'openAir']);
  /** How close to a face still counts as "in the wall zone", in metres. */
  const WALL_ZONE = 0.3;
  /** Slack around a solid, so a drop behind a basin is not a hair outside it. */
  const SOLID_MARGIN = 0.1;
  /** Samples per segment; a drop is short, so this is plenty. */
  const SAMPLES = 16;

  const walked = ROOMS.filter((room) => WALKED_KINDS.has(room.kind));
  const solids = [
    ...SERVICE_CHAMBERS.map((chamber) => chamber.rect),
    ...FIXTURES.map((fixture) => fixture.rect),
  ];
  /**
   * @param {number} x
   * @param {number} z
   * @param {readonly number[]} rect
   * @param {number} [margin]
   * @returns {boolean}
   */
  const within = (x, z, rect, margin = 0) =>
    x >= rect[0] - margin &&
    x <= rect[1] + margin &&
    z >= rect[2] - margin &&
    z <= rect[3] + margin;
  /**
   * @param {number} x
   * @param {number} z
   * @param {readonly number[]} rect
   * @returns {number}
   */
  const toFace = (x, z, rect) => Math.min(x - rect[0], rect[1] - x, z - rect[2], rect[3] - z);

  let worstClear = 0;
  let offenders = 0;

  for (const [index, run] of SERVICE_RUNS.entries()) {
    for (let leg = 1; leg < run.points.length; leg += 1) {
      const from = run.points[leg - 1];
      const to = run.points[leg];
      let reported = false;

      for (let step = 0; step <= SAMPLES && !reported; step += 1) {
        const share = step / SAMPLES;
        const x = from[0] + (to[0] - from[0]) * share;
        const z = from[1] + (to[1] - from[1]) * share;
        const y = from[2] + (to[2] - from[2]) * share;

        if (y >= HEIGHTS.door - EPS) continue; // overhead: a person walks under it
        if (y <= EPS) continue; // buried in the floor build-up
        if (solids.some((rect) => within(x, z, rect, SOLID_MARGIN))) continue; // inside a solid

        for (const room of walked) {
          for (const rect of room.rects) {
            if (!within(x, z, rect)) continue;
            const clear = toFace(x, z, rect);
            if (clear <= WALL_ZONE + EPS) continue;
            if (clear > worstClear) worstClear = clear;
            offenders += 1;
            reported = true;
            fail(
              `SERVICE_RUNS[${index}] ${run.layer}/${run.family} leg ${leg} stands ` +
                `${m(clear)} clear of any wall of ${room.id} at (${n(x)}, ${n(z)}) and only ` +
                `${m(y)} above the floor — that is the middle of a walking way. A run crosses ` +
                `overhead, above ${m(HEIGHTS.door)}, or it comes down a wall`,
            );
            break;
          }
          if (reported) break;
        }
      }
    }
  }

  if (offenders === 0) {
    line(
      `no run stands in open floor below ${m(HEIGHTS.door)} — every low outlet ` +
        `comes down a wall, and everything crossing a room does it overhead`,
    );
  }
}

/* ──────── 22. nothing standing in a doorway ──────── */

check('22. A run may not stand in a door, an opening or a window');
{
  /**
   * THE OWNER'S SECOND ROUTING RULE, found by looking at the living room: its
   * 3.50 m opening to the corridor had FIVE service drops standing in it — two
   * sockets, an ethernet outlet, a radiator feed and a cooling duct, all in the
   * one gap people walk through. Twenty-four runs broke this across the floor.
   *
   * Check 9 already asks this of fixtures ("nothing may stand in a doorway",
   * Part 4). It never asked it of runs, because there were none. This is the
   * same question put to the other half of the model.
   *
   * WHAT COUNTS AS THE OPENING is the clear hole, not the wall around it: the
   * declared span along the wall, the wall's own thickness across it, and — this
   * is the part that matters — the height band between `sill` and `head`. A run
   * passing OVER a door at 2.35 m is not in the doorway, which is exactly how
   * the spine crosses the building. A run passing over one of the four void
   * windows is only clear above **2.30 m**, not 2.10 m, and those four are why
   * the shower cubicle's water had to be lifted and then stepped 0.10 m into the
   * room: its whole side-B face is window, so there is no clear stretch to drop
   * in at all.
   *
   * The openings are derived here from `PORTS` and `WINDOWS` against the room
   * rectangles rather than read from a list, so a door that moves takes this
   * check with it.
   */
  const SAMPLES = 20;
  const BAND_SLACK = 0.02;

  const openings = [];
  /**
   * Ports and windows asked the same question. A port has no `sill` or `head`,
   * so the union of their literal types cannot be asked for one; widening here
   * is what makes the question expressible, and the `??` below supplies a door's
   * own head when the opening does not state one.
   *
   * @type {ReadonlyArray<{ kind: string, between: readonly string[], along: 'x' | 'z', spanMin: number, width: number, sill?: number, head?: number }>}
   */
  const declaredOpenings = [...PORTS, ...WINDOWS];
  for (const opening of declaredOpenings) {
    const [first, second] = opening.between.map((id) => ROOMS.find((room) => room.id === id));
    if (!first || !second) continue;
    const from = opening.spanMin;
    const to = opening.spanMin + opening.width;

    /**
     * TAKE THE PAIR THAT ACTUALLY BRACKETS THE OPENING, not the last one that matches.
     *
     * Two rooms with two rectangles each give up to four candidate wall bands, and the
     * corridor–kitchen door has two: the real doorway at z 5.50–5.80, and a stretch of wall
     * at z 6.00–6.30 that only exists for x 10.00–11.90 and does not contain the door at
     * all. Keeping whichever came last tested a rectangle floating inside the kitchen and
     * left the doorway itself unguarded — a socket dropped dead centre of it passed both
     * this check and check 21.
     *
     * So the shared stretch has to contain the opening's own span. If none does, or more
     * than one does, that is not something to skip quietly: it means the rooms and the
     * opening disagree, and the check says so instead of testing nothing.
     */
    /** @type {Array<readonly [number, number]>} */
    const bands = [];
    for (const a of first.rects) {
      for (const b of second.rects) {
        const acrossLo = opening.along === 'x' ? Math.min(a[3], b[3]) : Math.min(a[1], b[1]);
        const acrossHi = opening.along === 'x' ? Math.max(a[2], b[2]) : Math.max(a[0], b[0]);
        if (acrossHi - acrossLo < -EPS || acrossHi - acrossLo >= 0.62) continue;
        const sharedLo = opening.along === 'x' ? Math.max(a[0], b[0]) : Math.max(a[2], b[2]);
        const sharedHi = opening.along === 'x' ? Math.min(a[1], b[1]) : Math.min(a[3], b[3]);
        if (sharedHi - sharedLo <= EPS) continue;
        if (from < sharedLo - EPS || to > sharedHi + EPS) continue;
        bands.push([acrossLo, acrossHi]);
      }
    }
    const distinct = bands.filter(
      (band, index) =>
        bands.findIndex(
          (other) => Math.abs(other[0] - band[0]) < EPS && Math.abs(other[1] - band[1]) < EPS,
        ) === index,
    );
    if (distinct.length !== 1) {
      fail(
        `the ${opening.between.join(' ↔ ')} ${opening.kind} spanning ${m(from)}–${m(to)} ` +
          `resolves to ${distinct.length} wall bands, not one — the rooms and the opening ` +
          `disagree, so nothing here can be checked`,
      );
      continue;
    }
    const band = distinct[0];
    openings.push({
      rect:
        opening.along === 'x'
          ? [from, to, band[0] - BAND_SLACK, band[1] + BAND_SLACK]
          : [band[0] - BAND_SLACK, band[1] + BAND_SLACK, from, to],
      sill: opening.sill ?? 0,
      head: opening.head ?? HEIGHTS.door,
      what: `${opening.between.join(' ↔ ')} ${opening.kind}`,
    });
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {readonly number[]} rect
   * @returns {boolean}
   */
  const inside = (x, z, rect) =>
    x >= rect[0] - EPS && x <= rect[1] + EPS && z >= rect[2] - EPS && z <= rect[3] + EPS;
  let offenders = 0;

  for (const [index, run] of SERVICE_RUNS.entries()) {
    for (let leg = 1; leg < run.points.length; leg += 1) {
      const from = run.points[leg - 1];
      const to = run.points[leg];
      let reported = false;
      for (let step = 0; step <= SAMPLES && !reported; step += 1) {
        const share = step / SAMPLES;
        const x = from[0] + (to[0] - from[0]) * share;
        const z = from[1] + (to[1] - from[1]) * share;
        const y = from[2] + (to[2] - from[2]) * share;
        for (const opening of openings) {
          if (!inside(x, z, opening.rect)) continue;
          if (y < opening.sill - EPS || y > opening.head + EPS) continue;
          offenders += 1;
          reported = true;
          fail(
            `SERVICE_RUNS[${index}] ${run.layer}/${run.family} leg ${leg} stands in the ` +
              `${opening.what} at (${n(x)}, ${n(z)}), ${m(y)} up — inside a clear opening that ` +
              `runs ${m(opening.sill)} to ${m(opening.head)}. A run crosses above the head or ` +
              `goes round; it does not stand in the gap people walk through`,
          );
          break;
        }
      }
    }
  }

  if (offenders === 0) {
    line(`${openings.length} openings, and no run stands in any of them`);
  }
}

/* ──────── 23. every run is connected to something ──────── */

check('23. A run that starts in a space tees off another run, or is declared plant');
{
  /**
   * FIVE RUNS ONCE BEGAN IN MID-AIR and nothing noticed. When the branches moved onto the
   * corridor, the master bedroom's five services were placed at their clear stretch — x 1.90
   * to 2.65 — while the corridor trunk they tap starts at x 5.60. Each branch floated three
   * metres from the nearest pipe, over the stairwell, and every other check passed: the
   * points are on the grid, inside the plot, clear of every opening, and overhead. The room
   * panel said the master bedroom had power, and it had five stubs reaching nothing.
   *
   * A dead trunk is decoration; an unfed branch is a room drawn as served that is not. So the
   * upstream end of a run has to LIE ON another run of the same family — not merely share a
   * vertex with one, because a branch legitimately tees off the middle of a trunk.
   *
   * The one exception is plant, and it is named rather than guessed: the cooling condenser is
   * an outdoor unit standing on the control-center balcony, so its trunk is the SOURCE of its
   * family and tees off nothing. A run leaving a chamber is exempt for the same reason — the
   * chamber is where its service comes from.
   */
  /** Families whose upstream end is plant rather than a tee, with why. */
  const PLANT_SOURCES = new Map([
    ['cooling', 'the condenser is an outdoor unit on the control-center balcony'],
  ]);
  /** How far off a centreline still counts as touching it, in metres. */
  const TEE_TOLERANCE = 0.02;

  /**
   * @param {readonly number[]} point
   * @param {readonly number[]} from
   * @param {readonly number[]} to
   * @returns {boolean}
   */
  const liesOn = (point, from, to) => {
    for (let axis = 0; axis < 3; axis += 1) {
      const low = Math.min(from[axis], to[axis]);
      const high = Math.max(from[axis], to[axis]);
      if (point[axis] < low - TEE_TOLERANCE || point[axis] > high + TEE_TOLERANCE) return false;
      const flat = Math.abs(from[axis] - to[axis]) < EPS;
      if (flat && Math.abs(point[axis] - from[axis]) > TEE_TOLERANCE) return false;
    }
    return true;
  };

  /**
   * CONNECTED ANYWHERE, NOT CONNECTED AT THE HEAD. The first draft of this check asked
   * whether a run's FIRST point sits on another run, and that is the wrong question for a
   * trunk: the corridor spine is fed by the link arriving in the middle of it, not at its
   * west end. The draft passed only by accident, because a branch happened to start on that
   * end, and went red the moment that branch was rerouted — against a spine that was
   * perfectly well connected.
   *
   * So the question is whether the run touches its family at all: any of its points on
   * another run of the same family, or any of theirs on one of its legs.
   */
  let floating = 0;
  for (const [index, run] of SERVICE_RUNS.entries()) {
    if (run.from.at !== 'space') continue;
    if (PLANT_SOURCES.has(run.family)) continue;
    const joined = SERVICE_RUNS.some((other) => {
      if (other === run || other.family !== run.family) return false;
      for (const point of run.points) {
        for (let leg = 1; leg < other.points.length; leg += 1) {
          if (liesOn(point, other.points[leg - 1], other.points[leg])) return true;
        }
      }
      for (const point of other.points) {
        for (let leg = 1; leg < run.points.length; leg += 1) {
          if (liesOn(point, run.points[leg - 1], run.points[leg])) return true;
        }
      }
      return false;
    });
    if (joined) continue;
    floating += 1;
    const head = run.points[0];
    fail(
      `SERVICE_RUNS[${index}] ${run.layer}/${run.family} from ` +
        `(${n(head[0])}, ${n(head[1])}, ${n(head[2])}) touches no other ${run.family} run at ` +
        `any point along it — it is connected to nothing. A branch tees off a trunk, and a ` +
        `trunk is fed somewhere along its length; only plant stands on its own`,
    );
  }

  if (floating === 0) {
    const plant = [...PLANT_SOURCES].map(([family, why]) => `${family} (${why})`).join(', ');
    line(`every run tees off another of its family, except the declared plant: ${plant}`);
  }
}

/* ──────── 24. room for the fitting that turns the corner ──────── */

check('24. Every corner has room for the bend that makes it');
{
  /**
   * `SERVICE_SPEC.minBendRadius` has claimed since it was written that it licenses a check,
   * and there was no check: it was run once by hand, the eight corners it found were fixed,
   * and the check itself was never committed. A constant that documents an absent guard is
   * worse than no constant, because the next reader believes the guard is there.
   *
   * Every polyline turns a square 90°, and a square 90° is a duct that does not exist: the
   * fitting that makes the turn sweeps a radius and needs straight pipe on both sides to land
   * on. So the question is not "draw an arc" but "is there room for one" — both legs meeting
   * at a corner must be at least the radius long. Ducts bind hardest, which is why they carry
   * the larger multiple; a 160 mm duct cannot turn through a 0.10 m jog, and seven of the
   * original eight failures were exactly that.
   */
  /** Families built as duct rather than as pipe. */
  const DUCTS = new Set(['cooling', 'chamberVent']);
  let tight = 0;
  let worstMargin = Infinity;

  for (const [index, run] of SERVICE_RUNS.entries()) {
    const bore = SERVICE_SPEC.bore[run.family];
    const multiple = DUCTS.has(run.family)
      ? SERVICE_SPEC.minBendRadius.duct
      : SERVICE_SPEC.minBendRadius.pipe;
    const needed = bore * multiple;
    for (let corner = 1; corner < run.points.length - 1; corner += 1) {
      const before = run.points[corner - 1];
      const at = run.points[corner];
      const after = run.points[corner + 1];
      const legs = [before, after].map((other) =>
        Math.hypot(other[0] - at[0], other[1] - at[1], other[2] - at[2]),
      );
      const shortest = Math.min(...legs);
      if (shortest - needed < worstMargin) worstMargin = shortest - needed;
      if (shortest >= needed - EPS) continue;
      tight += 1;
      fail(
        `SERVICE_RUNS[${index}] ${run.layer}/${run.family} turns at ` +
          `(${n(at[0])}, ${n(at[1])}, ${n(at[2])}) with only ${m(shortest)} of straight run, ` +
          `and a ${Math.round(bore * 1000)} mm ${DUCTS.has(run.family) ? 'duct' : 'pipe'} ` +
          `needs ${m(needed)} to land the fitting on`,
      );
    }
  }

  if (tight === 0) {
    line(`every corner has room for its bend; the tightest has ${m(worstMargin)} to spare`);
  }
}

/* ──────── 25. the stairwell carries the light and nothing else ──────── */

check('25. Nothing but lighting is in the stairwell');
{
  /**
   * THE OWNER'S RULE: "this infrastructure never pass the stairs (except electricity
   * light)". A stairwell is an escape route with a moving stair in it. A pipe there is a
   * pipe somebody has to service standing on a flight, and a leak there runs down the one
   * way out of the building. The light is the exception because an unlit stair is more
   * dangerous than anything the rule is keeping out.
   *
   * It is stated about the INTERIOR, with a margin, and that margin is doing real work: the
   * stairwell's east face at x 5.60 is a ZERO-THICKNESS join with the corridor (the
   * demountable panel of `JOIN_OVERRIDES`), so the corridor spine's west end sits exactly on
   * the line. Touching that edge is not being in the stairwell, and a check that said
   * otherwise would fail on a spine that never enters it.
   *
   * Check 20 says the same thing from the other side — the stairwell is subtracted from
   * every programme but the light — but that only governs where a run ENDS. This one
   * governs where a run GOES, which is the half that matters for a room you pass through.
   */
  /** How far inside the face a run has to be before it counts as in the stairwell. */
  const EDGE_SLACK = 0.02;
  /** The one family the stairwell may carry. */
  const ALLOWED = 'lighting';
  /** Samples per leg. */
  const SAMPLES = 40;

  const stairwell = ROOMS.find((room) => room.id === 'stairs');
  if (!stairwell) {
    fail('no `stairs` space in ROOMS, so this check cannot run');
  } else {
    let trespass = 0;
    for (const [index, run] of SERVICE_RUNS.entries()) {
      if (run.family === ALLOWED) continue;
      let reported = false;
      for (let leg = 1; leg < run.points.length && !reported; leg += 1) {
        const from = run.points[leg - 1];
        const to = run.points[leg];
        for (let step = 0; step <= SAMPLES; step += 1) {
          const share = step / SAMPLES;
          const x = from[0] + (to[0] - from[0]) * share;
          const z = from[1] + (to[1] - from[1]) * share;
          const inside = stairwell.rects.some(
            (rect) =>
              x > rect[0] + EDGE_SLACK &&
              x < rect[1] - EDGE_SLACK &&
              z > rect[2] + EDGE_SLACK &&
              z < rect[3] - EDGE_SLACK,
          );
          if (!inside) continue;
          trespass += 1;
          reported = true;
          fail(
            `SERVICE_RUNS[${index}] ${run.layer}/${run.family} passes through the stairwell ` +
              `at (${n(x)}, ${n(z)}). Only lighting may: a stair is an escape route with a ` +
              `moving flight in it, and anything else there is serviced standing on the stair`,
          );
          break;
        }
      }
    }
    if (trespass === 0) {
      line('the stairwell carries lighting and nothing else');
    }
  }
}

if (notes.length) {
  console.log('\n── notes');
  for (const note of notes) console.log(`   ${note}`);
}

console.log('');
if (failures.length === 0) {
  console.log(
    `PASS — 25 checks, ${walls.length} walls, ${PORTS.length + WINDOWS.length} openings, ` +
      `${FIXTURES.length} fixtures, ${SERVICE_RUNS.length} service runs, everything closes.`,
  );
  process.exit(0);
}
console.log(`FAIL — ${failures.length} problem(s):`);
for (const f of failures) console.log(`   ✗ ${f}`);
process.exit(1);
