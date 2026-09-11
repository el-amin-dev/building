/**
 * Named material palette of the built floor.
 *
 * Every surface kind of the floor (walls, parapets, the slabs of each space kind, the
 * ceilings and their light panels, the railings, the stairs, the television panel) has one
 * entry here, so a mesh never carries its own inline colour and a Leva control can later
 * override a whole family of surfaces by name.
 *
 * The palette is deliberately low-contrast indoors: the interior surfaces are warm
 * off-whites and light beiges of close value, so the many rooms read as one building
 * instead of a patchwork. Elements that must be told apart from the surface behind them —
 * a parapet against a wall, a railing against the stairs, the television against a wall —
 * step away in value or in metalness rather than in hue.
 *
 * Pure data, independent of three.js: the specs map straight onto
 * `meshStandardMaterial` props.
 */
import type { SpaceKind } from '../domain/floorPlan/index.ts';

/** Warm off-white plaster of the interior walls: the base tone of the whole floor. */
const PLASTER_WHITE = '#e9e4db';
/** Plaster shaded one step down, so a parapet reads as an element and not as a wall. */
const PARAPET_GREY = '#d3ccbf';
/** Warm beige screed of the rooms, as in the interim chamber's floor. */
const SCREED_BEIGE = '#d6c7ae';
/** Slightly cooler, darker screed marking the circulation spaces (stairs, corridors). */
const CIRCULATION_BEIGE = '#c2b49b';
/** Grey outdoor tile of the balconies, clearly not an indoor floor. */
const TERRACE_GREY = '#9fa8a8';
/** Near-white ceiling, the lightest surface indoors, so rooms feel open. */
const CEILING_WHITE = '#f4f6f7';
/** Warm white of the ceiling light panel's own surface. */
const LIGHT_PANEL_WHITE = '#fff8e8';
/** Colour the light panel emits: a warm, domestic white. */
const LIGHT_PANEL_EMISSIVE = '#ffefc6';
/** Brushed metal of the railings and balustrades. */
const RAILING_STEEL = '#7f8a93';
/** Timber-toned stair flight, distinct from both the walls and the screed. */
const STAIRS_TIMBER = '#a98f6f';
/** Switched-off television: the darkest surface on the floor. */
const TV_PANEL_BLACK = '#16191c';

/** Fully diffuse finish: plaster and raw screed scatter all the light they receive. */
const MATTE_ROUGHNESS = 0.9;
/** Slightly sealed finish: a painted ceiling, a floor tile. */
const SATIN_ROUGHNESS = 0.75;
/** Varnished timber: a soft, wide highlight. */
const VARNISH_ROUGHNESS = 0.55;
/** Diffusing panel of a luminaire: barely glossy, since it emits rather than reflects. */
const PANEL_ROUGHNESS = 0.4;
/** Brushed metal: a tight highlight. */
const BRUSHED_ROUGHNESS = 0.35;
/** Glass screen: the sharpest highlight on the floor. */
const SCREEN_ROUGHNESS = 0.2;

/** Dielectric surfaces (plaster, screed, timber, glass) reflect no metallically. */
const NON_METAL = 0;
/** A screen's frame and coating read as faintly metallic. */
const FAINTLY_METAL = 0.2;
/** Brushed steel, still rough enough to stay readable without an environment map. */
const BRUSHED_METAL = 0.6;

/** Brightness of the ceiling panel's emission: lit enough to read as the room's light. */
const LIGHT_PANEL_EMISSIVE_INTENSITY = 1.4;

/** Large surfaces are dithered: their wide, shallow gradients would otherwise band. */
const DITHER_LARGE_SURFACE = true;
/** Small elements need no dithering; their gradients are too short to band. */
const DITHER_SMALL_ELEMENT = false;

/** Name of a surface family of the built floor. */
export type FloorMaterialKey =
  | 'wall'
  | 'parapet'
  | 'slabRoom'
  | 'slabCirculation'
  | 'slabOpenAir'
  | 'ceiling'
  | 'lightPanel'
  | 'railing'
  | 'stairs'
  | 'tvPanel';

/** The `meshStandardMaterial` settings of one surface family. */
export interface FloorMaterialSpec {
  /** Base colour, as a `#rrggbb` hexadecimal string. */
  readonly color: string;
  /** Microscopic roughness, 0 (mirror) to 1 (fully diffuse). */
  readonly roughness: number;
  /** How metallic the surface is, 0 (dielectric) to 1 (bare metal). */
  readonly metalness: number;
  /** Colour the surface emits, for the light panels only; omitted elsewhere. */
  readonly emissive?: string;
  /** Strength of {@link FloorMaterialSpec.emissive}; only set alongside it. */
  readonly emissiveIntensity?: number;
  /** Whether the renderer dithers the shading, to keep wide gradients from banding. */
  readonly dithering: boolean;
}

/**
 * Builds a frozen material spec.
 *
 * @param spec - The settings of the surface family.
 * @returns The same spec, frozen.
 */
function makeSpec(spec: FloorMaterialSpec): FloorMaterialSpec {
  return Object.freeze(spec);
}

/**
 * The material of every surface family of the floor, frozen down to each spec.
 *
 * - `wall`: the interior and exterior walls, the largest surface of the floor;
 * - `parapet`: the low walls edging the balconies and the stair void, a shade darker so
 *   they read as elements standing on the slab;
 * - `slabRoom`, `slabCirculation`, `slabOpenAir`: the floor slabs, one per walkable space
 *   kind, so a corridor and a balcony are told apart underfoot (a `void` space has none);
 * - `ceiling`: the underside of the slab above, hidden in the exterior view;
 * - `lightPanel`: the emissive panel that lights each room — the room's light is this
 *   surface, not a point light, so it must glow on its own;
 * - `railing`: the metal balustrades, metallic against the matte surfaces around them;
 * - `stairs`: the flight and its steps, a timber tone distinct from walls and screed;
 * - `tvPanel`: the television screen in the living room, the one dark surface.
 */
export const MATERIAL_PALETTE: Readonly<Record<FloorMaterialKey, FloorMaterialSpec>> =
  Object.freeze({
    wall: makeSpec({
      color: PLASTER_WHITE,
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_LARGE_SURFACE,
    }),
    parapet: makeSpec({
      color: PARAPET_GREY,
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_LARGE_SURFACE,
    }),
    slabRoom: makeSpec({
      color: SCREED_BEIGE,
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_LARGE_SURFACE,
    }),
    slabCirculation: makeSpec({
      color: CIRCULATION_BEIGE,
      roughness: SATIN_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_LARGE_SURFACE,
    }),
    slabOpenAir: makeSpec({
      color: TERRACE_GREY,
      roughness: SATIN_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_LARGE_SURFACE,
    }),
    ceiling: makeSpec({
      color: CEILING_WHITE,
      roughness: SATIN_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_LARGE_SURFACE,
    }),
    lightPanel: makeSpec({
      color: LIGHT_PANEL_WHITE,
      roughness: PANEL_ROUGHNESS,
      metalness: NON_METAL,
      emissive: LIGHT_PANEL_EMISSIVE,
      emissiveIntensity: LIGHT_PANEL_EMISSIVE_INTENSITY,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    railing: makeSpec({
      color: RAILING_STEEL,
      roughness: BRUSHED_ROUGHNESS,
      metalness: BRUSHED_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    stairs: makeSpec({
      color: STAIRS_TIMBER,
      roughness: VARNISH_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    tvPanel: makeSpec({
      color: TV_PANEL_BLACK,
      roughness: SCREEN_ROUGHNESS,
      metalness: FAINTLY_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
  });

/**
 * Returns the material of the floor slab of a space.
 *
 * @param kind - Kind of the space whose slab is drawn.
 * @returns The palette key of that slab: `slabRoom`, `slabCirculation` or `slabOpenAir`.
 * @throws RangeError for a `void` space, which has no floor at all (see `hasFloor` in
 *   `floorPlan/queries.ts`): asking for its slab material is a caller bug.
 */
export function getSlabMaterialKey(kind: SpaceKind): FloorMaterialKey {
  switch (kind) {
    case 'room':
      return 'slabRoom';
    case 'circulation':
      return 'slabCirculation';
    case 'openAir':
      return 'slabOpenAir';
    case 'void':
      throw new RangeError('A void space has no floor slab, so it has no slab material');
  }
}
