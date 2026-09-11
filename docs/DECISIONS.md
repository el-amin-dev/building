# Architecture Decision Records

> Append-only. One entry per significant decision. Newest on top.
> "Significant" = affects architecture, data model, security posture, or is hard to reverse.

<!--
Entry format (use exactly this shape):

## ADR-NNN — <title> (<date>)
- status: accepted | superseded-by-ADR-NNN
- context: <what forced a decision>
- decision: <what was chosen>
- alternatives: <what was rejected + why>
- consequences: <trade-offs accepted>
-->

<!-- append ADRs below, newest first -->

## ADR-002 — Defer keyboard and single-pointer camera navigation (2026-09-11)

- status: accepted
- context: The placeholder scene moves the camera only through drei `OrbitControls`: drag to orbit, wheel or pinch to zoom. Keyboard users cannot move the camera, which fails WCAG 2.1.1 Keyboard, and orbiting needs a dragging movement with no single-pointer alternative, which fails WCAG 2.5.7 Dragging Movements. Camera navigation is the first real feature to be built, so controls made now for a placeholder box would be reworked once the real navigation model (exterior orbit, interior movement between floors and rooms) exists.
- decision: Defer accessible camera navigation to the camera-navigation feature, which must ship keyboard controls and single-pointer (button) controls for every camera movement before it is done. Until then the canvas carries no misleading role (neither `role="img"`, which hides that it is interactive, nor `role="application"`, which announces keyboard interaction that does not exist), and a visually hidden description states that camera movement is pointer-only for now.
- alternatives: build HUD rotate/zoom buttons and key bindings now (throwaway work before the navigation model is designed); `role="application"` on the canvas (misleads assistive technology users into expecting keyboard support).
- consequences: The placeholder scene is not WCAG 2.2 AA conformant for camera movement until the camera-navigation feature lands. The HUD (view mode toggle) is already keyboard and single-pointer operable.

## ADR-001 — Frontend stack: Vite + React + TypeScript + React Three Fiber (2026-09-11)

- status: accepted
- context: The product is a browser-only 3D building that users explore from the outside and then inside (floors, rooms, kitchen). It needs a declarative scene graph that composes with a regular UI layer (HUD, menus), fast local iteration, unit-testable logic, and an end-to-end check that WebGL actually renders. There is no backend.
- decision: Vite 8 + React 19.2 + TypeScript 6.0; three.js through `@react-three/fiber` 9 and `@react-three/drei` 10; Zustand 5 for shared UI state; Tailwind CSS 4 for the HUD; Leva for a development-only tweak panel; Vitest 5 + Testing Library (jsdom) for unit tests; Playwright (Chromium only) for end-to-end tests; ESLint 10 + Prettier. Code lives in a single feature module `src/features/building` with `domain` (pure TypeScript, no React/three) → `application` (store) → `ui` (components) seams, dependencies pointing inward; environment variables are parsed by a pure function (`src/app/parseAppConfig.ts`) that both the Vite config (fail fast at dev/build start) and the app (`src/app/config.ts`) call. Version caps: `react`/`react-dom` stay on `~19.2.8` because `@react-three/fiber` 9.7 declares the peer range `react >=19 <19.3` (19.3.0 is already published); `typescript` stays on `~6.0.3` because `typescript-eslint` 8.x declares the peer range `typescript <6.1.0` (7.x is already published). `jsdom` stays on `^29.1.1` because jsdom 30 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`, while 29.x accepts Node `^22.13.0 || >=24.0.0` and works with Vitest 5 (peer range `*`). `engines.node` is `^22.13.0 || ^24.0.0 || >=26.0.0`: the intersection of every `engines.node` range in the resolved dependency graph, bounded by Vitest 5 (`^22.12.0 || ^24.0.0 || >=26.0.0`) and ESLint 10 / jsdom 29 (`^20.19.0 || ^22.13.0 || >=24`).
- alternatives: plain three.js (imperative scene management, no component model shared with the HUD); Babylon.js (heavier runtime, weaker React integration); Next.js (server rendering adds nothing to a client-side WebGL app); Redux Toolkit (more ceremony than Zustand for small UI state); Jest (separate transform pipeline, whereas Vitest reuses the Vite config); Cypress (Playwright is faster headless and simpler to run in CI); latest React 19.3 / TypeScript 7 (outside the peer ranges of `@react-three/fiber` and `typescript-eslint`); jsdom 30 (narrows the supported Node range for no benefit to these tests).
- consequences: React and TypeScript upgrades are blocked until `@react-three/fiber` and `typescript-eslint` widen their peer ranges; the `~` ranges keep `pnpm update` from crossing the caps. Node 22 older than 22.13.0 is unsupported; moving to jsdom 30 later raises the floor to `^22.22.2 || ^24.15.0 || >=26.0.0`. The WebGL `<Canvas>` cannot run under jsdom, so the 3D scene is covered only by the Playwright smoke test. Leva is part of the production bundle (its panel is hidden outside development). three.js makes the main chunk large; code splitting is deferred until real building content exists.
