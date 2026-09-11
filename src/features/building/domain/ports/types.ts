/**
 * Types of the port model: the doors and openings that connect two spaces.
 *
 * A port is one passage in the wall between two spaces of the floor plan. The
 * schedule comes from brief §6 (access graph / door schedule), amended by the
 * owner answers of ADR-006: doors are 0.90 m wide unless an exception says
 * otherwise, the living room opens onto the corridor through a 3.50 m opening,
 * and there is no side-A exterior door.
 *
 * This module holds types only; the schedule data, its queries and its
 * validation live in sibling files. Ports are horizontal by nature: every port
 * runs from the finished floor up to `FLOOR_HEIGHTS.door`, with a lintel filling
 * the wall above it, so no vertical size is stored per port.
 */
import type { SpaceId } from '../floorPlan/index.ts';

/**
 * What kind of passage a port is: a `door` is a door-width leaf in a wall, an
 * `opening` is a wall interruption with no leaf, such as the 3.50 m living-room
 * opening or the stairs-to-corridor continuity (brief §6, §4.2).
 */
export type PortKind = 'door' | 'opening';

/**
 * The plan axis the port's width runs along: `x` for a port in a wall facing
 * z (a north or south wall), `z` for a port in a wall facing x.
 */
export type PortAxis = 'x' | 'z';

/** One passage between two spaces of the floor. */
export interface Port {
  /**
   * The two spaces the port connects, in the order the schedule names them. A
   * port is undirected: it is equally a passage from the first to the second.
   */
  readonly spaces: readonly [SpaceId, SpaceId];
  /** Whether the passage has a door leaf or is an open wall interruption. */
  readonly kind: PortKind;
  /**
   * Axis the port's width runs along. Stored rather than inferred from the two
   * spaces: guestRoom ↔ linkCorridor and guestRoom ↔ corridor each touch on
   * both axes, so the shared wall alone does not determine the axis.
   */
  readonly along: PortAxis;
  /**
   * Start of the port along {@link Port.along}, in metres on the centimetre plan
   * grid: the port covers `spanMin` to `spanMin + width`.
   */
  readonly spanMin: number;
  /** Clear width of the passage, in metres; 0.90 m for a default door (brief §6). */
  readonly width: number;
  /**
   * Why this port deviates from the brief §6 default, for traceability to the
   * owner answer that ruled it (ADR-006). Absent when the port follows the
   * default.
   */
  readonly exception?: string;
}
