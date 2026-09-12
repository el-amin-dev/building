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
 * length; ports and windows carry their matricule alone. Even so a label is
 * usually wider than the opening it names, so labels cannot simply sit inside
 * the thing they name. What saves it is that rooms are drawn as *clear*
 * rectangles: the 6 px (partition) and 9 px (exterior) gaps between them form a
 * continuous empty lattice, which is exactly where wall, port and window labels
 * belong. So every such label is queued into a "band" — one shared line of
 * constant centreline per wall axis — and each band is then packed:
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
 * ends up off the wall it names, and none now form a band below the plot. Where
 * a label does sit a little outside its wall that is deliberate and permitted.
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
 * bottom edge. The page is then 1414 × 759 px, which still fits a screen.
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
  const { PLOT, ROOMS, WALLS, STAIRS, SIDES, FLOOR_NUMBER } = spec;
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
      cells.push(
        shape({
          style:
            `rounded=0;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};` +
            `strokeWidth=${room.kind === 'openAir' ? 2 : 1};fontSize=${label.fontSize};fontStyle=1;` +
            `verticalAlign=middle;align=center;${isVoid ? 'dashed=1;fontColor=#cc0000;' : ''}`,
          value: label.lines.join('\n'),
          x: px(minX),
          y: py(minZ),
          w: wPx,
          h: hPx,
        }),
      );
    });
  }

  // ----------------------------------------------------------- the stairwell
  const stairRoom = ROOMS.find((room) => room.kind === 'stairwell');
  if (stairRoom && STAIRS) {
    // 18 risers over two flights: state the per-flight count rather than hard-
    // coding 9, so a change to `riserCount` cannot leave the drawing lying.
    const perFlight = Math.round(STAIRS.riserCount / 2);
    const flights = [
      [STAIRS.flightA, `flight A — ${perFlight} risers ↓`],
      [STAIRS.halfLanding, 'half-landing\n(half a storey down)'],
      [STAIRS.flightB, `flight B — ${perFlight} risers ↓`],
    ];
    for (const [rect, text] of flights) {
      if (!rect) continue;
      const [minX, maxX, minZ, maxZ] = rect;
      cells.push(
        shape({
          style:
            'rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;fillStyle=hatch;strokeColor=#666666;' +
            `strokeWidth=1;fontSize=${BAND_FONT};fontStyle=0;fontColor=#333333;verticalAlign=middle;align=center;`,
          value: text,
          x: px(minX),
          y: py(minZ),
          w: SCALE * (maxX - minX),
          h: SCALE * (maxZ - minZ),
        }),
      );
    }
    // The "no floor here, the top landing is the corridor" note used to be drawn
    // in the band where the stair meets the corridor. It is not any more: the
    // plan carries identity only, and that is a description. It survives as a
    // caption under the drawing, where it explains the plan's oddest feature
    // without cluttering it.
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
    'Green = port (door or opening) · Gold = window · Hatched = stair flights · Dashed red = void (no floor)\n' +
      'Every shape carries its matricule, and a wall carries its length. Sizes, notes, widths and sill→head are on the Registers page.',
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
    /** Boxes already committed, in page coordinates, for the collision test. */
    const placed = [];

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
