/**
 * Everything the room info panel of the HUD shows about one room, derived once.
 *
 * The panel names a room, measures it, counts what opens into it and what stands
 * in it, says where its daylight comes from, and lists what is still unsettled
 * about it. Every one of those is a question the model can already answer, so
 * this module answers them — and the component that draws the panel derives
 * nothing at all. That is the whole point of it existing: a readout that works
 * out its own numbers is a second model, and a second model disagrees with the
 * first one the day either moves.
 *
 * Three rules this module keeps, each of which has an obvious-looking wrong way
 * right next to it:
 *
 * **The label is never re-spelt.** `getSpaceLabel` is the one label formatter of
 * the model (ADR-014), so {@link RoomInfo.label} is its output verbatim,
 * `F2-R11/KIT · Kitchen`, and {@link RoomInfo.matricule} is the same
 * `getFloorMatricule` stamp on its own for a caller that wants only that.
 * {@link RoomInfo.name} is the plan's name, untouched. Nothing here joins a
 * matricule to a name with its own separator.
 *
 * **The clear size is the room's rects, not its bounding box.**
 * `getSpaceBounds` sits in the same barrel and looks like the obvious call, and
 * it is wrong for this: the corridor, the guest room and the kitchen are each
 * drawn as two rectangles, so their bounding box states a width and a depth the
 * room does not have — the corridor's box would swallow the whole stair hall.
 * {@link RoomInfo.rects} is therefore the rects themselves, rect by rect, and
 * {@link RoomInfo.area} is `getSpaceArea`, which sums them. A panel that wants
 * one line per rectangle has one; a panel that wants a single number has the
 * area.
 *
 * **Daylight is derived, never a list of room ids.** See {@link DaylightSource}.
 *
 * **So are the services, and for the same reason.** A hand-kept list of which
 * room has water in it is a second copy of the runs, right until the morning a
 * branch moves and the list does not. {@link RoomInfo.services} is read off the
 * declared ENDS of the runs themselves. See {@link RoomService}.
 *
 * Pure: it reads a plan, a port schedule and a built floor, and mutates none of
 * them. Areas are in square metres and rects in metres, with the plan
 * conventions of `floorPlan/types.ts`.
 */

import type { BuiltFloor } from './builtFloor.ts';
import { getFixturesOf } from './fixtures.ts';
import type { BuiltFixture } from './fixtures.ts';
import { getFloorMatricule, getSpace, getSpaceArea, getSpaceLabel } from './floorPlan/index.ts';
import type { FloorPlan, Space, SpaceId, SpaceKind } from './floorPlan/index.ts';
import type { FloorSpaceRef } from './floorSpace.ts';
import type { PlanRect } from './planGeometry.ts';
import { getPortPartners, getPortsOf } from './ports/index.ts';
import type { Port, PortKind } from './ports/index.ts';
import { getServiceRuns, getServiceRunsReaching } from './services.ts';
import type { BuiltServiceRun } from './services.ts';
import { ROOMS, SERVICE_LAYERS } from './sourceOfTruth/plan.ts';
import type { PlanFixtureKind, PlanRoom, PlanServiceLayerKey } from './sourceOfTruth/plan.ts';
import { getWindowsOf } from './windows.ts';
import type { FloorWindow } from './windows.ts';

/**
 * Where a room's daylight comes from, or that it has none.
 *
 * Derived from the plan, the ports and the windows every time, and deliberately
 * not a hard-coded list of the three rooms ADR-006 names. A list would be right
 * today and silently wrong the morning a window is added to the living room,
 * which is precisely the change the open item on that room anticipates.
 *
 * - `window` — a window of the room whose other side is `openAir` or `void`;
 * - `door` — a port of the room whose partner space is `openAir`;
 * - `borrowed` — reached through a leafless `opening`, or through a window, from
 *   a space that itself has daylight;
 * - `none` — otherwise.
 *
 * **A "has a window?" test would be wrong, and the master bedroom is the proof.**
 * It has no window at all, by the owner's choice, and it is not dark: its
 * balcony door is centred on the side-A wall and is its only opening. It comes
 * out `door`. The kitchen, the control center and the utility room come out
 * `window`; the living room and both kids bedrooms come out `none`, which is
 * what ADR-006 records.
 *
 * **Finding: more spaces come out `none` than the brief's three.** The corridor,
 * both sanitairs and the stairwell have no daylight either, and so do the
 * control-center balcony and the side-B balcony slab. That is not a defect of
 * the derivation and is not patched here: the brief's row counts HABITABLE rooms
 * only, and the corridor, the sanitairs and the stairwell are not habitable. The
 * two balconies are a second finding of the same shape, and a sharper one: an
 * `openAir` space is under the sky, so "no daylight" is a poor thing to say
 * about it, but {@link DaylightSource} has no value for "it is outside" and
 * inventing one here would break the readout this type is the contract for. The
 * side-A balcony and the two voids escape it only by accident — a window of a
 * daylit room happens to name them, so they come out `borrowed`. Both findings
 * are reported rather than papered over.
 */
export type DaylightSource = 'window' | 'door' | 'borrowed' | 'none';

/** The sentence a room with no daylight carries, in the brief's words (ADR-006). */
export const NO_DAYLIGHT_NOTE = 'Electric light only (no daylight)';

/** The kinds of space that are open to the sky, and so are a source of daylight. */
const SKY_KINDS: readonly SpaceKind[] = Object.freeze(['openAir', 'void']);

/** The kind of space a door may open onto and still be daylight: a balcony. */
const DAYLIT_PARTNER_KIND: SpaceKind = 'openAir';

/** The kind of port that has no leaf, and so lets light through from next door. */
const LEAFLESS_KIND: PortKind = 'opening';

/**
 * The source-of-truth rooms by id, for the two fields the {@link Space} model
 * does not carry.
 *
 * `floorPlanData.ts` maps a `PlanRoom` to a `Space` and keeps the geometry and
 * the identity only, because that is all the 3D app consumes; `note` and `open`
 * are words for a reader and have never had a home in the model. Reading them
 * straight from the plan here is the same move `windows.ts` makes with `WINDOWS`
 * and `fixtures.ts` with `FIXTURES`, and it keeps them a single copy.
 */
const PLAN_ROOMS: ReadonlyMap<string, PlanRoom> = new Map(
  ROOMS.map((room) => [room.id, room] as const),
);

/** One passage into a room, as the panel lists it. */
export interface RoomDoor {
  /**
   * Matricule of the passage, when the model has one for it.
   *
   * **Absent for every port of this floor today, and that is a finding rather
   * than an oversight.** The drawing does number them — `F1-R11-KIT-W3-P1`, the
   * `-P<n>` tag of `scripts/source-of-truth/walls.mjs` — but that number is
   * scoped to a WALL FACE and is derived by the drawing scripts; the domain's
   * `Port` carries no matricule at all. Numbering them a second time here would
   * be a second matricule authority, which is the one thing the source of truth
   * exists to prevent, so the field is declared for the day the port model gains
   * one and left unset until then.
   */
  readonly matricule?: string;
  /** The space on the other side of the passage. */
  readonly partner: SpaceId;
  /** Name of that space, as the plan prints it; never re-spelt here. */
  readonly partnerName: string;
  /** Clear width of the passage, in metres. */
  readonly width: number;
  /** Whether the passage has a leaf (`door`) or is a wall interruption (`opening`). */
  readonly kind: PortKind;
  /** Whether the leaf slides rather than swings; `false` for a leafless opening. */
  readonly sliding: boolean;
}

/**
 * One service that reaches a room, and what it lands on there.
 *
 * Derived from the declared runs every time — never a table of which room has
 * water in it, which would be a second copy of `SERVICE_RUNS` and would be right
 * only until a branch moved. It is the {@link DaylightSource} argument again, and
 * the services are the sharper case of it: a run is a line somebody draws on a
 * drawing, and a drawing is edited far more often than a room is.
 *
 * **Reaching is an END in the room, never a crossing.** `getServiceRunsReaching`
 * asks the two declared ends and ignores the geometry, which is what this type
 * depends on: the three stacks rise through `voidWest` and `voidEast`, the
 * bath-cubicle branches cross their cubicle on the way to the sanitair, and a
 * pipe passing overhead serves nothing it passes. A test that asked "does a run's
 * box overlap this room?" would put drainage in half the floor, which is ADR-021's
 * defect wearing a different hat.
 *
 * **{@link name} is the layer's own declared name, never a label written here.**
 * `SERVICE_LAYERS` prints `Low voltage`, and the checkbox in the layer switcher
 * prints `Low voltage`, so the panel prints `Low voltage`. A second spelling of
 * the same layer is the `getSpaceLabel` rule of this module applied to a layer
 * instead of a room. The entries are in `SERVICE_LAYERS` order for the same
 * reason: that is the order the switcher lists them in, and a readout that sorts
 * its own way makes the viewer re-find each one.
 *
 * **{@link fittings} is a list and not a boolean, and that is the one real choice
 * here.** The brief's distinction is between "there is water in this room" and
 * "this basin has a tap", and a `boolean atFitting` would record the distinction
 * while throwing away the fact that makes it useful — WHICH fitting. The end
 * already carries it (`{ at: 'fitting', space, kind }`), so reporting the kinds
 * costs nothing and is not an invention: the kinds are the plan's own words, the
 * same ones {@link RoomInfo.fixtures} prints. Empty therefore means exactly "the
 * service reaches this room but stops at no named fitting in it" — a run declared
 * into the space, or a chamber standing in it — which is true of the electricity
 * and low-voltage outlets of every room and of every stack standing in a void.
 * The kinds are deduplicated keeping first declaration order, because the hot and
 * the cold branch of one basin are two runs and one basin.
 */
export interface RoomService {
  /** The layer key, as the store, the palette and the checkbox all spell it. */
  readonly layer: PlanServiceLayerKey;
  /** The layer's declared display name, e.g. `Low voltage`; never re-spelt here. */
  readonly name: string;
  /**
   * The fittings in this room a run of this layer actually terminates at, in
   * declaration order and deduplicated; empty when it only reaches the room.
   */
  readonly fittings: readonly PlanFixtureKind[];
}

/** Everything the room info panel shows about one room of one storey. */
export interface RoomInfo {
  /** The room this describes: the storey and the space. */
  readonly ref: FloorSpaceRef;
  /** `getSpaceLabel`, the one label formatter: `F2-R11/KIT · Kitchen`. */
  readonly label: string;
  /** `getFloorMatricule` on its own: `F2-R11/KIT`. */
  readonly matricule: string;
  /** Name of the room, as the plan prints it. */
  readonly name: string;
  /** What the space is, which drives its walls and its floor. */
  readonly kind: SpaceKind;
  /**
   * The clear size, rect by rect: the room's own rectangles, NOT its bounding
   * box (see the module docblock).
   */
  readonly rects: readonly PlanRect[];
  /** Clear floor area, in square metres, unrounded: the sum of the rects. */
  readonly area: number;
  /** Every port naming the room, in schedule order: the doors and the one opening. */
  readonly doors: readonly RoomDoor[];
  /** Every window looking into or out of the room, in schedule order. */
  readonly windows: readonly FloorWindow[];
  /** Every fixture standing in the room, in plan reading order. */
  readonly fixtures: readonly BuiltFixture[];
  /** Where the room's daylight comes from, derived (see {@link DaylightSource}). */
  readonly daylight: DaylightSource;
  /**
   * Which services reach the room, in `SERVICE_LAYERS` order, derived from the
   * declared runs (see {@link RoomService}).
   */
  readonly services: readonly RoomService[];
  /** What is still unsettled about the room, one sentence per entry. */
  readonly openItems: readonly string[];
}

/**
 * Returns the space on the other side of a window from one of its two spaces.
 *
 * @param window - The window.
 * @param id - Identifier of the space the window is looked at from; it must be
 *   one of the window's two.
 * @returns Whichever of the window's two ids is not `id`.
 */
function windowPartner(window: FloorWindow, id: SpaceId): SpaceId {
  return window.spaceId === id ? window.neighbourId : window.spaceId;
}

/**
 * Returns the space on the other side of a port from one of its two spaces.
 *
 * @param port - The port.
 * @param id - Identifier of the space the port is looked at from; it must be one
 *   of the port's two.
 * @returns Whichever of the port's two ids is not `id`.
 */
function portPartner(port: Port, id: SpaceId): SpaceId {
  const [first, second] = port.spaces;
  return first === id ? second : first;
}

/**
 * Returns the daylight a space has in its own right, before any is borrowed.
 *
 * The first two rules of {@link DaylightSource}, in that order: a window onto
 * the sky beats a door onto a balcony, because the panel should say the room is
 * glazed when it is.
 *
 * @param plan - The floor plan holding the space and its neighbours.
 * @param ports - The port schedule of the floor.
 * @param windows - The windows of the floor.
 * @param id - Identifier of the space.
 * @returns `'window'`, `'door'`, or `'none'`; never `'borrowed'`.
 * @throws RangeError naming the id when the plan has no such space.
 */
function getDirectDaylight(
  plan: FloorPlan,
  ports: readonly Port[],
  windows: readonly FloorWindow[],
  id: SpaceId,
): DaylightSource {
  const glazed = getWindowsOf(windows, id).some((window) =>
    SKY_KINDS.includes(getSpace(plan, windowPartner(window, id)).kind),
  );
  if (glazed) {
    return 'window';
  }
  const opened = getPortPartners(ports, id).some(
    (partner) => getSpace(plan, partner).kind === DAYLIT_PARTNER_KIND,
  );
  return opened ? 'door' : 'none';
}

/**
 * Lists the spaces a space could borrow daylight from: those it is joined to by
 * something light passes through.
 *
 * A leafless `opening` — the single 3.50 m living-room one on this floor — and a
 * window both let light through. A door does not, whether it swings or slides,
 * which is why the guest sanitair stays dark behind its three sliding leaves and
 * why the control-center balcony gets nothing from the room it serves.
 *
 * @param ports - The port schedule of the floor.
 * @param windows - The windows of the floor.
 * @param id - Identifier of the space.
 * @returns The ids on the other side of each such join, possibly repeated.
 */
function getLenders(
  ports: readonly Port[],
  windows: readonly FloorWindow[],
  id: SpaceId,
): readonly SpaceId[] {
  return [
    ...getPortsOf(ports, id)
      .filter((port) => port.kind === LEAFLESS_KIND)
      .map((port) => portPartner(port, id)),
    ...getWindowsOf(windows, id).map((window) => windowPartner(window, id)),
  ];
}

/**
 * Derives the daylight of every space of the floor at once.
 *
 * Borrowing is a property of the whole floor and not of one room, so it is
 * settled as a fixed point rather than by looking one step sideways: a space
 * with no daylight of its own takes `'borrowed'` as soon as anything it is
 * joined to has daylight, and the pass is repeated until nothing changes. On
 * this plan it converges after a single pass; written as a loop it stays correct
 * if a chain ever forms, and the order the spaces are visited in cannot change
 * the answer because the pass only ever adds.
 *
 * @param plan - The floor plan. Not mutated.
 * @param ports - The port schedule of the floor. Not mutated.
 * @param windows - The windows of the floor. Not mutated.
 * @returns One entry per space of the plan.
 * @throws RangeError naming the id when a port or a window names a space the
 *   plan does not hold.
 */
function getDaylightOfFloor(
  plan: FloorPlan,
  ports: readonly Port[],
  windows: readonly FloorWindow[],
): ReadonlyMap<SpaceId, DaylightSource> {
  const daylight = new Map<SpaceId, DaylightSource>(
    plan.spaces.map((space) => [space.id, getDirectDaylight(plan, ports, windows, space.id)]),
  );
  let spreading = true;
  while (spreading) {
    spreading = false;
    plan.spaces.forEach((space) => {
      if (daylight.get(space.id) !== 'none') {
        return;
      }
      const lit = getLenders(ports, windows, space.id).some(
        (lender) => (daylight.get(lender) ?? 'none') !== 'none',
      );
      if (lit) {
        daylight.set(space.id, 'borrowed');
        spreading = true;
      }
    });
  }
  return daylight;
}

/**
 * Describes one port as the panel lists it.
 *
 * @param plan - The floor plan holding both spaces.
 * @param port - The port to describe.
 * @param id - Identifier of the room the port is listed under.
 * @returns A frozen {@link RoomDoor}.
 * @throws RangeError naming the id when the plan has no space on the other side.
 */
function makeRoomDoor(plan: FloorPlan, port: Port, id: SpaceId): RoomDoor {
  const partner = portPartner(port, id);
  return Object.freeze({
    partner,
    partnerName: getSpace(plan, partner).name,
    width: port.width,
    kind: port.kind,
    sliding: port.swing === 'slide',
  });
}

/**
 * Assembles what is still unsettled about a room.
 *
 * Assembled, never transcribed: no sentence is written here, and nothing that is
 * already stated as geometry is repeated. Four sources, in this order —
 *
 * 1. the room's `note`, what the owner wanted from it when the rects do not say;
 * 2. its `open` entries, his unresolved items in his own words;
 * 3. {@link NO_DAYLIGHT_NOTE}, when the derivation says the room has none — the
 *    one sentence this module contributes, and it is contributed from the
 *    derived answer rather than from a list of rooms;
 * 4. the `why` of each of its ports that carries one, in schedule order.
 *
 * Deduplicated keeping the first occurrence, because the three rooms ADR-006
 * names already carry their own sentence about having no daylight, and two of
 * the floor's ports are explained by the same room from both sides.
 *
 * @param space - The room.
 * @param ports - The ports naming it, in schedule order.
 * @param daylight - Where its daylight comes from.
 * @returns A frozen array of sentences, possibly empty.
 */
function getOpenItems(
  space: Space,
  ports: readonly Port[],
  daylight: DaylightSource,
): readonly string[] {
  const room = PLAN_ROOMS.get(space.id);
  const items: readonly string[] = [
    ...(room?.note === undefined ? [] : [room.note]),
    ...(room?.open ?? []),
    ...(daylight === 'none' ? [NO_DAYLIGHT_NOTE] : []),
    ...ports.flatMap((port) => (port.why === undefined ? [] : [port.why])),
  ];
  return Object.freeze([...new Set(items)]);
}

/**
 * Lists the fittings of one room that a run actually terminates at.
 *
 * Both ends are asked, because a run is written in the direction the service
 * flows and a room may be either end of one: the kitchen sink is the `from` of
 * its waste branch and the `to` of its cold branch.
 *
 * @param run - One built run.
 * @param id - Identifier of the room being described.
 * @returns The fitting kinds the run lands on in that room; empty when it ends
 *   there without naming one, and empty when it does not end there at all.
 */
function getServedFittings(run: BuiltServiceRun, id: SpaceId): readonly PlanFixtureKind[] {
  return [run.run.from, run.run.to].flatMap((end) =>
    end.at === 'fitting' && end.space === id ? [end.kind] : [],
  );
}

/**
 * Derives which services reach one room, layer by layer.
 *
 * One entry per layer that has at least one run ending in the room, in
 * `SERVICE_LAYERS` order; a layer nothing reaches is absent rather than present
 * and empty, so the panel prints the services a room has and not a nine-row
 * table of mostly noes.
 *
 * @param runs - The runs of the floor, as `getServiceRuns` built them.
 * @param id - Identifier of the room.
 * @returns A frozen array of frozen {@link RoomService}s, possibly empty.
 * @throws RangeError when a run ends at a chamber the plan does not declare.
 */
function getRoomServices(runs: readonly BuiltServiceRun[], id: SpaceId): readonly RoomService[] {
  const reaching = getServiceRunsReaching(runs, id);
  return Object.freeze(
    SERVICE_LAYERS.flatMap<RoomService>((layer) => {
      const ofLayer = reaching.filter((run) => run.layer === layer.key);
      if (ofLayer.length === 0) {
        return [];
      }
      const fittings = ofLayer.flatMap((run) => getServedFittings(run, id));
      return [
        Object.freeze({
          layer: layer.key,
          name: layer.name,
          fittings: Object.freeze([...new Set(fittings)]),
        }),
      ];
    }),
  );
}

/**
 * Gathers everything the room info panel shows about one room of one storey.
 *
 * Every field is taken from the module that owns it — the label and the area
 * from the plan queries, the ports from the port schedule, the windows and the
 * fixtures from the built floor, the services from the declared runs — so the
 * panel that draws this derives nothing and cannot disagree with the floor it is
 * drawn over.
 *
 * @param plan - The floor plan to read. Not mutated.
 * @param ports - The port schedule of that plan. Not mutated.
 * @param built - The built floor, for its windows and its fixtures. Not mutated.
 * @param ref - The room: which storey, and which space of the typical floor.
 * @param runs - The built service runs of the floor; defaults to the declared
 *   ones. A parameter rather than a member of `built`, because a run is not a
 *   solid of the storey and `BuiltFloor` does not carry one; a default rather
 *   than a required argument, so no existing caller has to hand the panel a
 *   second model of the same floor. Not mutated.
 * @returns A frozen {@link RoomInfo} with frozen arrays.
 * @throws RangeError naming the id when the plan has no such space, naming the
 *   floor when it is not an integer of at least `MIN_FLOOR_COUNT` — which
 *   rejects floor 0, a negative storey and 1.5 alike (`floorPlan/queries.ts`) —
 *   or naming a chamber a run ends at that the plan does not declare.
 */
export function getRoomInfo(
  plan: FloorPlan,
  ports: readonly Port[],
  built: BuiltFloor,
  ref: FloorSpaceRef,
  runs: readonly BuiltServiceRun[] = getServiceRuns(),
): RoomInfo {
  const space = getSpace(plan, ref.spaceId);
  const roomPorts = getPortsOf(ports, space.id);
  const daylight = getDaylightOfFloor(plan, ports, built.windows).get(space.id) ?? 'none';
  return Object.freeze({
    ref: Object.freeze({ floor: ref.floor, spaceId: space.id }),
    label: getSpaceLabel(space, ref.floor),
    matricule: getFloorMatricule(space.matricule, ref.floor),
    name: space.name,
    kind: space.kind,
    rects: Object.freeze([...space.rects]),
    area: getSpaceArea(space),
    doors: Object.freeze(roomPorts.map((port) => makeRoomDoor(plan, port, space.id))),
    windows: getWindowsOf(built.windows, space.id),
    fixtures: getFixturesOf(built.fixtures, space.id),
    daylight,
    services: getRoomServices(runs, space.id),
    openItems: getOpenItems(space, roomPorts, daylight),
  });
}
