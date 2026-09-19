/**
 * Named material palette of the built floor.
 *
 * Every surface kind of the floor (walls, parapets, the slabs of each space kind, the
 * ceilings and their light panels, the railings, the stairs, the television panel, the
 * sanitary ware, and since Part 4 the furniture: white goods, joinery, worktops and soft
 * furnishings) has one entry here, so a mesh never carries its own inline colour and a
 * Leva control can later override a whole family of surfaces by name.
 *
 * Since the scheme went whole-building (ADR-020) this palette IS the scheme: flat matte
 * white walls, natural unvarnished light oak millwork, bouclé on the soft furnishings and
 * white-veined marble on every working surface. There is no second set of keys for a
 * decorated room and no per-space override, because every room is decorated — a `joinery`
 * box is oak wherever it stands, and that is the whole of the rule.
 *
 * The palette is deliberately low-contrast indoors: the interior surfaces are off-whites,
 * creams and pale oak of close value, so the many rooms read as one building instead of a
 * patchwork. Elements that must be told apart from the surface behind them — a parapet
 * against a wall, a railing against the stairs, the television against a wall — step away
 * in value rather than in hue, which is why the railings and the balustrades are the one
 * black in the building and the marble is the one thing with a sheen.
 *
 * Pure data, independent of three.js: the specs map straight onto
 * `meshStandardMaterial` props.
 */
import type { SpaceKind } from '../domain/floorPlan/index.ts';

/**
 * Flat matte white of the interior walls: the envelope the whole scheme is set against.
 *
 * Barely warm and barely off — it has to read as white beside the marble, which is cooler
 * and lighter than it, and beside the bouclé, which is warmer and darker. A true `#ffffff`
 * was tried and is wrong: nothing else in the building can then be lighter than a wall, so
 * the marble loses its sheen and the ceiling loses its lift.
 */
const PLASTER_WHITE = '#f2f1ee';
/** The wall white shaded one step down, so a parapet reads as an element and not as a wall. */
const PARAPET_GREY = '#ddd9d2';
/** Grey outdoor tile of the balconies, clearly not an indoor floor. */
const TERRACE_GREY = '#9fa8a8';
/** Near-white ceiling, the lightest surface indoors, so rooms feel open. */
const CEILING_WHITE = '#f4f6f7';
/** Warm white of the ceiling light panel's own surface. */
const LIGHT_PANEL_WHITE = '#fff8e8';
/** Colour the light panel emits: a warm, domestic white. */
const LIGHT_PANEL_EMISSIVE = '#ffefc6';
/**
 * Matte black of the railings and the balustrades.
 *
 * The brief's own note — spidery, matte-black, minimalist — and the only black in the
 * building besides the switched-off television. It is what lets a balustrade read as a line
 * drawn across a pale room rather than as another grey element among grey elements.
 */
const RAILING_BLACK = '#1e2022';
/** Switched-off television: the darkest surface on the floor. */
const TV_PANEL_BLACK = '#16191c';
/** Glazed white ceramic of a basin, a bath and a shower tray. */
const SANITARY_WHITE = '#f0f3f4';
/**
 * Enamelled white of the goods that are delivered rather than built: a fridge, a cooker
 * body, a washing machine. Close to the sanitary glaze in hue and a step down in value, so
 * a kitchen reads as fitted rather than as a row of bathroom fittings.
 */
const APPLIANCE_ENAMEL = '#dfe3e2';
/*
 * The scheme, which the owner asked to see tried in the living room and then, having seen
 * it, asked for over the whole floor: warm minimalism, flat matte surfaces, natural
 * unvarnished oak millwork, bouclé upholstery against cool white-veined marble, and a canvas
 * carrying the only saturated colour in a room.
 *
 * These four are not a separate family from the ones above any more — they ARE the ones
 * above, for the families the scheme speaks to. `joinery` is oak, `worktop` is marble,
 * `softFurnishing` is bouclé, and a room's own floor is carpet or marble depending on
 * whether anything in it is plumbed or powered (`floorLayout.ts`). The per-space override
 * that made this true of the living room alone is deleted rather than widened: an override
 * every space takes is not an override.
 *
 * They are exported for `textures.ts`, which draws each family's pattern and then divides
 * that pattern by the colour it was drawn over, so the map it hands back is a neutral
 * modulation of exactly these values rather than a second, slightly different opinion about
 * what oak looks like. A colour of a scheme belongs in the palette; the weave of it belongs
 * in the generator; neither may hold a copy of the other.

/** Flat-weave carpet: a warm greige that reads as textile rather than as screed. */
export const PARIS_CARPET = '#cfc7ba';
/** Natural, unvarnished light oak — the millwork tone the whole scheme is hung on. */
export const PARIS_OAK = '#ddc9a8';
/** Bouclé: cream wool, close in value to the walls so the seating reads as mass, not as object. */
export const PARIS_BOUCLE = '#e6dfd3';
/** White marble with cool veining: the one cold surface, and the one with a sheen. */
export const PARIS_MARBLE = '#f2f3f4';

/*
 * The two floor weights of the scheme.
 *
 * A floor is the same material as the millwork above it and never the same value, for a
 * reason that is about seeing rather than about taste: a stair tread cut from the landing it
 * lands on has no edge, and a white basin on a white marble floor has no outline. Real floors
 * happen to be darker than the furniture standing on them anyway — they are laid thicker,
 * walked on and finished harder — so the physical answer and the legible one agree here.
 *
 * They are not exported: `textures.ts` draws one oak and one marble, and because a generated
 * texture is DIVIDED by the colour it was drawn over it is a neutral modulation that lands
 * correctly on any value of its family. One grain serves both oaks, which is the whole point
 * of neutralising it.
 */

/** Oak boards underfoot: the millwork oak laid thicker and walked on. */
const PARIS_OAK_FLOOR = '#d2ba95';
/** Marble underfoot: greyer and heavier than a worktop slab, so white ware reads against it. */
const PARIS_MARBLE_FLOOR = '#e4e7e9';
/** The canvas: a muted, low-saturation pastel, which is as much colour as the room takes. */
const ARTWORK_PASTEL = '#c2b2a4';

/** Fully diffuse finish: plaster and raw screed scatter all the light they receive. */
const MATTE_ROUGHNESS = 0.9;
/** Slightly sealed finish: a painted ceiling, a floor tile. */
const SATIN_ROUGHNESS = 0.75;
/** Varnished timber: a soft, wide highlight. */
const VARNISH_ROUGHNESS = 0.55;
/** Diffusing panel of a luminaire: barely glossy, since it emits rather than reflects. */
const PANEL_ROUGHNESS = 0.4;
/** Fired ceramic glaze: wetter-looking than paint, short of a mirror. */
const GLAZE_ROUGHNESS = 0.25;
/** Glass screen: the sharpest highlight on the floor. */
const SCREEN_ROUGHNESS = 0.2;

/** Dielectric surfaces (plaster, screed, timber, glass) reflect no metallically. */
const NON_METAL = 0;
/** A screen's frame and coating read as faintly metallic. */
const FAINTLY_METAL = 0.2;

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
  | 'slabServiced'
  | 'ceiling'
  | 'lightPanel'
  | 'railing'
  | 'stairs'
  | 'tvPanel'
  | 'sanitaryWare'
  | 'appliance'
  | 'joinery'
  | 'worktop'
  | 'softFurnishing'
  | 'artwork';

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
 * - `parapet`: the low walls edging the two balcony slabs, a shade darker so they read as
 *   elements standing on the slab. Side B is a full-height exterior wall like every other
 *   side, so no parapet runs along it;
 * - `slabRoom`, `slabCirculation`, `slabOpenAir`: the floor slabs, one per walkable space
 *   kind, so a corridor and a balcony are told apart underfoot (a `void` space has none).
 *   A room is carpeted and the circulation is boarded in the same oak as the millwork,
 *   which keeps the corridor reading as circulation underfoot the way the old two screeds
 *   did, in the scheme's own materials rather than in two shades of beige;
 * - `slabServiced`: the marble floor of a room that is plumbed, powered or holds a riser —
 *   the two bathrooms, the three cubicles, the kitchen, the laundry and the control center.
 *   None of that is a space *kind*: every one of them is an ordinary `room`, so
 *   `getSlabMaterialKey` cannot pick them out and `floorLayout.ts` asks the fixtures
 *   instead (`isServicedSpace`). It is the broader question the old `slabWet` asked, and it
 *   is broader for a reason a wet room could not answer: a kitchen has no basin on this
 *   floor, and a kitchen may not be carpeted;
 * - `ceiling`: the underside of the slab above, hidden in the exterior view;
 * - `lightPanel`: the emissive panel that lights each room — the room's light is this
 *   surface, not a point light, so it must glow on its own;
 * - `railing`: the balustrades, matte black and the only black besides the television, so a
 *   line of balustrade reads as drawn across a pale room rather than as one more grey thing;
 * - `stairs`: the flight and its steps, the same oak as the millwork and a step more sealed,
 *   because a tread is walked on and a wardrobe door is not;
 * - `tvPanel`: the television screen in the living room, the one dark surface;
 * - `sanitaryWare`: the basins, baths and shower trays standing in the bathrooms — glazed,
 *   so they separate from the marble floor they stand on by their sheen rather than by hue;
 * - `appliance`, `joinery`, `worktop`, `softFurnishing`, `artwork`: the furniture, by the
 *   family the domain names (`fixtures.ts`). Since ADR-020 three of them carry the scheme
 *   everywhere — oak, marble, bouclé — and the `paris*` keys that used to carry it for one
 *   room are gone, along with the per-space override that chose between them.
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
      color: PARIS_CARPET,
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_LARGE_SURFACE,
    }),
    slabCirculation: makeSpec({
      color: PARIS_OAK_FLOOR,
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
    slabServiced: makeSpec({
      color: PARIS_MARBLE_FLOOR,
      roughness: GLAZE_ROUGHNESS,
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
      color: RAILING_BLACK,
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    stairs: makeSpec({
      color: PARIS_OAK,
      // A step more sealed than the joinery: a tread is walked on, a wardrobe door is not.
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
    sanitaryWare: makeSpec({
      color: SANITARY_WHITE,
      roughness: GLAZE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    appliance: makeSpec({
      color: APPLIANCE_ENAMEL,
      roughness: SATIN_ROUGHNESS,
      metalness: FAINTLY_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    joinery: makeSpec({
      color: PARIS_OAK,
      // Unvarnished, so it scatters: the difference between this and the treads above is as
      // much the roughness as anything, since the hue is now deliberately the same.
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    worktop: makeSpec({
      color: PARIS_MARBLE,
      // Polished stone: the one highlight in a room, and what the bouclé is set against.
      roughness: GLAZE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    softFurnishing: makeSpec({
      color: PARIS_BOUCLE,
      // Wool loops scatter almost everything they receive; the softest surface here.
      roughness: 0.98,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    artwork: makeSpec({
      color: ARTWORK_PASTEL,
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
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
