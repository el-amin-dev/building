/**
 * Public API of the port model: the port types, the door schedule of the typical
 * floor, the read-only queries on it and its validation.
 *
 * Import from this module rather than from the individual files. The model is
 * pure TypeScript and depends only on the source of truth, the floor-plan model,
 * the plan geometry, the plan box and the floor heights.
 */
export type { Port, PortAxis, PortKind, PortSwing } from './types.ts';
export { PORT_SCHEDULE } from './portSchedule.ts';
export {
  getPortContact,
  getPortOpening,
  getPortPartners,
  getPortSpan,
  getPortThicknesses,
  getPortsOf,
  needsSwingClearance,
} from './queries.ts';
export { validatePorts } from './validatePorts.ts';
