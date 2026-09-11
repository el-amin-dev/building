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
- Interior view: activate the "Interior view" toggle; the "Interior 3D view" region takes focus (amber outline), the view opens in the +x/+z corner of the walkable area, 0.25 m from both walls, facing the opposite corner (every entry starts there), and the HUD shows "Move: W A S D · Look: I J K L · Person view: V" plus a "Third person" toggle (screen readers get a full description of each key and of Tab to the toggle)
  - `W` / `S` — walk forward / back
  - `A` / `D` — step left / right
  - `J` / `L` — turn left / right
  - `I` / `K` — look up / down (limited to ±80°)
  - `V` — switch between first person (eye level, 1.68 m) and third person (camera behind and above a 1.80 m mannequin, looking at its head); the "Third person" HUD toggle does the same (`aria-pressed` shows the mode, the "View:" status reads "Interior · First person" or "Interior · Third person"); the pose is kept when switching, and the mode is kept when leaving and re-entering the interior
  - third person: the camera pulls in when a wall, the floor or the ceiling is closer than its 2.5 m follow distance, and the mannequin hides while the camera is closer than 0.6 m (e.g. with its back to a wall, as in the start corner)
  - keys act only while the view has focus; Ctrl, Alt and Meta combinations are ignored, and pressing or releasing Meta (Cmd) clears held keys because macOS sends no keyup for them while Cmd is held
  - keys are physical positions (QWERTY labels): on AZERTY, `W A S D` are the keys labelled Z Q S D
  - walls stop movement
- `Tab` from the view moves focus to the "Interior view" toggle, then to the "Third person" toggle; `Enter` on "Interior view" switches back to the exterior view, `Enter` or `Space` on "Third person" switches the camera mode

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
- `pnpm dev`, open http://localhost:5173 — the chamber renders in the exterior view, drag to orbit; Tab to "Interior view" and press Enter: the view takes focus and the first frame shows two walls, the corner between them, the floor and the ceiling; hold W to walk, J / L to turn, I / K to look; walking into a wall stops; press V: the camera moves behind and above the person, and the mannequin (slate body, dark visor on the front of the head) appears once the camera has room behind it; back up to a wall with S and the camera pulls in and the mannequin hides; press V again for eye level; Tab to "Third person" and press Enter for the same switch; Tab back to "Interior view" and press Enter to return to the exterior view

## CI

- Workflow `.github/workflows/ci.yml` runs on every pull request and on every push to `main`; a newer push to a pull request cancels that pull request's run in progress, while every push to `main` runs to completion
- One job, `ci` (Ubuntu, Node from `.nvmrc`, pnpm from `packageManager`, 15-minute timeout): `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm exec playwright install --with-deps chromium`, `pnpm test:e2e` — the same full gate as locally
- `ci` is the required status check on `main`: a pull request merges only when it is green
- `pnpm install --frozen-lockfile` fails when `pnpm-lock.yaml` does not match `package.json` → run `pnpm install` locally and commit the lockfile
- On CI, Playwright retries a failing test twice (a trace is recorded on the first retry) and writes a GitHub annotation plus an HTML report

### Read a failure

- `gh pr checks` — status of the checks on the current branch's pull request (`gh pr checks --watch` waits until they finish)
- `gh run list --workflow ci.yml --branch "$(git branch --show-current)" --limit 5` — recent runs of this branch, with their run IDs
- `gh run view <run-id> --log-failed` — log of the failed steps only (`gh run view --log-failed` without an ID asks which run)
- `gh run view <run-id> --web` — open the run in the browser

### Playwright report artifact

- Uploaded whenever the job is not cancelled (passed or failed), so traces of tests that passed on retry are kept too; artifact `playwright-report`, kept 7 days
- It holds `playwright-report/` and, when tests wrote traces or failure output, `test-results/`
- No artifact exists when the job failed before the end-to-end tests produced output; `gh run download` then prints `no valid artifacts found to download`
- `gh run download <run-id> --name playwright-report --dir /tmp/floor-playwright-report` — download and extract it
- `pnpm exec playwright show-report /tmp/floor-playwright-report/playwright-report` — open the HTML report (traces of retried tests open from the report)
- If that path does not exist, open `index.html` wherever it sits in the downloaded folder: `find /tmp/floor-playwright-report -name index.html`

### Rerun

- `gh run rerun <run-id> --failed` — rerun only the failed jobs of a run
- `gh run rerun <run-id>` — rerun the whole run

### Dependabot

- `.github/dependabot.yml` opens weekly pull requests for npm packages and GitHub Actions; minor and patch updates arrive grouped in one pull request per ecosystem, majors one per dependency
- Workflow actions stay on major tags (for example `actions/checkout@v7`); Dependabot proposes the next major tag when one is released
- Version caps are ignore rules there, each with its own reason:
  - ADR-001: `react`, `react-dom` stay below 19.3.0, `typescript` below 6.1.0, `jsdom` below 30.0.0 — change one of these in `docs/DECISIONS.md` and `.github/dependabot.yml` together
  - `@types/react`, `@types/react-dom` stay below 19.3.0 to follow the React cap — change them together with the `react` / `react-dom` cap
  - `@types/node` stays below 23.0.0 so Node types match the Node 22 baseline in `.nvmrc`, the lowest supported runtime — change it together with `.nvmrc`
- Dependabot pull requests run the same `ci` check as any other pull request

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
