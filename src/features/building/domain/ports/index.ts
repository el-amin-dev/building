/**
 * Public API of the port model (ADR-006): the port types, the door schedule of
 * the typical floor, the read-only queries on it and its validation.
 *
 * Import from this module rather than from the individual files. The model is
 * pure TypeScript and depends only on the floor-plan model, the plan geometry,
 * the plan box and the floor heights.
 */
export type { Port, PortAxis, PortKind } from './types.ts';
export { PORT_SCHEDULE } from './portSchedule.ts';
export {
  getPortContact,
  getPortOpening,
  getPortPartners,
  getPortSpan,
  getPortsOf,
} from './queries.ts';
export { validatePorts } from './validatePorts.ts';
