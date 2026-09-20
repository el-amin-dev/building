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

- Exterior view (default): drag to orbit, wheel or pinch to zoom, **or use the keyboard** — the "Exterior 3D view" region is a focus stop like the interior one (ADR-013 supersedes ADR-002, which had left it roleless and unfocusable while it had no keys)
  - `←` / `→` — orbit around the building (a full turn in 6 s)
  - `↑` / `↓` — tilt over it and back down (level to overhead in 2 s), stopping short of both the ground plane and straight overhead
  - `+` / `-` (and `NumpadAdd` / `NumpadSubtract`) — zoom in / out, multiplicatively, so a step feels the same size whether the whole floor or one room is in frame
  - keys act only while the region has focus (WCAG 2.1.4) and never scroll the page; the limits are the ones the framing derives, so zooming in never enters the walls
  - the camera **remembers your angle**: orbit, leave for the interior, come back, and you return to the angle and distance you left, not to the default frame (ADR-013). A fresh load always fits the whole floor; a **live** resize keeps your angle and can therefore crop the building, which is a known accepted cost
  - on-screen equivalent: the "Camera control" pad, six hold-to-act buttons in `Rotate` / `Tilt` / `Zoom` pairs, so the exterior view needs neither a keyboard nor a drag
- Interior view: activate the "Interior view" toggle; the "Interior 3D view" region takes focus (amber outline), the view opens on the **stair arrival landing** — (5.10, 5.00), the only part of the stair bay that is floor at this level — facing the corridor (every entry starts there, ADR-006, ADR-013; there is no remembered interior pose), and the HUD shows "Move: W A S D · Look: I J K L · Person view: V · Escape stops a walk · or use the on-screen remote control" plus a "Third person" toggle, the `Floors` stepper, the "Go to room" menu, the "About this room" panel, the room readout and the minimap (screen readers get a full description of each key, of the room menu, of the exterior camera keys, of the floor stepper and its `01` to `10` reading, of Tab to the toggles and of Shift+Tab back to the view)
  - `W` / `S` — walk forward / back
  - `A` / `D` — step left / right
  - `J` / `L` — turn left / right
  - `I` / `K` — look up / down (limited to ±80°)
  - `V` — switch between first person (eye level, 1.68 m) and third person (camera behind and above a 1.80 m mannequin, looking at its head); the "Third person" HUD toggle does the same (`aria-pressed` shows the mode, the "View:" status reads "Interior · First person" or "Interior · Third person"); the pose is kept when switching, and the mode is kept when leaving and re-entering the interior
  - third person: `I` (look up) tilts the camera down to a level view from behind the head, `K` (look down) raises it toward overhead (from 0° to 80° above the head's level, 15° at level pitch); the camera never goes below head height, so it never clips the body; the camera pulls in when a wall, the floor or the ceiling is closer than its 2.5 m follow distance; when a wall close behind the person leaves less than 0.5 m (e.g. after backing into a wall), the camera rises over the person and looks down at its head instead, also while looking up, so the mannequin stays visible; the mannequin only hides if even that leaves the camera closer than 0.5 m (e.g. under a very low ceiling). At the **stair arrival** start pose the camera backs **into the open stair shaft** and shows the whole person: the follow camera reads the same bay-released field the stair is walked on, so behind the 1.00 m landing is the open shaft rather than a blocker, and nothing pins the camera short there. `V` on the landing is a normal follow view, and so is `V` part way up a flight — behind the body is the stair it just climbed. The 0.50 m rule above is unchanged and still bites where it is real, against a **wall** a body is flat up against; the landing is no longer one of those places (ADR-013 recorded it as permanently pinned to `minBodyVisibleDistance` at **0.500 m at 45.6°** "because behind the camera is the shaft" — that was the collision model of the time, and ADR-014 corrects it). The interior still **opens in first person**, so nothing is shown from behind until `V` is pressed (ADR-013, ADR-014)
  - keys act only while the view has focus; Ctrl, Alt and Meta combinations are ignored, and pressing or releasing Meta (Cmd) clears held keys because macOS sends no keyup for them while Cmd is held
  - keys are physical positions (QWERTY labels): on AZERTY, `W A S D` are the keys labelled Z Q S D
  - `Escape` — stop an automatic "Go to room" walk (it does nothing when no walk is running)
  - the **whole floor** is walkable and you cross a wall **only at a door**, never at a window: a door's threshold block is floor at body height while every declared window leaves its sill solid there, so the rule falls out of the geometry rather than being written anywhere (ADR-013)
  - walls, parapets and railings stop movement, and so does a **fall edge** — the two side-B voids and the 6.00 m² stair shaft stop you a body radius short of the brink (0.25 m, 0.275 m at the two railed balcony edges), so you cannot lean out over a shaft to look down
- On-screen remote control (interior view only, no keyboard needed): a HUD pad labelled "Remote control" with one hold-to-act button per movement, so every key above has an equivalent button
  - "Move" cluster — `Move forward` (↑), `Move back` (↓), `Strafe left` (←), `Strafe right` (→)
  - "Turn" cluster — `Turn left` (⟲), `Turn right` (⟳)
  - "Look" cluster — `Look up` (▲), `Look down` (▼), limited to ±80° like `I` / `K`
  - a button acts while it is **held**: press and hold with a mouse or a finger, or hold `Space` or `Enter` while the button has focus; there is no drag and no gesture (WCAG 2.5.7) and every button is at least 44 px (WCAG 2.5.8)
  - `aria-pressed` marks a held button, which also turns amber
  - holding several buttons combines them exactly like held keys, and opposite buttons (forward + back) cancel out
  - releasing after a **pointer** hold returns focus to the "Interior 3D view" region, so the keys keep working; releasing after a **keyboard** hold leaves focus on the button
  - a hold also ends — and never sticks — when the pointer is released away from the button, when the pointer is cancelled or its capture is lost, when the window loses focus (Alt/Cmd-Tab), when the camera mode changes, and when the interior view is left
- Room readout (interior view only): a HUD line naming the room you stand in as **matricule + name** — `Room: F1-R11/KIT · Kitchen` — in a polite live region (`aria-live="polite"`, deliberately **no** `role="status"`, so the HUD mask of the screenshot specs still finds exactly one status element). It re-resolves after 0.05 m of movement, so standing still or turning in place says nothing, and it keeps the **last known** room while you straddle a jamb or a wall band, so it never blanks or chatters as you cross a doorway
- "Go to room" (interior view only): a disclosure button listing every reachable room **of the storey you are on** — nineteen, never one hundred and ninety, the list named "Rooms on floor 2" and closing itself if you change storey while it is open — by the same `F1-R11/KIT · Kitchen` label, in matricule order; picking one **walks** you there through the real doorways at normal walking pace — it does not teleport (owner decision, ADR-013). The two voids are absent from the list rather than offered and refused
- **"About this room"** (interior view only): a disclosure beside "Go to room" describing the room you are standing in — its label and matricule, its clear size **rect by rect** (the kitchen, the corridor and the guest room are each several rectangles, and one width × depth would state a size they do not have), its floor area, what opens into it and how wide, its windows and their kind, what stands in it by fixture matricule, and whatever the owner has not settled about it. Where a list is empty it says so in words. It follows you as you walk. It is a named section and **not** a live region: the readout already announces the room, and two announcers would say everything twice. A balcony does not claim to be on electric light — the daylight scale has no value for "it is outside", so that one sentence is suppressed for the open-air spaces and every other open item still shows
  - three ways to stop: the **"Stop walking"** button that appears beside the trigger while a walk runs, **`Escape`** while the view has focus, or simply **moving yourself** — any movement key or any remote-control button cancels the walk, look-only included
  - a pointer pick hands focus back to the view, so the keys and the pad keep working while you watch; a keyboard pick returns focus to the trigger
  - the readout announces exactly twice per successful walk — `Walking to F1-R11/KIT · Kitchen`, then the room label on arrival — and reports `Cannot walk to …` when there is no route or `Stopped before reaching …` when the body wedges; a walk you cancel yourself is silent
  - every route crosses the stair landing (`arrival → kitchen` is `stairs → corridor → kitchen`), because the plan has no corridor ↔ guest-room port and the guest room ↔ kitchen opening is a `pass` **window**, not a port
- Minimap (interior view only, `sm` and wider): the floor in plan at one SVG unit per metre, the room you are in filled amber, and an arrow showing your heading, sampled every 100 ms and written straight to the DOM so movement re-renders nothing. Its rooms are **pointer-selectable** — click one to walk there — and deliberately not focus stops: a room is about 15 px across, below the 24 px of WCAG 2.5.8, so "Go to room" is the full-size equivalent control for keyboard and touch (ADR-013). A chip above the drawing names the storey it is of — `Floor 1 of 1`, `Floor 3 of 7` — and screen readers get the information rather than the picture: "Floor 1 of 1 minimap. You are in `F1-R11/KIT · Kitchen`, facing toward side D" (ADR-014)
- Switching views **flies** the camera between outside and inside over **0.9 s**, eased, from wherever the camera actually is to the exact pose the arriving view's controls will hold, so there is no jump at the hand-off (ADR-013). Under `prefers-reduced-motion: reduce` the switch is instant, bit-for-bit what it was before flights existed — and **only** the flight is affected: an automatic walk still walks at normal pace, because walking is the content, not decoration
  - the region carries `data-camera-transition` (`idle` / `running`) while the flight is in the air, which is what lets a screenshot wait for a settled scene
  - known nit: in third person the mannequin is absent during the 0.9 s flight back out, because the camera controls are unmounted while the flight owns the camera
- Floors (both views): the `Floors` stepper reads `[−] 01 [+]` and stacks the typical floor **1 to 10** storeys, `01` on load — `Remove a floor` and `Add a floor` around a live reading of the count, third panel of the HUD's first row (ADR-014, which supersedes ADR-006's "the app shows floor 1 only, placed at level 0")
  - the reading is announced **politely** as `Floors shown: 03` — the pixels stay the bare `03` — and both buttons are `aria-describedby` it, so the count is re-read whenever a button takes focus
  - at either end the button **stays focusable** rather than vanishing or going `disabled`: it is `aria-disabled`, greyed, and its press does nothing, so stepping 04 → 01 by keyboard never drops focus onto `<body>` on the last press. Tab, Enter and Space and nothing else — no arrow keys, no Home / End, no press-and-hold repeat, the whole range being nine presses end to end
  - every storey added is the **same typical floor**, stacked 3.00 m up (floor-to-floor, ADR-006), with the stair running continuously through it: walk a flight and you arrive exactly one storey up, walk it back down and you return exactly. The dog-leg turns at the half-landing, so climbing by hand takes a **strafe** (`A` / `D`) onto the next flight. The half-flights at the two ends of the stack are drawn but **blocked** — there is no storey below floor 1 and none above the top one (owner decision, ADR-014)
  - changing the count: **adding storeys never moves you**, and removing storeys from under you puts you on the new top storey keeping your plan position, heading and pitch — or back at the stair arrival if you were caught **mid-flight**, where there is no plan position to keep (owner decision, ADR-014)
  - **below the top storey the ceiling you see is the underside of the slab above** — its screed, not ceiling white. A ceiling drawn there would be that same slab a second time, coincident on all six faces; only the top storey, which has no slab above it, gets one of its own (owner decision, ADR-014)
  - the `Floors` caption goes `sr-only` below the `sm` breakpoint; the two buttons and the reading are the same size at every width
- Phone width (below Tailwind's `sm` breakpoint, e.g. 400 px): the pad leaves the HUD stack and anchors to the **bottom** of the screen, full width and centred; the status line and both toggles share one row (the camera mode stays in the status for screen readers, hidden visually); the visible hint shortens to "Move with the pad below · or W A S D". The 3D view keeps ~73.5% of the height at 400 × 800. Nothing changes for assistive technology — the full key description and the Tab order are the same at every width — and from `sm` up the layout is unchanged
- `Tab` from the view moves focus to the "Interior view" toggle, then to the "Third person" toggle, then to the two `Floors` buttons, then to "Go to room" (and to "Stop walking" while a walk runs), then through the eight remote-control buttons; in the exterior view it is the "Interior view" toggle, the two `Floors` buttons, then the six camera-pad buttons. The room readout and the minimap are read, not operated, so neither is a tab stop. `Enter` on "Interior view" switches view, `Enter` or `Space` on "Third person" switches the camera mode and keeps focus on the button: `Shift+Tab` returns to the view (twice from "Third person", once from "Interior view")
- clicking "Third person" with the mouse switches the camera mode and returns focus to the view, so the keys keep working

## Services and layers

- **The floor is modelled as a stack of build layers.** The layers are **additive, never exclusive** (owner decision, ADR-022): ticking one adds it over whatever is already there, so water over naked walls, then water and gas together, then everything but the finish, is how the floor is meant to be read. Nothing ticked is **naked walls** — structure, slabs and ceiling, no service and no finish — and **`furniture` + `finishing` on and every service off reproduces the v1.0.0 floor pixel for pixel** — NOT all nine ticked, which was the original wording and is wrong on its face: ticking a service layer is precisely what makes that service visible, so the all-on view is v1.0.0 _plus_ 116 runs drawn over it. Measured in the browser on 2026-09-20. The two views the baselines pin are therefore the two ENDS of the switcher — nothing ticked (naked walls) and the v1.0.0-equivalent — and the all-on view is a third thing, not a restatement of the second
  - **What is wired today**: the runs are declared in the plan and built by the domain module, and the `Layers` panel is in the HUD with its state in `layerStore` (every box off on load). The **layer-to-render wiring is still being built** — the service buckets in `floorLayout.ts` are declared but not yet filled, no bucket is yet gated on its layer flag, and the empty-layer HUD state is not written — so ticking a box does not change the picture yet. Everything below describes what the model declares and what the switcher controls, not what the canvas shows
- The nine, in `SERVICE_LAYERS` order, which is both the build order and the order the checkboxes appear in: `drainage` · `water` · `gas` · `electricity` · `lowVoltage` · `climate` · `covers` · `furniture` · `finishing`. The first six are services (`service: true`); the last three are not, and are in the list because the owner asked for **one box per build level** — `covers` is the boxing built over a run, `furniture` is the 44 fixtures, `finishing` is the decorative scheme of ADR-020 (carpet, marble, oak, bouclé, the artwork), which re-surfaces the same geometry rather than adding or removing a box
  - `drainage` is first and is its own layer because it is the only run that cannot be routed for convenience: it **falls**. `water` is the domestic supply, cold and hot to the fittings; `climate` is the comfort circuit, the cooling runs plus the wall heaters — **a radiator is not a tap** (ADR-022). A real wall heater sits on a flow and a return; **the model draws ONE pipe per heater, standing for the pair**, so a `heating` run is a whole circuit and not one of its two legs, and there is one heating lane on the spine rather than two. `gas` reaches two places only, the heater in the control center and the kitchen cooker
  - The two halves of `climate` start in two different places. The wall heaters leave `wetGasChamber`, off the same heater the hot water does — which is why the isolation register lists `climate` under that chamber for its **heating half only**. The cooling trunk starts at `ccBalcony`, because the plant is an **outdoor unit on the control-center balcony**: a condenser rejects heat and needs open air, so it cannot be sealed into either chamber. It is the one service whose source is a place rather than a chamber, and its `from` names a space for that reason
- **The `Layers` control** sits in the HUD's second row beside "Go to room" and "About this room". It is a trigger whose accessible name carries the current state — `Layers: Naked walls` with nothing ticked, `Layers: 3 of 9 on` otherwise — opening a real `<fieldset>` with the `<legend>` **Build layers** and one **native checkbox** per layer. The summary is a bare `aria-live="polite"` paragraph read as a sentence ("Layers shown: 3 of 9 on") while the pixels stay the bare summary, the same pattern as the `Floors` stepper. `Escape` closes the panel, as every disclosure in this HUD does
  - Below the `sm` breakpoint only the word `Layers` stays visible and the summary goes `sr-only`, because that HUD row is measured at a 400 px width and one word is what fits. Nothing is lost to assistive technology: the accessible name is the button's whole text content
  - Checkboxes are **pointer-operable by nature**, which is the rule this app keeps everywhere (the owner cannot always use a keyboard). If the switcher is ever given a keyboard shortcut it is an addition to the on-screen control, never a replacement for it
- **The layer state is not in the URL.** Nothing else in this app is, and putting the layers there is a new rule about the whole app rather than a detail of this part (owner decision, ADR-022). Revisit it if a naked-walls view ever has to be sent as a link
- **Where the data lives.** `SERVICE_LAYERS`, `SERVICE_SPEC`, `SERVICE_CHAMBERS` and `SERVICE_RUNS` are in `src/features/building/domain/sourceOfTruth/plan.ts`, beside `PORTS`, `WINDOWS` and `FIXTURES`, so `pnpm verify:plan` gates a pipe the same way it gates a door; `src/features/building/domain/services.ts` turns a declared run into boxes, the way `domain/fixtures.ts` does for a fitting (ADR-015). The switcher's state is `src/features/building/application/layerStore.ts` (every layer off to begin with), and the panel is `src/features/building/ui/LayerSwitcher.tsx`
  - **116 runs** are declared — 13 drainage, 18 water, 2 gas, 39 electricity, 16 low voltage, 28 climate (9 cooling, 19 heating) — which the domain module builds into **219 segments, 203 covers and 9 caps**. A segment gets no boxing where it is buried: a run at negative `y` is already under the screed, and the question is asked per segment, so a stack that starts under the floor and rises through an open void is boxed over only the part a person can see
  - A run is `layer` · `family` · two ends · a centreline of `[x, z, y]` points on the centimetre grid, written **in the order the service flows** (`points[0]` is upstream). `y` is measured from the finished floor of the storey, so a **negative `y` is inside the floor build-up** — the 0.30 m between `HEIGHTS.wall` (2.70) and `HEIGHTS.floorToFloor` (3.00) — which is where the waste branches run. A riser is simply two points differing in `y`
  - Matricules are `F1-DRN-S4`: floor, a three-letter layer code (`DRN` · `WTR` · `GAS` · `ELE` · `ELV` · `CLM`), then the `S` number. **`S` for service** — `W`, `P`, `G` and `X` are taken by walls, ports, glazing and fixtures, `R` by the rooms
  - No run writes its own diameter: bores, falls, clearances and separations all come from `SERVICE_SPEC`, so changing a pipe size moves every pipe of that family together. Two of its numbers are not geometry — `narrowingAllowance` (pipes close up from the inside in service, **faster on hot**, so hot carries the larger allowance) and `dataToPowerSeparation` (0.20 m, which is a **verifier check and not a comment**)
- **The control center is two sealed chambers inside one room** — R08 `[1.60, 3.80, 7.20, 9.70]`, 5.50 m², whose rects do not move, so the floor is still 21 spaces and every total still closes. `wetGasChamber` `[1.65, 2.30, 9.05, 9.65]` holds the water heater, the gas cock and the manifolds and takes `drainage` · `water` · `gas` · `climate`; `electricalChamber` `[2.40, 3.05, 9.05, 9.65]` holds the consumer unit, the meters and the low-voltage patch and takes `electricity` · `lowVoltage`. Each is a closed box **2.20 m tall**, and each **vents to outside on its own 125 mm duct**. **Both ducts leave east through the 0.30 wall at x 3.80–4.10 and cap over `ccBalcony`** — "everything starts from CC and out from CC balcony, except the drainage" (owner, 2026-09-20). The wet-and-gas duct runs **north and high**, at z 9.15 and y 2.50, straight **over both boxes**; the electrical one at z 9.35 and y 2.35, rising at x 2.65. **Crossing above a sealed box is not a hazard**, and the model no longer pretends otherwise: these are closed ducts, so what matters is where they **discharge**, not what they pass over. Their mouths are **0.20 m apart in z and 0.15 m in y**, so neither breathes into the other, and the gas duct's underside at 2.4375 clears the 2.20 m chamber tops by 0.2375 m and the 2.10 m door head with room to spare. The isolation rule is about **ends**: `holds` fails a run that _terminates_ in the wrong compartment. A vent **caps** rather than ending in the balcony, because discharging over a space is not servicing it. The `holds` list is the isolation rule: **a gas run ending in the electrical compartment is the one failure this whole part exists to prevent**, and it is checked rather than conventional (brief §7.4, ADR-022)
- **Services are read by hue, never by texture.** ADR-020's decorative scheme is deliberately inverted inside these layers — the service materials are flat colour with no texture map at all — because a services view exists to tell gas from water at a glance. Drainage is the dark one, cold and hot are the blue and red halves of one question, gas is the near-universal yellow, cooling is cyan. **Power and lighting share one hue on purpose**: they are one service, and which circuit family a conduit carries (2.5 mm² power and plugs, 1.5 mm² lighting) is data, not a colour
- **The ends of the stack are capped, and the caps are deliberate.** The building is 1…10 identical storeys, so a riser declared once is in the same place on all of them, but floor 0 is undesigned and the roof is not modelled. Each end of a stack is a declared cap carrying **the reason it is there and when to delete it** — pending the floor 0 design at the bottom, pending the roof plant at the top — exactly the way both half-flights at the ends of the stair stack are blocked but still drawn. A capped riser is not a modelling bug
- **What a run does not do: make a room "serviced".** A pipe crossing a bedroom must not lay marble in it. `isServicedSpace` asks only what stands **in** a room (`SERVICING_ROLES`) and is never taught about runs; the guard is `src/features/building/ui/floorLayout.test.ts`, which pins the floor finish of all **21** spaces by name and fails if a twenty-second space is added unpinned (ADR-021 fixed this class of defect once, ADR-022 keeps it fixed)
  - Routing the services found the kitchen had **no sink** — two counters, a cooker and a fridge and nothing to connect water or waste to. One was added and the west counter run shortened for it, so the fixture count is **44**, not the 42 of v1.0.0

## Test

- `pnpm verify:plan` — the source-of-truth verifier over `src/features/building/domain/sourceOfTruth/plan.ts`: 24 checks across 21 spaces, 92 derived walls, 19 ports, 8 windows, 44 fixtures and 116 service runs. It prints the room table and the four totals closing on the plot, both dimension chains, the opening and matricule checks, reachability, the stair fit, wall thickness per contact, the fixture door-swing check, the isolation register, the walls built below storey height and the isolation-width check that nothing reads heavy while being built thin, then, since Part 5, the twelve service checks — runs as real geometry, a run ending in the compartment its layer belongs to, parallel separation, no water over the electrical compartment, risers only in a void or a chamber, drains that fall, head clearance over the balcony slab, the programme actually delivered, that no run stands in open floor below head height, that none stands in a door, an opening or a window, that every run tees off something rather than beginning in mid-air, and that every corner has room for the fitting that turns it — printing `PASS — 24 checks, 92 walls, 27 openings, 44 fixtures, 116 service runs, everything closes` (verified 2026-09-20). Run it first after touching the plan: it exits non-zero on the first broken invariant, and it is the first command of the DoD gate (ADR-010)
  - **What it is, and is not, an independent check of.** It verifies the plan DATA independently — the grid, the areas, both dimension chains, the jambs, matricule uniqueness, reachability, the stair fit, fixture clearance, the isolation register, the sub-storey walls and the isolation width — and it independently MEASURES the gap between rooms straight from the rects (`contactsOf`, `verify.mjs`), which check 8 compares against the derived contacts. But it `import`s `deriveWalls` from `scripts/source-of-truth/walls.mjs`, the same code the drawing is generated from, so checks 5, 8, 10, 11 and 12 all run on that one derivation: the outline walk, the clockwise ordering, the matricule numbering and the isolation/junction reasons are invisible to it by construction, and a defect in any of them cannot be caught here. Note too that the `INSULATED_WALLS` / `PARAPET_WALLS` tripwires pin only **lengths**, so a numbering bug that preserves lengths passes checks 10 and 11 untouched. The real second opinion on the derivation is the Vitest suite over `src/features/building/domain/walls.ts` (ADR-012)
- `pnpm verify:plan | grep exact` — just the four totals: `floor 163.9200 · void 9.3600 · stairwell 8.0000 · walls 43.7200` (verified 2026-09-19; they were `floor 163.5150 … walls 44.1250` until the guest shower was dropped and its walls with it — ADR-021). The floor the app builds from them is FLOOR (slabs) 165.920 m² + VOID 9.360 + WALLS 43.720 + SHAFT 6.000 = 225.000 m² of plot, because only the 1.00 × 2.00 arrival landing of the 8.00 m² stair bay is floor at this level
- `pnpm test` — all unit tests, 3133 of them across 89 files (Vitest; jsdom for `src/`, node for `tooling/`) (verified)
- `pnpm test src/features/building/domain/viewMode.test.ts` — one file
- `pnpm test src/features/building/domain/walls.test.ts` — one file, the wall generator (the footprint it has to reproduce is the plan's WALLS total, 43.720 m², which `pnpm verify:plan` prints; 64 tests, green — it was one of the ~20 test files the plan-v2 migration reopened, and that migration is finished). This file is also the **only** check on the wall derivation's outline walk, clockwise ordering, matricule numbering and isolation/junction reasons — see the `pnpm verify:plan` entry above for why the verifier cannot catch a defect in any of them
- `pnpm test -t "toggles exterior to interior and back"` — one test by name
- `pnpm test:watch` — watch mode
- `pnpm test:e2e` — builds with the title `Floor E2E`, starts its own preview server on port 4174, runs Playwright on Chromium, one worker: 23 tests across 8 files, plus one on-demand capture spec that is skipped unless asked for. Wall clock depends almost entirely on what else the machine is doing: the same six specs took 1.2 min on a quiet machine and crawled for the best part of an hour at a load average near 30. Run the gate with nothing else executing
- `E2E_SERVER_PORT=4196 pnpm test:e2e` — end-to-end tests on another port; use this form when 4174 is busy, with any free port (verified on 4196). The run fails fast with `http://localhost:<port> is already used` when the port is taken, because it always starts its own server
- `pnpm test:e2e tests/e2e/smoke.spec.ts` — one end-to-end file
- `pnpm test:e2e tests/e2e/exterior.spec.ts` — one end-to-end file, 2 tests, both `test.slow()`: the committed screenshot baselines of (1) the default exterior frame of the whole floor and (2) the interior first-person start pose. Each settles the scene (two identical captures in a row) and then compares **the whole canvas** — the HUD is hidden for the duration of the shot rather than masked, so there is no mask and no uncompared region (ADR-019). Baselines live in `tests/e2e/__screenshots__/exterior.spec.ts/` and are per project and platform (`chromium-linux`)
  - **The tolerance is a count, not a percentage**: `maxDiffPixels` is 200 in `playwright.config.ts`. It was measured rather than chosen — both baselines were regenerated and then compared 20 times with the threshold at zero, and all 20 passed, so the rasteriser is deterministic here and the real noise floor is nothing. 200 is a stated cushion for a future driver or Mesa change, about 0.02 % of the frame, against the 9 216 pixels the old 1 % ratio allowed. To re-measure: set it to 0 and run `--repeat-each 10` on a quiet machine
  - The HUD is hidden with `opacity`, never `visibility`. `visibility: hidden` takes an element out of the focus model, so the browser blurs whatever held focus inside it — a capture would then move focus mid-test and fail an assertion further down, which is exactly what happened once. A screenshot helper may not change the state of the page it photographs
- A baseline is written locally when it is missing (`updateSnapshots: 'missing'`) but never on CI (`'none'`), so CI cannot accept a baseline silently. To change one on purpose: delete the `.png` and run the file again, or `pnpm exec playwright test tests/e2e/exterior.spec.ts --update-snapshots`, then review the image in the diff before committing it
  - **The hole that automation does not close**: a _wrong_ baseline, regenerated and committed by a person, passes every run afterwards. `updateSnapshots: 'none'` stops CI writing one; it cannot stop a human committing one. The only gate on that is opening the PNG in the pull request diff and looking at it
- The committed baselines are **`chromium-linux` only**. On another platform Playwright looks for a file that does not exist and writes your own baseline locally instead — that is expected, not a failure to "fix", and a mismatch against a Linux baseline on macOS or Windows says nothing about the scene. Only Linux baselines are committed, because CI is the Ubuntu runner
- `pnpm test:e2e tests/e2e/navigation.spec.ts` — one end-to-end file, 3 tests: (1) walk, turn and return to the exterior view; (2) V and the "Third person" button switch the camera mode (V at the start pose changes the scene, a mouse click on the button returns focus to the view); (3) movement keys and V ignored while the interior view is not focused. Frame comparisons mask the HUD, so only the rendered scene counts. Tests (1) and (2) are marked `test.slow()` (90 s instead of 30 s), because polling frames rendered by software WebGL, and the mannequin's first shader compilation, take most of the default limit
- `pnpm test:e2e tests/e2e/remoteControl.spec.ts` — one end-to-end file, 3 tests, all `test.slow()`: (1) the pad walks and turns with the **mouse alone** (not a single keyboard event: it holds "Move forward", then "Turn left", and each release must stop the scene changing) and focus is back on the "Interior 3D view" region afterwards; (2) sliding off "Turn left" and releasing the pointer over the canvas still stops the turn (no stuck action); (3) at a 400 px phone width all 8 buttons stay visible, at least 24 × 24 px, hit-testable and free of horizontal page scroll, and holding "Move forward" still walks there. Frame comparisons mask the whole HUD, because a held button's `aria-pressed` colour would otherwise make the comparison pass on its own
- `pnpm test:e2e tests/e2e/explore.spec.ts` — one end-to-end file, 5 tests: the walk from the stair arrival through the corridor and the guest room to the kitchen, asserted on the room readout rather than on timing; a held key cancelling an automatic walk while `V` does not; and reduced motion making the view flight instant **while a walk still walks**
- `pnpm test:e2e tests/e2e/accessibility.spec.ts` — one end-to-end file, 4 axe audits over the HUD: both views, the room list open, and a 400 px phone width. No rule is disabled; the canvas and the development-only debug panel are excluded, because a WebGL surface has no DOM to audit and its accessible alternative lives on the wrapping region
- `pnpm test:e2e tests/e2e/floors.spec.ts` — one end-to-end file, 4 tests: the stepper present in both views in the tab order the hint promises; stepping to ten and back to one without ever dropping focus; adding a storey redrawing the building and removing it restoring the frame exactly; and **climbing the dog-leg to the storey above and walking back down**. The climb strafes rather than turns — one frame of held turning is nine degrees whatever the frame rate, which is thirty centimetres of drift over a flight's two metres, and a drifted body stalls silently on the neighbouring strip rather than failing loudly
- `pnpm test:e2e tests/e2e/tour.spec.ts` — one end-to-end file, **one test with nineteen steps**: it opens "Go to room", reads the nineteen room labels out of the list, and walks to each in turn, asserting the readout announces the walk and then reports arrival. It fails immediately on "Cannot walk to" or "Stopped before reaching" rather than letting a timeout absorb a refusal. It is tagged `@tour`, so `pnpm test:e2e --grep-invert @tour` skips it for an inner-loop run while the full gate still includes it
  - It paces itself on a **stall watchdog** rather than a wall-clock budget: while a walk is running it samples the pose the minimap publishes, and fails naming the room and the last position if nothing has moved for 20 s. A watchdog is load-independent where a fixed budget is not — a machine four times slower still makes progress
  - It runs at a 640 × 400 viewport, which is exactly the `sm` breakpoint, so the DOM is the default-width DOM. The walker advances by the frame, so a smaller frame walks faster; measured, that is worth about 14 %, not a multiple. This test compares no pixels, so the smaller frame costs it nothing
  - **It found a real defect the first time it ran**: every route out of the guest room's L-shaped leg walked through the wall at x 6.90. See ADR-019's neighbours and `domain/roomRoute.ts` — the seam between two rects of one room is now crossed square-on
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
- `pnpm verify:plan && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm size && pnpm test:e2e` — full gate (the plan is verified first: if the source of truth does not close, nothing downstream of it is worth running; `pnpm size` runs straight after the build, while `dist/` is there)
- `pnpm size` — the bundle budget (`tooling/bundleBudget.ts`, `scripts/check-bundle-size.mjs`): it walks `index.html` → the entry → its static imports to measure what a visitor actually waits for, gzips each chunk and prints a table. Raising a budget is a reviewed edit to that file in the same pull request, never a silent bump
- `pnpm capture:docs` — rewrites the README's screenshots from the running app (`tests/e2e/docsCapture.spec.ts`). Skipped in every normal run, and part of no gate, because it writes files

## Smoke checks

- `pnpm test:e2e` — page title, a visible `<canvas>`, and the "Interior view" toggle switching `aria-pressed` and the "View:" status; `tests/e2e/navigation.spec.ts`: (1) the "Interior 3D view" region takes focus, holding W walks and holding J turns (the canvas changes), Tab to the toggle and Enter return to the exterior view, no page errors; (2) V at the start pose and the "Third person" button switch the camera mode and change the scene (the HUD hidden for the shot, never masked — ADR-019), and W still walks after a mouse click on the button; (3) movement keys and V are ignored while the interior view is not focused; `tests/e2e/exterior.spec.ts`: the **three** committed baselines — the default exterior frame (now **naked walls**), the same frame with `Furniture` and `Finishing` ticked, and the interior first-person start pose, all compared over the whole frame against an absolute 200 pixels; `tests/e2e/layers.spec.ts`: the layer switcher in both views, every layer ticked and unticked with the count checked after each, `Escape`, focus, and the 400 px pointer path; and `tests/e2e/tour.spec.ts`: one test that walks to all nineteen rooms, each from the room before it, paced by a stall watchdog on the minimap pose (verified 2026-09-20: 31 passed, 1 skipped, 10.2 min — the tour is about 4.3 of it and the docs capture is the skip, being env-gated. The spread between two runs of the same commit on the same machine is why the stall watchdog paces the tour and not a wall clock)
- `E2E_SERVER_PORT=4194 pnpm test:e2e tests/e2e/remoteControl.spec.ts` — the pad drives the interior with no keyboard at all, stops on release (including a release away from the button), and fits a 400 px phone width with every button tappable
- `pnpm build && pnpm preview`, then in another shell `curl -s http://localhost:4173/ | grep '<title>'` — expect `<title>Floor</title>`
- `DEV_SERVER_PORT=5199 pnpm dev`, open http://localhost:5199 (5173 is taken on this machine) — walk the **whole floor** (22.50 × 10.00 m, ADR-008):
  - exterior view: the frame holds the whole floor, seen from side B and turned a little toward side A, so two sides are visible at once; drag to orbit, wheel to zoom — zooming in never enters the walls. The camera is derived from the viewport, not hand-placed: at 16:9 it fits the floor from 21.56 m and the building spans about 0.69 of the tighter frame axis
  - two cosmetic limits of that default frame are known and deferred to Part 4, so do not chase them: there is **no sky or horizon** (the dark ground plane fills the background behind the floor), and in a portrait window (e.g. 400 × 800) the building fills only about a quarter of the height, because the frame is width-bound at that aspect
  - exactly one wall stands below storey height: the side-A balcony's outer edge (`F1-R01-BAL-W4`), a balustrade at **1.10 m** over its whole 9.40 m run, which you look over rather than through. Every other wall on the floor is full height at 2.70 m — side B is a normal exterior wall now, so nothing along it is a parapet. `pnpm verify:plan` check 11 says this as "1 of 96 faces stand low". The height is `HEIGHTS.railing` itself rather than a second literal, so the 1.00-versus-1.10 disagreement the verifier used to print on every run cannot arise again (owner decision, ADR-011)
  - the side-B strip is 0.80 m deep and is four things in a row, not one terrace: the control-center balcony (x 4.10–4.90, 0.64 m²), the void (west) (x 4.90–11.65, 5.40 m²), the walkable balcony slab (x 11.65–15.35, 3.70 × 0.80 = 2.96 m²) and the void (east) (x 15.35–20.30, 3.96 m²). The two voids total 9.36 m² and read as holes through the floor; the slab's two edges against them carry thin metal railings
  - a void reads as a **shaft**: orbit until you look into the 0.80 m opening — the ground is a storey below the slabs (−3.30 m) and dark, so what shows through is clearly further away and darker than the lit slabs around it, and the side face of the shaft is what gives its depth. There is no shadow gradient down the shaft: there are no shadow maps in Part 2 (ADR-008), so depth comes from the side face alone
  - the stair bay (4.00 × 2.00 m at x 1.60–5.60, z 4.00–6.00) is mostly a hole: only the 1.00 × 2.00 m arrival landing at its east end (x 4.60–5.60) is floor at this level, and the other 6.00 m² is open. The stair runs THROUGH this floor — look down the flight arriving from the half-landing below, and up through the opening the flight leaving this floor rises out of. A landing at each end with the two flights of 9 risers between them, 18 risers of 3.00/18 in all, a 0.25 m going and a 1.00 m flight width, wide enough to carry an appliance
  - the dark television panel faces the living-room opening from the corridor's south wall
  - windows are 8 declared openings, and none of them sits in the side-C or side-D envelope: one from the control center onto the side-A balcony, one 0.55 m food tunnel from the guest room through to the kitchen, and six facing the two side-B voids. They are deliberately not one size — bathroom ventilation slots above eye level (sill 1.90 m, head 2.30 m), the food pass at counter height (1.00–1.80 m), daylight windows at 0.90–2.10 m, and the laundry's single wide opening at 0.60–2.30 m. The living room and both kids bedrooms still get no daylight at all, and the master bedroom deliberately has no window
  - drive the interior with the **remote buttons alone**: Tab to "Interior view", Enter, then use only the mouse on the pad — hold "Move forward" to walk, "Turn left" / "Turn right" to turn, "Look up" / "Look down" to look; every release stops the movement at once; release a button while the pointer is over the canvas and nothing keeps moving; click "Third person" and the pad still drives the person
  - repeat the previous check with the window narrowed to 400 px (phone width): the pad leaves the HUD stack and sits **bottom-anchored**, full width and centred; the status line and both toggles share one row at the top; the hint shortens to "Move with the pad below · or W A S D"; the 3D view keeps most of the height between the two (~73.5% at 400 × 800) instead of being squeezed into a strip; there is no horizontal page scroll, and every button is still at least 44 px and tappable. Widen the window again and the desktop layout is unchanged
  - keys still work alongside the pad: hold W to walk, J / L to turn, I / K to look, V to switch person view; walking now stops at the **real walls** of the whole floor and passes through its doors (ADR-013), so walk out of the stair bay into the corridor and on into the kitchen
  - the interior opens on the stair arrival landing (5.10, 5.00) facing the corridor, never in a corner, and it opens in **first person**; `V` pressed there now shows the **whole person**, because the follow camera backs into the open stair shaft behind the landing instead of being stopped by it (ADR-008, ADR-013, ADR-014)
  - step the `Floors` stepper to `03`: two more identical storeys appear above, the frame still holds the whole building, and the fog plane still clears it (`CAMERA_FAR` is 800 m, against a measured worst case of 500.26 m over the count × aspect matrix). Enter the interior, walk into the stair bay and up the flight — the rise is continuous, the half-landing needs a strafe onto the next flight, and on arrival the readout reads `Room: F2-…`, the room list is named "Rooms on floor 2" and the minimap chip reads `Floor 2 of 3`. Step back to `01` while standing on floor 3 and you land on floor 1 at the same plan position (ADR-014)
  - pick a room from "Go to room" and watch the walk route itself through the doorways; press `Escape`, or hold any movement key, to take over mid-walk
  - the interior lighting is the same on every entry: enter, leave, and enter again — the rooms are shaded identically, and entering the interior directly is identical to entering it after the exterior has settled (ADR-009)

## CI

- Workflow `.github/workflows/ci.yml` runs on every pull request and on every push to `main`; a newer push to a pull request cancels that pull request's run in progress, while every push to `main` runs to completion
- One job, `ci` (Ubuntu, Node from `.nvmrc`, pnpm from `packageManager`, 15-minute timeout): `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm verify:plan` (the step is named "Verify the floor plan"), `pnpm test`, `pnpm build`, `pnpm exec playwright install --with-deps chromium`, `pnpm test:e2e` — the same full gate as locally
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

## Deploy

Self-hosted, over SSH. A release is a directory named after the commit and the web server's root is the `current` symlink, so going live is one rename and rolling back is re-pointing that symlink at the previous directory. `.github/workflows/deploy.yml` runs exactly the commands below on a `v*` tag, but it is **advisory** while the repository has a GitHub Actions billing problem: the authoritative deploy is this sequence, run by hand from a clean checkout of the tag. Both paths are the same commands, so restoring billing changes who runs them and nothing else.

Substitute throughout: `<host>` the web server, `<user>` the SSH user, `<path>` the absolute directory holding `releases/` and `current`, `<url>` the public URL, and `<sha>` the full commit the tag points at.

### Deploy a tag

```bash
git fetch --tags && git checkout v1.0.0   # deploy a tag, never a dirty tree
git status --porcelain                    # must print nothing
pnpm install --frozen-lockfile
pnpm build                                # writes dist/
pnpm size                                 # the bundle budget — a red budget is not deployed

SHA="$(git rev-parse HEAD)"

# Upload beside the live release, never over it: nothing the browser sees moves yet
rsync -az --delete -e "ssh -p 22" \
  --rsync-path="mkdir -p '<path>/releases/$SHA' && rsync" \
  dist/ "<user>@<host>:<path>/releases/$SHA/"

# Go live. `ln -sfn` alone unlinks `current` before relinking it, which leaves a
# window with no web root at all; linking under a temporary name and `mv -T`ing it
# over is one rename syscall, so a request sees either the old release or the new one.
ssh <user>@<host> "set -eu; cd '<path>'; \
  ln -sfn 'releases/$SHA' current.tmp; \
  mv -Tf current.tmp current; \
  ls -1dt releases/*/ | tail -n +6 | xargs -r rm -rf"   # keep the 5 newest

# The deploy is not done until the site answers
curl -fsS --retry 5 --retry-delay 3 --retry-all-errors '<url>' > /dev/null && echo 'deploy ok'
```

### Roll back

A rollback moves the symlink and nothing else — no rebuild, no upload, and the bad release stays on disk for inspection.

```bash
ssh <user>@<host> "ls -1dt '<path>'/releases/*/"        # newest first
ssh <user>@<host> "readlink '<path>/current'"           # what is live right now

ssh <user>@<host> "set -eu; cd '<path>'; \
  ln -sfn 'releases/<previous-sha>' current.tmp; \
  mv -Tf current.tmp current"

curl -fsS '<url>' > /dev/null && echo 'rollback ok'
```

Delete the bad release directory once the cause is understood, so the pruner does not carry it forward.

### The web server

Static files with the hashed-asset contract Vite already produces: `try_files $uri /index.html` so a deep link resolves, `assets/*` served `Cache-Control: public, max-age=31536000, immutable` because every asset name carries its own hash, and `index.html` served `no-store` because it is the one file whose name never changes and whose content always does.

### The deploy key

- One key, used for nothing else. Its line in the host's `authorized_keys` is restricted — `command="<wrapper>",restrict ssh-ed25519 AAAA…` — so it can only run the upload-and-swap wrapper and cannot open a shell.
- The private half is `secrets.DEPLOY_SSH_KEY` and the host's public key line is `secrets.DEPLOY_KNOWN_HOSTS`; the workflow verifies the host against it (`StrictHostKeyChecking=yes`) rather than trusting it on first use, and never prints either.
- Variables, not secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_URL`, and the optional `DEPLOY_PORT`. **With `DEPLOY_HOST` unset a tag push still builds, checks the budget and uploads `dist/` as an artifact, and the run is green** — the deploy steps are skipped, not failed.

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
- `pnpm typecheck` reporting fewer errors than the tree actually has → its incremental cache is stale. It still **fails** correctly, so the gate has no hole, but a partial error list can persuade you that a given file is clean when it is not. When checking one file's state, run `pnpm exec tsc -b --force` (or delete `tsconfig.tsbuildinfo`) instead of trusting the incremental output: measured on one broken tree, plain `tsc -b` reported 22 errors while `--force` reported 78 across 10 files
- Playwright `Executable doesn't exist` → `pnpm exec playwright install chromium`
- Playwright reports missing system libraries → `pnpm exec playwright install --with-deps chromium`
- `Unsupported engine` warnings → `nvm install && nvm use` (Node from `.nvmrc`)
