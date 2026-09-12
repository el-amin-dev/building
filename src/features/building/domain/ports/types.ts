/**
 * Types of the port model: the doors and openings that connect two spaces.
 *
 * A port is one passage in the wall between two spaces of the floor plan. The
 * ports themselves are declared once, in the source of truth
 * (`../sourceOfTruth/plan.ts`, `PORTS`); `portSchedule.ts` is that declaration
 * wearing the shape this model consumes. These types therefore describe the
 * shape only — where a port is, and why, is the plan's to say.
 *
 * This module holds types only; the schedule data, its queries and its
 * validation live in sibling files. Ports are horizontal by nature: every port
 * runs from the finished floor up to `FLOOR_HEIGHTS.door`, with a lintel filling
 * the wall above it, so no vertical size is stored per port.
 */
import type { SpaceId } from '../floorPlan/index.ts';

/**
 * What kind of passage a port is: a `door` is a leaf in a wall, an `opening` is
 * a wall interruption with no leaf — the 3.50 m living-room opening onto the
 * corridor is the only one of the floor.
 */
export type PortKind = 'door' | 'opening';

/**
 * The plan axis the port's width runs along: `x` for a port in a wall facing
 * z (a north or south wall), `z` for a port in a wall facing x.
 */
export type PortAxis = 'x' | 'z';

/**
 * How a door leaf opens. Absent means it swings; `'slide'` means it slides.
 *
 * Mirrors `PlanPortSwing` of the source of truth. It exists because five leaves
 * of this floor cannot swing at all: the guest bathroom's open part is 0.55 m
 * deep, and the four bath and shower cubicles are shallower than the leaf that
 * serves them, so a swinging leaf would have no floor to open into. The plan
 * records that reason on each one.
 */
export type PortSwing = 'slide';

/** One passage between two spaces of the floor. */
export interface Port {
  /**
   * The two spaces the port connects, in the order the source of truth names
   * them. A port is undirected: it is equally a passage from the first to the
   * second.
   */
  readonly spaces: readonly [SpaceId, SpaceId];
  /** Whether the passage has a door leaf or is an open wall interruption. */
  readonly kind: PortKind;
  /**
   * Axis the port's width runs along. Stored rather than inferred from the two
   * spaces: corridor ↔ kitchen, controlCenter ↔ guestRoom and
   * guestRoom ↔ guestSanitair each touch on both axes, so the shared wall alone
   * does not determine the axis.
   */
  readonly along: PortAxis;
  /**
   * Start of the port along {@link Port.along}, in metres on the centimetre plan
   * grid: the port covers `spanMin` to `spanMin + width`.
   */
  readonly spanMin: number;
  /**
   * Clear width of the passage, in metres.
   *
   * There is no default width and no fixed set of allowed widths. The floor uses
   * 0.60, 0.65, 0.70, 0.90, 1.20 and 3.50, and each departure from the usual 0.90
   * is a consequence of the room it serves — a 0.65 leaf in a wall only 0.75 m
   * long, a 0.60 cubicle door, the 3.50 living-room opening, and the 1.20 control
   * centre door, which is the one that departs UPWARDS: the owner widened it so a
   * water heater or a gas bottle can reach the risers. The plan carries the
   * reason for each; see {@link Port.why}.
   */
  readonly width: number;
  /**
   * How the leaf opens; absent when it swings, which is the normal case.
   *
   * A sliding leaf needs no floor to open into, so any check of door clearance
   * must exempt it rather than fail it — see `needsSwingClearance` in
   * `queries.ts`, which is the one place that decision is made.
   */
  readonly swing?: PortSwing;
  /**
   * Why the port is where it is and the size it is, in the owner's terms, as
   * recorded in the source of truth.
   *
   * This replaces the former `exception` field, which meant "why this port
   * deviates from the 0.90 m default". There is no default any more: a width is
   * whatever the room it serves allows, so a reason is ordinary rather than
   * exceptional. Absent when the plan states none.
   */
  readonly why?: string;
}
