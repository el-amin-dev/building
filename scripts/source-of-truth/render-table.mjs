/**
 * Reference-table page of the source-of-truth drawing.
 *
 * The plan page shows the floor; it cannot also carry the numbers. Every room's
 * matricule, every derived wall with its run and its length, and every port and
 * window with its span, its clear width and the owner's reason for it, are what
 * the owner actually checks a revision against — so they get their own page,
 * beside the plan, as five tables: ROOMS, WALLS, PORTS, WINDOWS, FIXTURES.
 *
 * This module consumes the contract of `plan-v2.mjs`, nothing else:
 *
 *   renderTablePage({ spec, walls }) -> '<mxGraphModel>…</mxGraphModel>'
 *
 * `spec` is the module namespace of `plan-v2.mjs` and `walls` the array
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
 * @param {{ ROOMS: readonly object[] }} spec - The plan-v2 namespace.
 * @returns {Map<string, string>} Space id to its name.
 */
function buildNameIndex(spec) {
  return new Map(spec.ROOMS.map((room) => [room.id, room.name]));
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
 * @param {{ kind?: string, between?: readonly string[], along?: string,
 *           spanMin?: number, width?: number }} opening
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
 * @param {readonly object[]} walls - The derived walls.
 * @returns {Map<string, { matricule: string, walls: string[], opening: object }>}
 */
function indexDerivedOpenings(walls) {
  /** @type {Map<string, { matricule: string, walls: string[], opening: object }>} */
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
 * @param {{ FLOOR_NUMBER: number }} spec - The plan-v2 namespace.
 * @param {{ n: number, type: string }} room
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
 * @param {readonly object[]} walls - The derived walls.
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
 * @param {object} spec - The plan-v2 namespace.
 * @param {readonly object[]} walls - The derived walls, for the matricules.
 * @returns {Table}
 */
function buildRoomsTable(spec, walls) {
  const prefixes = buildRoomPrefixes(walls);
  const rooms = [...spec.ROOMS].sort((a, b) => a.n - b.n);
  const rows = rooms.map((room) => {
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
 * WALLS: the owner's wall register — every derived wall, room by room.
 *
 * Nothing is filtered, not even a zero-thickness join: the register answers "what
 * did the derivation make of my plan", and a wall missing from it cannot be
 * questioned. Each room closes with the sum of its wall lengths and the table
 * with the sum of those, so a run that grew or vanished between two revisions
 * shows up as a changed number rather than as a row to be hunted for.
 *
 * @param {object} spec - The plan-v2 namespace.
 * @param {readonly object[]} walls - The derived walls.
 * @returns {Table}
 */
function buildWallsTable(spec, walls) {
  const names = buildNameIndex(spec);
  const ordered = [...walls].sort((a, b) => a.roomN - b.roomN || a.wallN - b.wallN);
  /** @type {Row[]} */
  const rows = [];
  let runningLength = 0;
  let groupLength = 0;
  let groupCount = 0;
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
        '',
        '',
      ],
    });
    groupLength = 0;
    groupCount = 0;
  };

  for (const wall of ordered) {
    const room = spaceName(names, wall.roomId);
    if (room !== groupRoom) {
      flush();
      groupRoom = room;
    }
    const length = typeof wall.length === 'number' ? wall.length : 0;
    runningLength += length;
    groupLength += length;
    groupCount += 1;
    rows.push({
      kind: 'body',
      cells: [
        wall.matricule ?? ABSENT,
        room,
        wall.side ?? ABSENT,
        describeRun(wall),
        metres(wall.length),
        metres(wall.thickness),
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
      { head: 'THICK m', align: 'right' },
      { head: 'FACES', align: 'left' },
    ],
    rows,
  };
}

/**
 * One row of an opening table, joining a spec entry to its derived twin.
 *
 * @param {Map<string, string>} names - From {@link buildNameIndex}.
 * @param {object} opening - The spec entry (or an unmatched derived opening).
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
 * @param {readonly object[]} declared - `spec.PORTS` or `spec.WINDOWS`.
 * @param {Map<string, { matricule: string, walls: string[], opening: object }>} index
 * @param {(kind: unknown) => boolean} belongs - Whether a derived kind is this family's.
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
 * @param {object} spec - The plan-v2 namespace.
 * @param {Map<string, { matricule: string, walls: string[], opening: object }>} index
 * @returns {Table}
 */
function buildPortsTable(spec, index) {
  const names = buildNameIndex(spec);
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
 * @param {object} spec - The plan-v2 namespace.
 * @param {Map<string, { matricule: string, walls: string[], opening: object }>} index
 * @returns {Table}
 */
function buildWindowsTable(spec, index) {
  const names = buildNameIndex(spec);
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
 * Position order of two fixtures in the same room: plan reading order.
 *
 * A fixture's number is part of its matricule, so this comparator decides what
 * `F1-R13-BTH-X1` names — and the plan page must reach the same answer, or the
 * two pages disagree about which fitting is which while both look correct. The
 * rule is therefore fixed here, in one place, and justified rather than assumed:
 * north strip first (`minZ`, since z runs C→B), then west to east (`minX`), which
 * is how the drawing is read.
 *
 * It is not an arbitrary pick between that and `minX`-first. Sorting the main
 * sanitair this way yields sink, shower, bath, and the guest sanitair sink, bath
 * — exactly the owner's own recorded notation for the two rooms,
 * `[open sink [shower][bath]]` and `[open sink [bath]]` (ADR-006, TASKS §Part 1).
 * Sorting by `minX` first yields bath, sink, shower, which matches nothing the
 * owner ever said, and declaration order swaps the shower and the bath. The
 * ordering that reproduces the owner's description is the one that is right.
 *
 * @param {{ rect: readonly number[] }} a
 * @param {{ rect: readonly number[] }} b
 * @returns {number} Negative when `a` is read first.
 */
function byPosition(a, b) {
  return a.rect[2] - b.rect[2] || a.rect[0] - b.rect[0];
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
 * Fixture kinds that are a screen wall inside a room rather than a fitting.
 *
 * Conservative on purpose: a kind that is not listed here is reported as a
 * fitting, so a structural kind added to the spec later shows up as a fitting
 * until it is named here. That is the safe direction to be wrong in — a screen
 * miscounted as a basin is a visible oddity in a six-row table, whereas a basin
 * miscounted as a screen would quietly understate what the owner asked for.
 */
const SCREEN_WALL_KINDS = Object.freeze(['partition']);

/** Role of a fixture that divides space rather than being used. */
const ROLE_SCREEN = 'screen wall';

/** Role of an ordinary fitting: something installed to be used. */
const ROLE_FITTING = 'fitting';

/**
 * Whether a fixture is a screen wall or a fitting.
 *
 * The owner reads this register to check the fittings they asked for, and a
 * T-shaped screen is not one: it is a piece of wall inside a room, held in
 * `FIXTURES` because that is where its rectangle lives, not because it is a
 * basin. Saying so in its own column is what keeps the table honest.
 *
 * The distinction is deliberately presentational, and touches neither the
 * ordering nor the number. Both are shared with the plan page, which sorts every
 * fixture of a room together (`fixturesByRoom`, `render-plan.mjs`), so pulling
 * the screens out into their own block here would renumber the fittings and make
 * the two pages disagree about what `F1-R10-BTH-X3` names. The consequence is
 * that the two rects of one screen can be numbered apart, interleaved with the
 * fittings they enclose; this column is precisely what stops that reading as a
 * mistake.
 *
 * @param {unknown} kind - A fixture's `kind`.
 * @returns {string} {@link ROLE_SCREEN} or {@link ROLE_FITTING}.
 */
function fixtureRole(kind) {
  return SCREEN_WALL_KINDS.includes(kind) ? ROLE_SCREEN : ROLE_FITTING;
}

/**
 * Count the fixture rows for the table's title.
 *
 * The title is the line a reader trusts to say what the table contains, so it is
 * counted from the rendered rows rather than written down: while every row is a
 * fitting it says so, and as soon as the spec holds something that is not one it
 * reports the split instead of quietly calling a screen wall a fitting.
 *
 * The rows are searched for the role text rather than indexed by column number,
 * so inserting a column cannot silently turn this count into nonsense; no other
 * column can hold that text.
 *
 * @param {Row[]} rows - The fixture rows, already built.
 * @returns {string} e.g. `'9 entries: 7 fittings and 2 screen walls'`.
 */
function summariseFixtures(rows) {
  const screens = rows.filter((row) => row.cells.includes(ROLE_SCREEN)).length;
  const fittings = rows.length - screens;
  const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  if (screens === 0) return plural(rows.length, 'fitting');
  const entries = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
  return `${entries}: ${plural(fittings, 'fitting')} and ${plural(screens, 'screen wall')}`;
}

/**
 * FIXTURES: what stands in the rooms — the fittings, the television, and the
 * screen walls that divide a room without reaching the ceiling.
 *
 * Numbered per room with the tag `X`, in {@link byPosition} order, on the room
 * matricule the other tables already use: `F1-R13-BTH-X1`. The room part is taken
 * from the derived walls exactly as {@link buildRoomsTable} takes it, so a room
 * cannot be `R13` in one table and `R13` in another by coincidence rather than by
 * construction. Rooms are listed in room-number order; a fixture in a room the
 * spec does not declare keeps its raw room id rather than vanishing.
 *
 * @param {object} spec - The plan-v2 namespace.
 * @param {readonly object[]} walls - The derived walls, for the room matricules.
 * @returns {Table}
 */
function buildFixturesTable(spec, walls) {
  const names = buildNameIndex(spec);
  const prefixes = buildRoomPrefixes(walls);
  const roomsById = new Map(spec.ROOMS.map((room) => [room.id, room]));

  /** @type {Map<string, object[]>} */
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
    [...list].sort(byPosition).forEach((fixture, index) => {
      if (!kinds.includes(fixture.kind)) kinds.push(fixture.kind);
      const [minX, maxX, minZ, maxZ] = fixture.rect ?? [];
      const hasRect = typeof minX === 'number' && typeof minZ === 'number';
      rows.push({
        kind: 'body',
        cells: [
          `${prefix}-X${index + 1}`,
          spaceName(names, roomId),
          fixture.kind ?? ABSENT,
          fixtureRole(fixture.kind),
          describeRect(fixture.rect),
          hasRect ? `${metres(maxX - minX)} × ${metres(maxZ - minZ)}` : ABSENT,
          hasRect ? metres((maxX - minX) * (maxZ - minZ)) : ABSENT,
        ],
      });
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

  /** Left edge of each column, px, accumulated once and reused per row. */
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
 * @param {object} args.spec - Module namespace of `plan-v2.mjs`.
 * @param {readonly object[]} args.walls - `deriveWalls(spec)`, per that file's contract.
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
