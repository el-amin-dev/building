/**
 * Self-check of the floor plan source of truth: `node scripts/source-of-truth/verify.mjs`
 *
 * WHY a verifier and not tests: the numbers in `plan-v2.mjs` are the owner's,
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
} from './plan-v2.mjs';
import { deriveWalls, wallsByRoom } from './walls.mjs';

const SPEC = { FLOOR_NUMBER, PLOT, WALLS, HEIGHTS, STAIRS, ROOMS, JOIN_OVERRIDES, PORTS, WINDOWS, FIXTURES };

const EPS = 1e-6;
const cm = (v) => Math.round(v * 100) / 100;
/** Plain number for chain lines: 12, 4.5, 0.3 — not 12.00. */
const n = (v) => String(cm(v));
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
 * The stairwell's pieces, read out of STAIRS by shape rather than by name: every
 * 4-number rect on it except the bay they tile.
 *
 * WHY not a written list: a hand-kept list of piece names is only right until
 * someone adds a fifth piece, and the failure is silent — the missing piece is
 * simply never checked, never drawn, and nobody sees an error. A renderer lost
 * one that way this round. Enumerating the spec cannot miss one.
 */
const STAIR_PIECES = Object.entries(STAIRS)
  .filter(
    ([key, value]) =>
      key !== 'bay' && Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === 'number'),
  )
  .map(([key, rect]) => ({ key, rect }));

const failures = [];
const notes = [];
let currentCheck = '';
const fail = (message) => failures.push(`${currentCheck}: ${message}`);
const check = (title) => {
  currentCheck = title;
  console.log(`\n── ${title}`);
};
const line = (text) => console.log(`   ${text}`);

const rectArea = ([minX, maxX, minZ, maxZ]) => (maxX - minX) * (maxZ - minZ);
const roomArea = (room) => cm(room.rects.reduce((sum, r) => sum + rectArea(r), 0));
const rectsOverlap = (a, b) =>
  a[0] < b[1] - EPS && b[0] < a[1] - EPS && a[2] < b[3] - EPS && b[2] < a[3] - EPS;
const onGrid = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

const walls = deriveWalls(SPEC);
const byRoom = wallsByRoom(walls);

console.log(`floor plan v2 — self-check (floor ${FLOOR_NUMBER}, plot ${n(PLOT[1])} × ${n(PLOT[3])})`);
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
            fail(`${ROOMS[i].id} [${rect.map(n).join(', ')}] overlaps ${ROOMS[j].id} [${other.map(n).join(', ')}]`);
          }
        }
      }
      const [minX, maxX, minZ, maxZ] = rect;
      if (minX < INNER.minX - EPS || maxX > INNER.maxX + EPS || minZ < INNER.minZ - EPS || maxZ > INNER.maxZ + EPS) {
        fail(`${ROOMS[i].id} rect ${ri} leaves the interior ${n(INNER.minX)}–${n(INNER.maxX)} × ${n(INNER.minZ)}–${n(INNER.maxZ)}`);
      }
      if (maxX - minX < EPS || maxZ - minZ < EPS) fail(`${ROOMS[i].id} rect ${ri} is degenerate`);
    }
  }

  const gridValues = [
    ...PLOT.map((v, i) => [`PLOT[${i}]`, v]),
    ...Object.entries(WALLS),
    ...Object.entries(HEIGHTS),
    ...ROOMS.flatMap((r) => r.rects.flatMap((rect, ri) => rect.map((v, k) => [`${r.id}.rects[${ri}][${k}]`, v]))),
    ...['bay', 'flightA', 'flightB', 'halfLanding'].flatMap((k) => STAIRS[k].map((v, i) => [`STAIRS.${k}[${i}]`, v])),
    ['STAIRS.going', STAIRS.going],
    ['STAIRS.flightWidth', STAIRS.flightWidth],
    ...[...PORTS, ...WINDOWS].flatMap((o, i) =>
      ['spanMin', 'width', 'sill', 'head']
        .filter((f) => o[f] !== undefined)
        .map((f) => [`${o.between.join('↔')}.${f}`, o[f]]),
    ),
  ];
  const offGrid = gridValues.filter(([, v]) => !onGrid(v));
  for (const [label, v] of offGrid) fail(`${label} = ${v} is not on the centimetre grid`);
  line(`${ROOMS.reduce((c, r) => c + r.rects.length, 0)} rects, ${gridValues.length} coordinates checked`);
  line(`interior ${n(INNER.minX)}–${n(INNER.maxX)} (x) × ${n(INNER.minZ)}–${n(INNER.maxZ)} (z)`);
}

/* ───────────────────────────── 2. areas ───────────────────────────── */

check('2. Areas: room table, and the four totals closing on the plot');
{
  for (const room of ROOMS) {
    line(`R${String(room.n).padStart(2, '0')} ${room.id.padEnd(18)} ${room.kind.padEnd(11)} ${m(roomArea(room)).padStart(7)} m²`);
  }

  const sumOf = (predicate) => cm(ROOMS.filter(predicate).reduce((s, r) => s + roomArea(r), 0));
  const floor = sumOf((r) => FLOOR_KINDS.has(r.kind));
  const voidArea = sumOf((r) => r.kind === 'void');
  const stairwell = sumOf((r) => r.kind === 'stairwell');
  const wallsArea = cm(PLOT_AREA - floor - voidArea - stairwell);

  // Independent second opinion on the wall area: compress the coordinates and
  // add up the cells no rect covers. If this disagrees with "plot minus the
  // rest", a rect is outside the plot or two rects overlap.
  const xs = [...new Set([PLOT[0], PLOT[1], ...ROOMS.flatMap((r) => r.rects.flatMap((c) => [c[0], c[1]]))])].sort((a, b) => a - b);
  const zs = [...new Set([PLOT[2], PLOT[3], ...ROOMS.flatMap((r) => r.rects.flatMap((c) => [c[2], c[3]]))])].sort((a, b) => a - b);
  let uncovered = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < zs.length - 1; j += 1) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      const mz = (zs[j] + zs[j + 1]) / 2;
      const covered = ROOMS.some((r) => r.rects.some(([a, b, c, d]) => mx > a && mx < b && mz > c && mz < d));
      if (!covered) uncovered += (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]);
    }
  }
  uncovered = cm(uncovered);

  line('');
  line(`FLOOR     (room/circulation/openAir) ${m(floor).padStart(7)} m²`);
  line(`VOID                                 ${m(voidArea).padStart(7)} m²`);
  line(`STAIRWELL                            ${m(stairwell).padStart(7)} m²`);
  line(`WALLS     (plot − everything else)   ${m(wallsArea).padStart(7)} m²`);
  line(`                                     ─────────`);
  line(`TOTAL                                ${m(cm(floor + voidArea + stairwell + wallsArea)).padStart(7)} m² (plot ${m(PLOT_AREA)})`);

  if (Math.abs(cm(floor + voidArea + stairwell + wallsArea) - PLOT_AREA) > EPS) {
    fail(`the four totals sum to ${m(floor + voidArea + stairwell + wallsArea)}, not ${m(PLOT_AREA)}`);
  }
  if (Math.abs(uncovered - wallsArea) > EPS) {
    fail(`wall area by subtraction is ${m(wallsArea)} but the uncovered plot area is ${m(uncovered)} — a rect overlaps or leaves the plot`);
  }
  if (wallsArea <= 0) fail('wall area is not positive');
}

/* ───────────────────────────── 3. chains ───────────────────────────── */

check('3. Depth and width chains: wall + space + wall … closing on the plot');
{
  /**
   * Walk one axis through the plan at a fixed coordinate on the other axis.
   * Half-open containment ([min, max)) so a cut landing exactly on a party wall
   * face — x = 12 is bedroomMaleKids' own west face — belongs to one space only.
   */
  const chain = (axis, at) => {
    const spaces = [];
    for (const room of ROOMS) {
      for (const [minX, maxX, minZ, maxZ] of room.rects) {
        const across = axis === 'z' ? [minX, maxX] : [minZ, maxZ];
        if (at < across[0] - EPS || at >= across[1] - EPS) continue;
        spaces.push(axis === 'z' ? { id: room.id, lo: minZ, hi: maxZ } : { id: room.id, lo: minX, hi: maxX });
      }
    }
    // Merge the rects of one room that the cut crosses back to back (the
    // corridor at x = 7 is two rects but one continuous space).
    spaces.sort((a, b) => a.lo - b.lo);
    const merged = [];
    for (const s of spaces) {
      const last = merged[merged.length - 1];
      if (last && last.id === s.id && s.lo <= last.hi + EPS) last.hi = Math.max(last.hi, s.hi);
      else merged.push({ ...s });
    }

    const total = axis === 'z' ? PLOT[3] : PLOT[1];
    const parts = [];
    let pos = axis === 'z' ? PLOT[2] : PLOT[0];
    let sum = 0;
    let broken = false;
    for (const s of merged) {
      const gap = cm(s.lo - pos);
      if (gap < -EPS) {
        fail(`${axis === 'z' ? 'x' : 'z'}=${n(at)}: ${s.id} overlaps the space before it by ${m(-gap)}`);
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
    const hosts = walls.filter((w) =>
      w.openings.some((op) => op.between === o.between && Math.abs(op.spanMin - o.spanMin) < EPS),
    );
    const primary = hosts.filter((w) => !w.openings.find((op) => op.between === o.between && Math.abs(op.spanMin - o.spanMin) < EPS).alias);

    if (primary.length !== 1) {
      fail(`${ref} ${o.between.join(' ↔ ')} sits in ${primary.length} derived walls, not exactly 1`);
      continue;
    }
    if (hosts.length !== 2) {
      fail(`${ref} ${o.between.join(' ↔ ')} is on ${hosts.length} wall face(s): the two rooms' facing walls do not both contain ${m(span[0])}–${m(span[1])}`);
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
      if (gap < -EPS) fail(`${w.matricule}: ${sorted[i - 1].matricule} and ${sorted[i].matricule} overlap by ${m(-gap)}`);
      else if (gap < CLEAR - EPS) fail(`${w.matricule}: only ${m(gap)} between ${sorted[i - 1].matricule} and ${sorted[i].matricule} (${CLEAR.toFixed(2)} needed)`);
    }
  }

  const placed = walls.flatMap((w) => w.openings).filter((op) => !op.alias).length;
  line(`${placed} of ${declared.length} openings named on a primary wall; ${walls.flatMap((w) => w.openings).length} wall faces carry one`);
  for (const w of walls) {
    if (w.openings.length === 0) continue;
    line(`${w.matricule.padEnd(16)} ${w.openings.map((op) => `${op.matricule}${op.alias ? '*' : ''} ${m(op.spanMin)}–${m(op.spanMin + op.width)}`).join(' | ')}`);
  }
  line('(* = alias: the same opening, named by the lower-numbered room)');
}

/* ───────────────────────── 5. matricules ───────────────────────── */

check('5. Matricules are unique');
{
  const wallSeen = new Map();
  for (const w of walls) {
    if (wallSeen.has(w.matricule)) fail(`wall matricule ${w.matricule} used twice (${wallSeen.get(w.matricule)} and ${w.roomId} W${w.wallN})`);
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
      if (op.alias && !openingOwners.has(op.matricule)) fail(`${w.matricule} aliases unknown opening ${op.matricule}`);
    }
  }
  line(`${wallSeen.size} wall matricules, ${openingOwners.size} opening matricules, all distinct`);
}

/* ───────────────────────── 6. reachability ───────────────────────── */

check('6. Reachability, and what a port is allowed to open onto');
{
  const roomById = new Map(ROOMS.map((r) => [r.id, r]));
  const kindOf = (id) => roomById.get(id)?.kind;
  const flightRun = cm((STAIRS.riserCount / 2 - 1) * STAIRS.going);
  const spansOverlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS;
  const extentAlong = (rect, axis) => (axis === 'x' ? [rect[0], rect[1]] : [rect[2], rect[3]]);
  /** Does this rect run right up to that wall's face? */
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
      w.neighbours.every((id) => FLOOR_KINDS.has(kindOf(id))),
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
  const atThisLevel = [];
  for (const piece of STAIR_PIECES) {
    for (const edge of openEdges) {
      if (!reachesWall(piece.rect, edge)) continue;
      if (!spansOverlap(extentAlong(piece.rect, edge.axis), [edge.spanMin, edge.spanMax])) continue;
      const travel = edge.axis === 'x' ? 'z' : 'x';
      const [lo, hi] = extentAlong(piece.rect, travel);
      if (Math.abs(cm(hi - lo) - flightRun) < EPS) {
        fail(`${piece.key} reaches the open edge ${edge.matricule} but is ${m(hi - lo)} along the way in — a full flight run, so it is a flight, not a landing`);
        continue;
      }
      atThisLevel.push({ ...piece, edge });
      break;
    }
  }
  const levelKeys = new Set(atThisLevel.map((p) => p.key));

  /** A space you can stand on at this storey: floored, or a stairwell with a landing at this level. */
  const carriesFloor = (id) =>
    FLOOR_KINDS.has(kindOf(id)) || (kindOf(id) === 'stairwell' && atThisLevel.length > 0);

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
   */
  const admittingPiece = (wall, span) =>
    atThisLevel.find(
      (piece) =>
        reachesWall(piece.rect, wall) &&
        span[0] >= extentAlong(piece.rect, wall.axis)[0] - EPS &&
        span[1] <= extentAlong(piece.rect, wall.axis)[1] + EPS,
    ) ?? null;

  for (const p of PORTS) {
    const span = [p.spanMin, cm(p.spanMin + p.width)];
    for (const id of p.between) {
      if (kindOf(id) === 'void') {
        fail(`${p.between.join(' ↔ ')} opens onto ${id}, a void — a hole in the floor is never a doorway`);
        continue;
      }
      if (kindOf(id) !== 'stairwell') continue;
      const wall = walls.find(
        (w) =>
          w.roomId === id &&
          w.openings.some((op) => op.between === p.between && Math.abs(op.spanMin - p.spanMin) < EPS),
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
      line(`${p.between.join(' ↔ ')} ${m(span[0])}–${m(span[1])} lands on ${piece.key} (${m(lo)}–${m(hi)}), jambs ${m(span[0] - lo)} / ${m(hi - span[1])}`);
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
      const probe = [cm(mid - 0.45), cm(mid + 0.45)];
      if (probe[0] < lo - EPS || probe[1] > hi + EPS) continue;
      probes.push(`${piece.key} via ${wall.matricule}`);
      if (admittingPiece(wall, probe)) {
        fail(`a 0.90 doorway at ${m(probe[0])}–${m(probe[1])} on ${wall.matricule} lands on ${piece.key}, half a storey off this floor, and the rule admitted it`);
      }
      break;
    }
  }

  const graph = new Map(ROOMS.map((r) => [r.id, []]));
  const link = (a, b) => {
    graph.get(a)?.push(b);
    graph.get(b)?.push(a);
  };
  for (const p of PORTS) link(p.between[0], p.between[1]);
  // Continuous floors need no door: you walk off the corridor onto the landing.
  // Only where both sides carry floor — a zero join to a void is an unguarded
  // edge, not a route.
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

  const from = new Map([['corridor', null]]);
  const queue = ['corridor'];
  while (queue.length) {
    const here = queue.shift();
    for (const next of graph.get(here) ?? []) {
      if (from.has(next)) continue;
      from.set(next, here);
      queue.push(next);
    }
  }
  const pathTo = (id) => {
    const hops = [];
    for (let at = id; at != null; at = from.get(at)) hops.unshift(at);
    return hops.join(' → ');
  };

  const want = ROOMS.filter((r) => FLOOR_KINDS.has(r.kind));
  const stranded = want.filter((r) => !from.has(r.id));
  for (const r of stranded) fail(`${r.id} (R${r.n}, ${r.kind}) has no route from the corridor`);
  line(`${want.length - stranded.length}/${want.length} reachable${stranded.length ? `; stranded: ${stranded.map((r) => r.id).join(', ')}` : ''}`);
  line(`at this storey's level: ${atThisLevel.map((p) => `${p.key} (via ${p.edge.matricule}, the 0.00 join to ${p.edge.faces})`).join(', ') || 'nothing'}`);
  line(`walk-through joins, no door: ${joins.map((j) => [...j].join(' ↔ ')).join(', ') || 'none'}`);
  line(`guest room: ${pathTo('guestRoom')}`);
  line(`refusal proved on ${probes.length} piece(s) off this level: ${probes.join(', ') || 'none'}`);
}

/* ───────────────────────────── 7. stairs ───────────────────────────── */

check('7. Stair fit: four pieces tiling the bay, two flights between two landings');
{
  const [bayMinX, bayMaxX, bayMinZ, bayMaxZ] = STAIRS.bay;
  const goingsPerFlight = STAIRS.riserCount / 2 - 1;
  const runNeeded = cm(goingsPerFlight * STAIRS.going);
  // Listed in travel order: arrive on landingEast at this floor's level, down
  // flightA to the west, turn 180° on halfLanding half a storey down, down
  // flightB to the east and the floor below.
  // Enumerated from the spec, not listed here: a fifth piece joins the tiling
  // and the assertions below on its own. The split into flights and landings is
  // the one thing still read off the names — nothing in the data says which a
  // piece is — so every piece lands in exactly one of the two lists and none can
  // fall between them.
  const pieces = STAIR_PIECES.map((p) => [p.key, p.rect]);
  const isFlight = (key) => /flight/i.test(key);
  const flights = pieces.map(([key]) => key).filter(isFlight);
  const landings = pieces.map(([key]) => key).filter((key) => !isFlight(key));

  line(`bay ${m(bayMaxX - bayMinX)} × ${m(bayMaxZ - bayMinZ)}; ${STAIRS.riserCount} risers of ${m(HEIGHTS.floorToFloor / STAIRS.riserCount)} (${m(HEIGHTS.floorToFloor)} storey), ${STAIRS.riserCount / 2} per flight`);
  for (const [name, [minX, maxX, minZ, maxZ]] of pieces) {
    line(`${name.padEnd(11)} x ${m(minX)}–${m(maxX)} (${m(maxX - minX)}) · z ${m(minZ)}–${m(maxZ)} (${m(maxZ - minZ)})`);
  }
  line(`each flight needs ${goingsPerFlight} goings of ${m(STAIRS.going)} = ${m(runNeeded)} of run; each landing needs ${m(STAIRS.flightWidth)} to turn in`);

  // WHY the run is (risers/2 − 1) goings and not risers/2: the last riser of a
  // flight lands ON the landing, so the treads that need floor are one fewer.
  // Both flights travel along x, so the run is the x extent and the width the z
  // extent; a landing is crossed along x too, which is the direction a 180°
  // turn has to be at least one flight wide in.
  for (const name of flights) {
    const [minX, maxX, minZ, maxZ] = STAIRS[name];
    if (Math.abs(cm(maxX - minX) - runNeeded) > EPS) {
      fail(`${name} run is ${m(maxX - minX)}, needs ${goingsPerFlight} × ${m(STAIRS.going)} = ${m(runNeeded)}`);
    }
    if (Math.abs(cm(maxZ - minZ) - STAIRS.flightWidth) > EPS) fail(`${name} is ${m(maxZ - minZ)} wide, not ${m(STAIRS.flightWidth)}`);
  }
  for (const name of landings) {
    const run = cm(STAIRS[name][1] - STAIRS[name][0]);
    if (run < STAIRS.flightWidth - EPS) {
      fail(`${name} is ${m(run)} long in the direction of travel, less than the ${m(STAIRS.flightWidth)} a 180° turn needs`);
    }
  }

  // Side by side: the same run, touching along their long edge. That is what
  // makes the pair read as one stair two flights wide and the turn a true half
  // turn rather than two unrelated flights sharing a bay.
  const [aMinX, aMaxX, aMinZ, aMaxZ] = STAIRS.flightA;
  const [bMinX, bMaxX, bMinZ, bMaxZ] = STAIRS.flightB;
  if (Math.abs(aMinX - bMinX) > EPS || Math.abs(aMaxX - bMaxX) > EPS) {
    fail(`the flights do not share a run: flightA x ${m(aMinX)}–${m(aMaxX)}, flightB x ${m(bMinX)}–${m(bMaxX)}`);
  }
  if (Math.abs(aMaxZ - bMinZ) > EPS && Math.abs(bMaxZ - aMinZ) > EPS) {
    fail(`the flights are not side by side: flightA z ${m(aMinZ)}–${m(aMaxZ)} and flightB z ${m(bMinZ)}–${m(bMaxZ)} do not touch`);
  }

  for (const [name, rect] of pieces) {
    if (rect[0] < bayMinX - EPS || rect[1] > bayMaxX + EPS || rect[2] < bayMinZ - EPS || rect[3] > bayMaxZ + EPS) {
      fail(`${name} leaves the bay`);
    }
  }
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      if (rectsOverlap(pieces[i][1], pieces[j][1])) fail(`${pieces[i][0]} overlaps ${pieces[j][0]}`);
    }
  }
  // Inside the bay + no overlap + areas summing to the bay is an exact tiling:
  // there is nowhere for a gap to hide once all three hold.
  const piecesArea = cm(pieces.reduce((s, [, r]) => s + rectArea(r), 0));
  const bayArea = cm(rectArea(STAIRS.bay));
  if (Math.abs(piecesArea - bayArea) > EPS) {
    fail(`the ${pieces.length} pieces cover ${m(piecesArea)} of the ${m(bayArea)} bay — they do not tile it`);
  }
  line(`pieces ${m(piecesArea)} m² = bay ${m(bayArea)} m², inside it, no overlap`);

  const bayRoom = ROOMS.find((r) => r.id === 'stairs');
  if (bayRoom && bayRoom.rects.length === 1 && bayRoom.rects[0].some((v, i) => Math.abs(v - STAIRS.bay[i]) > EPS)) {
    fail(`STAIRS.bay [${STAIRS.bay.map(n).join(', ')}] is not the R${bayRoom.n} rect [${bayRoom.rects[0].map(n).join(', ')}]`);
  }
}

/* ──────── 8. derived thickness against the gap actually drawn ──────── */

check('8. Derived wall thickness matches the gap left between the rooms');
{
  // Beyond the seven checks asked for, and the reason it is here: thickness is
  // derived from a rule (envelope → JOIN_OVERRIDES → partition) while the gap
  // is drawn in the rects. When they disagree the renderers build a 0.20 wall
  // into a 0.30 void and leave a sliver, so the disagreement has to be loud.
  const mismatches = [];
  for (const w of walls) {
    if (w.exterior || w.measuredGap === null) continue;
    if (Math.abs(w.measuredGap - w.thickness) > EPS) mismatches.push(w);
  }
  const grouped = new Map();
  for (const w of mismatches) {
    const key = `${m(w.thickness)}→${m(w.measuredGap)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(w);
  }
  for (const [key, group] of grouped) {
    const [derived, gap] = key.split('→');
    fail(`${group.length} walls derive ${derived} but the rects leave ${gap}: ${group.map((w) => `${w.matricule} (${w.roomId} ${w.side} → ${w.neighbours.join(',')})`).join('; ')}`);
  }
  for (const w of walls) if (w.thicknessNote) notes.push(`${w.matricule}: ${w.thicknessNote}`);
  line(`${walls.length - mismatches.length}/${walls.length} walls agree with the drawn gap`);
  const kinds = new Map();
  for (const w of walls) kinds.set(m(w.thickness), (kinds.get(m(w.thickness)) ?? 0) + 1);
  line(`thicknesses: ${[...kinds.entries()].sort().map(([t, c]) => `${t} × ${c}`).join(', ')}`);
}

/* ───────────────────────────── 9. fixtures ───────────────────────────── */

check('9. Fixtures: inside their room, clear of each other and of every door swing');
{
  const roomById = new Map(ROOMS.map((r) => [r.id, r]));
  const inside = (rect, [minX, maxX, minZ, maxZ]) =>
    rect[0] >= minX - EPS && rect[1] <= maxX + EPS && rect[2] >= minZ - EPS && rect[3] <= maxZ + EPS;

  for (const [i, f] of FIXTURES.entries()) {
    const room = roomById.get(f.room);
    if (!room) {
      fail(`FIXTURES[${i}] ${f.kind} names room '${f.room}', which does not exist`);
      continue;
    }
    // One rect, not the union: a fixture straddling two rects of an L-shaped
    // room would sit across the internal seam, which is a corner in the room,
    // not a wall — nothing stands there.
    if (!room.rects.some((r) => inside(f.rect, r))) {
      fail(`FIXTURES[${i}] ${f.kind} [${f.rect.map(n).join(', ')}] is not wholly inside any rect of ${f.room}`);
    }
    const offGrid = f.rect.filter((v) => !onGrid(v));
    if (offGrid.length) fail(`FIXTURES[${i}] ${f.kind} in ${f.room} is off the centimetre grid: ${offGrid.join(', ')}`);
  }

  for (let i = 0; i < FIXTURES.length; i += 1) {
    for (let j = i + 1; j < FIXTURES.length; j += 1) {
      if (rectsOverlap(FIXTURES[i].rect, FIXTURES[j].rect)) {
        fail(`${FIXTURES[i].kind} (${FIXTURES[i].room}) overlaps ${FIXTURES[j].kind} (${FIXTURES[j].room})`);
      }
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
  const swings = [];
  for (const w of walls) {
    for (const op of w.openings) {
      if (op.kind !== 'door') continue;
      const from = op.spanMin;
      const to = cm(op.spanMin + op.width);
      const deep = op.width;
      const rect =
        w.side === 'north'
          ? [from, to, w.at, cm(w.at + deep)]
          : w.side === 'south'
            ? [from, to, cm(w.at - deep), w.at]
            : w.side === 'east'
              ? [cm(w.at - deep), w.at, from, to]
              : [w.at, cm(w.at + deep), from, to];
      swings.push({ wall: w, op, rect });
    }
  }

  for (const swing of swings) {
    for (const f of FIXTURES) {
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

  const byFixtureRoom = new Map();
  for (const f of FIXTURES) {
    if (!byFixtureRoom.has(f.room)) byFixtureRoom.set(f.room, []);
    byFixtureRoom.get(f.room).push(f);
  }
  for (const [roomId, list] of byFixtureRoom) {
    const room = roomById.get(roomId);
    line(`${room ? `${room.name} (${m(roomArea(room))} m²)` : roomId}:`);
    for (const f of list) {
      line(
        `   ${f.kind.padEnd(7)} ${m(f.rect[1] - f.rect[0])} × ${m(f.rect[3] - f.rect[2])}` +
          `  at x ${m(f.rect[0])}–${m(f.rect[1])}, z ${m(f.rect[2])}–${m(f.rect[3])}`,
      );
    }
  }
  line(`${FIXTURES.length} fixtures, ${swings.length} door faces checked for swing`);
}

/* ───────────────────────────── report ───────────────────────────── */

console.log('\n── walls per room');
for (const [roomN, list] of byRoom) {
  const room = ROOMS.find((r) => r.n === roomN);
  console.log(`   R${String(roomN).padStart(2, '0')} ${room.name} — ${list.length} walls`);
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
    `PASS — 9 checks, ${walls.length} walls, ${PORTS.length + WINDOWS.length} openings, ${FIXTURES.length} fixtures, everything closes.`,
  );
  process.exit(0);
}
console.log(`FAIL — ${failures.length} problem(s):`);
for (const f of failures) console.log(`   ✗ ${f}`);
process.exit(1);
