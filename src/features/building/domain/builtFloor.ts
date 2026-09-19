/**
 * The whole floor, built once: one entry point the renderer can consume.
 *
 * Part 2 models the floor module by module — the plan (ADR-005), the ports
 * (ADR-006), the windows, the walls, the slabs, the railings, the stairs and the
 * television panel — and, since Part 4, the fixtures standing in the rooms
 * (`fixtures.ts`). Each of those is a pure function of the plan and the vertical
 * sizes, and each is independent of the others except for one ordering: the wall
 * generator needs the holes before it can leave them out, so the ports and the
 * windows must be resolved first and handed to it.
 *
 * This module is that single composition and nothing more. No geometry rule lives
 * here: every coordinate of a {@link BuiltFloor} is produced by the module that
 * owns it, so a rule changes in one place and this file never moves. What it does
 * add is the order and the one-off validation:
 *
 * 1. the port schedule is validated against the plan (`validatePorts`), so an
 *    unusable door is rejected here rather than silently missing a hole later;
 * 2. the windows are derived from the plan and the validated schedule, which is
 *    what keeps them clear of the doors (`windows.ts`, ADR-006);
 * 3. {@link BuiltFloor.openings} lists the port openings first, in schedule
 *    order, then the window openings, in window order;
 * 4. the walls are cut from that list, so every door and every window really
 *    holes its wall and keeps a threshold or a sill below and a lintel above
 *    (brief §2, §8).
 *
 * Every vertical level of the result comes from the `heights` argument alone
 * (`heights.ts`, ADR-006) and every plan coordinate from the `plan` argument, so
 * injecting other sizes moves the whole floor together. Nothing is memoised: the
 * renderer calls this once at module level, and a cache keyed on three object
 * arguments would be a correctness risk for no gain.
 *
 * Pure geometry, in metres, with the plan conventions of `floorPlan/types.ts`: no
 * React, no three, nothing mutated.
 */

import { getFixtures } from './fixtures.ts';
import type { BuiltFixture } from './fixtures.ts';
import { FLOOR_PLAN } from './floorPlan/index.ts';
import type { FloorPlan } from './floorPlan/index.ts';
import { FLOOR_HEIGHTS } from './heights.ts';
import type { FloorHeights } from './heights.ts';
import type { PlanBox } from './planBox.ts';
import { PORT_SCHEDULE, getPortOpening, validatePorts } from './ports/index.ts';
import type { Port } from './ports/index.ts';
import { getRailings } from './railings.ts';
import type { Railing } from './railings.ts';
import { getSlabs } from './slabs.ts';
import type { FloorSlab } from './slabs.ts';
import { getStairsLayout } from './stairs.ts';
import type { StairsLayout } from './stairs.ts';
import { getTvPanel } from './tvPanel.ts';
import { getWallPieces } from './walls.ts';
import type { WallPiece } from './walls.ts';
import { getWindows } from './windows.ts';
import type { FloorWindow } from './windows.ts';

/** Every solid of one storey, as the renderer needs it. */
export interface BuiltFloor {
  /** The solid wall blocks, with every opening punched out (`walls.ts`, brief §2). */
  /**
   * The wall solids, each carrying whether it is full height or a parapet.
   *
   * Declared as `WallPiece`, not `PlanBox`: a `WallPiece` is assignable to a
   * `PlanBox`, so widening it here compiles and breaks nothing — and silently
   * drops `kind` at the one boundary that consumes it, leaving the renderer to
   * infer from a height what the plan already states.
   */
  readonly walls: readonly WallPiece[];
  /** The slab under every space that has a floor (`slabs.ts`, brief §8). */
  readonly slabs: readonly FloorSlab[];
  /** The guard railings closing the fall edges of the side-B strip (`railings.ts`). */
  readonly railings: readonly Railing[];
  /** The windows of the floor, each with the hole it cuts (`windows.ts`, ADR-006). */
  readonly windows: readonly FloorWindow[];
  /**
   * The stairs: whatever pieces the plan declares, their levels, the rects that
   * block movement, and the arrival pose (`stairs.ts`).
   *
   * Only the arrival landing is floor at this storey, but the stair does not stop
   * here — it runs through (owner). One flight rises out of this level and the
   * other arrives at it from the half-landing below, so tread tops run from
   * −1.50 to +1.50 and the half-landing footprint carries a surface at both.
   */
  readonly stairs: StairsLayout;
  /** The television panel of the lounge (`tvPanel.ts`, brief §4.1). */
  readonly tvPanel: PlanBox;
  /**
   * The fixtures standing in the rooms, each with the boxes it is drawn as
   * (`fixtures.ts`, brief §7).
   *
   * A fitting on the built floor is not a new idea here: {@link BuiltFloor.tvPanel}
   * is precisely a fitting, and it has been on this interface since Part 2. The
   * alternative was tried and is what this replaces — a second layout folded in at
   * the UI, where `ui/floorLayout.ts` kept three sanitary heights of its own and
   * its docblock apologised for them in the same breath, promising to hand them to
   * the domain. A height derived beside the renderer is a building dimension
   * nobody can find: it is invisible to the volume checks, to the tests of this
   * file, and to anything else that asks what the floor is made of.
   *
   * Fixtures are deliberately NOT collision blockers: they are absent from
   * `getWalkField`, which sweeps `slabs`, `walls` and `railings` only. "Go to
   * room" routes to a room's centre, and a bed at a room's centre would wedge the
   * route follower against a blocker it had been told to walk into.
   */
  readonly fixtures: readonly BuiltFixture[];
  /**
   * Every hole fed to the wall generator: the port openings in schedule order,
   * then the window openings in window order. Doors run from the finished floor
   * to `heights.door`; each window carries its own sill and head, because they
   * now differ by purpose — a bathroom vent sits high, a pass-through at counter
   * height, a daylight window low and tall.
   *
   * That difference is what makes movement through a window impossible without a
   * rule forbidding it: a sill leaves the wall solid at body height, so a walker
   * meets masonry at a window and a hole only at a door.
   */
  readonly openings: readonly PlanBox[];
}

/**
 * Builds the whole floor from a plan, a port schedule and a set of vertical
 * sizes.
 *
 * The schedule is validated against the plan before anything is derived from it,
 * then the windows, then the openings, then the walls that those openings hole;
 * the slabs, the railings, the stairs and the television panel depend on the plan
 * and the heights alone and are read straight from their modules. The fixtures
 * take the plan alone: a basin rim is a fitting's own size, not a floor height
 * (`heights.ts`, `fixtures.ts`), so no injected set of heights moves one.
 *
 * @param plan - The floor plan to build; defaults to `FLOOR_PLAN`. Not mutated.
 * @param ports - The port schedule of that plan; defaults to `PORT_SCHEDULE`.
 *   Not mutated.
 * @param heights - Vertical sizes of the floor, in metres; defaults to
 *   `FLOOR_HEIGHTS`. Every level of the result comes from this argument.
 * @returns A frozen {@link BuiltFloor} whose arrays and members are frozen by the
 *   modules that build them.
 * @throws RangeError from the module that rejects the input: `validatePorts` for
 *   a port that does not sit in exactly one wall contact with a wall to cut,
 *   `getWallPieces` for a wall junction of unknown height, `getSlabs` for heights
 *   that leave no slab thickness, `getStairsLayout` for a stairs bay that cannot
 *   hold the flights, `getTvPanel` for a corridor that cannot host the panel,
 *   `getFixtures` for a fixture standing in a space the plan does not hold, of a
 *   kind with no profile, with no footprint, or tall enough to reach the storey.
 */
export function getBuiltFloor(
  plan: FloorPlan = FLOOR_PLAN,
  ports: readonly Port[] = PORT_SCHEDULE,
  heights: FloorHeights = FLOOR_HEIGHTS,
): BuiltFloor {
  const validated = validatePorts(plan, ports);
  const windows = getWindows(plan, validated, heights);
  const openings: readonly PlanBox[] = Object.freeze([
    ...validated.map((port) => getPortOpening(plan, port, heights)),
    ...windows.map((window) => window.opening),
  ]);
  return Object.freeze({
    walls: getWallPieces(plan, openings, heights),
    slabs: getSlabs(plan, heights),
    railings: getRailings(plan, heights),
    windows,
    stairs: getStairsLayout(plan, heights),
    tvPanel: getTvPanel(plan, heights),
    fixtures: getFixtures(plan),
    openings,
  });
}
