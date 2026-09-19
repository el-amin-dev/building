/**
 * What the built bundle is allowed to weigh, as reviewable numbers.
 *
 * WHY a file of constants and not a flag on the build: before the split
 * (ADR-001 deferred it "until real building content exists") the whole
 * application shipped as one 1 418 kB chunk, 402 kB gzipped, and nothing said
 * so except a warning nobody had to act on. A budget is only a gate if raising
 * it costs a reviewed edit, so every number lives here, next to the measurement
 * it was taken from and the reason it exists. `scripts/check-bundle-size.mjs`
 * reads them; `pnpm size` runs it; CI runs it right after the build.
 *
 * Each budget is its measurement × 1.15, rounded to a number a human can read.
 * The 15 % is room for ordinary growth — a dependency bump, a few more rooms —
 * not room for a second copy of a library. A breach is a question ("what did we
 * just add?"), and the answer is either a fix or a new measured value recorded
 * below.
 *
 * Sizes are gzipped, because that is what crosses the network, and in Vite's
 * kilobytes (1 000 bytes) so they can be compared with the build's own report.
 */

/** Bytes in the kilobyte used throughout this file — Vite's kB, not the 1 024-byte KiB. */
export const BYTES_PER_KILOBYTE = 1000;

/**
 * Filename stem of the chunk the 3D scene is loaded from.
 *
 * `src/app/App.tsx` reaches `BuildingScene` through `lazy(() => import(...))`, and the
 * bundler names the chunk after the module. The checker fails when no such chunk exists,
 * which is what catches the split being undone: a static import of the scene would fold it
 * back into the entry and there would be nothing by this name to weigh.
 */
export const SCENE_CHUNK_STEM = 'BuildingScene';

/** One budgeted quantity: what it covers, what it may weigh, and where the number came from. */
export interface BundleBudget {
  /** What the budget covers, as the report prints it. */
  readonly label: string;
  /** Upper bound on the gzipped size, in bytes. */
  readonly limitBytes: number;
  /** The measured gzipped size this limit was derived from, in bytes. */
  readonly measuredBytes: number;
  /** Why this quantity is worth a gate at all. */
  readonly reason: string;
}

/**
 * The entry chunk plus everything statically imported from it: what a visitor downloads
 * before anything can paint.
 *
 * The one number that decides how soon the HUD appears, and the only one that a stray
 * top-level `import` from the scene can wreck silently — it would move three.js back across
 * the line without changing any other total. Measured at 91.8 kB gzipped (entry 32.4 +
 * `react` 59.0 + the rolldown runtime 0.4), down from 402 kB when everything was one chunk.
 * It was 87.5 kB before the resilience layer was wired into the shell: the WebGL check, the
 * error boundary and the two fallback panels are in the entry chunk by design, since they are
 * what has to render when the scene chunk is the thing that will not arrive.
 */
export const INITIAL_JS_BUDGET: BundleBudget = {
  label: 'initial JS (entry + static imports)',
  limitBytes: 100 * BYTES_PER_KILOBYTE,
  measuredBytes: 91.8 * BYTES_PER_KILOBYTE,
  reason: 'What must arrive before the HUD can paint; a static scene import would blow it.',
};

/**
 * The lazily loaded scene chunk itself — the building model and the code that draws it.
 *
 * Its vendors (`three`, `r3f`, `leva`) are chunks of their own, so this one is the floor
 * itself: rooms, walls, openings, fixtures. It grows as the building does, which is why it is
 * budgeted separately rather than hidden inside the total. Measured at 19.3 kB gzipped.
 */
export const SCENE_JS_BUDGET: BundleBudget = {
  label: 'scene chunk',
  limitBytes: 22 * BYTES_PER_KILOBYTE,
  measuredBytes: 19.3 * BYTES_PER_KILOBYTE,
  reason: 'The building model itself; separated so its growth is legible, not averaged away.',
};

/**
 * Every JavaScript chunk in `dist/`, initial and lazy alike.
 *
 * Splitting moves weight; it does not remove it, and a split that quietly doubled a library
 * across two chunks would leave every other budget green. This is the total that catches
 * that. Measured at 413.6 kB gzipped, which includes `leva` (68.7 kB). That chunk is fetched
 * on every production visit, not only under `VITE_SHOW_DEBUG_PANEL`: `SceneLighting` imports
 * `useControls`, so leva is a dependency of the scene itself and arrives with it. ADR-016
 * records that as a debt to pay separately — the point here is that the number below is a
 * real download, not a chunk that merely sits in `dist/`.
 */
export const TOTAL_JS_BUDGET: BundleBudget = {
  label: 'total JS',
  limitBytes: 470 * BYTES_PER_KILOBYTE,
  measuredBytes: 413.6 * BYTES_PER_KILOBYTE,
  reason: 'Catches weight moved between chunks, or a library duplicated across them.',
};

/**
 * The stylesheet.
 *
 * Tailwind emits only the utilities the source actually uses, so this number tracks how many
 * distinct utilities the HUD has accumulated; a jump means a stylesheet stopped being purged,
 * not that a panel grew. Measured at 4.3 kB gzipped.
 */
export const CSS_BUDGET: BundleBudget = {
  label: 'CSS',
  limitBytes: 5 * BYTES_PER_KILOBYTE,
  measuredBytes: 4.3 * BYTES_PER_KILOBYTE,
  reason: 'Tracks utility accumulation, and catches a stylesheet that stopped being purged.',
};

/** Every budget, in the order the size report prints them. */
export const BUNDLE_BUDGETS: readonly BundleBudget[] = [
  INITIAL_JS_BUDGET,
  SCENE_JS_BUDGET,
  TOTAL_JS_BUDGET,
  CSS_BUDGET,
];
