/**
 * Weighs the built bundle against its budget: `node scripts/check-bundle-size.mjs`
 * (`pnpm size`), or `--report` to print the table without failing on a breach.
 *
 * WHY this and not the bundler's own warning: the warning fires on the biggest
 * single file, which is the wrong quantity twice over. What a visitor waits for
 * is the entry chunk plus everything statically imported from it — several
 * files, none of which need be the biggest — and what a split can quietly ruin
 * is that set, by letting one top-level `import` pull the 3D scene back across
 * the lazy boundary while every file on its own still looks reasonable. So the
 * initial set is computed the way the browser assembles it: read `dist/index.html`
 * for the entry, follow static imports from chunk to chunk, and stop at dynamic
 * ones, because `import(...)` is a later download and not part of the wait.
 *
 * Sizes are gzipped with `node:zlib`, since that is what crosses the network.
 * No dependency: this runs on whatever Node the CI job already has.
 *
 * The numbers it checks against live in `tooling/bundleBudget.ts`, one reviewed
 * edit away from changing. Exit code 0 only when every budget holds.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  BUNDLE_BUDGETS,
  BYTES_PER_KILOBYTE,
  CSS_BUDGET,
  INITIAL_JS_BUDGET,
  SCENE_CHUNK_STEM,
  SCENE_JS_BUDGET,
  TOTAL_JS_BUDGET,
} from '../tooling/bundleBudget.ts';

/** @import { BundleBudget } from '../tooling/bundleBudget.ts' */

/**
 * One built file, weighed.
 *
 * @typedef {object} Asset
 * @property {string} name File name inside `dist/assets`.
 * @property {number} rawBytes Size on disk, minified.
 * @property {number} gzipBytes Size gzipped, which is what the budgets are in.
 */

/**
 * One budget, against what was actually measured for it.
 *
 * @typedef {object} Result
 * @property {BundleBudget} budget The budget being checked.
 * @property {string} detail Which files it added up, for the report.
 * @property {number} rawBytes Measured size on disk.
 * @property {number} gzipBytes Measured gzipped size, the number compared.
 */

/** Where the build writes. */
const DIST_DIRECTORY = 'dist';
/** Built assets live one level down, and `index.html` references them from there. */
const ASSETS_DIRECTORY = join(DIST_DIRECTORY, 'assets');
/** The built page, the only thing the browser is handed by name. */
const INDEX_HTML = join(DIST_DIRECTORY, 'index.html');
/** The file to edit when a budget has to change, named in every failure. */
const BUDGET_FILE = 'tooling/bundleBudget.ts';
/** Flag that prints the table and returns 0 whatever it says — for taking a measurement. */
const REPORT_FLAG = '--report';

/** The entry script: `<script type="module" src="/assets/index-HASH.js">`. */
const ENTRY_SCRIPT_PATTERN = /<script[^>]+type="module"[^>]+src="([^"]+)"/;
/** Every stylesheet the page links, in `<link rel="stylesheet" href="...">` order. */
const STYLESHEET_PATTERN = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;
/**
 * Static module specifiers: `import ... from "x"`, `export ... from "x"` and bare `import "x"`.
 *
 * Deliberately not a parser. Everything it finds is checked against the files that actually
 * exist in `dist/assets`, so a string literal inside the minified code that happens to read
 * like an import cannot add anything to the graph. `import("x")` — the lazy boundary — has no
 * `from` and does not match the bare form either, so dynamic chunks stay out, which is the
 * whole point of the walk.
 */
const STATIC_IMPORT_PATTERN = /\b(?:from|import)\s*["']([^"']+)["']/g;

/**
 * Reads a built file and weighs it raw and gzipped.
 *
 * @param {string} name File name inside `dist/assets`.
 * @returns {Asset} The weighed file.
 */
function weigh(name) {
  const contents = readFileSync(join(ASSETS_DIRECTORY, name));
  return { name, rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength };
}

/**
 * The file name an asset reference in the HTML or in a chunk points at.
 *
 * Both forms appear: `/assets/index-HASH.js` from the page and `./react-HASH.js` from a
 * chunk. Only the base name matters, since everything lives in the one directory.
 *
 * @param {string} specifier The reference as written.
 * @returns {string} Its file name.
 */
function assetName(specifier) {
  return basename(specifier);
}

/**
 * Every chunk the browser must have before the entry can run: the entry and, transitively,
 * everything it imports statically.
 *
 * @param {string} entryName File name of the entry chunk.
 * @param {ReadonlySet<string>} existing The files actually present in `dist/assets`.
 * @returns {string[]} Their file names, entry first, each once.
 */
function collectInitialChunks(entryName, existing) {
  /** @type {string[]} */
  const ordered = [];
  const seen = new Set();

  /**
   * Adds one chunk, then everything it statically imports.
   *
   * @param {string} name File name of the chunk.
   * @returns {void}
   */
  function follow(name) {
    if (seen.has(name)) return;
    seen.add(name);
    ordered.push(name);

    const source = readFileSync(join(ASSETS_DIRECTORY, name), 'utf8');
    for (const [, specifier] of source.matchAll(STATIC_IMPORT_PATTERN)) {
      const imported = assetName(specifier);
      if (existing.has(imported)) follow(imported);
    }
  }

  follow(entryName);
  return ordered;
}

/**
 * Sums a set of weighed files into the result of one budget.
 *
 * @param {BundleBudget} budget The budget the sum is for.
 * @param {readonly Asset[]} assets The files it covers.
 * @returns {Result} The budget and what was measured against it.
 */
function tally(budget, assets) {
  return {
    budget,
    detail: assets.map((asset) => asset.name).join(', ') || '(nothing)',
    rawBytes: assets.reduce((sum, asset) => sum + asset.rawBytes, 0),
    gzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
  };
}

/**
 * A size in the kilobytes the budgets are written in.
 *
 * @param {number} bytes The size.
 * @returns {string} It, in kB, to one decimal.
 */
function kb(bytes) {
  return `${(bytes / BYTES_PER_KILOBYTE).toFixed(1)} kB`;
}

/* ───────────────────────────── measure ───────────────────────────── */

let html;
try {
  html = readFileSync(INDEX_HTML, 'utf8');
} catch {
  console.log(`FAIL — no ${INDEX_HTML}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const present = new Set(readdirSync(ASSETS_DIRECTORY));
const entryMatch = ENTRY_SCRIPT_PATTERN.exec(html);
if (!entryMatch) {
  console.log(`FAIL — ${INDEX_HTML} has no module entry script; the build did not finish.`);
  process.exit(1);
}

const initial = collectInitialChunks(assetName(entryMatch[1]), present).map(weigh);
const everyScript = [...present].filter((name) => name.endsWith('.js')).map(weigh);
const stylesheets = [...html.matchAll(STYLESHEET_PATTERN)].map((match) =>
  weigh(assetName(match[1])),
);
const scene = everyScript.filter((asset) => asset.name.startsWith(`${SCENE_CHUNK_STEM}-`));

if (scene.length === 0) {
  console.log(
    `FAIL — no \`${SCENE_CHUNK_STEM}-*.js\` chunk in ${ASSETS_DIRECTORY}. The 3D scene is meant to ` +
      'be reached through `lazy(() => import(...))` in src/app/App.tsx; a static import would ' +
      'fold it back into the entry chunk, which is exactly what this check exists to prevent.',
  );
  process.exit(1);
}

const results = [
  tally(INITIAL_JS_BUDGET, initial),
  tally(SCENE_JS_BUDGET, scene),
  tally(TOTAL_JS_BUDGET, everyScript),
  tally(CSS_BUDGET, stylesheets),
];

/* ───────────────────────────── report ───────────────────────────── */

const LABEL_WIDTH = Math.max(...BUNDLE_BUDGETS.map((budget) => budget.label.length));
const COLUMN_WIDTH = 11;

console.log('\n── bundle size, gzipped, against tooling/bundleBudget.ts\n');
console.log(
  `   ${'what'.padEnd(LABEL_WIDTH)} ${'raw'.padStart(COLUMN_WIDTH)} ${'gzip'.padStart(COLUMN_WIDTH)} ` +
    `${'budget'.padStart(COLUMN_WIDTH)} ${'headroom'.padStart(COLUMN_WIDTH)}`,
);
for (const result of results) {
  const headroom = result.budget.limitBytes - result.gzipBytes;
  console.log(
    `   ${result.budget.label.padEnd(LABEL_WIDTH)} ${kb(result.rawBytes).padStart(COLUMN_WIDTH)} ` +
      `${kb(result.gzipBytes).padStart(COLUMN_WIDTH)} ${kb(result.budget.limitBytes).padStart(COLUMN_WIDTH)} ` +
      `${(headroom < 0 ? `-${kb(-headroom)}` : kb(headroom)).padStart(COLUMN_WIDTH)}`,
  );
}

console.log('\n── every chunk\n');
const upFront = new Set([...initial, ...stylesheets].map((asset) => asset.name));
for (const asset of [...everyScript, ...stylesheets].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
  const where = upFront.has(asset.name) ? 'initial' : 'on demand';
  console.log(
    `   ${asset.name.padEnd(34)} ${kb(asset.rawBytes).padStart(COLUMN_WIDTH)} ` +
      `${kb(asset.gzipBytes).padStart(COLUMN_WIDTH)}   ${where}`,
  );
}

console.log('');
const breach = results.find((result) => result.gzipBytes > result.budget.limitBytes);
if (!breach) {
  console.log(`PASS — ${results.length} budgets, all within their limits.`);
  process.exit(0);
}

const over = breach.gzipBytes - breach.budget.limitBytes;
console.log(
  `FAIL — ${breach.budget.label}: ${kb(breach.gzipBytes)} gzipped against a budget of ` +
    `${kb(breach.budget.limitBytes)}, over by ${kb(over)}.`,
);
console.log(`   covers: ${breach.detail}`);
console.log(`   why it is budgeted: ${breach.budget.reason}`);
console.log(
  `   Either take the weight back out, or record the new measurement in ${BUDGET_FILE} — ` +
    'raising the number is a reviewed edit, not a side effect.',
);
process.exit(process.argv.includes(REPORT_FLAG) ? 0 : 1);
