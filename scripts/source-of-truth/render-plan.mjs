/**
 * Render the floor plan of `plan-v2.mjs` as one draw.io page.
 *
 * This is the drawing half of the source of truth: `plan-v2.mjs` holds the
 * geometry, `walls.mjs` derives the wall and opening matricules from it, and
 * this module turns both into the `<mxGraphModel>` XML of the plan page. It
 * computes no geometry of its own beyond pixels — every length it prints comes
 * from the spec or from a derived wall — so the drawing cannot drift from the
 * data.
 *
 * ## Scale and placement
 *
 * 60 px = 1 m ({@link SCALE}), with the plan origin (the outer corner of sides A
 * and C) at page (140, 80), the corner the owner's hand-drawn page used:
 *
 *     px = 140 + 60·x      py = 80 + 60·z
 *
 * The 22.50 × 10.00 plot is therefore 1350 × 600 px at (140, 80). The origin is
 * kept, the scale is not: at the owner's 30 px = 1 m there was more label than
 * there was wall to put it on, so a regenerated page no longer overlays the old
 * one — it is twice the size. See {@link SCALE}.
 *
 * ## Why the labels are packed rather than centred
 *
 * The owner asked for *every* wall to be labelled with its matricule and its
 * length; ports and windows carry their matricule alone, and a fixture its
 * matricule and its kind, since a small rectangle does not otherwise say whether
 * it is a sink or a shower. A screen of kind `partition` is the exception: it is
 * drawn as fabric and carries no label. Even so a label is usually wider than
 * the opening it names, so labels cannot simply sit inside the thing they name.
 * What saves it is that rooms are drawn as *clear* rectangles: the 12 px and
 * 18 px gaps between them form a continuous empty lattice, which is exactly
 * where wall, port and window labels belong. So every such label is queued into
 * a "band" — one shared line of constant centreline per wall axis — and each
 * band is then packed:
 *
 * - up to six interleaved lanes per band ({@link BAND_ROWS}), straddling the
 *   wall line, because a band carries both faces of its wall plus every opening
 *   in it — the z = 3.80 corridor line alone carries five walls and five ports;
 * - each label then takes the spot nearest its own wall — searching along the
 *   band in both directions — that collides with nothing already placed,
 *   including the labels of every other band, because two perpendicular bands
 *   cross wherever two walls meet and a rotated label driven through a
 *   horizontal one leaves both unreadable.
 *
 * At 60 px = 1 m this succeeds almost everywhere: one label of about a hundred
 * ends up off the wall it names, and the only ones reaching past the outline are
 * six on the 0.80 m walls of the south strip, where the label is half again as
 * long as the wall it names — five of those clear it by under 20 px. A label
 * sitting a little outside its own wall is deliberate and permitted.
 * The side labels and the captions are placed against the *measured* bounds of
 * everything drawn, not a fixed margin, so they cannot land on a label however
 * `walls.mjs` changes. Nothing is ever dropped: an unlabelled wall would defeat
 * the point of the drawing.
 *
 * Cell ids are `v2-<counter>` in emission order, so two runs over the same spec
 * produce byte-identical XML and the committed HTML only changes when the
 * geometry does.
 *
 * Node built-ins only, ES modules.
 */

/**
 * Pixels per metre.
 *
 * 60, not the 30 of the owner's hand-drawn page. Label text is a fixed size
 * while every wall run scales with this number, so raising it gives a label more
 * room without making it one pixel bigger: a 4.00 m wall goes from 120 px to
 * 240 px against a ~60 px label and swallows it whole. At 30 the plan simply had
 * more label than it had wall to put it on, and about forty wall labels ended up
 * in an illegible thicket below the drawing.
 *
 * 60 is the smallest scale that removes that thicket completely. Measured over
 * 24…60 px/m at six lanes, the labels left off the wall they name run 27 (at 30)
 * → 10 (40) → 6 (45) → 4 (50) → 1 (60), and every scale below 60 still leaves a
 * ~75 px band of overflow under the plot; at 60 the last label clears the plot's
 * bottom edge. The page is then about 1400 × 800 px, which still fits a screen.
 *
 * This is the one number the whole placement geometry keys off.
 */
const SCALE = 60;
/** Page x of plan x = 0. */
const ORIGIN_X = 140;
/** Page y of plan z = 0. */
const ORIGIN_Y = 80;

/** @param {number} x Plan x, metres. @returns {number} Page x, px. */
const px = (x) => ORIGIN_X + SCALE * x;
/** @param {number} z Plan z, metres. @returns {number} Page y, px. */
const py = (z) => ORIGIN_Y + SCALE * z;

/**
 * Room fill and stroke by space type, taken from the owner's own drawing so the
 * regenerated page reads as the same document.
 *
 * `GST` is not in the brief's palette list but the owner coloured the guest room
 * `#fff2cc`, so that is kept. `VOID` is white with a dashed red stroke and red
 * text, which is how the drawing distinguishes "no floor" from "floor".
 */
const PALETTE = Object.freeze({
  BED: ['#dae8fc', '#6c8ebf'],
  CTR: ['#dae8fc', '#6c8ebf'],
  LIV: ['#e1d5e7', '#9673a6'],
  KIT: ['#d5e8d4', '#82b366'],
  LND: ['#ffd9b3', '#d79b00'],
  BTH: ['#ffe6cc', '#d79b00'],
  UTL: ['#f8cecc', '#b85450'],
  BAL: ['#c9e6c9', '#2d7d2d'],
  COR: ['#f5f5f5', '#666666'],
  STR: ['#f5f5f5', '#666666'],
  GST: ['#fff2cc', '#d6b656'],
  VOID: ['#ffffff', '#cc0000'],
});

/** The master bedroom is the one `BED` the owner drew in the living-room violet. */
const MASTER_FILL = Object.freeze(['#e1d5e7', '#9673a6']);

/** Green of a port bar, and the darker green its label is written in. */
const PORT_COLORS = Object.freeze({ fill: '#00b050', stroke: 'none', text: '#00701a' });
/** Gold of a window bar, and the darker gold its label is written in. */
const WINDOW_COLORS = Object.freeze({ fill: '#e3c800', stroke: '#B09500', text: '#7a5c00' });
/** Grey of a wall label: present, readable, and never competing with a matricule. */
const WALL_TEXT = '#666666';

/**
 * Blue-grey of a fixture: a sink, a bath, a shower, the television.
 *
 * Deliberately outside the pastel range the rooms are filled with, and nowhere
 * near the green of a port or the gold of a window, so a fixture reads as a
 * thing standing in a room rather than as part of the fabric around it.
 */
const FIXTURE_COLORS = Object.freeze({ fill: '#cfd8dc', stroke: '#455a64', text: '#37474f' });

/**
 * A partition is drawn in the wall's own grey.
 *
 * `#8c8c8c` is the plot's fill: it is what shows through the gaps between the
 * clear room rectangles, so it is already what every wall on this page looks
 * like. Painting a screen in it makes it read as something you cannot walk
 * through, flat and without an outline of its own, exactly like the fabric
 * around it.
 *
 * A partition is a *fixture* in the data only because the wall derivation works
 * from room rectangles and would have to split a room in two to express a
 * screen; it never enters that path. On the page it is fabric, so drawing it in
 * the fitting blue-grey would read as furniture you could walk round.
 */
const PARTITION_FILL = '#8c8c8c';

/**
 * How each spelling of a wall's `side` maps to the axis the wall runs along and
 * to the direction its solid lies in, away from the room that owns it.
 *
 * `walls.mjs` says `north`/`east`/`south`/`west`; the domain model's `RectSide`
 * says `minZ`/`maxX`/`maxZ`/`minX`. Both are accepted so this renderer is not
 * hostage to which one the derivation happens to use. See {@link bandOf}.
 */
const SIDE_GEOMETRY = Object.freeze({
  north: { axis: 'x', outward: -1 },
  south: { axis: 'x', outward: 1 },
  west: { axis: 'z', outward: -1 },
  east: { axis: 'z', outward: 1 },
  minZ: { axis: 'x', outward: -1 },
  maxZ: { axis: 'x', outward: 1 },
  minX: { axis: 'z', outward: -1 },
  maxX: { axis: 'z', outward: 1 },
});

/** Font size of a wall / port / window label, px. Small by instruction. */
const BAND_FONT = 6;
/** Gap left between two packed labels in the same band row, px. */
const BAND_GAP = 3;
/**
 * How far from its fixture a label may sit and still count as adjacent, in
 * rings (a ring is one label height). Within this, staying next to the shape
 * matters more than staying inside the room.
 */
const ADJACENT_RINGS = 2;
/**
 * Perpendicular offsets of a band's lanes, in label heights from the wall line,
 * tried in this order.
 *
 * The innermost pair straddles the wall and is all most bands ever need; each
 * further pair takes only what will not fit, the outermost reaching ~20 px into
 * the neighbouring room. That is the better of two bad options: a label a little
 * over the edge of a room still points at its own wall, whereas one slid 100 px
 * along the band no longer says which wall it names.
 *
 * Six is measured, not guessed. At 60 px = 1 m, with the plan reduced to
 * matricules, the number of labels that end up off the wall they name falls 9 →
 * 3 → 1 as the lanes go 2 → 4 → 6, and only at six lanes does the last of the
 * overflow clear the bottom of the plot instead of forming a band under it.
 * Going further reaches deeper into the rooms for nothing.
 */
const BAND_ROWS = Object.freeze([-0.5, 0.5, -1.5, 1.5, -2.5, 2.5]);
/** Font sizes a room matricule may use, largest first. */
const ROOM_FONTS = Object.freeze([9, 8, 7, 6]);

/**
 * Mean glyph advance as a fraction of font size, for draw.io's default
 * Helvetica. Matricules are upper-case and digit-heavy, which run wider than
 * lower-case prose, so this errs high: over-estimating a label's width costs a
 * few px of packing slack, while under-estimating would let text collide.
 */
const CHAR_W = 0.62;
/** Same, for the text inside a room box, where wrapping applies. */
const CHAR_W_PROSE = 0.58;

/**
 * Render the plan page.
 *
 * @param {{ spec: Record<string, unknown>, walls: ReadonlyArray<Record<string, unknown>> }} input
 *   `spec` is the module namespace of `plan-v2.mjs`; `walls` is the `Wall[]` of
 *   `walls.mjs` (passed in rather than imported so this module stays a pure
 *   function of its inputs and can be exercised against a fixture).
 * @returns {string} The `<mxGraphModel>…</mxGraphModel>` XML of the page.
 */
export function renderPlanPage({ spec, walls }) {
  const { PLOT, ROOMS, WALLS, STAIRS, SIDES, FIXTURES, FLOOR_NUMBER } = spec;
  const [plotMinX, plotMaxX, plotMinZ, plotMaxZ] = PLOT;

  /** Emitted cells, in z-order: later cells paint on top of earlier ones. */
  const cells = [];
  let idCounter = 0;
  const nextId = () => `v2-${++idCounter}`;

  /** Band label requests, resolved in one pass after every shape is placed. */
  const bands = new Map();
  let bandSeq = 0;

  /**
   * Visual bounds of every cell emitted so far, which is how the side labels and
   * the notes block find somewhere clear to sit: a band label may spill past the
   * plot outline, so measuring beats guessing a fixed margin.
   */
  const boxes = [];

  /**
   * Every *label* box committed so far: room matricules first, then fixtures,
   * then the wall, port and window labels.
   *
   * One shared list, because the owner's instruction this round was to fix any
   * overlap — not merely overlaps between labels of the same kind. It is what
   * lets a wall label steer around a fixture label it otherwise knows nothing
   * about, and what keeps both off a room's matricule.
   */
  const placedLabels = [];

  // ---------------------------------------------------------------- the plot
  cells.push(
    shape({
      style: `rounded=0;whiteSpace=wrap;html=1;fillColor=#8c8c8c;strokeColor=#000000;strokeWidth=4;fontSize=9;fontStyle=1;verticalAlign=middle;align=center;`,
      value: '',
      x: px(plotMinX),
      y: py(plotMinZ),
      w: SCALE * (plotMaxX - plotMinX),
      h: SCALE * (plotMaxZ - plotMinZ),
    }),
  );

  // ------------------------------------------------- fixtures, planned first
  // The fixture shapes are drawn further down, on top of the room fills, but
  // their boxes are needed here: a room's matricule has to know where the bath
  // is before it can choose a corner of the room to sit in.
  for (const [, items] of fixturesByRoom(FIXTURES ?? [], ROOMS)) {
    for (const fixture of items) {
      const [minX, maxX, minZ, maxZ] = fixture.rect;
      placedLabels.push({ x0: px(minX), y0: py(minZ), x1: px(maxX), y1: py(maxZ) });
    }
  }

  // --------------------------------------------------------------- the rooms
  for (const room of ROOMS) {
    const matricule = roomMatricule(FLOOR_NUMBER, room);
    room.rects.forEach((rect, index) => {
      const [minX, maxX, minZ, maxZ] = rect;
      const wPx = SCALE * (maxX - minX);
      const hPx = SCALE * (maxZ - minZ);
      const [fill, stroke] = fillFor(room);
      const isVoid = room.type === 'VOID';
      // The stairwell bay is tiled by its three hatched flight rects below, so
      // its own rect is drawn as the backing shape only — a label here would be
      // painted over and would only confuse the XML.
      const label =
        room.kind === 'stairwell'
          ? { fontSize: BAND_FONT, lines: [] }
          : roomLabel({ matricule, index, rectCount: room.rects.length, wPx, hPx });
      // draw.io centres a shape's label, and in a small room that can drop the
      // matricule straight onto a fixture: the 1.60 × 1.30 guest sanitair, whose
      // centre is inside its bath, is exactly that case. So the matricule takes
      // the first of draw.io's nine anchor positions that is clear of everything
      // placed so far — the centre first, so only a room that needs to move does.
      const rectBox = { x0: px(minX), y0: py(minZ), x1: px(maxX), y1: py(maxZ) };
      const anchor = placeRoomLabel(label, rectBox, placedLabels);
      // When every anchor is blocked — the guest sanitair, five fixtures in
      // 1.60 × 1.50 — the matricule comes out of the shape and is drawn as its
      // own cell in whatever gap the room has left. Here that is the 15 px band
      // between the basin and the screen, which no corner anchor can reach.
      const loose =
        anchor.free || label.lines.length === 0
          ? null
          : findFreeBoxInRect(anchor.box, rectBox, placedLabels);
      cells.push(
        shape({
          style:
            `rounded=0;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};` +
            `strokeWidth=${room.kind === 'openAir' ? 2 : 1};fontSize=${label.fontSize};fontStyle=1;` +
            `verticalAlign=${anchor.vertical};align=${anchor.horizontal};` +
            `${isVoid ? 'dashed=1;fontColor=#cc0000;' : ''}`,
          value: loose ? '' : label.lines.join('\n'),
          x: px(minX),
          y: py(minZ),
          w: wPx,
          h: hPx,
        }),
      );
      if (loose) {
        cells.push(
          text({
            style:
              `text;html=1;align=center;verticalAlign=middle;fontSize=${label.fontSize};` +
              `fontStyle=1;${isVoid ? 'fontColor=#cc0000;' : ''}`,
            value: label.lines.join('\n'),
            x: loose.x0,
            y: loose.y0,
            w: loose.x1 - loose.x0,
            h: loose.y1 - loose.y0,
          }),
        );
      }
      // What must stay clear is the text itself, not the whole rect: a
      // rect-sized obstacle would push every wall label out of every room.
      const placedBox = loose ?? anchor.box;
      if (placedBox) placedLabels.push(placedBox);
    });
  }

  // ----------------------------------------------------------- the stairwell
  const stairRoom = ROOMS.find((room) => room.kind === 'stairwell');
  if (stairRoom && STAIRS) {
    // 18 risers over two flights: state the per-flight count rather than hard-
    // coding 9, so a change to `riserCount` cannot leave the drawing lying.
    const perFlight = Math.round(STAIRS.riserCount / 2);
    // Whatever pieces the spec defines, in the order it defines them — which is
    // travel order, from the corridor down. Naming them here once meant the
    // arrival landing went undrawn when the owner added it, leaving bare bay
    // fill where the one new thing was supposed to be; a fifth piece now appears
    // by itself.
    for (const [name, rect] of stairPieces(STAIRS)) {
      const [minX, maxX, minZ, maxZ] = rect;
      // Hatched for the flights, plain for the landings: what you can stand on
      // as floor is drawn as floor, and the label says which level that is.
      const isFlight = /flight/i.test(name);
      cells.push(
        shape({
          style:
            `rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;${isFlight ? 'fillStyle=hatch;' : ''}` +
            `strokeColor=#666666;strokeWidth=1;fontSize=${BAND_FONT};fontStyle=0;fontColor=#333333;` +
            'verticalAlign=middle;align=center;',
          value: stairPieceLabel(name, perFlight),
          x: px(minX),
          y: py(minZ),
          w: SCALE * (maxX - minX),
          h: SCALE * (maxZ - minZ),
        }),
      );
    }
    // The "no floor here, the top landing is the corridor" note used to be drawn
    // in the band where the stair meets the corridor, and a fuller version sat
    // under the plan. Both are gone: the plan carries identity only and those are
    // descriptions. The three piece labels above still say what the bay holds;
    // the rest is on the Registers page.
  }

  // ------------------------------------------------------------- the fixtures
  // The things standing in a room: a sink, a bath, a shower, a screen, the
  // television. A fixture is in a room, not in a wall, so it is numbered per
  // room — X1, X2 … in reading order, top to bottom then left to right — and
  // placed here rather than through the band machinery, which threads labels
  // along walls. Screens are numbered with the rest, so the drawing and the
  // Registers page agree on which X is which even though they carry no label.
  for (const [roomId, items] of fixturesByRoom(FIXTURES ?? [], ROOMS)) {
    const room = ROOMS.find((candidate) => candidate.id === roomId);
    if (!room) continue;
    const base = roomMatricule(FLOOR_NUMBER, room);
    const roomBoxes = room.rects.map(([minX, maxX, minZ, maxZ]) => ({
      x0: px(minX),
      y0: py(minZ),
      x1: px(maxX),
      y1: py(maxZ),
    }));

    items.forEach((fixture, index) => {
      const [minX, maxX, minZ, maxZ] = fixture.rect;
      const box = { x0: px(minX), y0: py(minZ), x1: px(maxX), y1: py(maxZ) };
      const isPartition = fixture.kind === 'partition';
      cells.push(
        shape({
          style:
            'rounded=0;whiteSpace=wrap;html=1;' +
            (isPartition
              ? `fillColor=${PARTITION_FILL};strokeColor=${PARTITION_FILL};strokeWidth=1;`
              : `fillColor=${FIXTURE_COLORS.fill};strokeColor=${FIXTURE_COLORS.stroke};strokeWidth=1;`),
          value: '',
          x: box.x0,
          y: box.y0,
          w: box.x1 - box.x0,
          h: box.y1 - box.y0,
        }),
      );
      // The shape is already an obstacle: it was registered in the planning pass
      // above, before any room matricule chose where to sit.

      // A screen carries no label. The guest sanitair holds five fixtures in
      // 1.60 × 1.50 m, and what is left of its floor is one band 96 px wide and
      // 15 px tall: a `-X2 partition` label is ~90 px long, so it could only be
      // flung outside the room, where it would sit among three other labels and
      // point at nothing a reader could pick out from a 0.10 m line. The screens
      // still take their X numbers, so the drawing and the Registers page agree
      // on which X is which, and the Registers page carries their sizes.
      if (isPartition) return;

      // The kind word is carried as well as the matricule, against the
      // matricule-only rule the rest of the plan follows. A small rectangle is
      // the one shape here that does not say what it is on sight.
      const label = `${base}-X${index + 1} ${fixture.kind}`;
      const spot = placeLabelBox(label, box, roomBoxes, placedLabels);
      if (!spot) return;
      placedLabels.push(spot);
      cells.push(
        text({
          style:
            `text;html=1;align=center;verticalAlign=middle;fontSize=${BAND_FONT};` +
            `fontColor=${FIXTURE_COLORS.text};`,
          value: label,
          x: spot.x0,
          y: spot.y0,
          w: spot.x1 - spot.x0,
          h: spot.y1 - spot.y0,
        }),
      );
    });
  }

  // ----------------------------------------- walls, and the openings in them
  for (const wall of walls) {
    const { axis, at } = bandOf(wall, WALLS.partition);
    const length = numberOr(wall.length, wall.spanMax - wall.spanMin);
    const mid = (wall.spanMin + wall.spanMax) / 2;
    queueBand({
      axis,
      at,
      centre: axis === 'x' ? px(mid) : py(mid),
      text: `${wall.matricule}  ${metres(length)}`,
      color: WALL_TEXT,
    });

    for (const opening of wall.openings ?? []) {
      // Each physical opening is derived onto both of the rooms that share the
      // wall; the second copy is flagged `alias` so we draw one bar, not two.
      if (opening.alias) continue;
      const glazed = isWindow(opening);
      const colors = glazed ? WINDOW_COLORS : PORT_COLORS;
      // A zero-thickness join (the stairs/corridor continuity) would render as
      // an invisible zero-height bar; clamp so nothing silently disappears.
      const thickness = Math.max(numberOr(wall.thickness, WALLS.partition), 0.08);
      const acrossPx = SCALE * thickness;
      const alongPx = SCALE * opening.width;
      cells.push(
        shape({
          style: `rounded=0;whiteSpace=wrap;html=1;fillColor=${colors.fill};strokeColor=${colors.stroke};`,
          value: '',
          x: axis === 'x' ? px(opening.spanMin) : px(at) - acrossPx / 2,
          y: axis === 'x' ? py(at) - acrossPx / 2 : py(opening.spanMin),
          w: axis === 'x' ? alongPx : acrossPx,
          h: axis === 'x' ? acrossPx : alongPx,
        }),
      );
      queueBand({
        axis,
        at,
        centre:
          axis === 'x'
            ? px(opening.spanMin + opening.width / 2)
            : py(opening.spanMin + opening.width / 2),
        // Matricule only. Width, sill and head are columns on the Registers
        // page, and dropping them here takes a window label from ~33 characters
        // to ~16 — much of why these labels now fit on the walls they name.
        text: opening.matricule,
        color: colors.text,
      });
    }
  }

  // Band labels last of all, so no shape is ever painted over a label.
  emitBands();

  // --------------------------------------------------- side labels and notes
  // Measured before anything else is added: wall labels are allowed to spill
  // past the outline, so the side labels and the captions are placed against
  // what was actually drawn rather than against a guessed margin. This is what
  // keeps the legend off the deepest rotated label whatever `walls.mjs` emits.
  const bounds = contentBounds();
  const plotW = SCALE * (plotMaxX - plotMinX);
  const plotH = SCALE * (plotMaxZ - plotMinZ);
  const midZ = py((plotMinZ + plotMaxZ) / 2);
  const sideStyle = (extra) => `text;html=1;align=center;verticalAlign=middle;fontSize=11;${extra}`;

  // C is the north side (z = 0) and B the south (z = 10); A (x = 0) and D
  // (x = 22.50) are rotated so they read along the sides they name. A is green:
  // it is the entry, and the only side of the four that the owner acts on.
  cells.push(
    text({
      style: sideStyle('fontColor=#999999;'),
      value: SIDES.C,
      x: px(plotMinX),
      y: bounds.y0 - 22,
      w: plotW,
      h: 15,
    }),
    text({
      style: sideStyle('fontColor=#008000;fontStyle=1;rotation=-90;'),
      value: SIDES.A,
      x: bounds.x0 - 24 - plotH / 2,
      y: midZ - 8,
      w: plotH,
      h: 16,
    }),
    text({
      style: sideStyle('fontColor=#999999;rotation=90;'),
      value: SIDES.D,
      x: bounds.x1 + 24 - plotH / 2,
      y: midZ - 8,
      w: plotH,
      h: 16,
    }),
  );

  // Side B and the captions, stacked down the page from the deepest thing drawn.
  let cursorY = bounds.y1 + 10;
  /**
   * Emit one full-width caption under the plan and advance the cursor.
   *
   * @param {string} style Cell style.
   * @param {string} value Caption text.
   * @param {number} h Height, px.
   * @returns {void}
   */
  const caption = (style, value, h) => {
    cells.push(text({ style, value, x: px(plotMinX), y: cursorY, w: plotW, h }));
    cursorY += h + 6;
  };
  const noteStyle =
    'text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontSize=8;' +
    'fontColor=#555555;fontStyle=2;';

  caption(sideStyle('fontColor=#999999;'), SIDES.B, 15);

  // `{{TOTALS}}` is substituted by the caller: the area arithmetic is done once,
  // in the verifier, and never a second time here where it could disagree.
  caption(
    'text;html=1;align=center;verticalAlign=middle;fontSize=10;fontColor=#0050a0;fontStyle=2;',
    `PLOT ${metres(plotMaxX - plotMinX)} x ${metres(plotMaxZ - plotMinZ)}` +
      `    |    exterior walls ${metres(WALLS.exterior)} · partitions ${metres(WALLS.partition)}` +
      `    |    {{TOTALS}}`,
    14,
  );

  caption(
    'text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontSize=9;fontColor=#00701a;',
    'Green = port (door or opening) · Gold = window · Blue-grey = fixture · Solid grey = partition · Hatched = stair flights · Dashed red = void (no floor)\n' +
      'Every shape carries its matricule; a wall carries its length and a fixture its kind. Partitions, sizes, notes, widths and sill→head are on the Registers page.',
    26,
  );

  caption(
    noteStyle,
    `Scale ${SCALE} px = 1 m · origin = the outer corner of sides A and C · x runs A→D, z runs C→B · ` +
      'a wall label may sit just outside the wall it names.',
    22,
  );

  // The stairwell used to get a paragraph here — bay size, riser count, going,
  // and the consequence that the bay carries no floor so the corridor is the top
  // landing. It is gone with the rest of the prose: the plan carries identity
  // only, and every one of those numbers is on the Registers page. The three
  // hatched piece labels still say what the bay contains.

  return (
    '<mxGraphModel dx="669" dy="364" grid="1" gridSize="10" guides="1" tooltips="1" connect="1"' +
    ' arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel>`
  );

  // ------------------------------------------------------------- local helpers
  // These close over `cells`, `nextId` and `bands`; keeping them inside the
  // renderer is what makes the id sequence a private, deterministic detail.

  /**
   * Emit a filled vertex.
   *
   * @param {{style: string, value: string, x: number, y: number, w: number, h: number}} spec_ Cell spec.
   * @returns {string} `<mxCell>` XML.
   */
  function shape(spec_) {
    return cell(spec_);
  }

  /**
   * Emit a label-only vertex (no fill, no stroke).
   *
   * @param {{style: string, value: string, x: number, y: number, w: number, h: number}} spec_ Cell spec.
   * @returns {string} `<mxCell>` XML.
   */
  function text(spec_) {
    return cell(spec_);
  }

  /**
   * Emit one `<mxCell>`, attribute order matching draw.io's own output so a
   * regenerated page diffs cleanly against a hand-edited one.
   *
   * @param {{style: string, value: string, x: number, y: number, w: number, h: number}} spec_ Cell spec.
   * @returns {string} `<mxCell>` XML.
   */
  function cell({ style, value, x, y, w, h }) {
    // A rotated cell turns about its own centre, so on the page its width and
    // height are swapped. Recording the *visual* box keeps `contentBounds` right
    // for the rotated wall labels, which are the ones that spill furthest.
    const rotated = /rotation=-?90;/.test(style);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const visualW = rotated ? h : w;
    const visualH = rotated ? w : h;
    boxes.push({
      x0: cx - visualW / 2,
      y0: cy - visualH / 2,
      x1: cx + visualW / 2,
      y1: cy + visualH / 2,
    });
    return (
      `<mxCell id="${nextId()}" parent="1" style="${escapeXml(style)}" value="${escapeXml(value)}" vertex="1">` +
      `<mxGeometry height="${round2(h)}" width="${round2(w)}" x="${round2(x)}" y="${round2(y)}" as="geometry"/>` +
      `</mxCell>`
    );
  }

  /**
   * Queue a thin label to be placed in the empty lattice between rooms.
   *
   * @param {{axis: 'x'|'z', at: number, centre: number, text: string,
   *   color: string}} request The band (`axis` + `at`), where along it the
   *   label would ideally sit (`centre`, in px), and how to draw it.
   * @returns {void}
   */
  function queueBand({ axis, at, centre, text: label, color }) {
    const key = `${axis}@${at.toFixed(3)}`;
    let band = bands.get(key);
    if (!band) {
      band = { axis, at, items: [] };
      bands.set(key, band);
    }
    band.items.push({
      centre,
      text: label,
      color,
      w: label.length * BAND_FONT * CHAR_W + 4,
      seq: bandSeq++,
    });
  }

  /**
   * Place every queued band label and emit it.
   *
   * Each label takes the position closest to the wall it names at which it hits
   * nothing already placed. Two things make that possible: the six
   * {@link BAND_ROWS} lanes straddling the wall line, and a search along the band
   * in *both* directions for the nearest free gap.
   *
   * The collision test is against every label already emitted, not merely the
   * others in this band, and that is the whole point. Two perpendicular bands
   * cross wherever two walls meet, so packing each band on its own left 96 pairs
   * of labels overlapping — a rotated wall label through a horizontal one, 8 px
   * by 8 px, both unreadable — while every band looked perfectly packed. The
   * two-directional search also removes the need to re-centre a row afterwards:
   * a label never drifts because it takes the nearest gap, so a crowded band
   * spreads symmetrically rather than marching off the end of the drawing.
   *
   * Opening bars are deliberately not obstacles: a port label sitting on its own
   * green bar still reads, and blocking on 25 more rectangles would push labels
   * away from the walls they name for no gain.
   *
   * @returns {void}
   */
  function emitBands() {
    const height = BAND_FONT + 2;
    // Every label box committed so far — the room matricules and the fixture
    // labels included — so a wall label never lands on one.
    const placed = placedLabels;

    for (const key of [...bands.keys()].sort()) {
      const { axis, at, items } = bands.get(key);
      items.sort((a, b) => a.centre - b.centre || a.seq - b.seq);

      for (const item of items) {
        const wanted = item.centre - item.w / 2;
        let best = null;
        for (const row of BAND_ROWS) {
          const offset = row * height;
          const lane = (axis === 'x' ? py(at) : px(at)) + offset;
          const lo = lane - height / 2;
          const hi = lane + height / 2;
          // Only what shares this lane can ever be hit, however far along the
          // band the label ends up; the rest is not worth testing against.
          const blockers = placed
            .filter((b) => (axis === 'x' ? b.y0 < hi && lo < b.y1 : b.x0 < hi && lo < b.x1))
            .map((b) => (axis === 'x' ? [b.x0, b.x1] : [b.y0, b.y1]));
          const start = nearestFreeStart(blockers, wanted, item.w);
          if (best === null || Math.abs(start - wanted) < Math.abs(best.start - wanted)) {
            best = { start, offset, lo, hi };
          }
        }

        placed.push(
          axis === 'x'
            ? { x0: best.start, x1: best.start + item.w, y0: best.lo, y1: best.hi }
            : { x0: best.lo, x1: best.hi, y0: best.start, y1: best.start + item.w },
        );
        cells.push(
          text({
            style:
              `text;html=1;align=center;verticalAlign=middle;fontSize=${BAND_FONT};` +
              `fontColor=${item.color};` +
              `${axis === 'z' ? 'rotation=-90;' : ''}`,
            value: item.text,
            // Unrotated geometry in both cases: a `rotation=-90` cell turns
            // about its own centre, so we position the centre and let draw.io
            // swap the axes for us.
            x: axis === 'x' ? best.start : px(at) + best.offset - item.w / 2,
            y:
              axis === 'x'
                ? py(at) + best.offset - height / 2
                : best.start + item.w / 2 - height / 2,
            w: item.w,
            h: height,
          }),
        );
      }
    }
  }

  /**
   * Visual bounds of every cell emitted so far.
   *
   * @returns {{ x0: number, y0: number, x1: number, y1: number }} The bounding box, px.
   */
  function contentBounds() {
    return boxes.reduce(
      (box, next) => ({
        x0: Math.min(box.x0, next.x0),
        y0: Math.min(box.y0, next.y0),
        x1: Math.max(box.x1, next.x1),
        y1: Math.max(box.y1, next.y1),
      }),
      { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    );
  }
}

/**
 * Group the fixtures by room and put each room's in reading order.
 *
 * Numbering is per room, not per wall: a fixture stands in a room. Ordering by
 * z and then x makes `X1`, `X2` … stable — the same fixture keeps its number
 * from one run to the next as long as it has not moved, which matters because
 * these matricules are quoted on the Registers page.
 *
 * @param {ReadonlyArray<{room: string, rect: ReadonlyArray<number>}>} fixtures The spec's fixtures.
 * @param {ReadonlyArray<{id: string}>} rooms The spec's rooms, for a stable room order.
 * @returns {Array<[string, Array<Record<string, unknown>>]>} `[roomId, fixtures]`, rooms in spec order.
 */
function fixturesByRoom(fixtures, rooms) {
  const roomOrder = new Map(rooms.map((room, index) => [room.id, index]));
  const grouped = new Map();
  for (const fixture of fixtures) {
    if (!grouped.has(fixture.room)) grouped.set(fixture.room, []);
    grouped.get(fixture.room).push(fixture);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => a.rect[2] - b.rect[2] || a.rect[0] - b.rect[0]);
  }
  return [...grouped.entries()].sort(
    (a, b) => (roomOrder.get(a[0]) ?? 0) - (roomOrder.get(b[0]) ?? 0),
  );
}

/**
 * The pieces of the stair, in the order the spec lists them — travel order.
 *
 * Anything on `STAIRS` that is a rectangle and is not the `bay` is a piece. The
 * bay is the bounding box of the lot and is drawn separately as the stairwell
 * room's own rect, so including it would paint over everything inside it.
 *
 * Read from the data rather than named, because they were named once and the
 * arrival landing the owner asked for then went undrawn.
 *
 * @param {Record<string, unknown>} stairs The spec's `STAIRS`.
 * @returns {Array<[string, ReadonlyArray<number>]>} `[name, rect]` in spec order.
 */
function stairPieces(stairs) {
  return Object.entries(stairs).filter(
    ([name, value]) =>
      name !== 'bay' &&
      Array.isArray(value) &&
      value.length === 4 &&
      value.every((n) => Number.isFinite(n)),
  );
}

/**
 * The label for one stair piece: what it is, and what level it is at.
 *
 * The level is the thing a reader needs and cannot see: the east landing is
 * walkable floor at *this* storey, the half-landing is floor half a storey down,
 * and a flight is neither — it is the descent between them. The name is
 * un-camel-cased so a piece the spec adds later reads correctly without being
 * listed here; a one-letter word such as the `A` of `flightA` keeps its capital.
 *
 * @param {string} name The key on `STAIRS`, e.g. `flightA` or `landingEast`.
 * @param {number} perFlight Risers in one flight.
 * @returns {string} Two lines: the name, then the level.
 */
function stairPieceLabel(name, perFlight) {
  const words = name
    .replace(/([A-Z])/g, ' $1')
    .split(/\s+/)
    .filter(Boolean);
  const pretty = words.map((word, i) => (i === 0 || word.length === 1 ? word : word.toLowerCase()));
  const title = pretty.join(' ');

  if (/flight/i.test(name)) return `${title}\n${perFlight} risers ↓`;
  if (/half/i.test(name)) return `${title}\nhalf a storey down`;
  if (/landing/i.test(name)) return `${title}\nthis floor's level`;
  return title;
}

/**
 * draw.io's nine label anchors, in the order a room's matricule should try them.
 *
 * Centre first, so a room only moves its matricule when something is in the way;
 * then the edges, then the corners, which are the positions a small room with a
 * bath across it still has free.
 */
const ROOM_ANCHORS = Object.freeze([
  ['center', 'middle'],
  ['center', 'top'],
  ['center', 'bottom'],
  ['left', 'middle'],
  ['right', 'middle'],
  ['left', 'top'],
  ['right', 'top'],
  ['left', 'bottom'],
  ['right', 'bottom'],
]);

/**
 * Choose where inside its rect a room's matricule should sit.
 *
 * Returns the draw.io alignment to set on the room's own shape rather than a
 * position, so the matricule stays part of the rect — one cell, not two — and
 * still moves out from under a bath when it has to.
 *
 * @param {{fontSize: number, lines: string[]}} label The chosen room label.
 * @param {{x0: number, y0: number, x1: number, y1: number}} rect The room rect, px.
 * @param {ReadonlyArray<{x0: number, y0: number, x1: number, y1: number}>} obstacles Boxes to avoid.
 * @returns {{horizontal: string, vertical: string, box: {x0: number, y0: number, x1: number,
 *   y1: number} | null}} The alignment, and the box it puts the text in.
 */
function placeRoomLabel(label, rect, obstacles) {
  if (label.lines.length === 0) return { horizontal: 'center', vertical: 'middle', box: null };

  const w = label.lines[0].length * label.fontSize * CHAR_W_PROSE;
  const h = label.fontSize * 1.45;
  const pad = 2;
  const free = (box) =>
    !obstacles.some(
      (o) =>
        box.x0 < o.x1 - 0.01 &&
        o.x0 < box.x1 - 0.01 &&
        box.y0 < o.y1 - 0.01 &&
        o.y0 < box.y1 - 0.01,
    );

  let centred = null;
  for (const [horizontal, vertical] of ROOM_ANCHORS) {
    const x0 =
      horizontal === 'center'
        ? (rect.x0 + rect.x1) / 2 - w / 2
        : horizontal === 'left'
          ? rect.x0 + pad
          : rect.x1 - pad - w;
    const y0 =
      vertical === 'middle'
        ? (rect.y0 + rect.y1) / 2 - h / 2
        : vertical === 'top'
          ? rect.y0 + pad
          : rect.y1 - pad - h;
    const box = { x0, y0, x1: x0 + w, y1: y0 + h };
    if (!centred) centred = { horizontal, vertical, box, free: false };
    if (free(box)) return { horizontal, vertical, box, free: true };
  }
  // Every anchor is blocked. Report it rather than quietly drawing over a bath:
  // the caller lifts the matricule out of the shape and places it in whatever
  // gap the room has left.
  return centred;
}

/**
 * The free spot nearest the middle of a rect that will hold a box of this size.
 *
 * A last resort for a room matricule when all nine anchors are blocked. Anchors
 * can only reach the edges and the exact centre, so a room whose free floor is a
 * band *across* its middle — the guest sanitair, where the only gap is the 15 px
 * between the basin and the screen — has nowhere to put its name until something
 * scans the interior properly.
 *
 * @param {{x0: number, y0: number, x1: number, y1: number}} size Box whose width and height to fit.
 * @param {{x0: number, y0: number, x1: number, y1: number}} rect The rect to stay inside, px.
 * @param {ReadonlyArray<{x0: number, y0: number, x1: number, y1: number}>} obstacles Boxes to avoid.
 * @returns {{x0: number, y0: number, x1: number, y1: number} | null} The box, or null if the rect is full.
 */
function findFreeBoxInRect(size, rect, obstacles) {
  const w = size.x1 - size.x0;
  const h = size.y1 - size.y0;
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  // A 1 px grid, not a coarse one. The guest sanitair's only gap is the 15 px
  // band between basin and screen, and the matricule is 13 px tall: a 3 px grid
  // offered y = 535, which clipped the basin, and y = 538, which overshot the
  // screen by 0.05 px, and so reported the room full when it was not.
  const step = 1;

  const candidates = [];
  for (let y = rect.y0 + 2; y + h <= rect.y1 - 2; y += step) {
    for (let x = rect.x0 + 2; x + w <= rect.x1 - 2; x += step) {
      candidates.push({ x0: x, y0: y, x1: x + w, y1: y + h });
    }
  }
  // Nearest the middle first, so the name still reads as belonging to the room.
  const distance = (box) => Math.hypot((box.x0 + box.x1) / 2 - cx, (box.y0 + box.y1) / 2 - cy);
  candidates.sort((a, b) => distance(a) - distance(b));

  return (
    candidates.find(
      (box) =>
        !obstacles.some(
          (o) =>
            box.x0 < o.x1 - 0.01 &&
            o.x0 < box.x1 - 0.01 &&
            box.y0 < o.y1 - 0.01 &&
            o.y0 < box.y1 - 0.01,
        ),
    ) ?? null
  );
}

/**
 * Find a box for a fixture's label: as close to the fixture as possible, inside
 * its own room if that can be managed, and clear of everything already placed.
 *
 * Candidates are stacked directly above and below the fixture and stepped
 * outwards, and at each step the label may slide along the fixture as well as
 * shoulder past it. Every candidate inside the room is tried before any outside
 * it, so a label leaves the room it belongs to only when the room has genuinely
 * run out of space — which the 1.60 × 1.50 guest sanitair, holding a bath and a
 * sink, very nearly does.
 *
 * @param {string} label The text to place.
 * @param {{x0: number, y0: number, x1: number, y1: number}} fixture The fixture's box, px.
 * @param {ReadonlyArray<{x0: number, y0: number, x1: number, y1: number}>} roomBoxes Its room's rects, px.
 * @param {ReadonlyArray<{x0: number, y0: number, x1: number, y1: number}>} obstacles Boxes to avoid.
 * @returns {{x0: number, y0: number, x1: number, y1: number} | null} The box, or null if nowhere is free.
 */
function placeLabelBox(label, fixture, roomBoxes, obstacles) {
  const w = label.length * BAND_FONT * CHAR_W + 4;
  const h = BAND_FONT + 2;
  const cx = (fixture.x0 + fixture.x1) / 2;
  const step = h + 2;

  // How far the label can slide along the fixture and still sit over it. This is
  // the freedom a long thin fixture needs: the television is a 3.50 × 0.08 bar,
  // 210 px of it, and with only a couple of sideways positions to try its label
  // could not get past the corridor's own matricule — so it walked away in y
  // instead and ended up 0.55 m adrift, reading as a label for the corridor.
  const slide = Math.max(0, (fixture.x1 - fixture.x0 - w) / 2);
  const offsets = [0];
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    offsets.push(slide * fraction, -slide * fraction);
  }
  // Shoulder positions, for a fixture too small to slide along at all.
  offsets.push(w * 0.55, -w * 0.55, w * 0.9, -w * 0.9);
  // Nearest sideways position first, so the label stays over its own shape; the
  // ring (distance above or below) stays the outer loop, so adjacency wins over
  // alignment every time.
  const shifts = [...new Set(offsets.map((v) => Math.round(v * 100) / 100))].sort(
    (a, b) => Math.abs(a) - Math.abs(b) || a - b,
  );

  const candidates = [];
  for (let ring = 1; ring <= 14; ring += 1) {
    for (const dx of shifts) {
      for (const side of [1, -1]) {
        const cy = side > 0 ? fixture.y1 + (ring - 0.5) * step : fixture.y0 - (ring - 0.5) * step;
        candidates.push({
          x0: cx + dx - w / 2,
          y0: cy - h / 2,
          x1: cx + dx + w / 2,
          y1: cy + h / 2,
          ring,
        });
      }
    }
  }

  const free = (box) =>
    !obstacles.some(
      (o) =>
        box.x0 < o.x1 - 0.01 &&
        o.x0 < box.x1 - 0.01 &&
        box.y0 < o.y1 - 0.01 &&
        o.y0 < box.y1 - 0.01,
    );
  const insideRoom = (box) =>
    roomBoxes.some(
      (r) =>
        box.x0 >= r.x0 - 0.01 &&
        box.x1 <= r.x1 + 0.01 &&
        box.y0 >= r.y0 - 0.01 &&
        box.y1 <= r.y1 + 0.01,
    );

  // Adjacency first, then containment — in that order, and the order is the
  // whole point. Testing containment across every ring before adjacency meant
  // distance always won: the main sanitair's shower stands hard against the
  // room's east wall, where no full-width label can be contained beside it, so
  // the search climbed six rings to find a spot that was merely *inside* and
  // left the label 0.85 m above the thing it named. A label hanging a few px
  // over the room's edge still points at its fixture; one that far away does not.
  const adjacent = (box) => box.ring <= ADJACENT_RINGS;
  for (const box of candidates) if (adjacent(box) && insideRoom(box) && free(box)) return box;
  for (const box of candidates) if (adjacent(box) && free(box)) return box;
  for (const box of candidates) if (insideRoom(box) && free(box)) return box;
  for (const box of candidates) if (free(box)) return box;
  return null;
}

/**
 * The position nearest `wanted` at which a label of width `w` fits between
 * `blockers` without touching one.
 *
 * `blockers` are the occupied `[lo, hi]` intervals of a single lane, in band
 * coordinates. The candidates are `wanted` itself and, for each blocker, the
 * slots flush against either of its ends: the nearest fit is always one of
 * those, so there is no need to step along the band looking for it. Considering
 * the slots *before* `wanted` as well as after is what stops a crowded band from
 * drifting in one direction.
 *
 * @param {ReadonlyArray<ReadonlyArray<number>>} blockers Occupied `[lo, hi]` intervals.
 * @param {number} wanted The ideal start, band coordinates.
 * @param {number} w Width of the label, band coordinates.
 * @returns {number} The chosen start.
 */
function nearestFreeStart(blockers, wanted, w) {
  const free = (start) =>
    !blockers.some(([lo, hi]) => start < hi + BAND_GAP && lo - BAND_GAP < start + w);
  if (free(wanted)) return wanted;

  const candidates = [];
  for (const [lo, hi] of blockers) {
    candidates.push(hi + BAND_GAP);
    candidates.push(lo - BAND_GAP - w);
  }
  candidates.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b);
  for (const candidate of candidates) if (free(candidate)) return candidate;

  // Every slot in this lane conflicts: sit past everything rather than overlap.
  return Math.max(wanted, ...blockers.map(([, hi]) => hi + BAND_GAP));
}

/**
 * The band a wall belongs to: which way it runs, and where its centreline sits.
 *
 * `axis` is read as in `Opening.along` — `'x'` means the wall runs along x, so
 * `spanMin`/`spanMax` are x coordinates and the band coordinate is a z one.
 *
 * `at` is *not* the centreline. `walls.mjs` emits the clear face on the room's
 * side, with the solid lying outward of it: the master bedroom's south wall is
 * `at` 3.70 where the room's rect ends at z 3.70, and being 0.20 thick it fills
 * 3.70→3.90. Drawing on `at` directly would put every opening bar half a wall
 * thickness off its wall and — worse — would file the two faces of one physical
 * wall in two bands 0.20 m apart, so their labels would silently overlap instead
 * of being packed together. The outward direction therefore comes from `side`,
 * and the centreline is `at + outward · thickness/2`.
 *
 * Both side vocabularies are accepted: the compass names `walls.mjs` uses, and
 * the `minX`/`maxZ` spelling of `RectSide` in the domain model. A wall whose
 * `side` is neither is taken to carry a centreline in `at` already, which is the
 * harmless reading if the contract ever changes under us.
 *
 * @param {Record<string, unknown>} wall A derived wall.
 * @param {number} fallbackThickness Thickness to assume when the wall omits one.
 * @returns {{ axis: 'x'|'z', at: number }} Its axis and centreline coordinate.
 */
function bandOf(wall, fallbackThickness) {
  const named = SIDE_GEOMETRY[String(wall.side)];
  const axis = wall.axis === 'x' || wall.axis === 'z' ? wall.axis : (named?.axis ?? 'x');
  const thickness = numberOr(wall.thickness, fallbackThickness);
  return { axis, at: wall.at + (named ? named.outward : 0) * (thickness / 2) };
}

/**
 * Whether a derived opening is a window rather than a port.
 *
 * Tested on the presence of a vertical extent rather than on `kind`: ports are
 * `door`/`opening` and windows `light`/`pass`/`air` today, but only a window can
 * ever carry a sill and a head, so this survives a new kind being added.
 *
 * @param {Record<string, unknown>} opening A derived opening.
 * @returns {boolean} True for a window.
 */
function isWindow(opening) {
  return typeof opening.sill === 'number' && typeof opening.head === 'number';
}

/**
 * The matricule of a room, e.g. `F1-R11-KIT`.
 *
 * @param {number} floor Floor number.
 * @param {{ n: number, type: string }} room A room of the spec.
 * @returns {string} Its matricule.
 */
function roomMatricule(floor, room) {
  return `F${floor}-R${String(room.n).padStart(2, '0')}-${room.type}`;
}

/**
 * Fill and stroke for a room.
 *
 * @param {{ type: string, id: string }} room A room of the spec.
 * @returns {readonly [string, string]} `[fillColor, strokeColor]`.
 */
function fillFor(room) {
  if (room.id === 'masterBedroom') return MASTER_FILL;
  return PALETTE[room.type] ?? ['#ffffff', '#666666'];
}

/**
 * The label of one room rect: its matricule, and nothing else.
 *
 * The plan carries identity only (owner). Name, size, area and the room's note
 * were all drawn here once and made the boxes noisy; each of them is a column on
 * the Registers page — the owner's "dictionary" — so the plan points at that
 * rather than repeating it. Nothing is lost and the drawing reads cleanly.
 *
 * What is left has to be chosen for size alone: the largest font at which the
 * matricule fits its box. A room drawn as several rects still says which piece
 * this is, because two boxes carrying the same bare matricule would be
 * ambiguous.
 *
 * @param {{ matricule: string, index: number, rectCount: number, wPx: number,
 *   hPx: number }} input The room's matricule, which of its rects this is, and
 *   the box available in px.
 * @returns {{ fontSize: number, lines: string[] }} The chosen label.
 */
function roomLabel({ matricule, index, rectCount, wPx, hPx }) {
  const head = rectCount > 1 ? `${matricule} (${index + 1}/${rectCount})` : matricule;
  for (const fontSize of ROOM_FONTS) {
    if (fitsBox([head], fontSize, wPx, hPx)) return { fontSize, lines: [head] };
  }
  return { fontSize: ROOM_FONTS[ROOM_FONTS.length - 1], lines: [head] };
}

/**
 * Whether a set of lines fits a box once draw.io has wrapped them.
 *
 * An estimate, not a measurement: we have no font metrics in Node, so this
 * models `whiteSpace=wrap` as a character budget per line and errs on the
 * pessimistic side. Being wrong here costs a smaller font or one dropped line,
 * never text spilling out of a room.
 *
 * @param {ReadonlyArray<string>} lines Label lines.
 * @param {number} fontSize Candidate font size, px.
 * @param {number} wPx Box width, px.
 * @param {number} hPx Box height, px.
 * @returns {boolean} True when the wrapped block fits with a 4 px margin.
 */
function fitsBox(lines, fontSize, wPx, hPx) {
  // Width: a box narrower than the longest run of text that cannot be broken
  // overflows sideways however few rows the block needs. Browsers break after a
  // hyphen as well as at a space, so `F1-R18-VOID` may split, but `VOID` may
  // not — counting characters alone ignored that.
  const segments = lines.flatMap((line) => line.split(/[\s-]+/).filter(Boolean));
  const longest = segments.length === 0 ? 0 : Math.max(...segments.map((s) => s.length));
  if (longest * fontSize * CHAR_W_PROSE > wPx - 4) return false;

  // Height: 1.45, not the 1.3 used before. The text is middle-aligned, so a
  // block even slightly taller than its box spills out of *both* ends and over
  // whatever adjoins it — which is how the void labels in the south-east corner
  // came to run through their neighbours' names.
  const perLine = Math.max(1, Math.floor((wPx - 4) / (fontSize * CHAR_W_PROSE)));
  let rows = 0;
  for (const line of lines) rows += line === '' ? 1 : Math.ceil(line.length / perLine);
  return rows * fontSize * 1.45 <= hPx - 4;
}

/**
 * Format a length the way the drawing and the schedule both write it.
 *
 * @param {number} value Metres.
 * @returns {string} Two decimals, e.g. `4.00`.
 */
function metres(value) {
  return Number(value).toFixed(2);
}

/**
 * Round a pixel coordinate, dropping the noise that floating-point metres
 * produce so the XML stays stable between runs.
 *
 * @param {number} value Pixels.
 * @returns {string} The coordinate as draw.io writes it.
 */
function round2(value) {
  return String(Math.round(value * 100) / 100);
}

/**
 * First finite number of the two, so a wall that omits a derived field (say
 * `length`) still renders from what it does carry.
 *
 * @param {unknown} value Preferred value.
 * @param {number} fallback Used when `value` is not a finite number.
 * @returns {number} A finite number.
 */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Escape text for an XML attribute.
 *
 * Newlines become `&#10;`, which is how draw.io stores a hard line break inside
 * a label; every other character that could close the attribute or open a tag is
 * entity-escaped. `&` goes first so the escapes are not themselves escaped.
 *
 * @param {string} value Raw text.
 * @returns {string} Attribute-safe text.
 */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;');
}
