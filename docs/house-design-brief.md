# HOUSE DESIGN BRIEF — single floor, 22.50 m × 10.00 m

> Everything below is a **requirement from the owner**, not a suggestion, unless marked `OPEN` or `NOTE`.

`SUPERSEDED IN PART — read this first (2026-09-12)` This brief is the owner's **original** requirements, and it keeps its authority over **intent**: what each room is for, why it is where it is, and which rules must never be undone. It has lost its authority over **numbers**. The owner redesigned the plan after Parts 0–2 were built, and the single source of truth for every dimension, area and door is now `src/features/building/domain/sourceOfTruth/plan.ts`, checked by `pnpm verify:plan` and drawn into `docs/source-of-truth-n-floor.drawio.html`, which is GENERATED from it (ADR-010). **Where this document and the plan disagree, the plan wins.** The sections changed most are marked `SUPERSEDED` below; the headline changes are: interior partitions are 0.15 m and isolation is wall **width**, not a material; the **link corridor no longer exists**; a bathroom's bath and shower are now **rooms** with their own sliding doors, taking the floor from 18 spaces to 22 (**21** since the guest shower was dropped on 2026-09-19 — see §7.3); the stair **runs through** this floor on 18 risers and its bay is a hole but for the arrival landing; windows are 9 **declared** openings with a purpose each, not one derived size; and the plot closes in **four** parts, not three (see §8).

---

## 1. SITE & ORIENTATION

| Key | Value |
|---|---|
| Plot | 22.50 m (A→D axis) × 10.00 m (C→B axis) = **225.00 m²** |
| Floors | This document = **one floor only** (stairs + elevator reserved for future floors) |
| Side A | **Entry / street.** Main door comes in here |
| Side B | **Open air.** Full 22.50 m face. Light + ventilation source |
| Side C | **Blocked.** No windows, no openings |
| Side D | **Blocked.** No windows, no openings |

`NOTE` Because C and D are blocked, **every habitable room must get light/air from A or B**, or from one of the two open-air elements described in §5.

---

## 2. WALL SPECIFICATION

| Key | Value |
|---|---|
| Exterior walls (A, B, C, D) | **0.30 m** |
| Interior partitions | **0.20 m** |
| Walls facing open air / void | **0.30 m** (weather-exposed face) |
| Interior envelope | 21.90 m × 9.40 m |
| All dimensions in §4 | **CLEAR / INNER** (finished face to finished face) |

`SUPERSEDED` Interior partitions are **0.15 m**, not 0.20 m, and isolation is a wall's **width** rather than a property of how it is made: a face the owner named off the wall register is built **0.30 m** and a plain separator **0.15 m**. Exterior and void-facing walls are unchanged at 0.30 m, one join keeps a stated 0.20 m (east void ↔ utility room), and five joins are zero-thickness. A consequence the drawing now shows: **a wall can change thickness along its length** — four faces do, and each face carries a list of contact stretches with the thickness and the reason for each. `pnpm verify:plan` check 8 prints them; the totals are 0.15 m over 87.05 m of face, 0.30 m over 178.55 m, 0.20 m over 1.90 m and 0.00 m over 8.80 m, and 108.90 m of the floor's 276.30 m of wall face is insulated.

---

## 3. DESIGN RULES THE OWNER SET

1. **Function first, leftovers second.** Each room is sized to its *functional minimum* (what the furniture and fixtures actually need). Only afterwards is spare space distributed. Do **not** allocate by equal split or by percentage.
2. **All water infrastructure lives on side B.** Kitchen, laundry, main sanitair, guest sanitair are on the B side so supply and drainage run in one zone. The utility room needs no water, so it is deliberately kept off that zone.
3. **Corridor must pass appliances.** The corridor is sized so a fridge or a washing machine can be carried through, now and in future. This is a hard requirement, not comfort.
4. **Utility room absorbs leftover space.** It must always exist, but its size flexes with whatever is left. It replaced an earlier "storage room" — same role, one room only.
5. **Laundry is acoustically/visually separated from circulation.** It must NOT open onto the corridor.

---

## 4. ROOM PROGRAM — EXACT INNER DIMENSIONS

### 4.1 Top row (C side), depth 3.40 m — all four equal

| Room | Clear W × D | Area |
|---|---|---|
| Master Bedroom (parents) | 5.00 × 3.40 | 17.00 m² |
| Living Room | 5.00 × 3.40 | 17.00 m² |
| Bedroom — male kids | 5.00 × 3.40 | 17.00 m² |
| Bedroom — female kids | 5.00 × 3.40 | 17.00 m² |

- Living Room sits **between** the master bedroom and the kids' bedrooms.
- Living Room has a **3.50 m wide opening** to the corridor (not a door).
- A **television** is mounted on the corridor's south wall facing the living room — living room + corridor read as one lounge space.

### 4.2 Circulation, depth 1.50 m

| Element | Clear W × D | Area |
|---|---|---|
| Stairs + Elevator | 3.70 × 1.50 | 5.55 m² |
| Corridor | 14.90 × 1.50 | 22.35 m² |
| Link corridor | 5.40 × 0.90 | 4.86 m² |

- Stairs sit at the **A end**, continuous with the corridor (no wall between them).
- Corridor **ends at the Main Sanitair** (x = 20.20 m). It does **not** continue past it — the Utility Room takes the remaining depth.
- Link corridor runs east–west at the A end, below the stairs. It connects: **A balcony ↔ stairs ↔ corridor ↔ control center ↔ guest room**.

`SUPERSEDED` **The link corridor no longer exists.** The guest room's north strip absorbed it and does its job: the strip runs the full width from the side-A balcony at x 1.60 to x 9.70, reaches the balcony directly, and is the only side the control center can be entered from. The stair bay grew from 3.70 × 1.50 to **4.00 × 2.00 = 8.00 m²** so that a landing fits at each end with the two flights between them, taking 0.30 m off the corridor's west end; the corridor is 25.05 m² over two rects, the second of which is the stair hall and the television wall. The stairs are still continuous with the corridor through a zero-thickness join.

### 4.3 Service row (B side), depth 2.80 m

| Room | Clear W × D | Area |
|---|---|---|
| Control Center | 2.20 × 1.70 | 3.74 m² |
| Guest Room | **L-shaped** (see below) | 10.02 m² net |
| Guest Sanitair | 1.60 × 1.30 | 2.08 m² |
| Kitchen | 4.00 × 2.80 | 11.20 m² |
| Laundry | 3.20 × 2.80 | 8.96 m² |
| Main Sanitair | 2.60 × 2.80 | 7.28 m² |
| Utility Room | 1.80 × 5.80 | 10.44 m² |

**Guest Room is intentionally L-shaped — keep it irregular.**

| Key | Value |
|---|---|
| South arm | 5.80 × 1.70 |
| East arm | 2.60 × 1.10 |
| Gross | 12.72 m² |
| Net (after sanitair block) | 10.02 m² |
| Cause of the L | The link corridor notches its top-left corner |

**Utility Room** sits on side D, runs the **full depth** from the corridor to the side-B wall. It is the only service room with **no open-air strip in front of it**.

`CORRECTION 2026-09-19` **The guest room is a SITTING room, not a guest bedroom** — and it is still L-shaped, so the §9 item below still binds. The owner walked it in 3D and asked for the sofa and the table guests actually sit at; the bed and the 0.60 × 0.90 × 2.20 m oak wardrobe against its east wall — "the yellow thing", and the tallest object in a room 1.55 m deep — are what paid for them. The bed went by arithmetic rather than by taste: the lower leg is **1.55 m deep**, a bed is 0.90 and a sofa is 0.80, and 1.70 m of furniture does not fit across 1.55 m however the two are turned, so it was one or the other. It holds a sofa and a freestanding coffee table now, its north strip is still the circulation that reaches the control center and the side-A balcony (§4.2, ADR-011), and it is **11.97 m²** — up from 10.42, because its lower leg grew west-to-east into the metre the guest suite gave back when the shower was dropped (§7.3). The room keeps its own bathroom suite. Recorded in ADR-021.

---

## 5. OPEN-AIR ELEMENTS

### 5.1 Side-A balcony

| Key | Value |
|---|---|
| Size | 1.00 × 9.40 = **9.40 m²** |
| Extent | Full A depth (10.00 m minus the two 0.30 walls) |
| Role | Entry arrives here first; master bedroom opens onto it; link corridor opens onto it |

### 5.2 Side-B strip — **this is a hole, not land**

| Key | Value |
|---|---|
| Total | 18.60 m × 1.00 m = **18.60 m²** |
| Nature | **VOID — no floor, open to sky.** Light + laundry aeration |
| Extent | Runs from where the A-balcony block ends (x 1.60) to the Main Sanitair end (x 20.20) |
| Excluded | Utility Room has no strip in front of it |
| Balcony slab inside it | 3.50 × 1.00 = **3.50 m²** — the only part with a floor |
| Slab position | In front of the **laundry** and **part of the kitchen** only |
| Pure void | 11.10 m² west of the slab + 4.00 m² east = 15.10 m² |

`CRITICAL` The strip is **not** a continuous balcony. It is a void. Only the 3.50 m stretch serving the laundry and kitchen is a walkable slab.

`SUPERSEDED` The `CRITICAL` rule above still holds — the strip is a hole with a slab in it — but every number in this table has moved, and **side B is now a normal 0.30 m exterior wall at full height, not an open face**. The strip is **0.80 m deep**, not 1.00: it carries the water, gas and electricity risers, which take about 0.15 m off the wall, so 0.80 m leaves about 0.65 m for a plumber to stand in, and the 0.20 m saved went to the kitchen, laundry and main sanitair. It is four pieces in a row, west to east: the **control-center balcony** (x 4.10–4.90, 0.64 m², new — walkable), **void (west)** (x 4.90–11.65, **5.40 m²**), the **balcony slab** (x 11.65–15.35, 3.70 × 0.80 = **2.96 m²** — the only part with a floor, still in front of the laundry and part of the kitchen, still the barbecue place) and **void (east)** (x 15.35–20.30, **3.96 m²**). Pure void is therefore **9.36 m²**, not 15.10 m². The slab runs 0.10 m wider than drawn at each end so the kitchen and laundry doors keep a 0.10 m jamb to the railing instead of opening onto it.

---

## 6. ACCESS GRAPH (door schedule)

All doors are **0.90 m** unless stated.

| From | To |
|---|---|
| Side A (exterior) | A balcony — **main entry** |
| A balcony | Link corridor · Master Bedroom |
| Corridor | Master Bedroom · Living Room (3.50 m opening) · Bedroom male · Bedroom female · Kitchen · Main Sanitair · Utility Room · Link corridor |
| Stairs | Link corridor |
| Link corridor | A balcony · Stairs · Corridor · Control Center · Guest Room |
| Guest Room | Link corridor · Kitchen · Guest Sanitair |
| Kitchen | Corridor · Guest Room · Laundry · Balcony slab |
| Laundry | Kitchen · Main Sanitair · Balcony slab |
| Main Sanitair | Corridor · Laundry |
| Control Center | Link corridor |
| Utility Room | Corridor **only** |
| Bedrooms (3) | Corridor **only**, one door each |

### Hard access rules

| Rule | Reason |
|---|---|
| Laundry has **NO corridor door** | Reached only through kitchen or main sanitair |
| Utility has **exactly one** corridor door | Nothing else |
| Master Bedroom does **NOT** open onto the stairs | It is the parents' room — privacy. It opens onto the corridor and the A balcony |
| Guest Room opens onto the **link corridor** | So guests reach the stairs and entry without crossing the family zone |
| Control Center is reached from the **link corridor** | It is a technical room — it needs direct access without crossing a habitable room. An earlier version routed it through the guest room; that is superseded |

`SUPERSEDED` The schedule is now **20 ports**: 19 doors from 0.60 to 0.90 m plus the single 3.50 m living-room opening with no leaf. Doors are no longer all 0.90 m, and **five slide** because no leaf can swing in the floor their room has left (the guest room ↔ guest sanitair door and all four bath/shower cubicle doors). The five **link-corridor doors are gone** with the link corridor, and so is the guest room ↔ kitchen door, which the owner replaced with a 0.65 m food-pass window through the wall. Entry is **through the stairs only** and there is deliberately no side-A exterior door, so the "Side A (exterior) → A balcony" row above no longer holds (ADR-006). The **guest room now opens onto the stair landing** directly, and the **control center is entered from the guest room's north strip** — the strip is what replaced the link corridor, so the two hard rules below about link-corridor access are met by it rather than voided. The four hard rules that still bind unchanged: the laundry has no corridor door, the utility room has exactly one, the master bedroom does not open onto the stairs, and the guest bathroom is reached through its own suite. `pnpm verify:plan` check 6 proves 19/19 spaces reachable with neither void reachable, and that a door opens onto the stair bay only where the landing is floor at this level.

`CORRECTION 2026-09-19` Four numbers in the paragraph above moved when the guest shower was dropped (§7.3, ADR-021), and nothing else in it did. The schedule is **19 ports**: 18 doors plus the single 3.50 m living-room opening. **Four slide**, not five — the guest room ↔ guest sanitair door and the three remaining bath/shower cubicle doors. The food pass narrowed from 0.65 m to **0.55 m**, which buys it 0.10 m of masonry jamb each side instead of the bare 0.05 m minimum, because it is no longer a hole in a 0.30 m wall but the bore of a **1.00 m tunnel**: a `passCounter` fixture builds the other 0.70 m out from the guest-room face, so the opening has a mouth at each end and a ledge at 1.00 m to stand plates on, with plain wall above it. And check 6 now proves **18/18** reachable. The four hard rules above still bind unchanged, and the guest bathroom is still reached through its own suite.

`SUPERSEDED 2026-09-12` The hard rule above — "Control Center is reached from the **link corridor** … it needs direct access without crossing a habitable room. An earlier version routed it through the guest room; that is superseded" — is **retired**, by the owner's decision. Plan v2 does route it through the guest room: `controlCenter ↔ guestRoom` and `controlCenter ↔ ccBalcony` are the room's only two doors. The owner decided that is **fine as built**, because the guest room's north strip *is* the circulation the rule asks for — it is the old link corridor, absorbed into the room when the link corridor disappeared (§4.2), running the full width from the side-A balcony at x 1.60 to x 9.70. The rule's intent survives, which is that a technical room is entered from circulation rather than through someone's living space; the sentence naming the link corridor cannot survive, because the link corridor does not exist. The trade-off was put to the owner and accepted: a technician reaching the water, gas and electricity risers still crosses a bedroom to get to them. Recorded in ADR-011 (`.claude/claude.questions.md` Q16).

---

## 7. FIXTURES AND EQUIPMENT PER ROOM

> **These are the details the owner specified early and they must be preserved.**

### 7.1 Laundry — must fit ALL of these

| Item | Note |
|---|---|
| **Washing machine** | Standard front-loader |
| **Sink for manual hand-washing** | The owner's mother prefers hand-washing to the machine for some items. This sink is **required**, it is not a duplicate of the machine |
| **Clothes armoire — dirty** | Separate section |
| **Clothes armoire — clean** | Separate section |
| **Cleaning / housekeeping storage** | Broom, mop, cleaning products, that kind of utility |
| **Aeration** | Opens onto the balcony slab. The side-B void exists largely to ventilate and dry laundry |

### 7.2 Kitchen

| Item | Note |
|---|---|
| **Natural light** | Comes from the open side B |
| **Balcony continuity** | Kitchen opens onto the balcony slab |
| **BBQ use** | The balcony slab is intended for **barbecue / grilling**, run as an extension of the kitchen. Keep the kitchen–balcony connection direct |
| Access | Also connects to guest room and laundry |

### 7.3 Sanitair concept — **read carefully, this is a specific layout**

The owner's model: `[ sink [bath] [shower] ]`

| Key | Value |
|---|---|
| Concept | You enter a sanitair room and find an **open sink** in that room |
| Sub-rooms | From that room, **two doors**: one to the **bath**, one to the **shower** |
| Sink | **Not separated** — it sits in the open part of the room |
| Purpose | Someone can wash their hands without occupying the bath or the shower |

| Room | Contents |
|---|---|
| **Main Sanitair** | Sink (open) + **Bath** + **Shower** |
| **Guest Sanitair** | Sink (open) + **Bath** — **NO shower** |

`SUPERSEDED` The concept above is exactly what got built, and it was made literal: the owner's `[ sink [bath] [shower] ]` means **the bath and the shower are rooms, not fittings** — "bathroom is room contain open sink, [bath],[shower] and both isolated with wall and has port". Each therefore has its own walls, its own matricule and its own **sliding** door, which is what took the floor from 18 spaces to 22. The guest sanitair **does get a shower** after all, contrary to the row above: it has all three, cut to the minimum that still works. As built — Main sanitair 3.98 m² (open part, sink 0.70 × 0.45) + Family bath 1.90 m² (a 1.50 × 0.70 bath) + Family shower 0.98 m²; Guest sanitair 1.54 m² (open part only 0.55 m deep, sink 0.70 × 0.45) + Guest bath 1.15 m² (a 1.55 × 0.60 bath across its width) + Guest shower 0.70 m². Every leaf in both suites slides because nothing can swing into 0.55 m, and the ventilation is a 0.60–0.70 m slot above eye level (sill 1.90 m, head 2.30 m) onto the side-B void. `OPEN` If the guest suite proves too tight in the 3D walk-through, the levers are to drop its bath or take depth from the guest room.

`CORRECTION 2026-09-19` **The guest sanitair has NO shower, and the table above stands exactly as written.** Two sentences in the paragraph above are retired: "The guest sanitair **does get a shower** after all, contrary to the row above", and the `OPEN` question that closes it. The shower was never asked for — `Guest Sanitair | Sink (open) + **Bath** — **NO shower**` is this section's own row — and the cubicle was added later, when the concept was made literal and a bath and a shower each became a room with its own door. It is also what made this the tightest corner of the floor: the open part is 0.55 m deep against a 0.50 m walker, which leaves 0.05 m of lateral room along its whole length. The owner walked it in 3D on 2026-09-19 and dropped it. That is a **third** lever this section never listed, and it is the cheapest of the three because it costs nothing the brief asked for; the two levers §7.3 *did* name — dropping the guest bath, or taking depth from the guest room — are **still unspent and still available** if the suite ever needs more. As built now: Main sanitair 3.98 m² + Family bath 1.90 m² + Family shower 0.98 m² (unchanged, but renumbered R21 → **R20** and R22 → **R21** behind the deleted room); Guest sanitair **0.99 m²**, the open part, still only 0.55 m deep, with a 0.35 × 0.45 corner basin standing in its east dead-end; Guest bath **1.26 m²**, which is 1.80 m wide where it was 1.65 because it absorbed the 0.15 m partition the shower used to stand behind, and it still holds a 1.55 m bath. The whole suite slid east onto the floor the shower held and both its sliding leaves are now at its west end, nearly opposite one another, which is what leaves the basin a dead-end to itself. The metre the suite gave up went to the guest room (§4.3), not to the bathroom's depth — so the suite is shorter, not roomier, and the 3D tour still walks it last. The floor is **21 spaces**, not 22. Recorded in ADR-021.

### 7.4 Control Center — **building services / technical entry**

`CORRECTION` This room is **not** a security or monitoring room. It is the **technical entry point and centralisation hub for every utility that comes into the house.**

| Key | Value |
|---|---|
| Role | **Entry + centralisation of all building services** |
| Position | Side A, at the entry — services arrive from the street on this side |
| Access | Link corridor |
| Size | 2.20 × 1.70 = 3.74 m² |

**Services that terminate and centralise here**

| Service |
|---|
| **Electricity** — incoming supply, panel, distribution |
| **Ethernet / internet** — incoming line, network centralisation |
| **Gas** — incoming supply |
| **Water** — incoming supply |
| **Heater** |
| **Air conditioning** |
| General **centralisation** of the above |

**MANDATORY SPLIT — to be applied later**

| Key | Value |
|---|---|
| Requirement | The Control Center must be **divided into two isolated compartments** |
| Compartment 1 | **Gas + Water** |
| Compartment 2 | **Electricity** (and the low-voltage / ethernet side) |
| Reason | Wet and gas services must not share a compartment with electrical equipment |
| Status | `DO NOT REDESIGN THE PLAN FOR THIS NOW.` The split is a later step — the room stays one volume in the current drawing, and gets divided internally afterwards |

### 7.5 Circulation

| Key | Value |
|---|---|
| Corridor width | **1.50 m** — chosen so a fridge (~0.90 m) or a washing machine can be carried through with clearance, now and in future |
| Stairs + elevator | Reserved at the A end. Elevator is `OPEN` — provision only |
| Link corridor width | 0.90 m — walking width only |

---

## 8. AREA VERIFICATION

| Item | Area |
|---|---|
| Master Bedroom | 17.00 m² |
| Living Room | 17.00 m² |
| Bedroom male | 17.00 m² |
| Bedroom female | 17.00 m² |
| Stairs + elevator | 5.55 m² |
| Corridor | 22.35 m² |
| Link corridor | 4.86 m² |
| Control Center | 3.74 m² |
| Guest Room (net) | 10.02 m² |
| Guest Sanitair | 2.08 m² |
| Kitchen | 11.20 m² |
| Laundry | 8.96 m² |
| Main Sanitair | 7.28 m² |
| Utility Room | 10.44 m² |
| A balcony | 9.40 m² |
| B balcony slab | 3.50 m² |
| **FLOOR TOTAL** | **167.38 m²** |
| VOID (no floor) | 15.10 m² |
| WALLS | 42.52 m² |
| **GROSS PLOT** | **225.00 m²** ✓ |

`SUPERSEDED` The table above is the owner's verification of **2026-09-11**, of a floor that has since changed; it is kept as the record of what was asked for. The floor that is built closes on the same plot in **FOUR** parts, not three, because the stair bay is now a hole with one landing in it. These figures come from `pnpm verify:plan`, which is the authority (ADR-010):

| Item | Area | Note |
|---|---|---|
| **FLOOR (slabs)** | **165.920 m²** | the plan's own FLOOR total of 163.920 m² (`room` + `circulation` + `openAir`, which excludes the stair bay) plus the 2.00 m² arrival landing |
| **VOID (no floor)** | **9.360 m²** | void (west) 5.40 + void (east) 3.96 |
| **WALLS** | **43.720 m²** | wall footprint = plot − floor − void − stairwell |
| **SHAFT** | **6.000 m²** | the stair bay (8.00 m²) less its 1.00 × 2.00 arrival landing: the stair runs THROUGH this floor, so the rest of the bay is an open hole |
| **GROSS PLOT** | **225.000 m²** ✓ | 22.50 × 10.00 |

Room areas as built (**21 rooms** since 2026-09-19): Master bedroom 17.00 · Living room 17.75 · Bedroom male kids 17.75 · Bedroom female kids 17.75 · Stairwell 8.00 · Corridor 25.05 · Control center 5.50 · Guest room 11.97 · Guest sanitair 0.99 · Kitchen 10.38 · Laundry 9.24 · Main sanitair 3.98 · Utility room 9.43 · Side-A balcony 9.40 · Control-center balcony 0.64 · Side-B balcony slab 2.96 · Void west 5.40 · Void east 3.96 · Guest bath 1.26 · Family bath 1.90 · Family shower 0.98 m². The three rooms that grew did so because a 0.15 m partition gives back what a 0.20 m one took; the living room and both kids bedrooms are 3.55 m deep rather than 3.40 m, which is what keeps the corridor's north face running straight. Four of these figures moved again on 2026-09-19, when the guest shower (0.70 m², R20/SHW) was deleted: the guest room took 10.42 → 11.97, the guest bath 1.15 → 1.26 and the guest sanitair 1.54 → 0.99, and the family cubicles renumbered R21 → R20 and R22 → R21 behind the gap (§7.3, ADR-021). FLOOR and WALLS moved with them, which is why the table above reads 163.920 and 43.720 where `verify:plan` used to print 163.515 and 44.125.

`SUPERSEDED` The two chains below are also superseded in their numbers — the partition is 0.15 m, the service row is 3.00 m deep where the strip gave up 0.20 m, and the open-air strip is 0.80 m. The chains still close on 10.00 m and 22.50 m, and `pnpm verify:plan` check 3 prints the real ones, five across the depth and two across the width, each summing wall + space + wall … to the plot.

### Depth chain — must always total 10.00 m

```
0.30  exterior wall C
3.40  top row (bedrooms + living)
0.20  partition
1.50  corridor
0.20  partition
2.80  service row (kitchen, laundry, sanitair, guest, control)
0.30  wall to the void
1.00  open-air strip (VOID)
0.30  exterior wall B
----
10.00 m
```

### Width chain — must always total 22.50 m

```
0.30  exterior wall A
1.00  A balcony
0.30  wall
20.60 interior span
0.30  exterior wall D
----
22.50 m
```

---

## 9. OPEN ITEMS AND KNOWN TENSIONS

| Item | Status |
|---|---|
| **Control Center = 3.74 m²** | `PRIORITY` This room must hold electricity + ethernet + gas + water + heater + AC, **and** later be split into two isolated compartments (gas/water · electricity). 3.74 m² divided in two gives roughly 1.9 m² per compartment. Check this against real equipment sizes before building — it may need to grow, and the link corridor above it is the space to take it from |
| **Control Center split** | Not drawn yet. Deliberately deferred — see §7.4 |
| **Link corridor = 0.90 m** | Walking width only. Appliances **cannot** pass through it — all appliance moves must route via the main corridor and the kitchen door |
| **Elevator** | Space reserved, specification `OPEN` |
| **Guest Room L-shape** | **Intentional. Do not "fix" it into a rectangle.** |
| **Utility Room proportion** | 1.80 m wide × 5.80 m deep is a long thin room. Works as storage/technical, poor for anything needing width |
| **Side-A balustrade height** | `RESOLVED 2026-09-12 — built at 1.10 m.` The balcony's outer edge (`F1-R01-BAL-W4`, 9.40 m long) is the only wall on the floor below storey height. It was **stated at 1.00 m** against the plan's own railing constant of **1.10 m**, and `pnpm verify:plan` printed the disagreement on every run. The owner chose **1.10 m** and the stated 1.00 m is deleted — 1.10 m is the usual minimum for an edge a person can fall over, which is very likely why the constant is 1.10 m. The fix is structural, not just a new number: the `PARAPET_WALLS` entry now carries `HEIGHTS.railing` itself, so no second literal is left to disagree with it, and check 11 reports the one low face with no disagreement line. Recorded in ADR-011 |
| **Control Center = 5.50 m²** | The room grew from 3.74 m² and now runs to the side-B wall, with its own 0.64 m² balcony, which eases the `PRIORITY` item above — but the two-compartment split is still not drawn, so check it against real equipment sizes before building |
| **No daylight for 3 rooms** | Still open, and still in tension with the §1 `NOTE`. Of the 8 windows (9 until the guest shower's ventilation slot went with the room on 2026-09-19), none is in the side-C or side-D envelope: the living room and both kids bedrooms touch only blocked side C and get electric light only. The master bedroom also has **no window at all**, by the owner's choice — its only opening is the balcony door |
| **Link corridor items above** | Void: the link corridor no longer exists (see §4.2), so its 0.90 m width and its "appliances cannot pass" consequence no longer apply. All appliance moves route via the 1.50 m corridor, and the stair was widened to 1.00 m flights with a 2.00 m landing at each end specifically so a fridge or washing machine can be turned in it |

---

## 10. HISTORY OF CHANGES (so you don't undo a deliberate decision)

| Decision | Why |
|---|---|
| Storage room removed | Utility Room does the same job — one room, not two |
| Laundry moved into the service row, between kitchen and sanitair | Earlier it sat behind them in a second depth band; the owner wants it on the same level, in line |
| Corridor widened 1.30 → 1.50 m | Appliance transport |
| Corridor shortened to end at Main Sanitair | Utility Room takes the space beyond |
| Utility moved to side D, full depth | It needs no water, so it stays out of the B water zone |
| Side-B strip changed from "balcony" to **VOID** | It is a hole, not floor. Only the laundry/kitchen stretch is a slab |
| A balcony added, full A depth | Living Room reduced to 5.00 m and kids' rooms to 5.00 m to pay for it |
| Master door moved off the stairs | Parents' privacy |
| Stairs kept at the A end, continuous with the corridor | Entry lands at the stairs |
| **Control Center redefined** | It was described as a security room in earlier versions. **That was wrong.** It is the technical entry and centralisation hub for electricity, ethernet, gas, water, heater and AC — see §7.4. Its position at the A entry is now justified by the incoming service runs, not by watching the door |
| **Control Center split deferred** | The room must eventually be two isolated compartments (gas/water · electricity). The owner explicitly asked **not** to redesign the plan for this yet |
