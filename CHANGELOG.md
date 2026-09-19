# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry names the pull request that shipped it and the architecture decision record that justifies it; the records themselves are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-09-19

First release: the typical apartment floor (22.50 × 10.00 m), furnished, stackable 1…10 storeys, and explorable from the outside in.

### Added

- Project scaffolding on the chosen stack — Vite 8, React 19.2, TypeScript 6.0, three.js through `@react-three/fiber` and `@react-three/drei`, Zustand, Tailwind 4, Leva, Vitest with Testing Library, Playwright on Chromium, ESLint and Prettier — in a single feature module with `domain` → `application` → `ui` seams and dependencies pointing inward (no pull request: pushed directly, before `main` was protected; ADR-001, ADR-002)
- A base chamber with interior eye navigation — W A S D to move, J L to turn, I K to look, bound by physical `KeyboardEvent.code` so they keep their position on any keyboard layout, scoped to a focusable named view (no pull request; ADR-003, ADR-004)
- Delivery pipeline: a CI workflow running the whole gate on every pull request and every push to `main` (frozen install → typecheck → lint → format check → plan verification → unit tests → build → Playwright end-to-end, with the report kept as an artifact), Dependabot with ignore rules for the stack's version caps, and a protected `main` requiring a pull request, a green check, a squashed merge and linear history (#7, ADR-001)
- The whole floor as validated domain data: the origin at the outer corner where sides A and C meet, x along A→D, z along C→B, y up, metres; every space a set of clear axis-aligned rects on a centimetre grid; and the areas, both dimension chains, the neighbour gaps and the access rules enforced as tests rather than as prose (#8, ADR-005, ADR-006)
- Third-person view: a 1.80 m person with eyes at 1.68 m in `PERSON_SPEC`, a low-poly procedural mannequin, and a follow camera 2.5 m behind the head that never drops below it, pulls in at walls and ceilings and rises overhead in tight spaces — V, or the HUD toggle, switches first and third person (#9, ADR-007)
- The built floor: walls at their real per-contact thickness, slabs, every door and opening in the plan, declared windows with their own kind, width, sill and head, a dog-leg stair through the storey, railings, the open-to-sky void and the TV panel — one merged mesh per material, so the floor costs one draw call per material rather than one per space (#10, ADR-008)
- Deterministic scene lighting: sun from side B, sky background, per-room emissive ceiling panels, hemisphere fill and horizon fog, with the development tweak panel owning _factors_ only, never intensities, so the rendered lighting is a function of the view alone until someone drags a control (#10, ADR-009)
- On-screen hold-to-act move, turn and look controls, so every keyboard movement has a single-pointer equivalent (#10, ADR-008)
- `pnpm verify:plan`: 12 checks over the plan data — the centimetre grid and the envelope, the areas closing on the 225.00 m² plot, both dimension chains, the jambs, matricule uniqueness, reachability and what a port may open onto, the stair fit, per-contact wall thickness, fixture and door-swing clearance, the isolation register, the walls built below storey height, and that no stretch reads as insulated while being built thin. It runs in CI between the format check and the unit tests, and is the first command of every gate (#11, ADR-010)
- Exploring the whole floor: one walk field swept once from the plot, the slabs and the wall pieces, classifying every cell as floor, solid or fall, with a body circle moved against it axis by axis and swept rather than sampled, so no step can tunnel a 0.15 m wall and no walk can cross a window (#12, ADR-013)
- Room awareness: the current room announced as `matricule · name` in a polite live region, an SVG minimap with position and heading, and a "Go to room" menu that **walks** the viewer there through the real doorways rather than teleporting — stoppable by the "Stop walking" button, by `Escape`, or by any manual input (#12, ADR-013)
- A keyboard-operable exterior: arrows orbit and tilt, `Equal`/`Minus` and the numpad zoom, and the exterior camera remembers its angle across a round trip through the interior (#12, ADR-013)
- Animated exterior ↔ interior transitions, 0.9 s and eased from the live camera to the pose the arriving controls will hold, instant under `prefers-reduced-motion` (#12, ADR-013)
- Accessibility: an axe check over both views in the end-to-end suite reporting no violations, a HUD usable at 400 px with every touch target at least 24 × 24 px, and visible focus and accessible names throughout (#12, ADR-013)
- The typical floor stacked 1…10 storeys, driven by a `[−] 01 [+]` HUD stepper, with `domain/storeys.ts` owning the whole arithmetic of the repetition — the bounds, each storey's level, the inverse lookup, the top of the built fabric and the labels — and the 3.00 m pitch read from `FLOOR_HEIGHTS` rather than written down (#14, ADR-014)
- Walkable stairs between storeys: a flight modelled as a height function over its footprint, walked continuously rather than stepped onto, so climbing a flight arrives exactly one storey up and descending returns exactly; both half-flights at the ends of the stack are blocked, though still drawn (#14, ADR-014)
- Room labels carrying their floor — `F1-R11/KIT · Kitchen` — from one storey up, matching the convention the wall matricules already use, in the readout, the room menu and the minimap (#14, ADR-014)
- The furnished floor: the owner's equipment as procedural low-poly primitives in every room, each checked inside its room, clear of every door swing and not overlapping its neighbours (#6)
- A room info panel: name, matricule, clear size, area, doors, windows, fixtures and open items, recording that the living room and the kids' bedrooms have electric light only (#6)
- One decorative scheme over the whole floor, from the owner's own brief: flat matte white walls, natural unvarnished light oak millwork, bouclé upholstery and flat-weave carpet against white-veined marble, matte-black balustrades, and one large abstract canvas carrying the only saturated colour in a room. Four surface textures are generated procedurally from seeded noise rather than downloaded, so the repository stays a repository of numbers and the scene stays deterministic. A room is carpeted unless something in it is plumbed, powered or a riser, in which case it is marble — derived from what the room holds, which is how the kitchen and the control center get a hard floor without being named anywhere (#6, ADR-020)
- A room tour in the end-to-end suite, walking every room of the floor (#6)
- A WebGL-unsupported fallback, a loading panel and a canvas error boundary with structured logging, all mounted in the shell around the lazy scene, so a machine that cannot render it — or a visitor whose cached page asks for a chunk a later release has pruned — gets an explanation rather than a blank canvas (#6, ADR-016)
- A bundle-size budget, `pnpm size`, run in CI after the build (#6)
- A deploy workflow, `.github/workflows/deploy.yml`, for the self-hosted target: it builds on a `v*` tag, checks the budget, uploads the build, then rsyncs into `releases/<sha>/` and swaps the `current` symlink atomically, so a rollback is re-pointing that symlink. The deploy steps stay inert until the host is configured, and the authoritative deploy path is the same commands run by hand while the repository's GitHub Actions billing is unresolved (#6)

### Changed

- The source of truth inverted: the owner's intent lives in `src/features/building/domain/sourceOfTruth/plan.ts` as data, and `docs/source-of-truth-n-floor.drawio.html` is **generated** from it by `node scripts/source-of-truth/build.mjs` rather than read as the authority. The loop runs one way only — the owner marks intent by hand, it is measured, agreed, encoded in the plan, and the drawing is rebuilt — so the model and the drawing cannot drift (#11, ADR-010, superseding ADR-003)
- The floor was rebuilt on that plan: isolation became wall **width** (0.30 m where named, 0.15 m elsewhere) and a wall may now carry two or three thicknesses along its length; the bath and shower became rooms with their own doors; the link corridor disappeared into the guest room's north strip. Rooms went 18 → 22, openings 24 → 29, ports 19 → 20, windows 8 → 9, risers 17 → 18, and the floor now closes on the plot in four parts rather than three — FLOOR 165.515 m² + VOID 9.360 + WALLS 44.125 + SHAFT 6.000 (#11, ADR-010)
- No elevator: the owner dropped it, so the 4.00 × 2.00 m bay holds the stair alone, and its east landing is walkable floor at this level rather than a blocked volume (#10, ADR-008, superseding ADR-006 in part)
- Eye height moved out of `FLOOR_HEIGHTS` into `PERSON_SPEC`, because it is a size of the person and not of the building; 1.60 m became 1.68 m (#9, ADR-007, superseding ADR-004)
- The side-A balustrade is built at **1.10 m**, the owner's own decision taken with the safety reasoning in front of him; the stated 1.00 m is deleted and the `PARAPET_WALLS` entry carries `HEIGHTS.railing` itself, so there is no second literal left to disagree with it (#11, ADR-011)
- Movement uses the walk field instead of the single-chamber clamp, and the follow camera uses the same wall collision — `CameraRoomBox` and `getBlockedRects` were deleted rather than ported, being second hand-written descriptions of holes and rooms the sweep already knows about (#12, ADR-013)
- The interior start pose is the stair arrival on `landingEast`, facing the corridor at (5.10, 5.00), replacing the interim master-bedroom pose (#12, ADR-013)
- Accessible camera navigation is no longer deferred: every camera movement now has both a keyboard and a single-pointer control, and the canvas carries `role="application"` with an accessible name (#12, ADR-013, superseding ADR-002)
- The building is the typical floor stacked, not floor 1 alone at level 0: the storey lives in the pose, one baked geometry in storey-local coordinates is drawn once per storey rather than copied N times in memory, and the exterior orbit frames the whole stack with its target at half the building height (#14, ADR-014, superseding one clause of ADR-006)
- No separate ceiling is drawn below the top storey — a ceiling is the underside of the slab above, and drawing both z-fights (#14, ADR-014)
- The CI job's timeout went to 25 minutes: the end-to-end suite doubled to 18 tests, each rendering the floor through a software rasteriser on a runner with no GPU and run one at a time on purpose, which left the old 15 minutes nothing for the install, the checks, the build or a retry (#12)
- The 3D scene is loaded as its own chunk, so the first paint no longer waits on three.js and the build has no chunk-size warning left (#6)
- The end-to-end screenshot baselines were re-instrumented: a capture now **hides** the HUD for its duration rather than painting magenta over it, so the whole frame is compared instead of the 30 % the interior baseline had left — its mask had grown, unwatched, to 645 120 pixels of 1280 × 720. The 1 % diff ratio, which allowed 9 216 pixels of a frame that size, became an absolute 200 pixels measured against a noise floor of zero over twenty runs (#6, ADR-019)

### Fixed

- The side-A balcony was being built closed in by a full-height wall: once side B was walled, the `piece.top === heights.railing` heuristic found a parapet nowhere. Parapets are now **stated** in `PARAPET_WALLS`, so nothing infers one from a height (#11, ADR-011)
- The follow camera was trapped in one convex room and could not follow through a doorway (#12, ADR-013)
- An automatic walk overshot or stopped short along its track on arrival (#12, ADR-013)
- The storey index flickered at exactly a storey boundary, because a float height alone decides it twice: the discrete index is now stored in the pose and the rise is assigned from the surface every frame, never integrated (#14, ADR-014)
- The camera's far plane was short by a quarter of a metre against the worst fog distance over the storey-count × aspect-ratio matrix — measured at 500.26 m — and went from 500 to 800 (#14, ADR-014)

### Known limitations

- Two wall derivations are kept — `src/features/building/domain/walls.ts` and `scripts/source-of-truth/walls.mjs` — and their divergence is recorded rather than repaired: the envelope agreement is a coincidence of the current plan, and insetting an outermost room would make them classify different faces as exterior (ADR-012)
- Floor 0, the ground floor, is not designed; the building is 1…10 identical typical storeys
- The control centre is still one volume, its split into isolated gas/water and electricity compartments deferred, and it is reached by crossing the guest room — accepted by the owner (ADR-011)

[Unreleased]: https://github.com/el-amin-dev/building/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/el-amin-dev/building/releases/tag/v1.0.0
