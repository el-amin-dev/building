/**
 * Regenerates the source-of-truth drawing from the agreed geometry.
 *
 *   node scripts/source-of-truth/build.mjs [--dry]
 *
 * The owner draws intent by hand; that intent is read, measured, agreed, and
 * encoded in `src/features/building/domain/sourceOfTruth/plan.ts`, the single
 * copy of the geometry. This script then rewrites the drawing from that
 * data, so the plan, the wall register and the model can no longer drift apart
 * the way the hand-dragged version did (shapes off the centimetre grid, labels
 * still quoting areas the shapes no longer had).
 *
 * `--dry` prints what would change and writes nothing.
 *
 * The totals line is computed here rather than in the renderers, and
 * `verify.mjs` computes the same figures independently: two implementations
 * that must agree is a cheaper check than one implementation everybody trusts.
 */
import * as spec from '../../src/features/building/domain/sourceOfTruth/plan.ts';
import { deriveWalls } from './walls.mjs';
import { readDiagrams, writeDiagrams } from './drawio.mjs';
import { renderPlanPage } from './render-plan.mjs';
import { renderTablePage } from './render-table.mjs';

/**
 * @import { PlanRectCoordinates, PlanRoom }
 *   from '../../src/features/building/domain/sourceOfTruth/plan.ts'
 */

/**
 * The four areas the drawing states, and the plot they have to close on.
 *
 * @typedef {object} Totals
 * @property {number} floor Area carrying a floor slab, in m².
 * @property {number} void Area with no floor, open to the sky, in m².
 * @property {number} stairwell Stair bay that is floor at this level, in m².
 * @property {number} walls The remainder of the plot, in m².
 * @property {number} plot The whole plot, in m².
 */

/** Path of the drawing, relative to the repository root. */
const DRAWING = 'docs/source-of-truth-n-floor.drawio.html';

/** Kinds that carry a floor slab, and therefore count towards the floor area. */
const FLOORED_KINDS = new Set(['room', 'circulation', 'openAir']);

/**
 * Area of a rect in square metres.
 *
 * @param {PlanRectCoordinates} rect Clear rect as `[minX, maxX, minZ, maxZ]`.
 * @returns {number} The area.
 */
function areaOf([minX, maxX, minZ, maxZ]) {
  return (maxX - minX) * (maxZ - minZ);
}

/**
 * Sums the room areas by category and derives the wall footprint as the
 * remainder of the plot, which is the only way the four figures are guaranteed
 * to close on the plot area.
 *
 * @param {readonly PlanRoom[]} rooms The rooms of {@link spec.ROOMS}.
 * @param {PlanRectCoordinates} plot The plot rect.
 * @returns {Totals} Floor, void, stairwell, wall and plot areas, rounded to the
 *   centimetre.
 */
function computeTotals(rooms, plot) {
  /**
   * @param {number} value Any area, in m².
   * @returns {number} It, rounded to the centimetre.
   */
  const round = (value) => Math.round(value * 100) / 100;
  let floor = 0;
  let voidArea = 0;
  let stairwell = 0;
  for (const room of rooms) {
    const area = room.rects.reduce((sum, rect) => sum + areaOf(rect), 0);
    if (room.kind === 'void') voidArea += area;
    else if (room.kind === 'stairwell') stairwell += area;
    else if (FLOORED_KINDS.has(room.kind)) floor += area;
    else throw new Error(`Room ${room.id} has an unknown kind: ${room.kind}`);
  }
  const plotArea = areaOf(plot);
  return {
    floor: round(floor),
    void: round(voidArea),
    stairwell: round(stairwell),
    walls: round(plotArea - floor - voidArea - stairwell),
    plot: round(plotArea),
  };
}

/**
 * Builds the one-line totals summary that both pages carry, so the drawing
 * always states the areas the geometry actually has.
 *
 * @param {Totals} totals Output of {@link computeTotals}.
 * @returns {string} A single line of text.
 */
function totalsLine(totals) {
  return (
    `PLOT ${totals.plot.toFixed(2)} m²  |  FLOOR ${totals.floor.toFixed(2)} m²  |  ` +
    `STAIRWELL ${totals.stairwell.toFixed(2)} m² (only the east landing is floor at this level)  |  ` +
    `VOID ${totals.void.toFixed(2)} m²  |  WALLS ${totals.walls.toFixed(2)} m²`
  );
}

const dry = process.argv.includes('--dry');
const walls = deriveWalls(spec);
const totals = computeTotals(spec.ROOMS, spec.PLOT);

const plan = renderPlanPage({ spec, walls });
const planXml = plan.xml.replaceAll('{{TOTALS}}', totalsLine(totals));
const tableXml = renderTablePage({ spec, walls });

const existing = readDiagrams(DRAWING);
const kept = existing.filter((page) => page.name !== 'Page-2' && page.name !== 'Registers');
const pages = [
  { id: 'plan-v2', name: 'Page-2', xml: planXml },
  { id: 'registers-v2', name: 'Registers', xml: tableXml },
  ...kept,
];

console.log(`walls derived: ${walls.length}`);
console.log(
  `openings placed: ${walls.reduce((sum, wall) => sum + wall.openings.filter((o) => !o.alias).length, 0)}`,
);
console.log(totalsLine(totals));
// Said out loud, every run. A fixture whose label found nowhere free is still
// drawn — its rectangle is on the plan and its row is on the Registers page —
// but the drawing no longer names it, and a drawing that is silently incomplete
// looks exactly like a finished one. Naming them here is what makes the gap a
// thing the owner can decide about rather than one he has to notice.
const placed = plan.fixtureLabels - plan.droppedLabels.length;
console.log(
  plan.droppedLabels.length === 0
    ? `fixture labels: all ${plan.fixtureLabels} placed`
    : `fixture labels: ${placed} of ${plan.fixtureLabels} placed — no room for ${plan.droppedLabels.join(', ')}`,
);
console.log(`pages: ${pages.map((page) => page.name).join(', ')}`);
console.log(`plan page: ${planXml.length} chars, registers page: ${tableXml.length} chars`);

if (dry) {
  console.log('--dry: nothing written');
} else {
  writeDiagrams(DRAWING, pages);
  console.log(`wrote ${DRAWING}`);
}
