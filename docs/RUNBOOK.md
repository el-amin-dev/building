# Runbook — floor

> Commands only. Not rationale. Not architecture.
> Every command here MUST work as-typed on a fresh clone.
> If behavior changes → this file changes in the SAME PR.
>
> Schema: sections below are placeholders. Fill them as the project is built.
> Empty section stays `_(fill me)_` — YAGNI.

## Setup

- `nvm install && nvm use` — Node from `.nvmrc` (`engines.node` is `^22.13.0 || ^24.0.0 || >=26.0.0`)
- `corepack enable` — only if pnpm is not installed; provides pnpm 11.21.0 (from `packageManager` in `package.json`)
- `pnpm install` — no dependency build scripts need approval; if a future dependency needs one, pnpm reports it and `pnpm approve-builds` records the approval in `pnpm-workspace.yaml`
- `cp .env.example .env.local` — optional; defaults apply when variables are unset
  - `VITE_APP_TITLE` — non-empty string, default `Floor`
  - `VITE_DEBUG_PANEL` — `true` or `false`, default `false`; the Leva panel only shows under `pnpm dev`
  - `VITE_*` values end up in the public bundle — never put secrets in them
- Ports are shell variables, not `.env` entries: `DEV_SERVER_PORT`, `PREVIEW_SERVER_PORT`, `E2E_SERVER_PORT` (integers 1–65535)
- `pnpm exec playwright install chromium` — once, before the first `pnpm test:e2e`

## Run

- `pnpm dev` — dev server on http://localhost:5173
- `DEV_SERVER_PORT=5199 pnpm dev` — dev server on another port
- `pnpm build` — type-check and build to `dist/`; fails immediately on an invalid `VITE_*` value
- `pnpm preview` — serve `dist/` on http://localhost:4173
- `PREVIEW_SERVER_PORT=4180 pnpm preview` — preview on another port

## Controls

- Exterior view (default): drag to orbit, wheel or pinch to zoom — pointer only (ADR-002)
- Interior view: activate the "Interior view" toggle; the "Interior 3D view" region takes focus (amber outline), the view opens in the +x/+z corner of the walkable area, 0.25 m from both walls, facing the opposite corner (every entry starts there), and the HUD shows "Move: W A S D · Look: I J K L" (screen readers get a full description of each key and of Tab to the toggle)
  - `W` / `S` — walk forward / back
  - `A` / `D` — step left / right
  - `J` / `L` — turn left / right
  - `I` / `K` — look up / down (limited to ±80°)
  - keys act only while the view has focus; Ctrl, Alt and Meta combinations are ignored, and pressing or releasing Meta (Cmd) clears held keys because macOS sends no keyup for them while Cmd is held
  - keys are physical positions (QWERTY labels): on AZERTY, `W A S D` are the keys labelled Z Q S D
  - walls stop movement
- `Tab` from the view moves focus to the "Interior view" toggle; `Enter` on the toggle switches back to the exterior view

## Test

- `pnpm test` — all unit tests (Vitest; jsdom for `src/`, node for `tooling/`)
- `pnpm test src/features/building/domain/viewMode.test.ts` — one file
- `pnpm test -t "toggles exterior to interior and back"` — one test by name
- `pnpm test:watch` — watch mode
- `pnpm test:e2e` — builds with the title `Floor E2E`, starts its own preview server on port 4174, runs Playwright on Chromium
- `E2E_SERVER_PORT=4190 pnpm test:e2e` — end-to-end tests on another port
- `pnpm test:e2e tests/e2e/smoke.spec.ts` — one end-to-end file
- `pnpm test:e2e tests/e2e/navigation.spec.ts` — one end-to-end file (interior navigation: walk, turn and return to the exterior view; movement keys ignored while the interior view is not focused)

## Database

- n/a — frontend only

## Lint / Format

- `pnpm typecheck` — `tsc -b` over app, tests, tooling, and tool configs
- `pnpm lint` — ESLint
- `pnpm lint --fix` — ESLint with autofix
- `pnpm format` — Prettier write
- `pnpm format:check` — Prettier check
- `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm test:e2e` — full gate

## Smoke checks

- `pnpm test:e2e` — page title, a visible `<canvas>`, and the "Interior view" toggle switching `aria-pressed` and the "View:" status; `tests/e2e/navigation.spec.ts`: (1) the "Interior 3D view" region takes focus, holding W walks and holding J turns (the canvas changes), Tab to the toggle and Enter return to the exterior view, no page errors; (2) movement keys are ignored while the interior view is not focused
- `pnpm build && pnpm preview`, then in another shell `curl -s http://localhost:4173/ | grep '<title>'` — expect `<title>Floor</title>`
- `pnpm dev`, open http://localhost:5173 — the chamber renders in the exterior view, drag to orbit; Tab to "Interior view" and press Enter: the view takes focus and the first frame shows two walls, the corner between them, the floor and the ceiling; hold W to walk, J / L to turn, I / K to look; walking into a wall stops; Tab to the toggle and press Enter to return to the exterior view

## Services / Ports

| Service      | Default port | Override (shell variable) | Start cmd       |
| ------------ | ------------ | ------------------------- | --------------- |
| Vite dev     | 5173         | `DEV_SERVER_PORT`         | `pnpm dev`      |
| Vite preview | 4173         | `PREVIEW_SERVER_PORT`     | `pnpm preview`  |
| E2E preview  | 4174         | `E2E_SERVER_PORT`         | `pnpm test:e2e` |

Defaults live in `tooling/ports.ts`. All servers use a strict port: they fail instead of picking another port.

## Troubleshooting

- `Error: Port 5173 is already in use` → `DEV_SERVER_PORT=5199 pnpm dev` (same pattern: `PREVIEW_SERVER_PORT=4180 pnpm preview`, `E2E_SERVER_PORT=4190 pnpm test:e2e`), or find the owner with `lsof -i :5173`
- `Invalid DEV_SERVER_PORT: expected an integer from 1 to 65535` (or `PREVIEW_SERVER_PORT` / `E2E_SERVER_PORT`) → `unset DEV_SERVER_PORT` or export a valid port
- `Invalid VITE_DEBUG_PANEL: expected "true" or "false"` or `Invalid VITE_APP_TITLE` when `pnpm dev` / `pnpm build` starts → fix the value in `.env.local` or the shell (see `.env.example`)
- Playwright `Executable doesn't exist` → `pnpm exec playwright install chromium`
- Playwright reports missing system libraries → `pnpm exec playwright install --with-deps chromium`
- `Unsupported engine` warnings → `nvm install && nvm use` (Node from `.nvmrc`)
