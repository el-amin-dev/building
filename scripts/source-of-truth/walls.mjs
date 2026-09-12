/**
 * Nominal walls, derived from the room rectangles of the source of truth,
 * `src/features/building/domain/sourceOfTruth/plan.ts`.
 *
 * WHY derive instead of declare: the owner edits rectangles, because a
 * rectangle is what he can measure on the drawing. A hand-written wall list
 * would drift from those rectangles inside a single session, and then the
 * drawing, the 3D model and the quantities would each be right about a
 * different building. Everything in this file is a consequence of the spec, so
 * there is nothing to keep in sync.
 *
 * WHY "nominal": a wall is reported once per room FACE, at the coordinate of
 * that room's own face — not once per pair of rooms. Two rooms sharing a
 * partition therefore yield two walls 0.20 apart, which is what lets a room be
 * dimensioned, built and surveyed on its own. The cost is that a shared door
 * appears twice; `alias: true` on the copy belonging to the higher-numbered
 * room tells a renderer which one not to draw.
 *
 * WHY clockwise numbering from the north face: the matricule has to be stable
 * across edits, and "W1 is the north wall, then round the outline" is a rule
 * the owner can apply by eye on the drawing without reading this code.
 *
 * Assumption this file makes about the spec: the rects of one room form a
 * single simply-connected rectilinear outline (they touch, they do not overlap
 * and they enclose no hole). `deriveWalls` throws if that is not true, rather
 * than emitting a plausible-looking wrong outline — `verify.mjs` is the place
 * where geometry complaints get reported, not a silent guess here.
 */

import * as plan from '../../src/features/building/domain/sourceOfTruth/plan.ts';

/**
 * @import { InsulatedWall, PlanJoinOverride, PlanPort, PlanRectCoordinates, PlanRoom,
 *   PlanRoomId, PlanRoomKind, PlanRoomType, PlanWallThicknesses, PlanWindow }
 *   from '../../src/features/building/domain/sourceOfTruth/plan.ts'
 */

/**
 * The source of truth as a module namespace. `deriveWalls` takes it as an
 * argument instead of reaching for the import, so a test can hand it a variant
 * of the geometry; the type says "whatever shape plan.ts has".
 *
 * @typedef {typeof plan} PlanSpec
 */

/** A closed interval along a wall's axis, `[lo, hi]` in metres. */
/** @typedef {readonly [number, number]} Span */

/** A {@link Span} still being built up, so its ends can still be moved. */
/** @typedef {[number, number]} MutableSpan */

/** A point on the plan, `[x, z]` in metres. */
/** @typedef {[number, number]} Point */

/** Which face of a room a wall is. */
/** @typedef {'north' | 'south' | 'east' | 'west'} Side */

/** The axis a wall RUNS along (not the one it faces). */
/** @typedef {'x' | 'z'} Axis */

/**
 * The rule that explains one stretch's thickness. Keep in step with the header:
 * every value here is a sentence a reader of the drawing can check.
 *
 * @typedef {'exterior' | 'join override' | 'weather-exposed' | 'isolation'
 *   | 'plain separator' | 'no facing space'} ContactReason
 */

/**
 * One stretch of a wall face, as {@link deriveWalls} reports it. The contacts of
 * a face tile its whole span in order along the axis, so a renderer can draw the
 * face by walking them with no special cases.
 *
 * @typedef {object} Contact
 * @property {string | null} neighbourId Room on the far side, or `null` for an
 *   exterior face and for a stretch backing onto nothing.
 * @property {number} spanMin Start of the stretch along the wall's axis.
 * @property {number} spanMax End of the stretch along the wall's axis.
 * @property {number} length `spanMax - spanMin`, in metres.
 * @property {number} thickness Built width of this stretch, in metres.
 * @property {ContactReason} reason The rule that explains `thickness`.
 */

/**
 * A {@link Contact} mid-derivation, before the two corner passes have given every
 * stretch a width. `thickness` is null exactly while the answer is still unknown.
 *
 * @typedef {Omit<Contact, 'thickness'> & { thickness: number | null }} DraftContact
 */

/**
 * A declared port or window, placed on a wall and named. The far edge is
 * `spanMin + width`; `alias` marks the second copy of a shared opening, the one
 * a renderer must not draw.
 *
 * @typedef {(PlanPort | PlanWindow) & { matricule: string, alias?: true }} DerivedOpening
 */

/**
 * A space on the far side of a wall face, and how much of the face it covers.
 *
 * @typedef {object} FacingSpace
 * @property {PlanRoom} room The space behind the face.
 * @property {number} gap Clear distance to it, in metres: the built thickness.
 * @property {MutableSpan[]} spans The stretches of the face it backs onto.
 */

/**
 * One face line of a room's outline, before it becomes a wall.
 *
 * @typedef {object} OutlineEdge
 * @property {Side} side Which face of the room it is.
 * @property {number} at Coordinate of the face line, on the axis it faces.
 * @property {MutableSpan} span Extent along the axis it runs on.
 */

/** An {@link OutlineEdge} with its clockwise walking direction worked out. */
/** @typedef {OutlineEdge & { start: Point, end: Point }} DirectedEdge */

/**
 * A wall as `deriveWalls` reports it — one per room FACE, at that room's own
 * face coordinate. See the module header for what "nominal" costs and buys.
 *
 * @typedef {object} Wall
 * @property {string} matricule `F1-R11-KIT-W3`: floor, room number, type, wall.
 * @property {number} roomN Matricule number of the room this face belongs to.
 * @property {PlanRoomId} roomId Identifier of that room.
 * @property {PlanRoomType} type Three-letter type code of that room.
 * @property {number} wallN Position clockwise from the north face, 1-based.
 * @property {Side} side Which face of the room this is.
 * @property {Axis} axis The axis the wall runs along.
 * @property {number} at Coordinate of the face, on the axis it faces.
 * @property {number} spanMin Start of the face along {@link Wall.axis}.
 * @property {number} spanMax End of the face along {@link Wall.axis}.
 * @property {number} length `spanMax - spanMin`, in metres.
 * @property {number} thickness The THICKEST contact. For quantities, never for
 *   drawing — see the header, and draw from {@link Wall.contacts}.
 * @property {boolean} varies Whether the contacts disagree about thickness.
 * @property {string} faces Human-readable list of what is behind the face.
 * @property {boolean} exterior Whether the face sits on the exterior envelope.
 * @property {string[]} neighbours Ids of the spaces behind the face.
 * @property {Contact[]} contacts The stretches of the face, tiling its span.
 * @property {DerivedOpening[]} openings Ports and windows placed on this face.
 * @property {FacingSpace[]} [_facing] Internal: the geometry behind the face,
 *   kept only long enough for `placeOpenings` to read and deleted before return.
 */

/**
 * A declared opening, flattened out of PORTS or WINDOWS with the bookkeeping
 * that lets it be named and reported.
 *
 * @typedef {object} DeclaredOpening
 * @property {PlanPort | PlanWindow} opening The declaration itself.
 * @property {string} group `'port'` or `'window'`, for reporting.
 * @property {string} tag `'P'` or `'G'`, the matricule letter.
 * @property {string} ref Where it was declared, e.g. `PORTS[3]`.
 * @property {Wall[]} [placements] The walls it landed on, set by `placeOpenings`.
 * @property {PlanRoomId} [primaryId] The room whose copy carries the matricule.
 */

/** Metre tolerance: the spec is on the centimetre grid, so 1e-6 m is pure noise. */
const EPS = 1e-6;

/**
 * Round to the centimetre — the grid the whole source of truth lives on.
 *
 * @param {number} v Any metre value.
 * @returns {number} It, on the centimetre grid.
 */
const cm = (v) => Math.round(v * 100) / 100;

/**
 * Equal to within {@link EPS}.
 *
 * @param {number} a One metre value.
 * @param {number} b The other.
 * @returns {boolean} Whether they are the same point on the grid.
 */
const near = (a, b) => Math.abs(a - b) < EPS;

/**
 * Side → the axis the wall RUNS along (not the axis it faces).
 *
 * @type {Readonly<Record<Side, Axis>>}
 */
const AXIS_OF = Object.freeze({ north: 'x', south: 'x', east: 'z', west: 'z' });

/**
 * Union of spans, merging anything that touches. Touching counts as merging on
 * purpose: that is exactly the "merged where collinear and adjacent" rule, and
 * it is what turns the corridor's two rects into one 2.00 m west wall.
 *
 * @param {readonly Span[]} spans The spans to union, in any order.
 * @returns {MutableSpan[]} The union, sorted and non-overlapping.
 */
function mergeSpans(spans) {
  /** @type {MutableSpan[]} */
  const out = [];
  for (const [lo, hi] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/**
 * span minus holes, as the pieces that survive.
 *
 * @param {Span} span The span to cut.
 * @param {readonly Span[]} holes The parts to remove, in any order.
 * @returns {MutableSpan[]} What is left, in order along the axis.
 */
function subtractSpans(span, holes) {
  /** @type {MutableSpan[]} */
  let pieces = [[span[0], span[1]]];
  for (const [hlo, hhi] of mergeSpans(holes)) {
    /** @type {MutableSpan[]} */
    const next = [];
    for (const [lo, hi] of pieces) {
      if (hhi <= lo + EPS || hlo >= hi - EPS) {
        next.push([lo, hi]);
        continue;
      }
      if (hlo > lo + EPS) next.push([lo, hlo]);
      if (hhi < hi - EPS) next.push([hhi, hi]);
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Overlap of two spans, or null when they only touch or miss.
 *
 * @param {Span} a One span.
 * @param {Span} b The other.
 * @returns {MutableSpan | null} Their shared extent, or `null`.
 */
function overlapSpan(a, b) {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return hi - lo > EPS ? [lo, hi] : null;
}

/**
 * The outline edges of a room's rects: every rect face, minus the part of it
 * that has more of the SAME room on the outside (an internal seam is not a
 * wall), then merged per face line. A plain rectangle gives 4; the guest room's
 * two rects give 6.
 *
 * @param {readonly PlanRectCoordinates[]} rects The clear rects of one room.
 * @returns {OutlineEdge[]} One edge per face line, merged where collinear.
 */
function outlineEdges(rects) {
  /** @type {OutlineEdge[]} */
  const candidates = [];
  for (const [minX, maxX, minZ, maxZ] of rects) {
    candidates.push({ side: 'north', at: minZ, span: [minX, maxX] });
    candidates.push({ side: 'south', at: maxZ, span: [minX, maxX] });
    candidates.push({ side: 'east', at: maxX, span: [minZ, maxZ] });
    candidates.push({ side: 'west', at: minX, span: [minZ, maxZ] });
  }

  /** @type {OutlineEdge[]} */
  const kept = [];
  for (const edge of candidates) {
    /** @type {MutableSpan[]} */
    const seams = [];
    for (const [minX, maxX, minZ, maxZ] of rects) {
      if (edge.side === 'north' && near(maxZ, edge.at)) seams.push([minX, maxX]);
      if (edge.side === 'south' && near(minZ, edge.at)) seams.push([minX, maxX]);
      if (edge.side === 'east' && near(minX, edge.at)) seams.push([minZ, maxZ]);
      if (edge.side === 'west' && near(maxX, edge.at)) seams.push([minZ, maxZ]);
    }
    for (const span of subtractSpans(edge.span, seams)) {
      if (span[1] - span[0] > EPS) kept.push({ side: edge.side, at: edge.at, span });
    }
  }

  /** @type {Map<string, { side: Side, at: number, spans: MutableSpan[] }>} */
  const byFace = new Map();
  for (const edge of kept) {
    const key = `${edge.side}@${cm(edge.at)}`;
    // `get` then fill, rather than `has` then `get`: one lookup instead of two,
    // and the face is a value the reader can see is present.
    let face = byFace.get(key);
    if (!face) {
      face = { side: edge.side, at: edge.at, spans: [] };
      byFace.set(key, face);
    }
    face.spans.push(edge.span);
  }

  /** @type {OutlineEdge[]} */
  const edges = [];
  for (const face of byFace.values()) {
    for (const span of mergeSpans(face.spans)) {
      edges.push({ side: face.side, at: cm(face.at), span: [cm(span[0]), cm(span[1])] });
    }
  }
  return edges;
}

/**
 * Start and end point of an edge walked CLOCKWISE seen from above, with x to
 * the east and z to the south: north runs +x, east +z, south -x, west -z.
 *
 * @param {OutlineEdge} edge The edge to walk.
 * @returns {[Point, Point]} Where the walk enters it and where it leaves.
 */
function directedEnds({ side, at, span: [a, b] }) {
  if (side === 'north')
    return [
      [a, at],
      [b, at],
    ];
  if (side === 'east')
    return [
      [at, a],
      [at, b],
    ];
  if (side === 'south')
    return [
      [b, at],
      [a, at],
    ];
  return [
    [at, b],
    [at, a],
  ];
}

/**
 * Walk the outline clockwise from the northernmost north edge, so W1 is north.
 *
 * @param {readonly OutlineEdge[]} edges The unordered face lines of one room.
 * @param {string} roomId The room, for the error messages.
 * @returns {DirectedEdge[]} The same edges, in clockwise order from the north.
 */
function orderClockwise(edges, roomId) {
  /**
   * @param {Point} point A plan point.
   * @returns {string} Its identity on the centimetre grid.
   */
  const key = ([x, z]) => `${cm(x)},${cm(z)}`;
  /** @type {Map<string, DirectedEdge>} */
  const byStart = new Map();
  /** @type {DirectedEdge[]} */
  const directed = [];
  for (const edge of edges) {
    const [start, end] = directedEnds(edge);
    // A walked copy rather than fields bolted onto the edge: the direction is
    // this walk's business, and a copy keeps `start`/`end` always present
    // instead of appearing halfway through the loop that fills them.
    const walked = { ...edge, start, end };
    if (byStart.has(key(start))) {
      throw new Error(`${roomId}: two outline edges leave ${key(start)} — rects overlap or pinch`);
    }
    byStart.set(key(start), walked);
    directed.push(walked);
  }

  const norths = directed
    .filter((e) => e.side === 'north')
    .sort((p, q) => p.at - q.at || p.span[0] - q.span[0]);
  if (norths.length === 0) throw new Error(`${roomId}: outline has no north edge`);

  /** @type {DirectedEdge[]} */
  const ordered = [];
  /** @type {Set<DirectedEdge>} */
  const seen = new Set();
  /** @type {DirectedEdge | undefined} */
  let current = norths[0];
  while (current && !seen.has(current)) {
    seen.add(current);
    ordered.push(current);
    current = byStart.get(key(current.end));
  }
  if (ordered.length !== directed.length) {
    throw new Error(
      `${roomId}: outline is not one closed loop (walked ${ordered.length} of ${directed.length} edges)`,
    );
  }
  return ordered;
}

/**
 * The spaces on the far side of a wall face, worked out geometrically: a rect
 * whose own opposite face is on the outward side, no further than one exterior
 * wall away, and whose span genuinely overlaps (touching at a point is not
 * "facing"). Geometric, because the spec never names wall pairs — only PORTS
 * and WINDOWS do, and those are the thing we are trying to place.
 *
 * @param {Wall} wall The face to look behind.
 * @param {readonly PlanRoom[]} rooms Every space on the floor.
 * @param {number} maxGap The thickest wall a face could be looking through.
 * @returns {FacingSpace[]} What is behind it, in room-number order.
 */
function facingSpaces(wall, rooms, maxGap) {
  /** @type {Map<number, FacingSpace>} */
  const hits = new Map();
  for (const other of rooms) {
    if (other.n === wall.roomN) continue;
    for (const [minX, maxX, minZ, maxZ] of other.rects) {
      /** @type {number} */
      let gap;
      /** @type {Span} */
      let theirSpan;
      if (wall.side === 'north') {
        gap = wall.at - maxZ;
        theirSpan = [minX, maxX];
      } else if (wall.side === 'south') {
        gap = minZ - wall.at;
        theirSpan = [minX, maxX];
      } else if (wall.side === 'east') {
        gap = minX - wall.at;
        theirSpan = [minZ, maxZ];
      } else {
        gap = wall.at - maxX;
        theirSpan = [minZ, maxZ];
      }
      if (gap < -EPS || gap > maxGap + EPS) continue;
      const shared = overlapSpan(theirSpan, [wall.spanMin, wall.spanMax]);
      if (!shared) continue;

      const entry = hits.get(other.n) ?? { room: other, gap: cm(gap), spans: [] };
      entry.gap = Math.min(entry.gap, cm(gap));
      entry.spans.push(shared);
      hits.set(other.n, entry);
    }
  }
  return [...hits.values()]
    .sort((a, b) => a.room.n - b.room.n)
    .map((hit) => ({
      ...hit,
      spans: mergeSpans(hit.spans).map(([a, b]) => /** @type {MutableSpan} */ ([cm(a), cm(b)])),
    }));
}

/**
 * `F1-R11-KIT-W3` — floor, zero-padded room number, room type, wall number.
 *
 * @param {number} floor The floor the wall is on.
 * @param {PlanRoom} room The room whose face it is.
 * @param {number} wallN Position clockwise from the north face, 1-based.
 * @returns {string} The matricule.
 */
const wallMatricule = (floor, room, wallN) =>
  `F${floor}-R${String(room.n).padStart(2, '0')}-${room.type}-W${wallN}`;

/**
 * Every declared opening, flattened, keeping the tag that distinguishes a port
 * (`-P<n>`) from a window (`-G<n>`) in the matricule.
 *
 * @param {PlanSpec} spec The source of truth.
 * @returns {DeclaredOpening[]} Every port, then every window, in declared order.
 */
function declaredOpenings(spec) {
  /** @type {DeclaredOpening[]} */
  const ports = spec.PORTS.map((o, i) => ({
    opening: o,
    group: 'port',
    tag: 'P',
    ref: `PORTS[${i}]`,
  }));
  /** @type {DeclaredOpening[]} */
  const windows = spec.WINDOWS.map((o, i) => ({
    opening: o,
    group: 'window',
    tag: 'G',
    ref: `WINDOWS[${i}]`,
  }));
  return [...ports, ...windows];
}

/**
 * deriveWalls(spec) -> Wall[]
 *
 * Wall { matricule, roomN, roomId, type, wallN, side, axis, at, spanMin,
 *        spanMax, length, thickness, faces, openings }
 *
 * Extra fields beyond the contract, all additive so a renderer can ignore them:
 * `exterior`, `neighbours` (ids), `varies`, and `contacts`.
 *
 * `thickness` is the THICKEST contact, kept for quantities and takeoff. It must
 * not be used to draw: isolation is now width, so one face is commonly heavy
 * where it faces weather or an isolated room and thin where it faces an ordinary
 * one, and a single rectangle at `thickness` overruns the thin stretches. Draw
 * from `contacts`, which tiles the whole face span in order along the axis:
 *
 *   Contact { neighbourId, spanMin, spanMax, length, thickness, reason }
 *
 * `neighbourId` is null for an exterior face (one contact, reason 'exterior')
 * and for a stretch that backs onto nothing (reason 'no facing space'), so a
 * renderer can walk the list without special cases. `reason` is one of
 * 'exterior', 'join override', 'weather-exposed', 'isolation', 'plain separator'
 * or 'no facing space' — the rule that explains the number beside it.
 *
 * `measuredGap` and `thicknessNote` are gone: they were a second and third
 * answer to the question `contacts` now answers once, and three fields that can
 * disagree is two too many.
 */
/**
 * Opposite face of the same physical wall.
 *
 * @type {Readonly<Record<Side, Side>>}
 */
const OPPOSITE_SIDE = Object.freeze({ north: 'south', south: 'north', east: 'west', west: 'east' });

/**
 * Are these two faces the two sides of one built wall? Same axis, opposite
 * sides, the second on the outward side of the first and no further than one
 * exterior wall away, spans overlapping.
 *
 * @param {Wall} a One face.
 * @param {Wall} b The other.
 * @param {number} maxGap The thickest wall they could be the two sides of.
 * @returns {boolean} Whether they are two faces of one built wall.
 */
function backToBack(a, b, maxGap) {
  if (a.axis !== b.axis || b.side !== OPPOSITE_SIDE[a.side]) return false;
  const gap =
    a.side === 'north'
      ? a.at - b.at
      : a.side === 'south'
        ? b.at - a.at
        : a.side === 'east'
          ? b.at - a.at
          : a.at - b.at;
  if (gap < -EPS || gap > maxGap + EPS) return false;
  return Math.min(a.spanMax, b.spanMax) - Math.max(a.spanMin, b.spanMin) > EPS;
}

/**
 * One space's claim on a stretch of a face, before the sweep resolves it.
 *
 * @typedef {object} FacePiece
 * @property {string} neighbourId The space making the claim.
 * @property {number} lo Start of the claimed stretch.
 * @property {number} hi End of the claimed stretch.
 * @property {number} gap Clear distance to that space; the nearest claim wins.
 * @property {number} thickness Built width this claim implies, in metres.
 * @property {ContactReason} reason The rule behind that width.
 */

/**
 * One cell of the swept face, with whichever claim won it.
 *
 * @typedef {object} FaceCell
 * @property {number} lo Start of the cell.
 * @property {number} hi End of the cell.
 * @property {FacePiece | null} piece The winning claim, or `null` where the cell
 *   backs onto nothing.
 */

/**
 * The stretches of one face, in order, tiling its whole span.
 *
 * WHY a sweep rather than one entry per neighbour: the stretches have to tile
 * the face for a renderer to draw it by walking the list, which means the bits
 * that back onto nothing must appear too, and two spaces that both claim a
 * stretch must be resolved rather than both emitted. Cutting the span at every
 * boundary and asking each cell which space is NEAREST does both, and cannot
 * leave a hole or an overlap however the rooms are drawn.
 *
 * @param {Wall} wall The face to tile.
 * @param {readonly FacingSpace[]} neighbours What is behind it, from
 *   {@link facingSpaces}.
 * @param {object} rules The parts of the spec the thickness rules need.
 * @param {PlanWallThicknesses} rules.WALLS The thicknesses, by what a wall is for.
 * @param {(a: string, b: string) => PlanJoinOverride | undefined} rules.overrideFor
 *   The declared override for a pair of rooms, when the spec states one.
 * @param {(kind: PlanRoomKind) => boolean} rules.exposed Whether a kind of space
 *   leaves the face open to the weather.
 * @param {PlanRoomKind} rules.roomKind What the wall's own room is.
 * @returns {Contact[]} The stretches of the face, tiling its whole span.
 */
function contactsAlong(wall, neighbours, { WALLS, overrideFor, exposed, roomKind }) {
  /** @type {FacePiece[]} */
  const pieces = [];
  for (const n of neighbours) {
    const override = overrideFor(wall.roomId, n.room.id);
    // The gap the rects leave IS the thickness — the spec draws every wall at
    // its real width, so measuring beats inferring. An override wins because it
    // states a gap the geometry would not predict, and the kind rule is only
    // reached when two spaces touch with no gap at all.
    const thickness = override
      ? override.thickness
      : n.gap > EPS
        ? n.gap
        : exposed(n.room.kind) || exposed(roomKind)
          ? WALLS.voidFacing
          : WALLS.partition;
    const reason = override
      ? 'join override'
      : exposed(n.room.kind) || exposed(roomKind)
        ? 'weather-exposed'
        : 'plain separator';
    for (const [lo, hi] of n.spans) {
      pieces.push({ neighbourId: n.room.id, lo, hi, gap: n.gap, thickness: cm(thickness), reason });
    }
  }

  const bounds = new Set([wall.spanMin, wall.spanMax]);
  for (const p of pieces) {
    if (p.lo > wall.spanMin + EPS) bounds.add(cm(p.lo));
    if (p.hi < wall.spanMax - EPS) bounds.add(cm(p.hi));
  }
  const cuts = [...bounds].sort((a, b) => a - b);

  /** @type {FaceCell[]} */
  const cells = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const lo = cuts[i];
    const hi = cuts[i + 1];
    if (hi - lo <= EPS) continue;
    const mid = (lo + hi) / 2;
    const covering = pieces
      .filter((p) => p.lo <= mid + EPS && p.hi >= mid - EPS)
      .sort((a, b) => a.gap - b.gap);
    cells.push({ lo, hi, piece: covering[0] ?? null });
  }

  /** @type {FaceCell[]} */
  const merged = [];
  for (const cell of cells) {
    const last = merged[merged.length - 1];
    const same =
      last &&
      (last.piece?.neighbourId ?? null) === (cell.piece?.neighbourId ?? null) &&
      Math.abs((last.piece?.thickness ?? -1) - (cell.piece?.thickness ?? -1)) < EPS &&
      Math.abs(last.hi - cell.lo) < EPS;
    if (same) last.hi = cell.hi;
    else merged.push({ ...cell });
  }

  /** @type {DraftContact[]} */
  const contacts = merged.map((cell) => ({
    neighbourId: cell.piece?.neighbourId ?? null,
    spanMin: cm(cell.lo),
    spanMax: cm(cell.hi),
    length: cm(cell.hi - cell.lo),
    thickness: cell.piece ? cell.piece.thickness : null,
    reason: cell.piece ? cell.piece.reason : 'no facing space',
  }));

  // A stretch backing onto nothing is a corner or a return. Build it as thick as
  // the thicker stretch it runs into, so the wall never thins at a junction; if
  // no stretch of this face faces anything, the plain default is all there is.
  //
  // Only the stretches ALONG this face are visible from here, because the other
  // faces of the floor do not exist yet. The wall that LANDS in a corner is the
  // other half of "thick win", and {@link assignJunctionReasons} adds it once
  // every face is built — the same pass that settles the corner's reason, so the
  // two halves can no longer be read off different neighbourhoods.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [i, c] of contacts.entries()) {
      if (c.thickness !== null) continue;
      // flatMap rather than filter-then-map: the same two tests in one pass, and
      // it yields the widths themselves rather than widths that might still be
      // null.
      const around = [contacts[i - 1], contacts[i + 1]].flatMap((x) =>
        x && x.thickness !== null ? [x.thickness] : [],
      );
      if (around.length) c.thickness = Math.max(...around);
      else if (pass === 1) c.thickness = WALLS.partition;
    }
  }
  // Both passes have run, so no stretch is left without a width: the first takes
  // the thickness of whatever it runs into, and the second falls back to the
  // plain default for a face that runs into nothing at all.
  return /** @type {Contact[]} */ (contacts);
}

/**
 * Second pass: label the stretches the owner built heavy.
 *
 * Isolation is a width now, and it is declared per FACE, so what it means for a
 * stretch is only knowable once every face exists — a named face makes whatever
 * backs onto it heavy too. It only ever upgrades a plain separator: an override
 * or a weather-exposed face already has a stronger reason for its number.
 *
 * @param {readonly Wall[]} walls Every derived wall; their contacts are relabelled
 *   in place.
 * @param {PlanSpec} spec The source of truth.
 * @returns {void}
 */
function assignIsolationReasons(walls, spec) {
  // Widened to the declared interface on purpose. `INSULATED_WALLS` is a frozen
  // literal, so its type knows exactly how many entries it has today and the
  // checker would call the empty-list guard below dead code — which it is not:
  // the owner emptying the list is precisely what it is there for.
  /** @type {readonly InsulatedWall[]} */
  const insulated = spec.INSULATED_WALLS ?? [];
  if (insulated.length === 0) return;
  const maxGap = spec.WALLS.exterior;
  const byMatricule = new Map(walls.map((w) => /** @type {[string, Wall]} */ ([w.matricule, w])));
  /** @type {Map<string, MutableSpan[]>} */
  const spans = new Map();
  /**
   * The heavy spans recorded against one wall, created on first use.
   *
   * @param {string} matricule The wall to record against.
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

  for (const entry of insulated) {
    const wall = byMatricule.get(entry.matricule);
    if (!wall) continue;
    spansOf(wall.matricule).push([wall.spanMin, wall.spanMax]);
    for (const other of walls) {
      if (other.matricule === wall.matricule || !backToBack(wall, other, maxGap)) continue;
      const lo = Math.max(wall.spanMin, other.spanMin);
      const hi = Math.min(wall.spanMax, other.spanMax);
      if (hi - lo > EPS) spansOf(other.matricule).push([cm(lo), cm(hi)]);
    }
  }

  for (const wall of walls) {
    const heavy = mergeSpans(spansOf(wall.matricule));
    if (heavy.length === 0) continue;
    for (const contact of wall.contacts) {
      // 'plain separator' and 'weather-exposed' both give way to isolation;
      // 'exterior' and 'join override' do not.
      //
      // WHY weather-exposed has to give way: naming a face insulates the wall,
      // and a wall has two faces. The master bedroom's west face is named, so
      // that wall is built heavy — but its other face is the side-A balcony
      // spine, which is weather-exposed and unnamed, so refusing the upgrade
      // left one face of one wall reading heavy and the other plain, and the
      // drawing painted them different colours. Nothing is lost by the upgrade:
      // weather-exposed and isolation are both 0.30, so the depth is the same
      // number either way and only the explanation changes.
      //
      // WHY exterior does not: an envelope face has no far side to carry
      // anything onto, and the renderer relies on it still reading 'exterior'.
      // WHY a join override does not: its depth is forced and often not 0.30 —
      // calling the 0.20 utility join an isolation wall would be a lie.
      if (contact.reason !== 'plain separator' && contact.reason !== 'weather-exposed') continue;
      const inside = heavy.some(
        ([lo, hi]) => contact.spanMin >= lo - EPS && contact.spanMax <= hi + EPS,
      );
      if (inside) contact.reason = 'isolation';
    }
  }
}

/**
 * How far a coordinate falls outside a span, or 0 when it is inside it.
 *
 * @param {number} at The coordinate.
 * @param {number} lo Start of the span.
 * @param {number} hi End of the span.
 * @returns {number} The distance, in metres.
 */
const distanceTo = (at, lo, hi) => (at < lo ? lo - at : at > hi ? at - hi : 0);

/**
 * The stretch of a face that reaches nearest to a coordinate along it.
 *
 * A long wall can be isolated at one end and plain at the other, so a corner
 * takes the stretch of the landing face that actually reaches it rather than the
 * face as a whole: the kitchen's west face is isolation where it wraps the guest
 * room and plain 0.15 at the end that turns into the void, and it is the end that
 * turns which matters.
 *
 * @param {Wall} face The face that lands in the corner.
 * @param {number} at Coordinate of the corner on the axis that face runs along.
 * @returns {number} Index of the nearest stretch, or `-1` when the face has none.
 */
function nearestContactIndex(face, at) {
  let nearest = -1;
  let nearestDistance = Infinity;
  for (const [i, c] of face.contacts.entries()) {
    const d = distanceTo(at, c.spanMin, c.spanMax);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = i;
    }
  }
  return nearest;
}

/**
 * Fourth pass: the junction rule. The owner's words were "in thick wall when X
 * wall meet Y wall and both this the XY point is RED thick win".
 *
 * A stretch that backs onto nothing is a corner — the block of masonry where a
 * perpendicular wall lands. This pass settles BOTH halves of "thick win" for it,
 * off one set of adjoining stretches: the corner takes the stronger REASON and
 * the thicker WIDTH together. Without the reason, an isolated run reads as plain
 * exactly where it turns a corner, which is the one place a sound or heat barrier
 * cannot afford a gap: the drawing would say the isolation stops at the corner
 * when it does not.
 *
 * WHY the width is settled here too, and not left to {@link contactsAlong}. The
 * two halves used to be read off different neighbourhoods and they disagreed.
 * `contactsAlong` gave a corner the thicker of the two stretches BESIDE it along
 * its own face — all it can see, since the other faces do not exist yet — while
 * this pass took the reason from a wider neighbourhood that also includes the face
 * LANDING in the corner. Where the wall that lands is heavy and the stretches
 * alongside are thin, the corner came out `reason: 'isolation'` at
 * `thickness: 0.15`; and isolation IS a width on this floor — 0.30 heavy, 0.15
 * plain — so that stretch claimed a sound and heat barrier while being built as a
 * thin partition, and a renderer painting the isolated runs red painted a thin
 * wall red.
 *
 * It happened at exactly two corners, both in the guest suite and both for the
 * same reason: one of the guest room's own 0.30 walls lands in a 0.15 wall to a
 * space the owner deliberately left OUT of the thick wrap. `F1-R09-GST-W7` is
 * where the room's west wall (0.30, named) meets the 0.15 wall to the control
 * center, "a technical room [that] does not need the sound isolation the bedrooms
 * do"; `F1-R10-BTH-W1` is where its east wall to the kitchen (0.30, named) meets
 * the 0.15 wall to the guest bathroom, which the owner excluded by name. Thick
 * wall meets thin wall is precisely the case the owner ruled on, so the corner is
 * widened, not merely coloured.
 *
 * Reading both off the same stretches makes the contradiction unreachable rather
 * than fixed twice: a corner that reads isolation is built at least
 * `WALLS.insulated`, because the stretch it took the reason from is. Widening can
 * only ever grow the corner into masonry — a corner is the block where a
 * perpendicular wall lands, so the run it grows along is that wall's own
 * footprint, never a clear rect.
 *
 * Isolated here means what the drawing means by red: the face is named, or the
 * backing pass labelled that stretch 'isolation'. Both halves are needed. Ten
 * named faces carry no 'isolation' contact at all, because an exterior or
 * weather-exposed stretch keeps the reason that explains its depth — so reading
 * `reason` alone would miss every junction with the side-C envelope or the
 * balcony spine.
 *
 * Two ways to adjoin, because a corner is where two faces turn:
 *   - the contact beside it along the same face, so an isolated run carries
 *     through the corner instead of stopping at it; and
 *   - the face that lands in it, taking that face's NEAREST contact, since a long
 *     wall can be isolated at one end and plain at the other — the kitchen's west
 *     face is isolation where it wraps the guest room and plain 0.15 at the end
 *     that turns into the void, and it is the end that turns which matters.
 *
 * Read off a snapshot taken before anything changes, so isolation crosses one
 * junction rather than travelling down a chain of them.
 *
 * @param {readonly Wall[]} walls Every derived wall; their contacts are relabelled
 *   in place.
 * @param {PlanSpec} spec The source of truth.
 * @returns {void}
 */
function assignJunctionReasons(walls, spec) {
  /** @type {Set<string>} */
  const named = new Set((spec.INSULATED_WALLS ?? []).map((entry) => entry.matricule));
  const maxGap = spec.WALLS.exterior;
  const before = new Map(
    walls.map(
      (w) =>
        /** @type {[string, boolean[]]} */ ([
          w.matricule,
          w.contacts.map((c) => named.has(w.matricule) || c.reason === 'isolation'),
        ]),
    ),
  );
  for (const wall of walls) {
    for (const [i, contact] of wall.contacts.entries()) {
      if (contact.reason !== 'no facing space') continue;

      const flags = before.get(wall.matricule) ?? [];
      // The stretches this corner adjoins, as widths, counting only the ones the
      // drawing would paint red. Along wins outright when it is there, so
      // isolation crosses one junction rather than travelling down a chain.
      //
      // flatMap rather than some-then-look-up: the test and the width come out of
      // one pass, which is the whole point — the reason and the thickness are now
      // read off the same stretches instead of two neighbourhoods that disagreed.
      const along = [i - 1, i + 1].flatMap((j) =>
        wall.contacts[j] && flags[j] ? [wall.contacts[j].thickness] : [],
      );
      const landing =
        along.length > 0
          ? []
          : walls.flatMap((other) => {
              if (other.axis === wall.axis) return [];
              if (other.at < contact.spanMin - EPS || other.at > contact.spanMax + EPS) return [];
              if (distanceTo(wall.at, other.spanMin, other.spanMax) > maxGap + EPS) return [];
              const nearest = nearestContactIndex(other, wall.at);
              if (nearest < 0 || !(before.get(other.matricule) ?? [])[nearest]) return [];
              return [other.contacts[nearest].thickness];
            });

      const adjoining = [...along, ...landing];
      if (adjoining.length === 0) continue;
      // Thick wins, both halves off the same stretches: the corner reads isolation
      // because a heavy stretch adjoins it, and is built at least as thick as that
      // stretch — never below `WALLS.insulated`, which is what isolation MEANS
      // once it is a width rather than a material.
      contact.reason = 'isolation';
      contact.thickness = cm(Math.max(contact.thickness, spec.WALLS.insulated, ...adjoining));
    }
  }
}

/**
 * Derive every nominal wall of the floor from the room rectangles.
 *
 * @param {PlanSpec} [spec] The source of truth; defaults to the committed plan.
 * @returns {Wall[]} One wall per room face, in room then clockwise order.
 */
export function deriveWalls(spec = plan) {
  const { FLOOR_NUMBER, PLOT, WALLS, ROOMS, JOIN_OVERRIDES } = spec;
  const exteriorT = WALLS.exterior;

  /**
   * The interior boundary: a face sitting on it is on the exterior envelope and
   * is 0.30 thick whatever is behind it. Side A is x 0, D is x 22.50, C is z 0
   * and B is z 10.00 (plan.ts header).
   *
   * @type {Readonly<Record<Side, { at: number, side: string }>>}
   */
  const envelope = {
    west: { at: cm(PLOT[0] + exteriorT), side: 'A' },
    east: { at: cm(PLOT[1] - exteriorT), side: 'D' },
    north: { at: cm(PLOT[2] + exteriorT), side: 'C' },
    south: { at: cm(PLOT[3] - exteriorT), side: 'B' },
  };

  /**
   * The declared override for a pair of rooms, whichever way round it was written.
   *
   * @param {string} a One room id.
   * @param {string} b The other.
   * @returns {PlanJoinOverride | undefined} The override, when the spec has one.
   */
  const overrideFor = (a, b) =>
    JOIN_OVERRIDES.find(
      (o) =>
        (o.between[0] === a && o.between[1] === b) || (o.between[0] === b && o.between[1] === a),
    );

  /** @type {Wall[]} */
  const walls = [];
  for (const room of ROOMS) {
    const ordered = orderClockwise(outlineEdges(room.rects), room.id);
    ordered.forEach((edge, index) => {
      const wallN = index + 1;
      // `exterior` and `neighbours` are seeded here rather than bolted on in the
      // branches below, so a wall is never half a wall.
      /** @type {Wall} */
      const wall = {
        matricule: wallMatricule(FLOOR_NUMBER, room, wallN),
        roomN: room.n,
        roomId: room.id,
        type: room.type,
        wallN,
        side: edge.side,
        axis: AXIS_OF[edge.side],
        at: cm(edge.at),
        spanMin: cm(edge.span[0]),
        spanMax: cm(edge.span[1]),
        length: cm(edge.span[1] - edge.span[0]),
        thickness: 0,
        varies: false,
        faces: '',
        contacts: [],
        openings: [],
        // Last, so the key order of a serialised wall is exactly what it was when
        // the branches below bolted these two on after the fact. Anything that
        // renders a wall by walking its keys sees no change.
        exterior: false,
        neighbours: [],
      };

      const neighbours = facingSpaces(wall, ROOMS, exteriorT);
      const onEnvelope = near(envelope[edge.side].at, wall.at);
      /**
       * Whether a kind of space leaves the face open to the weather.
       *
       * @param {PlanRoomKind} kind What the space on the far side is.
       * @returns {boolean} Whether the weather rule applies.
       */
      const exposed = (kind) => kind === 'openAir' || kind === 'void';

      if (onEnvelope) {
        wall.exterior = true;
        wall.faces = `outside (side ${envelope[edge.side].side})`;
        // One contact, so a renderer iterating `contacts` needs no special case
        // for the envelope.
        wall.contacts = [
          {
            neighbourId: null,
            spanMin: wall.spanMin,
            spanMax: wall.spanMax,
            length: wall.length,
            thickness: exteriorT,
            reason: 'exterior',
          },
        ];
      } else {
        wall.neighbours = neighbours.map((n) => n.room.id);
        wall.faces = neighbours.length
          ? neighbours.map((n) => n.room.name).join(' / ')
          : 'nothing (no facing space found)';
        wall.contacts = contactsAlong(wall, neighbours, {
          WALLS,
          overrideFor,
          exposed,
          roomKind: room.kind,
        });
      }

      wall._facing = neighbours;
      walls.push(wall);
    });
  }

  placeOpenings(walls, spec);
  assignIsolationReasons(walls, spec);
  assignJunctionReasons(walls, spec);
  // The thickest stretch, for quantities — never for drawing, see the header —
  // and whether the face is more than one thickness along its length. Both are
  // settled AFTER the junction pass, because that pass widens a corner to the
  // stretch it takes its reason from: read before it, `thickness` would go on
  // quoting the thin stretch beside a widened corner and `varies` would call a
  // face one width when it is two.
  for (const wall of walls) {
    wall.thickness = cm(Math.max(...wall.contacts.map((c) => c.thickness)));
    wall.varies = new Set(wall.contacts.map((c) => cm(c.thickness))).size > 1;
  }
  for (const wall of walls) delete wall._facing;
  return walls;
}

/**
 * Put every declared PORT and WINDOW on the wall(s) it belongs to.
 *
 * A wall takes an opening when the opening runs along the wall's axis, names
 * the wall's room, names one of the spaces that wall geometrically faces, and
 * its span falls inside the wall's span. Both rooms of a pair therefore get a
 * copy; the copy on the LOWER-numbered room carries the matricule and the copy
 * on the higher-numbered room repeats it with `alias: true`, so a door is one
 * door with one name even though two rooms own a face of it.
 *
 * @param {readonly Wall[]} walls Every derived wall; openings are pushed onto them
 *   in place.
 * @param {PlanSpec} spec The source of truth.
 * @returns {void}
 */
function placeOpenings(walls, spec) {
  /** @type {{ declared: DeclaredOpening, wall: Wall, span: MutableSpan, alias: boolean }[]} */
  const placements = [];
  for (const declared of declaredOpenings(spec)) {
    const { opening } = declared;
    const [idA, idB] = opening.between;
    const rooms = spec.ROOMS;
    const roomA = rooms.find((r) => r.id === idA);
    const roomB = rooms.find((r) => r.id === idB);
    const primaryId = roomA && roomB ? (roomA.n <= roomB.n ? idA : idB) : idA;
    /** @type {MutableSpan} */
    const span = [opening.spanMin, cm(opening.spanMin + opening.width)];

    /** @type {Wall[]} */
    const found = [];
    for (const wall of walls) {
      if (opening.along !== wall.axis) continue;
      if (!opening.between.includes(wall.roomId)) continue;
      const otherId = opening.between[0] === wall.roomId ? opening.between[1] : opening.between[0];
      if (!(wall._facing ?? []).some((n) => n.room.id === otherId)) continue;
      if (span[0] < wall.spanMin - EPS || span[1] > wall.spanMax + EPS) continue;
      found.push(wall);
    }

    for (const wall of found) {
      placements.push({ declared, wall, span, alias: wall.roomId !== primaryId });
    }
    declared.placements = found;
    declared.primaryId = primaryId;
  }

  // Number per wall and per kind, in span order along the wall, on the primary
  // side only — the alias copy must read the same matricule.
  /** @type {Map<DeclaredOpening, string>} */
  const matriculeOf = new Map();
  const primaries = placements.filter((p) => !p.alias);
  /** @type {Map<string, typeof placements>} */
  const byWall = new Map();
  for (const p of primaries) {
    let group = byWall.get(p.wall.matricule);
    if (!group) {
      group = [];
      byWall.set(p.wall.matricule, group);
    }
    group.push(p);
  }
  for (const group of byWall.values()) {
    group.sort((a, b) => a.span[0] - b.span[0]);
    /** @type {Map<string, number>} */
    const counters = new Map();
    for (const p of group) {
      const n = (counters.get(p.declared.tag) ?? 0) + 1;
      counters.set(p.declared.tag, n);
      matriculeOf.set(p.declared, `${p.wall.matricule}-${p.declared.tag}${n}`);
    }
  }

  for (const p of placements) {
    const matricule = matriculeOf.get(p.declared);
    // An opening with no primary placement cannot be named; leave it off the
    // wall so verify.mjs reports it instead of inventing a number for it.
    if (!matricule) continue;
    // DerivedOpening = Opening + { matricule } (+ alias). Deliberately nothing
    // else: the far edge is spanMin + width, and a second copy of a number is a
    // second chance to disagree with it.
    p.wall.openings.push({ ...p.declared.opening, matricule, ...(p.alias ? { alias: true } : {}) });
  }
  for (const wall of walls) wall.openings.sort((a, b) => a.spanMin - b.spanMin);
}

/**
 * Walls grouped by room number, in wall order — what both renderers want when
 * they draw or list a room.
 *
 * @param {readonly Wall[]} walls Every derived wall.
 * @returns {Map<number, Wall[]>} The walls by room number, each list in wall order.
 */
export function wallsByRoom(walls) {
  /** @type {Map<number, Wall[]>} */
  const byRoom = new Map();
  for (const wall of walls) {
    let list = byRoom.get(wall.roomN);
    if (!list) {
      list = [];
      byRoom.set(wall.roomN, list);
    }
    list.push(wall);
  }
  for (const list of byRoom.values()) list.sort((a, b) => a.wallN - b.wallN);
  return new Map([...byRoom.entries()].sort((a, b) => a[0] - b[0]));
}

export default deriveWalls;
