import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { parseAppConfig } from './src/app/parseAppConfig.ts';
import { DEV_SERVER_PORT, PREVIEW_SERVER_PORT } from './tooling/ports.ts';

const CLIENT_ENV_PREFIX = 'VITE_';
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (character) => HTML_ESCAPES[character]);
}

function htmlTitle(title: string): Plugin {
  return {
    name: 'html-title',
    transformIndexHtml: () => [{ tag: 'title', children: escapeHtml(title), injectTo: 'head' }],
  };
}

/**
 * The vendor chunks, in the order the bundler resolves them.
 *
 * The names are deliberate and stable, because `pnpm size` budgets them by name
 * (`tooling/bundleBudget.ts`): a nameless hashed chunk would let the meaning of a budget
 * change silently under a number that stayed constant. Anything no group claims is left
 * where the bundler would have put it, which for everything under the lazily imported scene
 * is the scene's own chunk.
 *
 * Only `react` is part of the initial download: the shell imports it directly. `three`, `r3f`
 * and `leva` all hang off `BuildingScene`'s dynamic import, so they are fetched when — and
 * only when — the scene is mounted. `leva` is there for two importers, not one: `DebugPanel`
 * for the panel frame, and `SceneLighting` for `useControls`, which is inside the scene and
 * therefore arrives with it however the debug flag is set. That is a recorded debt in
 * ADR-016, not an accident of this grouping. Splitting them apart rather than leaving one
 * scene chunk is what makes the size report legible: a jump in `three` after a dependency
 * bump reads differently from a jump in the building model itself.
 *
 * WHY `priority` and not just four `test`s: a group takes its captured modules' dependencies
 * with it, and drei and fiber depend on three, which depends on react. Descending priority is
 * what makes the specific claim win — a module captured by a higher-priority group is removed
 * from the lower ones — so three's 600 kB land in `three` rather than being swallowed into
 * whichever group happened to reach them first. Measured: without the priorities, `react`
 * came out empty and `r3f` weighed 908 kB.
 *
 * WHY `r3f` alone takes no dependencies with it: fiber's own dependency zustand is also the
 * shell's store, and captured into `r3f` it made the entry statically import that chunk —
 * 47.5 kB gzipped of drei and fiber arriving before anything could paint, for one 1 kB store.
 * Left uncaptured, zustand lands in the entry chunk where the shell needs it anyway, and the
 * scene reads it from there. The other three groups keep the default, so leva's own
 * dependencies stay with leva instead of forming a chunk named after whichever one of them
 * the bundler happened to pick.
 *
 * WHY groups and not the `manualChunks` Rollup compatibility shim: rolldown maps it to one
 * group whose settings cannot be reached, which is exactly the setting above, and it is
 * deprecated in the bundler this project builds with.
 *
 * Each `test` ends on a path separator, so `three` does not also capture `three-stdlib` and
 * `react` does not capture `react-dom` (which is named in its own alternative). `[\\/]`
 * rather than `/` because the ids carry Windows separators there.
 */
const VENDOR_CHUNK_GROUPS = [
  { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 40 },
  { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 30 },
  {
    name: 'r3f',
    test: /node_modules[\\/]@react-three[\\/]/,
    priority: 20,
    includeDependenciesRecursively: false,
  },
  { name: 'leva', test: /node_modules[\\/]leva[\\/]/, priority: 10 },
];

export default defineConfig(({ mode }) => {
  const { appTitle } = parseAppConfig(loadEnv(mode, process.cwd(), CLIENT_ENV_PREFIX));

  return {
    plugins: [react(), tailwindcss(), htmlTitle(appTitle)],
    build: {
      // Just above the largest chunk this split produces — three, measured at 740 kB
      // minified — so the warning stays a live early warning for the next thing that grows,
      // instead of being silenced with a number nothing could ever reach. The gate is
      // `pnpm size` against tooling/bundleBudget.ts; this is only the nudge during a build.
      chunkSizeWarningLimit: 760,
      rollupOptions: {
        output: {
          codeSplitting: { groups: VENDOR_CHUNK_GROUPS },
        },
      },
    },
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,
    },
    preview: {
      port: PREVIEW_SERVER_PORT,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tooling/**/*.test.ts'],
    },
  };
});
