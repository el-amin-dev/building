/**
 * Nominal walls, derived from the room rectangles of `plan-v2.mjs`.
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

import * as planV2 from './plan-v2.mjs';

/** Metre tolerance: the spec is on the centimetre grid, so 1e-6 m is pure noise. */
const EPS = 1e-6;

/** Round to the centimetre — the grid the whole source of truth lives on. */
const cm = (v) => Math.round(v * 100) / 100;

const near = (a, b) => Math.abs(a - b) < EPS;

/** Side → the axis the wall RUNS along (not the axis it faces). */
const AXIS_OF = Object.freeze({ north: 'x', south: 'x', east: 'z', west: 'z' });

/**
 * Union of spans, merging anything that touches. Touching counts as merging on
 * purpose: that is exactly the "merged where collinear and adjacent" rule, and
 * it is what turns the corridor's two rects into one 2.00 m west wall.
 */
function mergeSpans(spans) {
  const out = [];
  for (const [lo, hi] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** span minus holes, as the pieces that survive. */
function subtractSpans(span, holes) {
  let pieces = [span];
  for (const [hlo, hhi] of mergeSpans(holes)) {
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

/** Overlap of two spans, or null when they only touch or miss. */
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
 */
function outlineEdges(rects) {
  const candidates = [];
  for (const [minX, maxX, minZ, maxZ] of rects) {
    candidates.push({ side: 'north', at: minZ, span: [minX, maxX] });
    candidates.push({ side: 'south', at: maxZ, span: [minX, maxX] });
    candidates.push({ side: 'east', at: maxX, span: [minZ, maxZ] });
    candidates.push({ side: 'west', at: minX, span: [minZ, maxZ] });
  }

  const kept = [];
  for (const edge of candidates) {
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

  const byFace = new Map();
  for (const edge of kept) {
    const key = `${edge.side}@${cm(edge.at)}`;
    if (!byFace.has(key)) byFace.set(key, { side: edge.side, at: edge.at, spans: [] });
    byFace.get(key).spans.push(edge.span);
  }

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
 */
function directedEnds({ side, at, span: [a, b] }) {
  if (side === 'north') return [[a, at], [b, at]];
  if (side === 'east') return [[at, a], [at, b]];
  if (side === 'south') return [[b, at], [a, at]];
  return [[at, b], [at, a]];
}

/** Walk the outline clockwise from the northernmost north edge, so W1 is north. */
function orderClockwise(edges, roomId) {
  const key = ([x, z]) => `${cm(x)},${cm(z)}`;
  const byStart = new Map();
  for (const edge of edges) {
    const [start, end] = directedEnds(edge);
    edge.start = start;
    edge.end = end;
    if (byStart.has(key(start))) {
      throw new Error(`${roomId}: two outline edges leave ${key(start)} — rects overlap or pinch`);
    }
    byStart.set(key(start), edge);
  }

  const norths = edges
    .filter((e) => e.side === 'north')
    .sort((p, q) => p.at - q.at || p.span[0] - q.span[0]);
  if (norths.length === 0) throw new Error(`${roomId}: outline has no north edge`);

  const ordered = [];
  const seen = new Set();
  let current = norths[0];
  while (current && !seen.has(current)) {
    seen.add(current);
    ordered.push(current);
    current = byStart.get(key(current.end));
  }
  if (ordered.length !== edges.length) {
    throw new Error(
      `${roomId}: outline is not one closed loop (walked ${ordered.length} of ${edges.length} edges)`,
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
 */
function facingSpaces(wall, rooms, maxGap) {
  const hits = new Map();
  for (const other of rooms) {
    if (other.n === wall.roomN) continue;
    for (const [minX, maxX, minZ, maxZ] of other.rects) {
      let gap;
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
    .map((hit) => ({ ...hit, spans: mergeSpans(hit.spans).map(([a, b]) => [cm(a), cm(b)]) }));
}

/** `F1-R11-KIT-W3` — floor, zero-padded room number, room type, wall number. */
const wallMatricule = (floor, room, wallN) =>
  `F${floor}-R${String(room.n).padStart(2, '0')}-${room.type}-W${wallN}`;

/**
 * Every declared opening, flattened, keeping the tag that distinguishes a port
 * (`-P<n>`) from a window (`-G<n>`) in the matricule.
 */
function declaredOpenings(spec) {
  return [
    ...spec.PORTS.map((o, i) => ({ opening: o, group: 'port', tag: 'P', ref: `PORTS[${i}]` })),
    ...spec.WINDOWS.map((o, i) => ({ opening: o, group: 'window', tag: 'G', ref: `WINDOWS[${i}]` })),
  ];
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
/** Opposite face of the same physical wall. */
const OPPOSITE_SIDE = Object.freeze({ north: 'south', south: 'north', east: 'west', west: 'east' });

/**
 * Are these two faces the two sides of one built wall? Same axis, opposite
 * sides, the second on the outward side of the first and no further than one
 * exterior wall away, spans overlapping.
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
 * The stretches of one face, in order, tiling its whole span.
 *
 * WHY a sweep rather than one entry per neighbour: the stretches have to tile
 * the face for a renderer to draw it by walking the list, which means the bits
 * that back onto nothing must appear too, and two spaces that both claim a
 * stretch must be resolved rather than both emitted. Cutting the span at every
 * boundary and asking each cell which space is NEAREST does both, and cannot
 * leave a hole or an overlap however the rooms are drawn.
 */
function contactsAlong(wall, neighbours, { WALLS, overrideFor, exposed, roomKind }) {
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
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [i, c] of contacts.entries()) {
      if (c.thickness !== null) continue;
      const around = [contacts[i - 1], contacts[i + 1]]
        .filter((x) => x && x.thickness !== null)
        .map((x) => x.thickness);
      if (around.length) c.thickness = Math.max(...around);
      else if (pass === 1) c.thickness = WALLS.partition;
    }
  }
  return contacts;
}

/**
 * Second pass: label the stretches the owner built heavy.
 *
 * Isolation is a width now, and it is declared per FACE, so what it means for a
 * stretch is only knowable once every face exists — a named face makes whatever
 * backs onto it heavy too. It only ever upgrades a plain separator: an override
 * or a weather-exposed face already has a stronger reason for its number.
 */
function assignIsolationReasons(walls, spec) {
  const insulated = spec.INSULATED_WALLS ?? [];
  if (insulated.length === 0) return;
  const maxGap = spec.WALLS.exterior;
  const byMatricule = new Map(walls.map((w) => [w.matricule, w]));
  const spans = new Map(walls.map((w) => [w.matricule, []]));

  for (const entry of insulated) {
    const wall = byMatricule.get(entry.matricule);
    if (!wall) continue;
    spans.get(wall.matricule).push([wall.spanMin, wall.spanMax]);
    for (const other of walls) {
      if (other.matricule === wall.matricule || !backToBack(wall, other, maxGap)) continue;
      const lo = Math.max(wall.spanMin, other.spanMin);
      const hi = Math.min(wall.spanMax, other.spanMax);
      if (hi - lo > EPS) spans.get(other.matricule).push([cm(lo), cm(hi)]);
    }
  }

  for (const wall of walls) {
    const heavy = mergeSpans(spans.get(wall.matricule));
    if (heavy.length === 0) continue;
    for (const contact of wall.contacts) {
      if (contact.reason !== 'plain separator') continue;
      const inside = heavy.some(([lo, hi]) => contact.spanMin >= lo - EPS && contact.spanMax <= hi + EPS);
      if (inside) contact.reason = 'isolation';
    }
  }
}

export function deriveWalls(spec = planV2) {
  const { FLOOR_NUMBER, PLOT, WALLS, ROOMS, JOIN_OVERRIDES } = spec;
  const exteriorT = WALLS.exterior;

  /**
   * The interior boundary: a face sitting on it is on the exterior envelope and
   * is 0.30 thick whatever is behind it. Side A is x 0, D is x 22.50, C is z 0
   * and B is z 10.00 (plan-v2.mjs header).
   */
  const envelope = {
    west: { at: cm(PLOT[0] + exteriorT), side: 'A' },
    east: { at: cm(PLOT[1] - exteriorT), side: 'D' },
    north: { at: cm(PLOT[2] + exteriorT), side: 'C' },
    south: { at: cm(PLOT[3] - exteriorT), side: 'B' },
  };

  const overrideFor = (a, b) =>
    JOIN_OVERRIDES.find(
      (o) => (o.between[0] === a && o.between[1] === b) || (o.between[0] === b && o.between[1] === a),
    );

  const walls = [];
  for (const room of ROOMS) {
    const ordered = orderClockwise(outlineEdges(room.rects), room.id);
    ordered.forEach((edge, index) => {
      const wallN = index + 1;
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
      };

      const neighbours = facingSpaces(wall, ROOMS, exteriorT);
      const onEnvelope = near(envelope[edge.side].at, wall.at);
      const exposed = (kind) => kind === 'openAir' || kind === 'void';

      if (onEnvelope) {
        wall.exterior = true;
        wall.faces = `outside (side ${envelope[edge.side].side})`;
        wall.neighbours = [];
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
        wall.exterior = false;
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

      // The thickest stretch, for quantities. Never for drawing — see the header.
      wall.thickness = cm(Math.max(...wall.contacts.map((c) => c.thickness)));
      wall.varies = new Set(wall.contacts.map((c) => cm(c.thickness))).size > 1;

      wall._facing = neighbours;
      walls.push(wall);
    });
  }

  placeOpenings(walls, spec);
  assignIsolationReasons(walls, spec);
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
 */
function placeOpenings(walls, spec) {
  const placements = [];
  for (const declared of declaredOpenings(spec)) {
    const { opening } = declared;
    const [idA, idB] = opening.between;
    const rooms = spec.ROOMS;
    const roomA = rooms.find((r) => r.id === idA);
    const roomB = rooms.find((r) => r.id === idB);
    const primaryId = roomA && roomB ? (roomA.n <= roomB.n ? idA : idB) : idA;
    const span = [opening.spanMin, cm(opening.spanMin + opening.width)];

    const found = [];
    for (const wall of walls) {
      if (opening.along !== wall.axis) continue;
      if (!opening.between.includes(wall.roomId)) continue;
      const otherId = opening.between[0] === wall.roomId ? opening.between[1] : opening.between[0];
      if (!wall._facing.some((n) => n.room.id === otherId)) continue;
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
  const matriculeOf = new Map();
  const primaries = placements.filter((p) => !p.alias);
  const byWall = new Map();
  for (const p of primaries) {
    if (!byWall.has(p.wall.matricule)) byWall.set(p.wall.matricule, []);
    byWall.get(p.wall.matricule).push(p);
  }
  for (const group of byWall.values()) {
    group.sort((a, b) => a.span[0] - b.span[0]);
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
 */
export function wallsByRoom(walls) {
  const byRoom = new Map();
  for (const wall of walls) {
    if (!byRoom.has(wall.roomN)) byRoom.set(wall.roomN, []);
    byRoom.get(wall.roomN).push(wall);
  }
  for (const list of byRoom.values()) list.sort((a, b) => a.wallN - b.wallN);
  return new Map([...byRoom.entries()].sort((a, b) => a[0] - b[0]));
}

export default deriveWalls;
