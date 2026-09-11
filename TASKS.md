# Tasks

> Roadmap to finish the 3D simulation of the house floor (22.50 × 10.00 m, one storey).
> Sources of truth: `docs/house-design-brief.md` (requirements, wins on conflict) · `docs/source-of-truth-n-floor.drawio.html` Page-2 (drawing, 30 px = 1 m; Page-4 is history).
> Parts run in order — each part is one work session and starts only when the previous part is fully `[x]`.

**Next: Part 1**

## How to run a part

1. Read this file and take the first part with `[ ]` tasks.
2. Confirm its `depends-on` part is fully `[x]` and required owner answers exist.
3. Pre-flight check, then branch from `main` as `<type>/<issue>-<slug>`.
4. Work on independent tasks in parallel where possible; dependent tasks in order.
5. Tick `[x]` only when the task's code and its tests are green.
6. Finish with the part's DoD gate.

## Definition of Done (every DoD gate)

- `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm test:e2e` green
- tests land with the code; every domain function unit-tested; no magic numbers; no TODOs
- self code review clean — blocking findings fixed or deferred with an ADR
- `docs/RUNBOOK.md` and `docs/DECISIONS.md` updated when behavior or decisions change
- new UI meets WCAG 2.2 AA (keyboard, visible focus, contrast, accessible names)
- squash-merged into `main`

## Bootstrap — done

- [x] Scaffold: pnpm · Vite · React · TypeScript · R3F/drei · Zustand · Tailwind · Leva · Vitest · Playwright
- [x] `building` feature module with domain / application / ui seams and a view-mode toggle
- [x] Fail-fast env validation, ports from env, 33 unit tests and a Playwright smoke test
- [x] README, RUNBOOK, ADR-001 (stack and version caps), ADR-002 (camera accessibility deferral)
- [x] Bootstrap commit `dcacbc8` on `main`

## Part 0 — Demo: base chamber + eye navigation (W A S D move · J L turn · I K look)

- goal: walk inside one 5.00 × 3.40 m chamber — the base of the master and kids bedrooms — with an eye-level camera
- depends-on: Bootstrap
- exit: interior view takes focus; W/A/S/D walks, J/L turns, I/K looks up/down; walls stop movement

- [x] Create branch `feat/base-chamber-eye-navigation` from `main`
- [x] Add owner brief as `docs/house-design-brief.md` next to the drawing
- [x] Exclude both source-of-truth files from Prettier in `.prettierignore`
- [x] ADR-003 sources of truth: brief wins over drawing; Page-2 authoritative, Page-4 history; one storey; no windows yet
- [x] `domain/heights.ts` — frozen unified `FLOOR_HEIGHTS` (floor-to-floor 3.00 · wall 2.70 · door 2.10 · railing 1.10 · eye 1.60) + tests
- [x] `domain/chamber.ts` — `BASE_CHAMBER_SPEC` 5.00 × 3.40 with 0.20 walls, no height field, input validation + tests
- [x] `domain/chamber.ts` — wall boxes outside the clear size with closed corners, walkable bounds + tests
- [x] `domain/eyeNavigation.ts` — key bindings by `event.code` and movement intent (opposite keys cancel) + tests
- [x] `domain/eyeNavigation.ts` — `stepEyePose`: yaw-relative move, normalised diagonal, dt cap, wall clamp, pitch ±80° + tests
- [x] `ui/usePressedKeys.ts` — held keys scoped to the focused view, modifier combos ignored, cleared on blur + tests
- [x] `ui/ChamberModel.tsx` — floor and walls from domain data; ceiling only in the interior view
- [x] `ui/EyeCameraControls.tsx` — per-frame eye camera: pose in a ref, `YXZ` rotation, eye height from `FLOOR_HEIGHTS`
- [x] `ui/BuildingScene.tsx` — chamber replaces the placeholder box; exterior orbit ↔ interior eye camera by view mode
- [x] Interior view region: `tabIndex=0`, `role="application"`, accessible name, focus ring, auto-focus (WCAG 2.1.4)
- [x] `ui/NavigationHint.tsx` — "Move: W A S D · Look: I J K L" in the HUD during interior view + test
- [x] e2e `tests/e2e/navigation.spec.ts` — interior focus, held W/J change the canvas, back to exterior, no page errors
- [x] ADR-004 interior eye navigation + RUNBOOK "Controls" section
- [x] DoD gate → squash-merge into local `main`

## Part 1 — Foundation: owner answers, delivery pipeline, floor plan model

- goal: open questions answered, CI-guarded workflow, and the whole floor as validated domain data
- depends-on: Part 0
- exit: protected `main` with green CI; every brief §4–§5 space in the model with all §8 numbers enforced by tests

- [ ] Owner answer: master bedroom doors — corridor + A balcony, or corridor only (brief §6 "bedrooms corridor only" conflict)
- [ ] Owner answer: light for the living room and kids bedrooms, which touch only blocked side C (brief §1 note conflict)
- [ ] Owner answer: main entry position on the side-A wall; link-corridor ↔ A-balcony door width (drawn 0.80, brief says 0.90)
- [ ] Owner answer: bath and shower sub-room layout and inner door widths in the main and guest sanitairs (brief §7.3)
- [ ] Owner answer: confirm unified heights, window size and sill, stairs + elevator representation, hosting and visibility
- [ ] Create private GitHub repo, add `origin`, push `main` (after explicit go-ahead)
- [ ] CI workflow: frozen install → typecheck → lint → format:check → test → build → Playwright e2e (report on failure)
- [ ] Protect `main` (PR + green CI, squash-only) and add Dependabot with ignore rules for ADR-001 caps
- [ ] Open one issue per remaining part; RUNBOOK "CI" section
- [ ] ADR-005 floor coordinates: origin at outer A/C corner, x along A→D, z along C→B, y up, metres
- [ ] `domain/floorPlan` — `Space` types and every brief §4–§5 space with exact clear rects (guest room L-shape as 2 rects)
- [ ] Wall spec constants: exterior 0.30 · partition 0.20 · void-facing 0.30
- [ ] Tests: width chain 22.50, depth chain 10.00, every §8 area, totals 167.38 / 15.10 / 42.52 / 225.00
- [ ] Tests: no overlapping spaces, all spaces inside the envelope, neighbour gaps equal the wall spec
- [ ] Queries `getSpace`, `findSpaceAt`, `getNeighbours` + tests; base chamber spec derived from the model
- [ ] DoD gate → PR merged

## Part 2 — Built floor: walls, ports, openings, light

- goal: render the complete floor from the model — walls, slabs, every door of the §6 schedule, windows, railings, void
- depends-on: Part 1
- exit: exterior view shows the full floor generated only from domain data; all hard access rules pass as tests

- [ ] `domain/walls.ts` — wall segments from space edges at spec thickness, collinear merge + tests (wall area 42.52)
- [ ] `domain/slabs.ts` — slabs for floor spaces only, none for the void + tests
- [ ] `domain/ports` — `Port` model and full §6 schedule (0.90 doors, 3.50 living opening, main entry) with Page-2 offsets
- [ ] Tests: every port sits on a wall shared by its two spaces and fits inside it
- [ ] Tests: laundry has no corridor door, utility exactly one door, master not on stairs, guest + control via link corridor
- [ ] Tests: every floor space reachable from the main entry; voids unreachable
- [ ] Split walls around ports with lintels up to wall height + tests
- [ ] `domain/windows.ts` — windows on A/B-facing walls only, sizes per owner answer + test: none on C or D
- [ ] `ui/SpaceModel.tsx` + `ui/FloorModel.tsx` — whole floor from the model, geometry merged per material
- [ ] Test: every vertical size comes from `FLOOR_HEIGHTS`
- [ ] Railings on the A balcony, balcony slab and void edges; void open to sky; TV panel facing the living opening
- [ ] Stairs + elevator volume per owner answer; named material palette per space kind
- [ ] Lighting: sun from side B, sky, per-room light (hemisphere fill, material dithering, horizon fog); Leva debug controls for sun and materials
- [ ] Exterior orbit framed on the full floor + e2e screenshot baseline
- [ ] DoD gate → PR merged

## Part 3 — Explore: navigation, accessibility, room awareness

- goal: walk the whole floor through its doors, know where you are, and control everything by keyboard or single pointer
- depends-on: Part 2
- exit: entry → every room reachable without crossing walls or the void; ADR-002 superseded; axe reports no violations

- [ ] `domain/collision.ts` — body circle vs wall segments with sliding + tests
- [ ] Walkable area = slabs; void edges and blocked volumes stop movement; doorways pass only if wider than the body + tests
- [ ] `stepEyePose` uses floor collision instead of the single-chamber clamp
- [ ] `getCurrentSpace(pose)` and HUD room name in a polite live region + tests
- [ ] Interior start pose at the main entry on the A balcony, facing inward
- [ ] Exterior orbit keyboard controls (rotate, tilt, zoom), scoped to the focused view + tests
- [ ] On-screen hold-to-act move / turn / look buttons (WCAG 2.5.7) + tests
- [ ] "Go to room" menu operable by keyboard and single click + tests
- [ ] Animated exterior ↔ interior transitions, instant under `prefers-reduced-motion`
- [ ] SVG minimap from the model with position and heading; select a room to jump there + tests
- [ ] HUD usable at 400 px width with touch targets ≥ 24 × 24 px
- [ ] Playwright axe check on both views; e2e walk entry → link corridor → corridor → kitchen
- [ ] ADR superseding ADR-002; RUNBOOK "Controls" updated
- [ ] DoD gate → PR merged

## Part 4 — Furnished release: fixtures, hardening, v1.0.0

- goal: every room holds the owner's equipment; the app is fast and resilient; a versioned release ships
- depends-on: Part 3
- exit: all brief §7 fixtures placed and tested; no chunk-size warning; `v1.0.0` tagged and deployed per ADR

- [ ] ADR: fixtures as procedural low-poly primitives (no external 3D assets)
- [ ] `domain/fixtures.ts` — catalogue with footprints + tests: inside its room, no overlap, door clearance kept
- [ ] Laundry: washing machine, hand-wash sink, dirty armoire, clean armoire, cleaning storage
- [ ] Kitchen: counters, fridge, cooker; barbecue on the balcony slab
- [ ] Main sanitair: open sink + bath and shower sub-rooms; guest sanitair: open sink + bath, no shower (tested)
- [ ] Control center: one volume holding electricity, ethernet, gas, water, heater, AC (compartment split stays deferred)
- [ ] Bedrooms and living room furniture
- [ ] Test: a 0.90 m fridge passes the 1.50 m corridor; the 0.90 m link corridor is flagged too narrow
- [ ] Room info panel: name, clear size, area, doors, fixtures, brief §9 open items
- [ ] Lazy-load the 3D scene chunk, instance/merge static geometry, bundle-size budget in CI
- [ ] WebGL-unsupported fallback and a canvas error boundary with structured logging
- [ ] Add eslint-plugin-jsx-a11y if it supports ESLint 10, otherwise record the deferral
- [ ] ADR hosting target + deploy workflow; e2e full tour of every room
- [ ] README (controls, sources of truth, screenshots), `CHANGELOG.md`, tag `v1.0.0`
- [ ] DoD gate → release published

## Deferred (owner decision, not scheduled)

- Control center split into two isolated compartments (gas/water · electricity) — brief §7.4
- Other floors — stairs and elevator are reserved for them
