/**
 * Reference-table page of the source-of-truth drawing.
 *
 * The plan page shows the floor; it cannot also carry the numbers. Every room's
 * matricule, every derived wall with its run and its length, and every port and
 * window with its span, its clear width and the owner's reason for it, are what
 * the owner actually checks a revision against — so they get their own page,
 * beside the plan, as five tables: ROOMS, WALLS, PORTS, WINDOWS, FIXTURES.
 *
 * This module consumes the contract of `sourceOfTruth/plan.ts`, nothing else:
 *
 *   renderTablePage({ spec, walls }) -> '<mxGraphModel>…</mxGraphModel>'
 *
 * `spec` is the module namespace of `sourceOfTruth/plan.ts` and `walls` the array
 * `deriveWalls(spec)` returns (`walls.mjs`). Both arrive as arguments rather than
 * as imports so that this renderer stays a pure function of the data: the page
 * can be rendered from a fixture, and the build script (`build.mjs`) stays the
 * only place that decides which spec and which derivation are the real ones.
 *
 * Why the layout is computed and not written down
 * -----------------------------------------------
 * draw.io has no table primitive. A table here is a grid of `mxCell` rects, each
 * one positioned absolutely, so every column width, row height and page size is a
 * number this file has to produce. Hard-coding those numbers would mean that the
 * first owner note longer than its column, the first `why` sentence rewritten, or
 * the first room added, silently clips its text: draw.io does not grow a shape to
 * fit its label, it hides the overflow. So each column is measured instead —
 * `CHAR_WIDTH` px per character of the longest line it must hold, plus padding —
 * each table's height follows from its real row count, each table starts below the
 * previous one's real height, and the page follows the widest table. The data may
 * then change freely; the page re-sizes itself around it. `CHAR_WIDTH` is a
 * deliberate over-estimate of Helvetica's average advance at `FONT_SIZE`, so the
 * measurement errs toward a column too wide rather than a label cut off.
 *
 * Consequence, accepted: the `why` column of PORTS and WINDOWS holds whole
 * sentences, so those tables are wide and the page with them. Wrapping them would
 * need rows of different heights, which costs the uniform, scannable 13 px row
 * this page is built on; a wide page that can be read is worth more than a narrow
 * page that cannot.
 */

/**
 * The derivation's own vocabulary. `walls.mjs` is the one place a wall, a contact
 * and the plan namespace are described, so those descriptions are imported rather
 * than restated here: a renderer that re-declared them could drift from what it
 * is handed.
 *
 * @import { Contact, PlanSpec, Span, Wall } from './walls.mjs'
 */

/**
 * @import { PlanFixture, PlanRectCoordinates, PlanRoom }
 *   from '../../src/features/building/domain/sourceOfTruth/plan.ts'
 */

/** Font size of every table cell, px. Titles are two points larger. */
const FONT_SIZE = 9;

/** Title font size, px: enough to find a table when scrolling the page. */
const TITLE_FONT_SIZE = 11;

/**
 * Width of one character at {@link FONT_SIZE}, px.
 *
 * Helvetica at 9 px averages nearer 4.7 px per character for mixed-case text; 5.2
 * is taken instead, so a column measured with it is a little too wide rather than
 * a hair too narrow. A label that does not fit is invisible in draw.io, a column
 * 8% too wide is merely a column 8% too wide.
 */
const CHAR_WIDTH = 5.2;

/** Height of a body row, px: the 12–14 px band that keeps a long table scannable. */
const ROW_HEIGHT = 13;

/** Height of the header row, px: one px taller than a body row, so it reads as a lid. */
const HEADER_ROW_HEIGHT = 14;

/** Height of a table title, px. */
const TITLE_HEIGHT = 18;

/** Gap between a title and its grid, px. */
const TITLE_GAP = 4;

/** Gap between one table and the next, px: wide enough that two grids never read as one. */
const TABLE_GAP = 28;

/** Margin between the page edge and the tables, px. */
const PAGE_MARGIN = 20;

/** Text inset inside a cell, px per side. */
const PADDING = 4;

/** Grid line colour of every cell. */
const GRID_STROKE = '#7f7f7f';

/** Fill of a body row: white, so the darker rows stand out against it. */
const BODY_FILL = '#ffffff';

/** Fill of a header row: the darker band that names the columns. */
const HEADER_FILL = '#cfcfcf';

/** Fill of a per-room subtotal row. */
const SUBTOTAL_FILL = '#f0f0f0';

/** Fill of a grand-total row: darker than a subtotal, so the last line is the loudest. */
const TOTAL_FILL = '#dedede';

/** Shown where a record has no value for a column that always has one. */
const ABSENT = '—';

/** Metres are reported to the centimetre, the grid the spec is encoded on. */
const DECIMALS = 2;

/**
 * @typedef {object} Column
 * @property {string} head - Header label.
 * @property {'left' | 'right'} align - Numbers right, words left.
 */

/**
 * @typedef {object} Row
 * @property {string[]} cells - One string per column, in column order.
 * @property {'body' | 'subtotal' | 'total'} kind - Decides fill and font style.
 */

/**
 * @typedef {object} Table
 * @property {string} title - Bold line above the grid.
 * @property {Column[]} columns
 * @property {Row[]} rows
 */

/**
 * The fields of an opening this page reads, from whichever end it arrived.
 *
 * A row is built either from a spec declaration (`PlanPort` or `PlanWindow`) or
 * from the derived twin `walls.mjs` placed on a wall, and those do not share one
 * type: only a window has a sill and a head, only a derived opening carries a
 * matricule and the `alias` flag, and `PlanPort & PlanWindow` is uninhabited
 * because the two `kind` unions do not overlap. Naming the fields that are
 * actually read is what lets one row builder serve both without claiming that a
 * door has a sill.
 *
 * @typedef {object} OpeningLike
 * @property {string} [kind] - `'door'`, `'opening'`, `'air'`, `'pass'`, `'light'`.
 * @property {readonly string[]} [between] - The two space ids it joins.
 * @property {string} [along] - The axis its width runs along.
 * @property {number} [spanMin] - Start along that axis, metres.
 * @property {number} [width] - Clear width, metres.
 * @property {number} [sill] - Windows only: sill above the floor, metres.
 * @property {number} [head] - Windows only: head above the floor, metres.
 * @property {string} [why] - The owner's reason, where one was given.
 * @property {string} [matricule] - Derived openings only.
 * @property {true} [alias] - Derived openings only: the second sighting of one port.
 */

/**
 * Escape a string for an XML attribute value.
 *
 * draw.io keeps a cell's label in the `value` attribute, so a label's line breaks
 * have to survive as the character reference `&#10;` — a literal newline inside an
 * attribute is legal XML but is normalised to a space by the parser, which would
 * silently join two lines of an owner note.
 *
 * @param {unknown} value - Anything; non-strings are stringified first.
 * @returns {string} The escaped text, safe in `"…"`.
 */
function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\n', '&#10;');
}

/**
 * Flatten a cell value onto one line.
 *
 * Every grid row is exactly {@link ROW_HEIGHT} px tall, which is what keeps a
 * 70-row register scannable, so a value arriving with a line break in it — an
 * owner note typed over two lines, a `faces` string composed elsewhere — cannot
 * be drawn as written: draw.io would lay out both lines and clip the second,
 * losing data silently. It is joined into one line instead, which the measured
 * column width then grows to hold. The escaper still emits `&#10;` for a genuine
 * line break, so a caller that one day wants a taller row keeps that door open.
 *
 * @param {unknown} value - Raw cell text.
 * @returns {string} The same text, with every run of whitespace as one space.
 */
function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Width the text needs, in px, measured on its longest line.
 *
 * Only the longest line matters: a cell's box has to hold the widest thing drawn
 * in it, and draw.io breaks a label on its explicit line breaks.
 *
 * @param {string} text - Raw (unescaped) cell text.
 * @returns {number} Width of the longest line, px.
 */
function measureText(text) {
  const lines = String(text ?? '').split('\n');
  return Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH;
}

/**
 * Format a length in metres.
 *
 * @param {unknown} value - A number, or anything else.
 * @returns {string} `'4.00'`, or {@link ABSENT} when the value is not a number.
 */
function metres(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(DECIMALS) : ABSENT;
}

/**
 * Build the id → display-name map of every space in the spec.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @returns {Map<string, string>} Space id to its name.
 */
function buildNameIndex(spec) {
  // The pair is cast to a tuple because `map` alone infers `string[]`, which is
  // not the `[key, value]` shape the `Map` constructor accepts.
  return new Map(spec.ROOMS.map((room) => /** @type {[string, string]} */ ([room.id, room.name])));
}

/**
 * Name a space by id, tolerating ids the spec does not declare.
 *
 * A wall or a window may face something that is not a room — the outside, a side
 * label — so an unknown id is passed through rather than reported as missing.
 *
 * @param {Map<string, string>} names - From {@link buildNameIndex}.
 * @param {unknown} id - Space id, or any other token.
 * @returns {string} The space's name, or the token itself.
 */
function spaceName(names, id) {
  const key = String(id ?? '');
  return names.get(key) ?? key;
}

/**
 * Describe what a wall faces, whatever shape `Wall.faces` takes.
 *
 * The contract names the field but not its type, and `walls.mjs` is written
 * beside this file, so every plausible shape is accepted: a single id, a list of
 * ids, or objects carrying one. Ids that name a space are shown by name, because
 * this column is read by the owner, not by a program.
 *
 * @param {Map<string, string>} names - From {@link buildNameIndex}.
 * @param {unknown} faces - `Wall.faces`.
 * @returns {string} A readable list, or {@link ABSENT}.
 */
function describeFaces(names, faces) {
  if (faces === null || faces === undefined) return ABSENT;
  const list = Array.isArray(faces) ? faces : [faces];
  const parts = list
    .map((face) => {
      if (face === null || face === undefined) return '';
      if (typeof face === 'object') {
        const token = face.name ?? face.id ?? face.kind ?? face.side;
        return token === undefined ? JSON.stringify(face) : spaceName(names, token);
      }
      return spaceName(names, face);
    })
    .filter((part) => part !== '');
  return parts.length === 0 ? ABSENT : parts.join(' · ');
}

/**
 * Describe the run of a wall: the span it covers, and where it sits across it.
 *
 * The span alone does not locate a wall — `x 10.00–14.00` is true of every wall
 * on that stretch of the floor — so the fixed coordinate (`at`, on the other
 * axis) is stated in the same cell. The two together are the wall's position.
 *
 * @param {{ axis?: string, spanMin?: number, spanMax?: number, at?: number }} wall
 * @returns {string} e.g. `'x 10.00–14.00 at z 5.60'`.
 */
function describeRun(wall) {
  const axis = wall.axis === 'x' || wall.axis === 'z' ? wall.axis : '?';
  const span = `${axis} ${metres(wall.spanMin)}–${metres(wall.spanMax)}`;
  if (typeof wall.at !== 'number' || !Number.isFinite(wall.at)) return span;
  const other = axis === 'x' ? 'z' : 'x';
  return `${span} at ${other} ${metres(wall.at)}`;
}

/**
 * Describe the span an opening covers along its own axis.
 *
 * @param {{ along?: string, spanMin?: number, width?: number }} opening
 * @returns {string} e.g. `'x 12.70–13.60'`.
 */
function describeOpeningSpan(opening) {
  const axis = opening.along === 'x' || opening.along === 'z' ? opening.along : '?';
  const { spanMin, width } = opening;
  if (typeof spanMin !== 'number' || typeof width !== 'number') return ABSENT;
  return `${axis} ${metres(spanMin)}–${metres(spanMin + width)}`;
}

/**
 * Identity of an opening, independent of which room's wall carries it.
 *
 * The same door is declared once in the spec and appears on the walls of both
 * rooms it joins, so the pair of ids is sorted: the two copies hash alike and a
 * spec entry finds its derived twin whichever way round it was written.
 *
 * @param {OpeningLike} opening
 * @returns {string} The key.
 */
function openingKey(opening) {
  const between = [...(opening.between ?? [])].map(String).sort().join('|');
  return [
    opening.kind ?? '',
    between,
    opening.along ?? '',
    metres(opening.spanMin),
    metres(opening.width),
  ].join('/');
}

/**
 * Index every derived opening by {@link openingKey}, dropping the aliases.
 *
 * A derived opening flagged `alias` is the second sighting of one port — the copy
 * on the other room's wall — so it is skipped here and never reaches a row: the
 * PORTS and WINDOWS tables are registers of openings, not of wall faces. Each
 * entry keeps every wall the opening was found in, because a port cut through a
 * join genuinely sits in the walls of both rooms and the owner looks for it under
 * either.
 *
 * @param {readonly Wall[]} walls - The derived walls.
 * @returns {Map<string, { matricule: string, walls: string[], opening: OpeningLike }>}
 */
function indexDerivedOpenings(walls) {
  /** @type {Map<string, { matricule: string, walls: string[], opening: OpeningLike }>} */
  const index = new Map();
  for (const wall of walls) {
    for (const opening of wall.openings ?? []) {
      if (opening.alias) continue;
      const key = openingKey(opening);
      const found = index.get(key);
      if (found) {
        if (!found.walls.includes(wall.matricule)) found.walls.push(wall.matricule);
        continue;
      }
      index.set(key, {
        matricule: opening.matricule ?? ABSENT,
        walls: [wall.matricule],
        opening,
      });
    }
  }
  return index;
}

/**
 * The matricule of a room.
 *
 * Taken from the derived walls where possible — a wall matricule is the room's
 * plus a `-W<n>` suffix — so the two tables can never disagree about a room's
 * identifier. Only a room with no wall at all (the stairwell bay, whose joins are
 * all zero-thickness) falls back to composing it from the spec, and then the
 * composition rule lives here in one place.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @param {PlanRoom} room
 * @param {Map<number, string>} prefixes - Room number to matricule, from the walls.
 * @returns {string} e.g. `'F1-R11-KIT'`.
 */
function roomMatricule(spec, room, prefixes) {
  const derived = prefixes.get(room.n);
  if (derived) return derived;
  return `F${spec.FLOOR_NUMBER}-R${String(room.n).padStart(2, '0')}-${room.type}`;
}

/**
 * Map each room number to the room part of its walls' matricules.
 *
 * @param {readonly Wall[]} walls - The derived walls.
 * @returns {Map<number, string>} Room number to room matricule.
 */
function buildRoomPrefixes(walls) {
  /** @type {Map<number, string>} */
  const prefixes = new Map();
  for (const wall of walls) {
    if (prefixes.has(wall.roomN)) continue;
    const prefix = String(wall.matricule ?? '').replace(/-W\d+$/u, '');
    if (prefix !== '') prefixes.set(wall.roomN, prefix);
  }
  return prefixes;
}

/**
 * ROOMS: one row per space, in matricule order.
 *
 * `rects` is a list because a space may be an L or a T, so its size is reported
 * rect by rect and its area is their sum — a single `w × d` would be a lie about
 * the corridor and the guest room.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @param {readonly Wall[]} walls - The derived walls, for the matricules.
 * @returns {Table}
 */
function buildRoomsTable(spec, walls) {
  const prefixes = buildRoomPrefixes(walls);
  // Widened to the interface the spec itself declares. The spec is a deeply frozen
  // `as const` literal, so its 22 rooms are 22 distinct literal types, and `note`
  // — which only some of them carry — is absent from their union.
  /** @type {readonly PlanRoom[]} */
  const rooms = [...spec.ROOMS].sort((a, b) => a.n - b.n);
  const rows = rooms.map((room) => {
    /** @type {readonly PlanRectCoordinates[]} */
    const rects = room.rects ?? [];
    const size = rects
      .map(([minX, maxX, minZ, maxZ]) => `${metres(maxX - minX)} × ${metres(maxZ - minZ)}`)
      .join(' + ');
    const area = rects.reduce((sum, [minX, maxX, minZ, maxZ]) => {
      return sum + (maxX - minX) * (maxZ - minZ);
    }, 0);
    return {
      kind: /** @type {const} */ ('body'),
      cells: [
        roomMatricule(spec, room, prefixes),
        room.name,
        room.kind,
        size === '' ? ABSENT : size,
        metres(area),
        room.note ?? '',
      ],
    };
  });
  return {
    title: `ROOMS — ${rows.length} spaces of floor ${spec.FLOOR_NUMBER}`,
    columns: [
      { head: 'MATRICULE', align: 'left' },
      { head: 'NAME', align: 'left' },
      { head: 'KIND', align: 'left' },
      { head: 'SIZE m', align: 'left' },
      { head: 'AREA m²', align: 'right' },
      { head: 'NOTE', align: 'left' },
    ],
    rows,
  };
}

/**
 * Tolerance for comparing plan coordinates, in metres.
 *
 * The spec is encoded on the centimetre grid, so anything under half a millimetre
 * is floating-point noise from the derivation rather than a gap in a wall.
 */
const COORD_EPSILON = 5e-4;

/**
 * State a wall's thickness, and say so when it is not one number.
 *
 * `thickness` on a derived wall is the THICKEST contact, kept for quantities and
 * takeoff, so printing it alone would claim a uniform wall where there is none:
 * the utility room's west face is 0.30 where it backs the corridor, 0.15 against
 * the main sanitair and 0.20 along the void, and 0.30 is true of its first
 * stretch only. A varying face therefore lists every thickness it is actually
 * built at, in the same qualifier-first shape the ISOLATION column uses for a
 * partial wall, so neither column can be read as a whole-wall number.
 *
 * Every distinct value is named rather than a range: no face carries more than
 * three, and a range would hide the 0.20 stretch that sits between the extremes
 * of that very wall. `varies` decides which rows need it, so a face the
 * derivation calls uniform is still reported as a single number.
 *
 * @param {Wall} wall - The derived wall, with `contacts` and `varies`.
 * @returns {string} `'0.20'`, or `'varies 0.15 · 0.20 · 0.30'`.
 */
function describeThickness(wall) {
  /** @type {readonly Contact[]} */
  const contacts = Array.isArray(wall.contacts) ? wall.contacts : [];
  if (!wall.varies || contacts.length === 0) return metres(wall.thickness);
  const distinct = [...new Set(contacts.map((contact) => metres(contact.thickness)))].sort();
  return `varies ${distinct.join(' · ')}`;
}

/**
 * Length covered by a set of intervals, counting an overlap once.
 *
 * Three rooms backing onto one corridor wall contribute three intervals, and the
 * corridor is insulated over their union — not over their sum, which would claim
 * more heavy wall than exists, and not over the whole run, which would insulate
 * the 0.60 m of corridor the owner deliberately left plain.
 *
 * @param {ReadonlyArray<readonly [number, number]>} intervals - `[from, to]` pairs.
 * @returns {number} Total covered length, metres.
 */
function unionLength(intervals) {
  const sorted = [...intervals].sort((p, q) => p[0] - q[0]);
  let total = 0;
  // The run being merged, held as one pair rather than as two ends that happen to
  // be assigned together. Both ends were only ever set in the same statement, so a
  // half-open run was already impossible; saying so in the type is what makes the
  // closing `to - from` provably a subtraction of two numbers.
  /** @type {[number, number] | null} */
  let run = null;
  for (const [start, end] of sorted) {
    if (run === null || start > run[1] + COORD_EPSILON) {
      if (run !== null) total += run[1] - run[0];
      run = [start, end];
    } else if (end > run[1]) {
      run[1] = end;
    }
  }
  return run === null ? total : total + (run[1] - run[0]);
}

/**
 * How much of each wall is built for isolation.
 *
 * Read from the derivation, not worked out again here. Each wall's `contacts`
 * tile its whole face span and carry the rule behind every stretch, so a stretch
 * counts as heavy when its `reason` is `'isolation'`. That is the same predicate
 * the plan page paints red on, which is the point: the register, the drawing and
 * the checks agree by construction instead of by coincidence.
 *
 * This module used to pair opposite faces itself and union the backing spans. It
 * was right when written and then fell behind the spec twice — a junction rule
 * making a thick corner heavy, and a fix letting isolation reach a weather-exposed
 * far face — and reported 3.90 m less than the drawing. Deriving the same fact
 * twice is what allowed that gap, so the second derivation is gone.
 *
 * A face named in `INSULATED_WALLS` counts entirely, and that half is not
 * redundant: an exterior face's stretches read `'exterior'` however heavily the
 * owner insulated it, so the whole side-C heat boundary carries no `'isolation'`
 * contact at all. Keying on `reason` alone reports 98.80 m against the true
 * 123.35 m — it would quietly call his envelope plain.
 *
 * The quoted length beside each matricule is a tripwire checked by the verifier,
 * so it is not re-derived here; what this needs from an entry is which face it
 * names.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @param {readonly Wall[]} walls - The derived walls.
 * @returns {Map<string, { insulated: number, named: boolean, full: boolean }>}
 */
function buildInsulationIndex(spec, walls) {
  // Widened to `Set<string>`: the owner's list is a frozen literal, so an
  // un-widened set would accept only those exact matricules and never a derived
  // wall's, which is the whole question being asked of it.
  /** @type {Set<string>} */
  const named = new Set((spec.INSULATED_WALLS ?? []).map((entry) => entry.matricule));
  /** @type {Map<string, { insulated: number, named: boolean, full: boolean }>} */
  const index = new Map();
  for (const wall of walls) {
    /** @type {readonly Contact[]} */
    const contacts = Array.isArray(wall.contacts) ? wall.contacts : [];
    /** @type {Span[]} */
    const intervals = named.has(wall.matricule)
      ? [[wall.spanMin, wall.spanMax]]
      : contacts
          .filter((contact) => contact.reason === 'isolation')
          .map((contact) => /** @type {Span} */ ([contact.spanMin, contact.spanMax]));
    const insulated = unionLength(intervals);
    index.set(wall.matricule, {
      insulated,
      named: named.has(wall.matricule),
      full: insulated > COORD_EPSILON && insulated >= (wall.length ?? 0) - COORD_EPSILON,
    });
  }
  return index;
}

/**
 * State one wall's isolation, in a cell that cannot be read as anything else.
 *
 * A bare yes/no would be false on several rows, so a partial wall says so in
 * words and in both numbers — `part 7.80 of 8.40` — and a whole one names its
 * length too, so that no cell means "heavy" without saying how much. A wall with
 * no isolation is blank rather than `no`: the register is a list of what is
 * built, and an empty cell reads as "nothing special here" at a glance.
 *
 * @param {Wall} wall - The derived wall.
 * @param {{ insulated: number, full: boolean } | undefined} entry - Its index row.
 * @returns {string} `'full 5.00'`, `'part 7.80 of 8.40'`, or an empty cell.
 */
function describeIsolation(wall, entry) {
  if (!entry || entry.insulated <= COORD_EPSILON) return '';
  if (entry.full) return `full ${metres(wall.length)}`;
  return `part ${metres(entry.insulated)} of ${metres(wall.length)}`;
}

/**
 * State an insulated total against the length it is measured out of.
 *
 * The share is what the owner asked to see — how much of the floor is being built
 * heavy — and it is given beside both numbers rather than alone, so a room that
 * is 100% insulated over 3.40 m is never confused with the floor's whole budget.
 *
 * @param {number} insulated - Insulated length, metres.
 * @param {number} total - Total wall length it is part of, metres.
 * @returns {string} e.g. `'7.80 of 8.40 heavy (93%)'`, or an empty cell.
 */
function describeIsolationTotal(insulated, total) {
  if (insulated <= COORD_EPSILON) return '';
  const share = total > COORD_EPSILON ? Math.round((insulated / total) * 100) : 0;
  return `${metres(insulated)} of ${metres(total)} heavy (${share}%)`;
}

/**
 * WALLS: the owner's wall register — every derived wall, room by room, and how
 * much of each one is built heavy.
 *
 * Nothing is filtered, not even a zero-thickness join: the register answers "what
 * did the derivation make of my plan", and a wall missing from it cannot be
 * questioned. Each room closes with the sum of its wall lengths and the table
 * with the sum of those, so a run that grew or vanished between two revisions
 * shows up as a changed number rather than as a row to be hunted for.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @param {readonly Wall[]} walls - The derived walls.
 * @returns {Table}
 */
function buildWallsTable(spec, walls) {
  const names = buildNameIndex(spec);
  const insulation = buildInsulationIndex(spec, walls);
  const ordered = [...walls].sort((a, b) => a.roomN - b.roomN || a.wallN - b.wallN);
  /** @type {Row[]} */
  const rows = [];
  let runningLength = 0;
  let runningInsulated = 0;
  let groupLength = 0;
  let groupInsulated = 0;
  let groupCount = 0;
  /** @type {string | null} */
  let groupRoom = null;

  /** Close the room being listed with its subtotal row. */
  const flush = () => {
    if (groupRoom === null) return;
    rows.push({
      kind: 'subtotal',
      cells: [
        '',
        `subtotal — ${groupRoom}`,
        '',
        `${groupCount} wall${groupCount === 1 ? '' : 's'}`,
        metres(groupLength),
        describeIsolationTotal(groupInsulated, groupLength),
        '',
        '',
      ],
    });
    groupLength = 0;
    groupInsulated = 0;
    groupCount = 0;
  };

  for (const wall of ordered) {
    const room = spaceName(names, wall.roomId);
    if (room !== groupRoom) {
      flush();
      groupRoom = room;
    }
    const length = typeof wall.length === 'number' ? wall.length : 0;
    const isolation = insulation.get(wall.matricule);
    runningLength += length;
    groupLength += length;
    runningInsulated += isolation?.insulated ?? 0;
    groupInsulated += isolation?.insulated ?? 0;
    groupCount += 1;
    rows.push({
      kind: 'body',
      cells: [
        wall.matricule ?? ABSENT,
        room,
        wall.side ?? ABSENT,
        describeRun(wall),
        metres(wall.length),
        describeIsolation(wall, isolation),
        describeThickness(wall),
        describeFaces(names, wall.faces),
      ],
    });
  }
  flush();
  rows.push({
    kind: 'total',
    cells: [
      '',
      'TOTAL — every wall',
      '',
      `${ordered.length} wall${ordered.length === 1 ? '' : 's'}`,
      metres(runningLength),
      describeIsolationTotal(runningInsulated, runningLength),
      '',
      '',
    ],
  });

  return {
    title: `WALLS — ${ordered.length} derived walls, the wall register`,
    columns: [
      { head: 'MATRICULE', align: 'left' },
      { head: 'ROOM', align: 'left' },
      { head: 'SIDE', align: 'left' },
      { head: 'RUNS', align: 'left' },
      { head: 'LENGTH m', align: 'right' },
      { head: 'ISOLATION', align: 'left' },
      { head: 'THICK m', align: 'left' },
      { head: 'FACES', align: 'left' },
    ],
    rows,
  };
}

/**
 * One row of an opening table, joining a spec entry to its derived twin.
 *
 * @param {Map<string, string>} names - From {@link buildNameIndex}.
 * @param {OpeningLike} opening - The spec entry (or an unmatched derived opening).
 * @param {{ matricule: string, walls: string[] } | undefined} derived
 * @param {boolean} withHeights - WINDOWS also report sill → head.
 * @returns {Row}
 */
function buildOpeningRow(names, opening, derived, withHeights) {
  const [from, to] = opening.between ?? [];
  const cells = [
    derived?.matricule ?? ABSENT,
    `${spaceName(names, from)} ↔ ${spaceName(names, to)}`,
    opening.kind ?? ABSENT,
    derived?.walls.join(' · ') ?? ABSENT,
    describeOpeningSpan(opening),
    metres(opening.width),
  ];
  if (withHeights) cells.push(`${metres(opening.sill)} → ${metres(opening.head)}`);
  cells.push(opening.why ?? '');
  return { kind: 'body', cells };
}

/**
 * Rows for one family of openings: the spec's own entries first, in spec order,
 * then any derived opening the spec does not account for.
 *
 * Spec order is kept because that is the order the owner agreed them in. An entry
 * flagged `alias` is a second name for a port already listed and is skipped. A
 * derived opening with no spec entry should not exist; it is listed last, marked,
 * rather than dropped, because a page that hides a disagreement between the spec
 * and the derivation is worse than a page that shows one.
 *
 * @param {Map<string, string>} names - From {@link buildNameIndex}.
 * @param {readonly OpeningLike[]} declared - `spec.PORTS` or `spec.WINDOWS`.
 * @param {Map<string, { matricule: string, walls: string[], opening: OpeningLike }>} index
 * @param {(kind: string | undefined) => boolean} belongs - Whether a derived kind is this family's.
 * @param {boolean} withHeights - WINDOWS also report sill → head.
 * @returns {Row[]}
 */
function buildOpeningRows(names, declared, index, belongs, withHeights) {
  const claimed = new Set();
  /** @type {Row[]} */
  const rows = [];
  for (const opening of declared) {
    if (opening.alias) continue;
    const key = openingKey(opening);
    claimed.add(key);
    rows.push(buildOpeningRow(names, opening, index.get(key), withHeights));
  }
  for (const [key, entry] of index) {
    if (claimed.has(key) || !belongs(entry.opening.kind)) continue;
    const row = buildOpeningRow(names, entry.opening, entry, withHeights);
    const why = row.cells[row.cells.length - 1];
    row.cells[row.cells.length - 1] = why === '' ? '(derived, not declared)' : `${why} (derived)`;
    rows.push(row);
  }
  return rows;
}

/**
 * PORTS: the doors and the one leafless opening, with the reason where given.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @param {Map<string, { matricule: string, walls: string[], opening: OpeningLike }>} index
 * @returns {Table}
 */
function buildPortsTable(spec, index) {
  const names = buildNameIndex(spec);
  /** @type {(kind: string | undefined) => boolean} */
  const isPort = (kind) => kind === 'door' || kind === 'opening';
  const rows = buildOpeningRows(names, spec.PORTS, index, isPort, false);
  return {
    title: `PORTS — ${rows.length} doors and openings`,
    columns: [
      { head: 'MATRICULE', align: 'left' },
      { head: 'JOINS', align: 'left' },
      { head: 'KIND', align: 'left' },
      { head: 'IN WALL', align: 'left' },
      { head: 'SPAN', align: 'left' },
      { head: 'CLEAR m', align: 'right' },
      { head: 'WHY', align: 'left' },
    ],
    rows,
  };
}

/**
 * WINDOWS: every declared window, with its sill and head.
 *
 * The sill and head are the whole point of a window here — the owner's kinds are
 * `air` (above eye level), `pass` (counter height) and `light` (hand level) — so
 * they get a column of their own rather than hiding in the `why`.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @param {Map<string, { matricule: string, walls: string[], opening: OpeningLike }>} index
 * @returns {Table}
 */
function buildWindowsTable(spec, index) {
  const names = buildNameIndex(spec);
  /** @type {(kind: string | undefined) => boolean} */
  const isWindow = (kind) => kind === 'air' || kind === 'pass' || kind === 'light';
  const rows = buildOpeningRows(names, spec.WINDOWS, index, isWindow, true);
  return {
    title: `WINDOWS — ${rows.length} openings, by kind: air · pass · light`,
    columns: [
      { head: 'MATRICULE', align: 'left' },
      { head: 'JOINS', align: 'left' },
      { head: 'KIND', align: 'left' },
      { head: 'IN WALL', align: 'left' },
      { head: 'SPAN', align: 'left' },
      { head: 'WIDTH m', align: 'right' },
      { head: 'SILL → HEAD m', align: 'left' },
      { head: 'WHY', align: 'left' },
    ],
    rows,
  };
}

/**
 * Describe the rectangle a fixture occupies, in the form the wall runs use.
 *
 * A fixture is a footprint, not a run, so both spans are stated: the reader
 * locates it the same way they locate a wall, by reading a coordinate off each
 * axis, without having to learn a second notation for the same kind of fact.
 *
 * @param {readonly number[]} rect - `[minX, maxX, minZ, maxZ]`, metres.
 * @returns {string} e.g. `'x 19.40–20.10 · z 5.70–6.15'`.
 */
function describeRect(rect) {
  if (!Array.isArray(rect) || rect.length < 4) return ABSENT;
  const [minX, maxX, minZ, maxZ] = rect;
  return `x ${metres(minX)}–${metres(maxX)} · z ${metres(minZ)}–${metres(maxZ)}`;
}

/**
 * What is printed for a kind the spec's role record does not classify.
 *
 * `FIXTURE_ROLES` is declared `satisfies Record<PlanFixtureKind, PlanFixtureRole>`,
 * so a kind that is in the union and missing from the record fails the build
 * before it reaches this page: the only way to arrive here is a `kind` that is
 * not in the union at all, which is a fact about the data and not a gap in the
 * classification. Saying so is the conservative answer. This page used to
 * default an unknown kind to `fitting`, which read as a plumbed-in fixture the
 * owner could check off his list — a guess presented as an answer, and the one
 * direction it is not safe to be wrong in.
 */
const ROLE_UNCLASSIFIED = 'unclassified';

/**
 * Index of the ROLE cell in a fixture row.
 *
 * {@link summariseFixtures} counts the roles, and a role is now one of four
 * words rather than one of two, so searching the whole row for a known string
 * would miscount the moment a note or a room name happened to contain one of
 * them. The column is named once, here, next to the row that is built with it.
 */
const ROLE_COLUMN = 3;

/**
 * What a fixture is FOR, read from the spec rather than decided here.
 *
 * The roles — `fitting`, `appliance`, `furniture`, `services` — are the owner's
 * distinction between what is plumbed into the building, what is delivered and
 * connected, what he may rearrange the day he moves in, and what belongs to the
 * building's own services. That is a fact about the kind, so it lives beside the
 * kinds in `plan.ts` as a total record, and this page looks the answer up
 * instead of holding a second, partial opinion about it.
 *
 * The role is presentational only: it touches neither the ordering nor the
 * number. Both are shared with the plan page, which sorts every fixture of a
 * room together, so grouping the rows by role here would renumber them and make
 * the two pages disagree about what `F1-R10-BTH-X3` names.
 *
 * @param {PlanSpec} spec - The plan namespace, for its `FIXTURE_ROLES`.
 * @param {string} kind - A fixture's `kind`; every declared fixture carries one.
 * @returns {string} The spec's role for that kind, or {@link ROLE_UNCLASSIFIED}.
 */
function fixtureRole(spec, kind) {
  /** @type {Readonly<Record<string, string>>} */
  const roles = spec.FIXTURE_ROLES;
  return roles[kind] ?? ROLE_UNCLASSIFIED;
}

/**
 * Count the fixture rows for the table's title, by role.
 *
 * The title is the line a reader trusts to say what the table contains, so it is
 * counted from the rendered rows rather than written down. It is counted BY ROLE
 * because at forty-odd entries "42 fittings" would be false as well as useless:
 * four of them are plumbed in, the rest are machines and furniture, and the
 * owner reads the register to check what he asked for room by room.
 *
 * The rows are searched for the role text rather than indexed by column number,
 * so inserting a column cannot silently turn this count into nonsense; no other
 * column can hold that text.
 *
 * @param {Row[]} rows - The fixture rows, already built.
 * @returns {string} e.g. `'42 entries: 5 fittings, 6 appliances, 30 furniture, 1 services'`.
 */
function summariseFixtures(rows) {
  const body = rows.filter((row) => row.kind === 'body');
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const row of body) {
    const role = row.cells[ROLE_COLUMN] ?? ROLE_UNCLASSIFIED;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  /**
   * The plural of a role. `furniture` is a mass noun and `services` is already
   * plural, so the rule cannot be "add an s" — and a title reading
   * "24 furnitures" is the kind of small wrongness that makes a reader distrust
   * the numbers beside it.
   *
   * @type {(count: number, noun: string) => string}
   */
  const plural = (count, noun) =>
    `${count} ${count === 1 || noun.endsWith('s') || noun === 'furniture' ? noun : `${noun}s`}`;
  const split = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([role, count]) => plural(count, role));
  if (split.length <= 1) return plural(body.length, split[0] ?? 'entry');
  return `${body.length} entries: ${split.join(', ')}`;
}

/**
 * FIXTURES: what stands in the rooms — the sanitary ware, the appliances and the
 * furniture the owner listed room by room.
 *
 * Numbered per room with the tag `X`, in `compareFixturePosition` order — the
 * spec's own comparator, because the number it decides is part of a matricule
 * and therefore part of the plan's identity scheme, not a presentation choice
 * this page is free to make. It is on the room
 * matricule the other tables already use: `F1-R13-BTH-X1`. The room part is taken
 * from the derived walls exactly as {@link buildRoomsTable} takes it, so a room
 * cannot be `R13` in one table and `R13` in another by coincidence rather than by
 * construction. Rooms are listed in room-number order; a fixture in a room the
 * spec does not declare keeps its raw room id rather than vanishing.
 *
 * @param {PlanSpec} spec - The plan namespace.
 * @param {readonly Wall[]} walls - The derived walls, for the room matricules.
 * @returns {Table}
 */
function buildFixturesTable(spec, walls) {
  const names = buildNameIndex(spec);
  const prefixes = buildRoomPrefixes(walls);
  const roomsById = new Map(
    spec.ROOMS.map((room) => /** @type {[string, PlanRoom]} */ ([room.id, room])),
  );

  /** @type {Map<string, PlanFixture[]>} */
  const byRoom = new Map();
  for (const fixture of spec.FIXTURES ?? []) {
    const list = byRoom.get(fixture.room);
    if (list) list.push(fixture);
    else byRoom.set(fixture.room, [fixture]);
  }

  const ordered = [...byRoom.entries()].sort((a, b) => {
    return (
      (roomsById.get(a[0])?.n ?? Number.MAX_SAFE_INTEGER) -
      (roomsById.get(b[0])?.n ?? Number.MAX_SAFE_INTEGER)
    );
  });

  /** @type {Row[]} */
  const rows = [];
  /** @type {string[]} */
  const kinds = [];
  for (const [roomId, list] of ordered) {
    const room = roomsById.get(roomId);
    const prefix = room ? roomMatricule(spec, room, prefixes) : roomId;
    let roomArea = 0;
    [...list].sort(spec.compareFixturePosition).forEach((fixture, index) => {
      if (!kinds.includes(fixture.kind)) kinds.push(fixture.kind);
      // Read through a plain list of numbers, the shape {@link describeRect} also
      // takes, so the defensive `?? []` survives typing: the union of the tuple
      // and the empty array would make every coordinate optional, and `hasRect`
      // cannot clear an optional the other two coordinates never mention.
      /** @type {readonly number[]} */
      const rect = fixture.rect ?? [];
      const [minX, maxX, minZ, maxZ] = rect;
      const hasRect = typeof minX === 'number' && typeof minZ === 'number';
      const area = hasRect ? (maxX - minX) * (maxZ - minZ) : 0;
      roomArea += area;
      rows.push({
        kind: 'body',
        cells: [
          `${prefix}-X${index + 1}`,
          spaceName(names, roomId),
          fixture.kind ?? ABSENT,
          fixtureRole(spec, fixture.kind),
          describeRect(fixture.rect),
          hasRect ? `${metres(maxX - minX)} × ${metres(maxZ - minZ)}` : ABSENT,
          hasRect ? metres(area) : ABSENT,
          fixture.note ?? '',
        ],
      });
    });
    // Each room closes with what is standing in it, the way the walls table
    // closes each room with its wall length. At forty-odd rows the register is
    // read a room at a time, and the question asked of a room is how much of its
    // floor is under something — which no individual row answers.
    rows.push({
      kind: 'subtotal',
      cells: [
        '',
        `subtotal — ${spaceName(names, roomId)}`,
        `${list.length} fixture${list.length === 1 ? '' : 's'}`,
        '',
        '',
        '',
        metres(roomArea),
        '',
      ],
    });
  }

  return {
    title: `FIXTURES — ${summariseFixtures(rows)}, by kind: ${kinds.join(' · ')}`,
    columns: [
      { head: 'MATRICULE', align: 'left' },
      { head: 'ROOM', align: 'left' },
      { head: 'KIND', align: 'left' },
      { head: 'ROLE', align: 'left' },
      { head: 'OCCUPIES', align: 'left' },
      { head: 'SIZE m', align: 'left' },
      { head: 'AREA m²', align: 'right' },
      { head: 'NOTE', align: 'left' },
    ],
    rows,
  };
}

/**
 * The draw.io style of one grid cell.
 *
 * `overflow=hidden` is deliberate: it makes a label that does not fit clip at the
 * cell edge instead of spilling over its neighbours, so a measurement mistake
 * shows up as a truncated word in one cell rather than as two overlapping rows.
 *
 * @param {{ fill: string, bold?: boolean, italic?: boolean, align: 'left' | 'right' }} options
 * @returns {string} The style string.
 */
function cellStyle({ fill, bold = false, italic = false, align }) {
  const fontStyle = (bold ? 1 : 0) + (italic ? 2 : 0);
  const spacingLeft = align === 'left' ? PADDING : 0;
  const spacingRight = align === 'right' ? PADDING : 0;
  return [
    'rounded=0',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${GRID_STROKE}`,
    `fontSize=${FONT_SIZE}`,
    `fontStyle=${fontStyle}`,
    `align=${align}`,
    'verticalAlign=middle',
    `spacingLeft=${spacingLeft}`,
    `spacingRight=${spacingRight}`,
    'spacingTop=0',
    'spacingBottom=0',
    'overflow=hidden',
    '',
  ].join(';');
}

/** The draw.io style of a table title: bold, no box. */
const TITLE_STYLE = `text;html=1;align=left;verticalAlign=middle;fontSize=${TITLE_FONT_SIZE};fontStyle=1;`;

/**
 * One `mxCell` rect carrying a label.
 *
 * @param {{ id: string, value: string, style: string, x: number, y: number,
 *           width: number, height: number }} cell
 * @returns {string} The XML of the cell.
 */
function renderCell({ id, value, style, x, y, width, height }) {
  return (
    `<mxCell id="${escapeXml(id)}" value="${escapeXml(value)}" ` +
    `style="${escapeXml(style)}" vertex="1" parent="1">` +
    `<mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/>` +
    '</mxCell>'
  );
}

/**
 * Fill and font of a row kind: a subtotal is quiet and italic, a grand total
 * loud and bold, so the eye finds the arithmetic without reading it.
 *
 * @param {'body' | 'subtotal' | 'total'} kind
 * @returns {{ fill: string, bold: boolean, italic: boolean }}
 */
function rowAppearance(kind) {
  if (kind === 'subtotal') return { fill: SUBTOTAL_FILL, bold: false, italic: true };
  if (kind === 'total') return { fill: TOTAL_FILL, bold: true, italic: false };
  return { fill: BODY_FILL, bold: false, italic: false };
}

/**
 * Place one table at (x, y) and emit its cells.
 *
 * Column widths are measured over the header and every row of that column, so a
 * column is exactly as wide as its widest content plus padding, and the table is
 * as wide as its columns. The title may be longer than the grid — a narrow table
 * with a long title — so the reported width is the wider of the two: the page
 * that follows must contain both.
 *
 * @param {Table} table
 * @param {number} x - Left edge, px.
 * @param {number} y - Top edge, px.
 * @param {() => string} nextId - Deterministic id source.
 * @returns {{ xml: string[], width: number, height: number }}
 */
function layoutTable(table, x, y, nextId) {
  // Flattened once, here, so that what is measured is exactly what is drawn.
  const title = oneLine(table.title);
  const rows = table.rows.map((row) => ({ ...row, cells: row.cells.map(oneLine) }));

  const widths = table.columns.map((column, index) => {
    const longest = rows.reduce(
      (widest, row) => Math.max(widest, measureText(row.cells[index] ?? '')),
      measureText(column.head),
    );
    return Math.ceil(longest + PADDING * 2);
  });
  const gridWidth = widths.reduce((sum, width) => sum + width, 0);
  const titleWidth = Math.ceil(measureText(title) * (TITLE_FONT_SIZE / FONT_SIZE)) + PADDING;
  const width = Math.max(gridWidth, titleWidth);

  /** @type {string[]} */
  const xml = [];
  xml.push(
    renderCell({
      id: nextId(),
      value: title,
      style: TITLE_STYLE,
      x,
      y,
      width,
      height: TITLE_HEIGHT,
    }),
  );

  /**
   * Left edge of each column, px, accumulated once and reused per row.
   *
   * @type {number[]}
   */
  const offsets = [];
  let offset = x;
  for (const columnWidth of widths) {
    offsets.push(offset);
    offset += columnWidth;
  }

  let rowY = y + TITLE_HEIGHT + TITLE_GAP;
  table.columns.forEach((column, index) => {
    xml.push(
      renderCell({
        id: nextId(),
        value: column.head,
        style: cellStyle({ fill: HEADER_FILL, bold: true, align: column.align }),
        x: offsets[index],
        y: rowY,
        width: widths[index],
        height: HEADER_ROW_HEIGHT,
      }),
    );
  });
  rowY += HEADER_ROW_HEIGHT;

  for (const row of rows) {
    const appearance = rowAppearance(row.kind);
    table.columns.forEach((column, index) => {
      xml.push(
        renderCell({
          id: nextId(),
          value: row.cells[index] ?? '',
          style: cellStyle({ ...appearance, align: column.align }),
          x: offsets[index],
          y: rowY,
          width: widths[index],
          height: ROW_HEIGHT,
        }),
      );
    });
    rowY += ROW_HEIGHT;
  }

  return { xml, width, height: rowY - y };
}

/**
 * Render the reference-table page of the source-of-truth document.
 *
 * The five tables are stacked down one page in the order a revision is read in:
 * what the spaces are (ROOMS), what the derivation made of them (WALLS), how they
 * are entered (PORTS), how they are aired and lit (WINDOWS) and what stands in
 * them (FIXTURES). Each table starts
 * below the previous one's real height, and the page is sized to the widest of
 * them, so adding a room or rewording a note never pushes a table off the page.
 *
 * @param {object} args
 * @param {PlanSpec} args.spec - Module namespace of `sourceOfTruth/plan.ts`.
 * @param {readonly Wall[]} args.walls - `deriveWalls(spec)`, per that file's contract.
 * @returns {string} `<mxGraphModel>…</mxGraphModel>`, one draw.io page.
 */
export function renderTablePage({ spec, walls }) {
  const derivedOpenings = indexDerivedOpenings(walls);
  const tables = [
    buildRoomsTable(spec, walls),
    buildWallsTable(spec, walls),
    buildPortsTable(spec, derivedOpenings),
    buildWindowsTable(spec, derivedOpenings),
    buildFixturesTable(spec, walls),
  ];

  const nextId = createIdFactory();
  /** @type {string[]} */
  const cells = [];
  let y = PAGE_MARGIN;
  let widest = 0;
  for (const table of tables) {
    const placed = layoutTable(table, PAGE_MARGIN, y, nextId);
    cells.push(...placed.xml);
    widest = Math.max(widest, placed.width);
    y += placed.height + TABLE_GAP;
  }

  const pageWidth = widest + PAGE_MARGIN * 2;
  const pageHeight = y - TABLE_GAP + PAGE_MARGIN;
  return (
    '<mxGraphModel dx="800" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" ' +
    'connect="0" arrows="0" fold="1" page="1" pageScale="1" ' +
    `pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">` +
    '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    cells.join('') +
    '</root></mxGraphModel>'
  );
}

/**
 * A source of deterministic cell ids.
 *
 * draw.io needs every cell id in a page to be unique, and a regenerated page must
 * diff against the last one, so the ids are a plain counter rather than the random
 * strings the editor itself writes: the same data renders the same page, byte for
 * byte. `0` and `1` are draw.io's own root and default layer, so the prefix keeps
 * these out of their way.
 *
 * @returns {() => string} Returns `'tbl-1'`, `'tbl-2'`, … on each call.
 */
function createIdFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `tbl-${counter}`;
  };
}
