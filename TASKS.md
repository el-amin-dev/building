# Tasks

> Roadmap to finish the 3D simulation of the typical apartment floor (22.50 × 10.00 m, floor 1 shown at level 0).
> **Source of truth:** `src/features/building/domain/sourceOfTruth/plan.ts` — the single copy of the geometry. `pnpm verify:plan` checks it (12 checks: rectangles on the centimetre grid and inside the interior, areas closing on the plot, both dimension chains, jambs, matricule uniqueness, reachability and what a port may open onto, stair fit, per-contact wall thickness, fixture and door-swing clearance, the isolation register, the walls built below storey height, and that no stretch reads as insulated while being built thin). CI runs it between `format:check` and the unit tests, and it is the first command of every DoD gate (ADR-010).
> `docs/source-of-truth-n-floor.drawio.html` is **generated** from the plan by `node scripts/source-of-truth/build.mjs` — Page-2 the plan at 60 px = 1 m, Registers the room/wall/port/window/fixture tables. The owner marks intent on the drawing by hand; that intent is measured, agreed, encoded in the plan, and the drawing is rebuilt from it, so the two cannot drift.
> `docs/house-design-brief.md` records the original requirements. Where it disagrees with the plan, **the plan wins** — it carries the owner's later decisions.
> Parts run in order — each part is one work session and starts only when the previous part is fully `[x]`.

**Next: Part 3 — Explore: navigation, accessibility, room awareness.** Parts 0, 1 and 2 are fully `[x]`: the migration to the new source of truth is finished and the whole gate is green — `verify:plan` (12 checks) · `typecheck` · `lint` · `format:check` · `test` (50 files, 1684 tests) · `build` · `test:e2e` (9 specs), with both screenshot baselines regenerated against the new floor.

## How to run a part

1. Read this file and take the first part with `[ ]` tasks.
2. Confirm its `depends-on` part is fully `[x]` and merged into `main`.
3. Pre-flight check, then branch from `main` as `<type>/<issue>-<slug>`; GitHub issues track the work (#1 delivery pipeline · #2 floor plan model · #3 third-person view · #4 Part 2 · #5 Part 3 · #6 Part 4).
4. Work on independent tasks in parallel where possible; dependent tasks in order.
5. Tick `[x]` only when the task's code and its tests are green.
6. Finish with the part's DoD gate.

## Definition of Done (every DoD gate)

- `pnpm verify:plan && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm test:e2e` green
- tests land with the code; every domain function unit-tested; no magic numbers; no TODOs
- self code review clean — blocking findings fixed or deferred with an ADR
- `docs/RUNBOOK.md` and `docs/DECISIONS.md` updated when behavior or decisions change
- new UI meets WCAG 2.2 AA (keyboard, visible focus, contrast, accessible names)
- squash-merged into `main` via a pull request with green CI

## The migration (why some `[x]` tasks went back to `[ ]`)

The floor plan was redesigned with the owner after Parts 0–2 were built. Isolation became wall **width** (0.30 where named, 0.15 elsewhere), a wall can now be two or three thicknesses along its length, the bath and shower became rooms with their own doors, and the link corridor disappeared. Rooms went 18 → 22, openings 24 → 29, ports 19 → 20, windows 8 → 9, risers 17 → 18. The floor now closes on the 225.00 m² plot in **four** parts rather than the brief's three, because the stair bay is a hole with one landing in it: FLOOR (slabs) **165.515** m² + VOID **9.360** + WALLS **44.125** + SHAFT **6.000**. The plan's own FLOOR total is 163.515 m² (`room`/`circulation`/`openAir`, which excludes the 8.00 m² bay) and the slabs add the 2.00 m² arrival landing to it. The superseded figures were floor 167.38, void 15.10, walls 42.52.

A task below keeps its `[x]` when the thing it built still stands and only its description needed correcting. A task goes back to `[ ]` when the new plan invalidates its result — a test pinning 42.52 m² of wall is green against a floor that no longer exists, which is worse than a failing one. The `[x]` marks are history and are not rewritten to pretend the old work was done against a plan that did not yet exist.

## Bootstrap — done

- [x] Scaffold: pnpm · Vite · React · TypeScript · R3F/drei · Zustand · Tailwind · Leva · Vitest · Playwright
- [x] `building` feature module with domain / application / ui seams and a view-mode toggle
- [x] Fail-fast env validation, ports from env, 33 unit tests and a Playwright smoke test
- [x] README, RUNBOOK, ADR-001 (stack and version caps), ADR-002 (camera accessibility deferral)
- [x] Bootstrap commit `dcacbc8` on `main`

## Part 0 — Demo: base chamber + eye navigation (W A S D move · J L turn · I K look)

- goal: walk inside one 5.00 × 3.40 m chamber — the base of the master bedroom — with an eye-level camera
- depends-on: Bootstrap
- exit: interior view takes focus; W/A/S/D walks, J/L turns, I/K looks up/down; walls stop movement

- [x] Create branch `feat/base-chamber-eye-navigation` from `main`
- [x] Add owner brief as `docs/house-design-brief.md` next to the drawing
- [x] Exclude the brief and the generated drawing from Prettier in `.prettierignore`
- [x] ADR-003 sources of truth — **superseded by ADR-010**, which records the inversion: the drawing is now generated from the plan rather than read as the authority, Page-4 no longer exists, windows exist, and ADR-006 made this a typical floor rather than one storey.
- [x] `domain/heights.ts` — frozen unified `FLOOR_HEIGHTS` (floor-to-floor 3.00 · wall 2.70 · door 2.10 · railing 1.10) + tests; eye height moved to `PERSON_SPEC` in Part 1
- [x] `domain/chamber.ts` — `BASE_CHAMBER_SPEC` 5.00 × 3.40 derived from the master bedroom, no height field, input validation + tests
- [x] `domain/chamber.ts` — wall boxes outside the clear size with closed corners, walkable bounds + tests
- [x] `domain/eyeNavigation.ts` — key bindings by `event.code` and movement intent (opposite keys cancel) + tests
- [x] `domain/eyeNavigation.ts` — `stepEyePose`: yaw-relative move, normalised diagonal, dt cap, wall clamp, pitch ±80° + tests
- [x] `ui/usePressedKeys.ts` — held keys scoped to the focused view, modifier combos ignored, cleared on blur + tests
- [x] `ui/ChamberModel.tsx` — floor and walls from domain data; ceiling only in the interior view
- [x] `ui/EyeCameraControls.tsx` — per-frame eye camera: pose in a ref, `YXZ` rotation, eye height from `PERSON_SPEC`
- [x] `ui/BuildingScene.tsx` — chamber replaces the placeholder box; exterior orbit ↔ interior eye camera by view mode
- [x] Interior view region: `tabIndex=0`, `role="application"`, accessible name, focus ring, auto-focus (WCAG 2.1.4)
- [x] `ui/NavigationHint.tsx` — "Move: W A S D · Look: I J K L" in the HUD during interior view + test
- [x] e2e `tests/e2e/navigation.spec.ts` — interior focus, held W/J change the canvas, back to exterior, no page errors
- [x] ADR-004 interior eye navigation + RUNBOOK "Controls" section
- [x] DoD gate → squash-merge into local `main`

> Part 0 survives the migration intact: it is about input, camera and one chamber derived from the model, none of which the new plan invalidates. Only the master bedroom's 5.00 × 3.40 still matches; the kids' bedrooms are now 5.00 × 3.55, so the chamber is the master bedroom's base alone.

## Part 1 — Foundation: owner answers, delivery pipeline, floor plan model

- goal: open questions answered, CI-guarded workflow, the whole floor as validated domain data, and a third-person view with a 1.80 m person
- depends-on: Part 0
- exit: protected `main` with green CI; every space in the plan present in the model with all its numbers enforced by tests; V switches first/third person

- [x] Owner answer: master bedroom doors → corridor + A balcony; kids bedrooms one corridor door each (ADR-006)
- [x] Owner answer: living room and kids bedrooms touch only blocked side C → electric light only, air system later, kept as an open item (ADR-006)
- [x] Owner answer: main entry position → entry via the stairs only, no side-A door (ADR-006). The link-corridor door it also decided is void: **the link corridor no longer exists** — the guest room's north strip replaced it and reaches the side-A balcony directly.
- [x] Owner answer: sanitairs (ADR-006) — **superseded**: a bathroom is now an open part with the basin plus a **walled bath and a walled shower, each its own room with a sliding door**. The guest bathroom has all three, cut to the minimum that still works.
- [x] Owner answer: heights confirmed; eye 1.68 from a 1.80 m person; self-hosted; public repo (ADR-006). **Superseded in part**: windows are no longer one size — each is declared with its own kind (`air` · `pass` · `light`), width, sill and head. There is no elevator at all, and the stairs are not a blocked volume: the east landing is walkable floor at this level.
- [x] Create public GitHub repo `el-amin-dev/building`, add `origin`, push `main`
- [x] CI workflow: frozen install → verify:plan → typecheck → lint → format:check → test → build → Playwright e2e (report artifact kept unless cancelled)
- [x] Protect `main` (PR + green CI, squash-only, linear history) and add Dependabot with ignore rules for the version caps
- [x] Issues #1–#6 opened; RUNBOOK "CI" section
- [x] ADR-005 floor coordinates: origin at outer A/C corner, x along A→D, z along C→B, y up, metres — unchanged by the migration, and the reason the two models could be compared at all
- [x] `domain/floorPlan` — derive `FLOOR_PLAN` from the plan's 22 rooms, including the four bath/shower cubicles and the `stairwell` kind; delete the hand-written copy of the old 18
- [x] Wall spec: exterior 0.30 · **insulated 0.30** · **partition 0.15** · void-facing 0.30 — `partition` 0.20 → 0.15 alone invalidates every gap and footprint number in the model
- [x] Tests: width chain 22.50, depth chain 10.00, every room area, totals **FLOOR 163.52 · VOID 9.36 · STAIRWELL 8.00 · WALLS 44.13 · 225.00**
- [x] Tests: no overlapping spaces, all inside the envelope, and every neighbour gap equal to the thickness its **contact** asks for — one thickness per join is no longer true
- [x] Queries `getSpace`, `findSpaceAt`, `getNeighbours` + tests; base chamber spec derived from the model
- [x] `domain/person.ts` — `PERSON_SPEC` height 1.80 · eye 1.68; eye removed from `FLOOR_HEIGHTS` + tests
- [x] `domain/thirdPersonCamera.ts` — follow camera 2.5 m behind the head, never below head height, pulled in at walls and ceiling, rising overhead near walls + tests
- [x] View store: interior camera mode first/third person, kept across view changes + tests
- [x] `ui/PersonModel.tsx` — low-poly procedural mannequin, visible in third-person view only + tests of its parts
- [x] V key (focused view only) and HUD "Third person" toggle button (a pointer click returns focus to the view); navigation hint updated + tests
- [x] e2e: V and the button switch views (HUD masked), walking works in both
- [x] ADR-007 third-person view; RUNBOOK "Controls", "Test" and "Smoke checks" updated
- [x] DoD gate → issues #1, #2, #3 closed by merged pull requests

## Part 2 — Built floor: walls, ports, openings, light

- goal: render the complete floor from the plan — walls at their real thickness, slabs, every port, declared windows, fixtures, railings, void
- depends-on: Part 1
- exit: exterior view shows the full floor generated only from the source of truth; every access rule passes as a test; `pnpm verify:plan` and the unit suite agree about the same floor

- [x] `domain/walls.ts` — **per-contact thickness**: a wall face carries a `contacts` list tiling it, each stretch with its own thickness and the reason for it (`exterior` · `join override` · `weather-exposed` · `isolation` · `plain separator` · `no facing space`). The single `thickness` field survives for quantities only — drawing from it overlaps a neighbour. Port the derivation proven in `scripts/source-of-truth/walls.mjs`; wall footprint **44.13**
- [x] `domain/walls.ts` — junctions: where an isolated wall meets another, the corner inherits both its thickness and its isolation
- [x] Wall height: side B is no longer open air, so the envelope is full height all round, and the `piece.top === heights.railing` heuristic is retired — **but the `parapet` bucket stays**. This task was written believing no parapet arises anywhere, and that was wrong: the owner has a balustrade on the side-A balcony, `F1-R01-BAL-W4`, 9.40 m long and one storey up. The heuristic found it nowhere once side B was walled, so the balcony was being built closed in by a full-height wall. A parapet is now **stated** in `PARAPET_WALLS` and carries `HEIGHTS.railing` (1.10) rather than a second literal, so nothing infers it from a height and the two numbers cannot disagree (ADR-011). The six balcony-slab/void joins are still zero-thickness overrides with no masonry, so those fall edges do belong to `railings.ts` alone
- [x] `domain/slabs.ts` — slabs for floor spaces only, none for the void, thickness derived as floor-to-floor − wall (0.30) + tests
- [x] `domain/slabs.ts` — answer the `stairwell` kind: only the east landing is floor at this level, so the bay is neither wholly floored nor wholly void
- [x] `domain/ports` — the plan's 20 ports: 19 doors from 0.60 to 0.90, the 3.50 living-room opening, and **five that slide** because no leaf can swing in the space they have. Entry via the stairs; no side-A door; no link corridor. (The 0.65 tunnel is a _window_, not a port — it is a pass-through, and nothing walks along it)
- [x] Tests: every port sits on a wall shared by its two spaces and fits inside it
- [x] Tests: laundry has no corridor door, utility exactly one door, master not on the stairs, **the control centre reached through the guest room and the guest bathroom through its own suite** — the link-corridor rules are void
- [x] Tests: every floor space reachable from the stairs arrival through ports only; voids unreachable; a door may open onto the stair bay only where the landing is floor at this level
- [x] Split walls around ports with lintels up to wall height + tests
- [x] `domain/windows.ts` — **declared, not derived**: realise the plan's 9 windows, each with its own kind, width, sill and head, validating jambs rather than choosing positions. The master bedroom deliberately has none
- [x] The plan's basins, baths, showers and television as objects standing in rooms, checked inside their room and clear of every door swing (a sliding leaf is exempt, and says so). **No `domain/fixtures.ts` was created**: the solids are built by `getFixtureLayout` in `ui/floorLayout.ts` straight from the plan's `FIXTURES`, with their own `sanitaryWare` material, and the room-containment and door-swing checks live in `verify.mjs` check 9. A domain module holding only a pass-through of plan data would have been a second copy of it
- [x] `ui/FloorModel.tsx` — whole floor from the model, one merged mesh per material (`ui/floorLayout.ts` buckets the solids, `ui/mergeBoxes.ts` + `ui/MergedBoxesMesh.tsx` bake them); ceilings and light panels only in the interior view
- [x] `ui/floorMaterials.ts` — palette entries for the `stairwell` kind and the bath/shower cubicles; `getSlabMaterialKey` is an exhaustive switch, so a new kind is a compile error by design
- [x] Test: every vertical size comes from `FLOOR_HEIGHTS` — `ui/floorLayout.test.ts` rebuilds the layout with injected heights (including noisy and off-grid ones) and checks every level moves with them
- [x] `domain/railings.ts` — re-derive: the balcony slab moved to x 11.65–15.35 and the west void no longer reaches x 1.60, so both guarded edges move
- [x] `domain/tvPanel.ts` — reconcile with the plan's `tv` fixture (x 7.50–11.00, 0.08 deep): two descriptions of one object, and the plan is the source
- [x] Render the railings, the open-to-sky void and the TV panel in the scene — the void is a hole in the slabs, and the ground sits a storey below (−3.30 m) and darkened so it reads as a shaft (ADR-008)
- [x] `domain/stairs.ts` — the plan's **four pieces** in a 4.00 × 2.00 bay: `landingEast` (floor at this level, continuous with the corridor), `flightA` and `flightB` of 9 risers each, and `halfLanding` half a storey down. 18 risers, going 0.25, flight width 1.00 — wide enough to carry an appliance, which is why the owner asked for it. Enumerate whatever pieces the plan defines rather than naming them
- [x] Lighting: sun from side B, sky background, per-room light as emissive ceiling panels, hemisphere fill, material dithering, horizon fog (`ui/lightingSpec.ts`, `ui/SceneLighting.tsx`, `ui/floorMaterials.ts`); Leva `Sun` and `Sky` folders as view-independent factor overrides (ADR-009) — no material controls: the palette stays data, changed in code
- [x] Exterior orbit framed on the full floor — eight box corners fitted to the frustum, fed to camera and lighting by `ui/useExteriorFraming.ts` (the plot is unchanged, so the framing survives)
- [x] Regenerate both e2e screenshot baselines (`tests/e2e/exterior.spec.ts`) — any geometry change invalidates them, and `updateSnapshots: 'none'` on CI makes that a failure rather than a silent rewrite
- [x] Rewrite the ~20 test files whose numbers moved; the heaviest are `walls.test.ts` (403 numeric literals), `floorPlanData.test.ts`, `stairs.test.ts`, `windows.test.ts`, `builtFloor.test.ts`
- [x] ADR: the source of truth inverted — the plan defines the floor and the drawing is generated from it; the model and the drawing share one copy (**ADR-010**, which also records the four-part closure, isolation as width, the 18-riser through-stair, the declared windows and what it supersedes in ADR-003/005/006/008)
- [x] Cover `scripts/` with typecheck, lint and format — the code that generates the drawing is currently in none of the three
- [x] DoD gate → PR merged (pull request #11, squashed onto `main` as `b333280`)

> Note: the planned `ui/SpaceModel.tsx` (one component per space) was deliberately dropped. Boxes sharing a material are baked into one merged geometry instead (`ui/mergeBoxes.ts`, `ui/MergedBoxesMesh.tsx`), so the floor costs one draw call per material rather than one per space (ADR-008).

> Note: `pnpm verify:plan` and the unit suite assert many of the same invariants — areas closing, dimension chains, jambs, reachability — and the overlap is deliberate: it caught three defects today that a single check passed. But they are **not** two independent implementations of the wall derivation, and an earlier version of this note said they were. `verify.mjs` imports `deriveWalls` from `scripts/source-of-truth/walls.mjs`, so checks 5, 8, 10, 11 and 12 run on the same code the drawing is generated from: the outline walk, the clockwise ordering, the matricule numbering and the isolation/junction reasons cannot be caught there at all. What the verifier genuinely checks on its own is the plan DATA (grid, areas, chains, jambs, matricule uniqueness, reachability, stair fit, fixture clearance, the isolation register, sub-storey walls, isolation width) and the room-to-room GAPS, which it measures straight from the rects (`contactsOf`) and check 8 compares against the derived contacts. The second opinion on the derivation itself is the Vitest suite over `src/features/building/domain/walls.ts` — and that twin has already drifted from `walls.mjs`, which is recorded and deferred in **ADR-012**.

## Part 3 — Explore: navigation, accessibility, room awareness

- goal: walk the whole floor through its doors, know where you are, and control everything by keyboard or single pointer
- depends-on: Part 2
- exit: **movement crosses a wall at a port and nowhere else** — never through a wall, never through a window; entry → every room reachable that way; ADR-002 superseded; axe reports no violations

- [x] `domain/collision.ts` — one **walk field**, swept once from the plot, the slabs and the wall pieces, classifying every cell as `floor` / `solid` / `fall`; a body circle moved against it axis by axis, **swept rather than sampled** so no step can tunnel a 0.15 m wall, with sliding + tests
- [x] Walkable area is that field's `floor` cells — **the slabs plus every door threshold block**, not the slabs alone: no slab is poured inside a wall, so a body crossing a 0.30 m threshold is off-slab by construction. Void edges and the stair shaft are `fall` cells and stop movement a body radius short of the brink, so `getBlockedRects` was **deleted rather than consumed** (a second hand-written description of a hole the sweep already blocks); doorways pass only if wider than the body + tests
- [x] Movement crosses a wall only through a **port**, never a window: a window's sill leaves the wall solid at body height, so this falls out of the geometry rather than needing a rule — `collision.ts` imports nothing from `domain/ports/`
- [x] `stepEyePose` uses floor collision instead of the single-chamber clamp; third-person camera pull-in uses the same wall collision (`CameraRoomBox` gone, so the follow camera now follows through a doorway instead of being trapped in one convex room)
- [x] `getCurrentSpace(pose)` and HUD room name in a polite live region + tests — `matricule + name` (`R11/KIT · Kitchen`) from the one `getSpaceLabel` formatter, and `aria-live="polite"` on an element with **no role**, so the page keeps exactly one `role="status"`
- [x] Interior start pose at the stairs arrival — on `landingEast`, the only part of the bay that is floor at this level — facing the corridor, (5.10, 5.00); replaces the interim master-bedroom pose Part 2 shipped (`createRoomCentrePose` and `interimWalkArea.ts` deleted, ADR-008, ADR-013)
- [x] Exterior orbit keyboard controls (rotate, tilt, zoom), scoped to the focused view + tests — arrows orbit and tilt, `Equal`/`Minus` and the numpad zoom, with the exterior camera remembering its angle across a round trip through the interior
- [x] On-screen hold-to-act move / turn / look buttons (WCAG 2.5.7) + tests — **delivered early in Part 2** (`ui/RemoteControl.tsx`, `application/remoteControlStore.ts`, `tests/e2e/remoteControl.spec.ts`, ADR-008)
- [x] "Go to room" menu operable by keyboard and single click + tests — it **walks** the viewer there through the real doorways rather than teleporting (owner decision), with three ways to stop: the "Stop walking" button, `Escape`, and any manual movement input
- [x] Animated exterior ↔ interior transitions (0.9 s, eased, from the live camera to the pose the arriving controls will hold), instant under `prefers-reduced-motion` — which governs that flight and **nothing else**: an automatic walk still walks at normal pace
- [x] SVG minimap from the model with position and heading; pick a room to **walk** there + tests — interior only, `sm` and wider, and its rooms are pointer-only targets with the full-size "Go to room" menu as the keyboard and touch equivalent (WCAG 2.5.8's equivalent-control exception)
- [x] HUD usable at 400 px width with touch targets ≥ 24 × 24 px — measured at 400 × 800: the 3D view keeps 67 % of the height against a 0.6 floor, the smallest pad button is 44 CSS px, and `tests/e2e/remoteControl.spec.ts` asserts every button visible, ≥ 24 × 24 px, hit-testable and free of horizontal page scroll
- [x] Playwright axe check on both views; e2e walk stairs arrival → corridor → guest room → kitchen (the link corridor it used to cross no longer exists) — `tests/e2e/accessibility.spec.ts` over four states, zero violations; the walk is `tests/e2e/explore.spec.ts`
- [x] ADR superseding ADR-002 (**ADR-013**, which also records the one-walk-field collision model, the automatic walk and its along-track arrival fix, the remembered orbit angle, the view flight and the exact scope of `prefers-reduced-motion`, the two ADR-008 promises this part breaks, and the accepted costs); RUNBOOK "Controls" updated
- [ ] DoD gate → PR merged

## Part 4 — Furnished release: fixtures, hardening, v1.0.0

- goal: every room holds the owner's equipment; the app is fast and resilient; a versioned release ships
- depends-on: Part 3
- exit: all brief §7 fixtures placed and tested; no chunk-size warning; `v1.0.0` tagged and deployed per ADR

- [ ] ADR: fixtures as procedural low-poly primitives (no external 3D assets)
- [ ] `domain/fixtures.ts` — extend the plan's sanitary ware and television into a full catalogue with footprints + tests: inside its room, no overlap, door clearance kept
- [ ] Laundry: washing machine, hand-wash sink, dirty armoire, clean armoire, cleaning storage
- [ ] Kitchen: counters, fridge, cooker; barbecue on the balcony slab
- [ ] Bathrooms: the bath and shower cubicles and their basins are already in the plan — furnish them, and check the guest suite's 0.55 m open part still works with a real basin in it
- [ ] Control center: one volume holding electricity, ethernet, gas, water, heater, AC (compartment split stays deferred)
- [ ] Bedrooms and living room furniture
- [ ] Test: a 0.90 m fridge passes the 1.50 m corridor and turns onto the 2.00 m stair landing (the stairs were widened to carry exactly this)
- [ ] Room info panel: name, matricule, clear size, area, doors, windows, fixtures, open items; living and kids rooms: electric light only (no daylight)
- [ ] Lazy-load the 3D scene chunk, instance/merge static geometry, bundle-size budget in CI
- [ ] WebGL-unsupported fallback and a canvas error boundary with structured logging
- [ ] Add eslint-plugin-jsx-a11y if it supports ESLint 10, otherwise record the deferral
- [ ] Re-instrument the geometry screenshot baselines: a 1 % diff-pixel ratio does not answer "did the geometry move" — 1 % of a 1280 × 720 frame is over 9,000 pixels, room for an entire corner of the building to change unnoticed, which is how a whole floor rebuild sat unseen behind the exterior baseline until Part 3's wider HUD mask used up the headroom (ADR-013). Either tighten the ratio toward the measured noise floor (0 px by Playwright's own metric when a baseline matches its own commit) or assert something that does not average over the frame
- [ ] ADR self-hosted target + deploy workflow; e2e full tour of every room
- [ ] README (controls, sources of truth, screenshots), `CHANGELOG.md`, tag `v1.0.0`
- [ ] DoD gate → release published

## Open questions (owner decision needed, blocking nothing yet)

- none open. Both questions the plan-v2 migration raised were answered by the owner on 2026-09-12 and recorded in **ADR-011** (`.claude/claude.questions.md` Batch 2):
  - **How high is the side-A balustrade?** → **1.10 m**, and the stated 1.00 m is deleted: 1.10 m is the usual minimum for an edge a person can fall over, which is very likely why `HEIGHTS.railing` is 1.10 m. The fix is structural rather than a new number — the `PARAPET_WALLS` entry for `F1-R01-BAL-W4` carries `HEIGHTS.railing` itself, so there is no second literal left to disagree with it and `pnpm verify:plan` has nothing to print
  - **Is reaching the control center through the guest room acceptable?** → **fine as built**: the guest room's north strip is circulation — the old link corridor, absorbed into the room — so the brief §6 rule is met by it and the §6 sentence against the guest-room route is retired. Accepted cost: a technician reaching the water, gas and electricity risers still crosses a bedroom

## Deferred (owner decision, not scheduled)

- A demountable aluminium / sandwich panel with a wide door will separate the stair landing from the corridor in the real building — removable in about five minutes. The owner asked that it **not be drawn**: it exists, but not in the geometry, so `stairs ↔ corridor` stays a zero-thickness join and that zero is deliberate (see the note on it in `JOIN_OVERRIDES`). Modelling it as masonry was tried and reverted: 0.15 m of wall is 0.15 m the floor does not have, since the stair needs its full 1.00 m landing to turn a 180°, so the corridor would have had to pay all of it and the master bedroom's door would have dropped 0.90 → 0.75 m

- Control center split into two isolated compartments (gas/water · electricity) — brief §7.4
- Floor 0 and stacking floors 2…N — the typical floor is floor 1, shown at level 0
- The guest bathroom is built to the minimum that works (open part 0.55 deep, every leaf sliding). If it proves too tight in the 3D walk-through, the levers are: drop its bath, or take depth from the guest room
