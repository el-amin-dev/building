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
- `DEV_SERVER_PORT=5199 pnpm dev` — dev server on another port; **5173 is already taken on this machine**, so use this form (`curl -s http://localhost:5199/ | grep '<title>'` answers `<title>Floor</title>`)
- `pnpm build` — type-check and build to `dist/`; fails immediately on an invalid `VITE_*` value
- `pnpm preview` — serve `dist/` on http://localhost:4173
- `PREVIEW_SERVER_PORT=4180 pnpm preview` — preview on another port

## Controls

- Exterior view (default): drag to orbit, wheel or pinch to zoom — pointer only (ADR-002)
- Interior view: activate the "Interior view" toggle; the "Interior 3D view" region takes focus (amber outline), the view opens in the **middle** of the walkable area — (4.10, 2.00), the centre of the master bedroom — facing −x straight through the balcony-A doorway (every entry starts there, ADR-008), and the HUD shows "Move: W A S D · Look: I J K L · Person view: V · or use the on-screen remote control" plus a "Third person" toggle (screen readers get a full description of each key, of Tab to the toggles and of Shift+Tab back to the view)
  - `W` / `S` — walk forward / back
  - `A` / `D` — step left / right
  - `J` / `L` — turn left / right
  - `I` / `K` — look up / down (limited to ±80°)
  - `V` — switch between first person (eye level, 1.68 m) and third person (camera behind and above a 1.80 m mannequin, looking at its head); the "Third person" HUD toggle does the same (`aria-pressed` shows the mode, the "View:" status reads "Interior · First person" or "Interior · Third person"); the pose is kept when switching, and the mode is kept when leaving and re-entering the interior
  - third person: `I` (look up) tilts the camera down to a level view from behind the head, `K` (look down) raises it toward overhead (from 0° to 80° above the head's level, 15° at level pitch); the camera never goes below head height, so it never clips the body; the camera pulls in when a wall, the floor or the ceiling is closer than its 2.5 m follow distance; when a wall close behind the person leaves less than 0.5 m (e.g. after backing into a wall), the camera rises over the person and looks down at its head instead, also while looking up, so the mannequin stays visible; the mannequin only hides if even that leaves the camera closer than 0.5 m (e.g. under a very low ceiling). At the mid-room start pose the camera keeps 2.433 m of its 2.50 m follow distance, so third person opens on the whole person, not a head close-up
  - keys act only while the view has focus; Ctrl, Alt and Meta combinations are ignored, and pressing or releasing Meta (Cmd) clears held keys because macOS sends no keyup for them while Cmd is held
  - keys are physical positions (QWERTY labels): on AZERTY, `W A S D` are the keys labelled Z Q S D
  - walls stop movement
- On-screen remote control (interior view only, no keyboard needed): a HUD pad labelled "Remote control" with one hold-to-act button per movement, so every key above has an equivalent button
  - "Move" cluster — `Move forward` (↑), `Move back` (↓), `Strafe left` (←), `Strafe right` (→)
  - "Turn" cluster — `Turn left` (⟲), `Turn right` (⟳)
  - "Look" cluster — `Look up` (▲), `Look down` (▼), limited to ±80° like `I` / `K`
  - a button acts while it is **held**: press and hold with a mouse or a finger, or hold `Space` or `Enter` while the button has focus; there is no drag and no gesture (WCAG 2.5.7) and every button is at least 44 px (WCAG 2.5.8)
  - `aria-pressed` marks a held button, which also turns amber
  - holding several buttons combines them exactly like held keys, and opposite buttons (forward + back) cancel out
  - releasing after a **pointer** hold returns focus to the "Interior 3D view" region, so the keys keep working; releasing after a **keyboard** hold leaves focus on the button
  - a hold also ends — and never sticks — when the pointer is released away from the button, when the pointer is cancelled or its capture is lost, when the window loses focus (Alt/Cmd-Tab), when the camera mode changes, and when the interior view is left
- Phone width (below Tailwind's `sm` breakpoint, e.g. 400 px): the pad leaves the HUD stack and anchors to the **bottom** of the screen, full width and centred; the status line and both toggles share one row (the camera mode stays in the status for screen readers, hidden visually); the visible hint shortens to "Move with the pad below · or W A S D". The 3D view keeps ~73.5% of the height at 400 × 800. Nothing changes for assistive technology — the full key description and the Tab order are the same at every width — and from `sm` up the layout is unchanged
- `Tab` from the view moves focus to the "Interior view" toggle, then to the "Third person" toggle, then through the eight remote-control buttons; `Enter` on "Interior view" switches back to the exterior view, `Enter` or `Space` on "Third person" switches the camera mode and keeps focus on the button: `Shift+Tab` returns to the view (twice from "Third person", once from "Interior view")
- clicking "Third person" with the mouse switches the camera mode and returns focus to the view, so the keys keep working

## Test

- `pnpm test` — all unit tests, 1505 of them (Vitest; jsdom for `src/`, node for `tooling/`)
- `pnpm test src/features/building/domain/viewMode.test.ts` — one file
- `pnpm test src/features/building/domain/walls.test.ts` — one file, the wall generator (its brief §8 check: the cells cover 42.52 m²)
- `pnpm test -t "toggles exterior to interior and back"` — one test by name
- `pnpm test:watch` — watch mode
- `pnpm test:e2e` — builds with the title `Floor E2E`, starts its own preview server on port 4174, runs Playwright on Chromium: 9 tests across 4 files (verified: 9 passed in 1.2 min)
- `E2E_SERVER_PORT=4196 pnpm test:e2e` — end-to-end tests on another port; use this form when 4174 is busy, with any free port (verified on 4196: 9 passed). The run fails fast with `http://localhost:<port> is already used` when the port is taken, because it always starts its own server
- `pnpm test:e2e tests/e2e/smoke.spec.ts` — one end-to-end file
- `pnpm test:e2e tests/e2e/exterior.spec.ts` — one end-to-end file, 2 tests, both `test.slow()`: the committed screenshot baselines of (1) the default exterior frame of the whole floor and (2) the interior first-person start pose. Each settles the scene (two identical captures in a row) before comparing the canvas with the whole HUD masked, at a 0.01 diff-pixel ratio for software-WebGL edge noise. Baselines live in `tests/e2e/__screenshots__/exterior.spec.ts/` and are per project and platform (`chromium-linux`)
- A baseline is written locally when it is missing (`updateSnapshots: 'missing'`) but never on CI (`'none'`), so CI cannot accept a baseline silently. To change one on purpose: delete the `.png` and run the file again, or `pnpm exec playwright test tests/e2e/exterior.spec.ts --update-snapshots`, then review the image in the diff before committing it
- The committed baselines are **`chromium-linux` only**. On another platform Playwright looks for a file that does not exist and writes your own baseline locally instead — that is expected, not a failure to "fix", and a mismatch against a Linux baseline on macOS or Windows says nothing about the scene. Only Linux baselines are committed, because CI is the Ubuntu runner
- `pnpm test:e2e tests/e2e/navigation.spec.ts` — one end-to-end file, 3 tests: (1) walk, turn and return to the exterior view; (2) V and the "Third person" button switch the camera mode (V at the start pose changes the scene, a mouse click on the button returns focus to the view); (3) movement keys and V ignored while the interior view is not focused. Frame comparisons mask the HUD, so only the rendered scene counts. Tests (1) and (2) are marked `test.slow()` (90 s instead of 30 s), because polling frames rendered by software WebGL, and the mannequin's first shader compilation, take most of the default limit
- `pnpm test:e2e tests/e2e/remoteControl.spec.ts` — one end-to-end file, 3 tests, all `test.slow()`: (1) the pad walks and turns with the **mouse alone** (not a single keyboard event: it holds "Move forward", then "Turn left", and each release must stop the scene changing) and focus is back on the "Interior 3D view" region afterwards; (2) sliding off "Turn left" and releasing the pointer over the canvas still stops the turn (no stuck action); (3) at a 400 px phone width all 8 buttons stay visible, at least 24 × 24 px, hit-testable and free of horizontal page scroll, and holding "Move forward" still walks there. Frame comparisons mask the whole HUD, because a held button's `aria-pressed` colour would otherwise make the comparison pass on its own
- `E2E_SERVER_PORT=4194 pnpm test:e2e tests/e2e/remoteControl.spec.ts` — same on another port; use this form when 4174 is busy (verified: 3 passed in 38.6 s)
- `E2E_SERVER_PORT=4196 pnpm exec playwright test tests/e2e/navigation.spec.ts --repeat-each 3` — repeat one file to check for flakiness
- The **local full gate is the merge gate** (see "Lint / Format"): a green local chain is what authorises a merge. GitHub CI is advisory only while the repository has a billing problem, so `ci` may be red or unstarted on a pull request whose local gate is green

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

- `pnpm test:e2e` — page title, a visible `<canvas>`, and the "Interior view" toggle switching `aria-pressed` and the "View:" status; `tests/e2e/navigation.spec.ts`: (1) the "Interior 3D view" region takes focus, holding W walks and holding J turns (the canvas changes), Tab to the toggle and Enter return to the exterior view, no page errors; (2) V at the start pose and the "Third person" button switch the camera mode and change the scene (HUD masked), and W still walks after a mouse click on the button; (3) movement keys and V are ignored while the interior view is not focused; `tests/e2e/exterior.spec.ts`: the two committed baselines — the default exterior frame of the whole floor and the interior first-person start pose (verified: 9 tests passed in 1.2 min)
- `E2E_SERVER_PORT=4194 pnpm test:e2e tests/e2e/remoteControl.spec.ts` — the pad drives the interior with no keyboard at all, stops on release (including a release away from the button), and fits a 400 px phone width with every button tappable
- `pnpm build && pnpm preview`, then in another shell `curl -s http://localhost:4173/ | grep '<title>'` — expect `<title>Floor</title>`
- `DEV_SERVER_PORT=5199 pnpm dev`, open http://localhost:5199 (5173 is taken on this machine) — walk the **whole floor** (22.50 × 10.00 m, ADR-008):
  - exterior view: the frame holds the whole floor, seen from the open side B and turned a little toward side A, so two sides are visible at once; drag to orbit, wheel to zoom — zooming in never enters the walls. The camera is derived from the viewport, not hand-placed: at 16:9 it fits the floor from 21.56 m and the building spans about 0.69 of the tighter frame axis
  - two cosmetic limits of that default frame are known and deferred to Part 4, so do not chase them: there is **no sky or horizon** (the dark ground plane fills the background behind the floor), and in a portrait window (e.g. 400 × 800) the building fills only about a quarter of the height, because the frame is width-bound at that aspect
  - the low walls read as parapets (1.10 m) where they front the A balcony and the side-B void, while every wall enclosing a room or the corridor is full height (2.70 m)
  - the side-B void reads as a hole through the floor, not as a terrace: the balcony slab sits in the middle of the strip, and its two edges against the void carry thin metal railings
  - the void reads as a **shaft**: orbit until you look into the 1.00 m opening — the ground is a storey below the slabs (−3.30 m) and dark, so what shows through is clearly further away and darker than the lit slabs around it, and the side face of the shaft is what gives its depth. There is no shadow gradient down the shaft: there are no shadow maps in Part 2 (ADR-008), so depth comes from the side face alone
  - the stairs bay shows the dog-leg: an up-flight in the northern half, the half-landing at its western end, the return flight coming back in the southern half, and the walkable landing on the corridor side
  - the dark television panel faces the living-room opening from the corridor's south wall
  - windows appear on the side-A and side-B faces only: none on side C (the living room and both kids bedrooms have none) and none on side D
  - drive the interior with the **remote buttons alone**: Tab to "Interior view", Enter, then use only the mouse on the pad — hold "Move forward" to walk, "Turn left" / "Turn right" to turn, "Look up" / "Look down" to look; every release stops the movement at once; release a button while the pointer is over the canvas and nothing keeps moving; click "Third person" and the pad still drives the person
  - repeat the previous check with the window narrowed to 400 px (phone width): the pad leaves the HUD stack and sits **bottom-anchored**, full width and centred; the status line and both toggles share one row at the top; the hint shortens to "Move with the pad below · or W A S D"; the 3D view keeps most of the height between the two (~73.5% at 400 × 800) instead of being squeezed into a strip; there is no horizontal page scroll, and every button is still at least 44 px and tappable. Widen the window again and the desktop layout is unchanged
  - keys still work alongside the pad: hold W to walk, J / L to turn, I / K to look, V to switch person view; walking stops at the edge of the master bedroom, which is the interim clamp until Part 3 brings wall collision (ADR-008)
  - the interior opens mid-room facing the balcony-A doorway, never in a corner, and `V` there shows the **whole** person from behind (2.433 m of the 2.50 m follow distance), not a close-up of the head (ADR-008)
  - the interior lighting is the same on every entry: enter, leave, and enter again — the rooms are shaded identically, and entering the interior directly is identical to entering it after the exterior has settled (ADR-009)

## CI

- Workflow `.github/workflows/ci.yml` runs on every pull request and on every push to `main`; a newer push to a pull request cancels that pull request's run in progress, while every push to `main` runs to completion
- One job, `ci` (Ubuntu, Node from `.nvmrc`, pnpm from `packageManager`, 15-minute timeout): `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm exec playwright install --with-deps chromium`, `pnpm test:e2e` — the same full gate as locally
- `ci` is the required status check on `main` in the branch protection settings, but it is **advisory in practice** while the repository has a billing problem: the merge gate is the green local full gate above (see "Test"), not the GitHub run
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

- `Error: Port 5173 is already in use` → `DEV_SERVER_PORT=5199 pnpm dev` (same pattern: `PREVIEW_SERVER_PORT=4180 pnpm preview`, `E2E_SERVER_PORT=4196 pnpm test:e2e`), or find the owner with `lsof -i :5173`
- `Invalid DEV_SERVER_PORT: expected an integer from 1 to 65535` (or `PREVIEW_SERVER_PORT` / `E2E_SERVER_PORT`) → `unset DEV_SERVER_PORT` or export a valid port
- `Invalid VITE_DEBUG_PANEL: expected "true" or "false"` or `Invalid VITE_APP_TITLE` when `pnpm dev` / `pnpm build` starts → fix the value in `.env.local` or the shell (see `.env.example`)
- `Error: http://localhost:4174 is already used, make sure that nothing is running on the port/url` → the end-to-end run always starts its own server (`reuseExistingServer: false`), so a busy port fails fast: find the owner with `ss -ltnp | grep 4174` and re-run with `E2E_SERVER_PORT=<free port> pnpm test:e2e`
- The heavy interactive end-to-end tests (`navigation.spec.ts`, `remoteControl.spec.ts`) **time out under heavy external machine load** — they poll frames rendered by software WebGL, so unrelated processes holding the machine busy (observed: a 12-core box at load 18–33) are enough to exhaust even the `test.slow()` budget. This is an environment characteristic, not a code defect: the two screenshot baselines passed in every run, including the loaded ones. Check `uptime` before blaming the code, then re-run when the load is low, or run one file at a time
- `Screenshot comparison failed` (`exterior.spec.ts`) → open the `-actual`, `-expected` and `-diff` PNGs Playwright writes under `test-results/`. An intended change is regenerated deliberately (see "Test"); an unintended one is a real rendering regression. A frame that differs between runs of the **same** checkout is non-determinism in the scene, not a tolerance to raise — that is exactly the Leva seeding trap of ADR-009
- `Some chunks are larger than 500 kB after minification` during `pnpm build` → expected and pre-existing: three.js dominates the bundle, and the lazy-loading task is in Part 4. The build still exits 0, so this is a warning, not a failure
- Playwright `Executable doesn't exist` → `pnpm exec playwright install chromium`
- Playwright reports missing system libraries → `pnpm exec playwright install --with-deps chromium`
- `Unsupported engine` warnings → `nvm install && nvm use` (Node from `.nvmrc`)
