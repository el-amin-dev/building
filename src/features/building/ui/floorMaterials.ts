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
 */

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

/*
 * The service layers, and the one place in this file where the scheme does not apply.
 *
 * ADR-020 made the decorative scheme the palette: every finished surface is carpet, oak,
 * bouclé or marble. Inside a service layer that rule is inverted, and deliberately so. A
 * services view exists to answer a question the scheme cannot: a plumber's first question
 * about a pipe is which of two identical pipes it is, and no amount of marble answers it.
 * So the ten keys below are read by HUE and never by texture — they carry no `map`, they
 * have no entry in `FAMILY_TEXTURE` (`FloorModel.tsx`), and they are flat colour by design.
 * That absence is not an oversight to be tidied up later: texturing these buckets, or
 * pulling them back towards the four scheme materials, would destroy the only thing the
 * services view is for.
 *
 * The hues follow real service-colour convention wherever one exists, because a convention
 * is a legend the viewer already knows, and are otherwise chosen to be separable at a glance.
 */

/** Waste and soil: conventionally the dark, unglamorous one, and the darkest service here. */
const SERVICE_DRAINAGE_GREY = '#5a6470';
/** Cold supply: the blue half of a plumber's first question about any pipe. */
const SERVICE_WATER_COLD_BLUE = '#2f6fd0';
/** Hot supply: the red half of that same question, so the pair is told apart by hue alone. */
const SERVICE_WATER_HOT_RED = '#c0392b';
/** Gas: the one service with a near-universal colour, so it is not ours to choose. */
const SERVICE_GAS_YELLOW = '#f2c31d';
/**
 * Power and lighting, which share one hue on purpose.
 *
 * A run's circuit family — 2.5 mm² sockets against 1.5 mm² lighting — is data the run
 * carries, not something the eye should have to decode from two oranges a shade apart.
 */
const SERVICE_ELECTRICITY_ORANGE = '#ff7a1a';
/** Ethernet and the rest of the low-voltage side, kept far from the power orange. */
const SERVICE_LOW_VOLTAGE_VIOLET = '#8e44ad';
/** The cooling runs: cyan reads cold at a glance, and nothing else here is near it. */
const SERVICE_CLIMATE_COOL_CYAN = '#17b8c4';
/**
 * The heating circuit, and the one hue here that is separable rather than conventional.
 *
 * Every conventionally warm colour was already spoken for — yellow by gas, orange by
 * electricity, red by hot water — so a fourth warm hue would have been the conventional
 * answer and an unreadable one. In a view whose whole purpose is telling services apart at
 * a glance, being separable beat being conventional, which is why heating is pink.
 */
const SERVICE_CLIMATE_HEAT_PINK = '#d94f8a';
/** The boxing built over a run: a light grey that stays behind whatever it covers. */
const SERVICE_COVER_LIGHT_GREY = '#cfd3d8';
/** The two sealed control-center chambers and their vent ducts, a step down from the boxing. */
const SERVICE_CHAMBER_GREY = '#8d9299';

/*
 * The building's plain finish, and the one key that is not a surface family at all.
 *
 * `finishing` is a checkbox, not a set of boxes: with it off the SAME geometry is drawn
 * in the plain finish the building would be handed over in, and no box is added or
 * removed (`SERVICE_LAYERS`, `finishing`). That is only true if the unfinished state is
 * one material every finish-bearing family can be re-surfaced with, so there is exactly
 * one of them rather than a second, unfinished palette.
 *
 * Raw sand-cement screed and bare plaster are the same thing to look at: a matte,
 * slightly warm grey with nothing on it. Drawn with no `map` on purpose — a screed has
 * no grain, and lending it the oak's would be a finish by another name.
 */

/** Bare screed and unpainted plaster: what the building looks like before it is finished. */
const PLAIN_SCREED_GREY = '#bdb9b3';

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
  | 'artwork'
  // The building's own fabric that happens to be built as a fitting (Part 5).
  | 'fabricJoinery'
  // The unfinished surface the `finishing` checkbox re-surfaces a finish-bearing family
  // with. A material, not a group of solids: its bucket is always empty.
  | 'plainSurface'
  // The service layers (Part 5). Read by hue, never by texture — see the constants above.
  | 'serviceDrainage'
  | 'serviceWaterCold'
  | 'serviceWaterHot'
  | 'serviceGas'
  | 'serviceElectricity'
  | 'serviceLowVoltage'
  | 'serviceClimateCool'
  | 'serviceClimateHeat'
  | 'serviceCover'
  | 'serviceChamber';

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
 *   room are gone, along with the per-space override that chose between them;
 * - `fabricJoinery`: the parts of a fitting that are the BUILDING rather than its
 *   contents — the food-pass counter, which is half a wall with a hole in it. Visually
 *   identical to `joinery` and a separate bucket for exactly one reason: the `furniture`
 *   checkbox hides the joinery to clear a room, and hiding the pass counter would not
 *   clear a room, it would open a 0.30 m slot from the guest room into the kitchen
 *   (`FABRIC_FIXTURE_KINDS`, `floorLayout.ts`);
 * - `plainSurface`: not a family of solids but the state the `finishing` checkbox puts
 *   the finish-bearing families INTO. Its bucket is always empty, and that is correct:
 *   unticking `finishing` adds and removes no box, it only re-surfaces the ones already
 *   drawn (`FloorModel.tsx`, `BUCKET_RULES`);
 * - `serviceDrainage` … `serviceChamber`: the ten service layers of Part 5 — the runs
 *   themselves, the boxing built over them and the sealed chambers. These are the one group
 *   the scheme does not reach: flat, separable hues with no texture, for the reason set out
 *   beside their colour constants above.
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
    fabricJoinery: makeSpec({
      // The same oak as `joinery`, by construction rather than by a copied hex: it IS
      // the same oak, and the two must never drift apart, because a viewer is meant to
      // see one pass counter and not an oak carcass with a slightly different lid.
      color: PARIS_OAK,
      // Matte, like the millwork it is made of and unlike the treads that are walked on.
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      // A hair off `joinery`'s dithering would be a difference nobody asked for, so the
      // spec is the same one twice over; only the BUCKET differs, and that is the point.
      dithering: DITHER_SMALL_ELEMENT,
    }),
    plainSurface: makeSpec({
      color: PLAIN_SCREED_GREY,
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      // Re-surfaces slabs as well as furniture, so it takes the large-surface dithering:
      // a whole floor of flat grey is exactly the wide, shallow gradient that bands.
      dithering: DITHER_LARGE_SURFACE,
    }),
    // The service layers. Flat colour throughout: no `map` is ever looked up for these keys,
    // because what a run IS has to be legible before what it is made of is.
    serviceDrainage: makeSpec({
      color: SERVICE_DRAINAGE_GREY,
      // Plastic waste pipe: sealed, but not a polished surface.
      roughness: SATIN_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceWaterCold: makeSpec({
      color: SERVICE_WATER_COLD_BLUE,
      roughness: SATIN_ROUGHNESS,
      metalness: FAINTLY_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceWaterHot: makeSpec({
      color: SERVICE_WATER_HOT_RED,
      roughness: SATIN_ROUGHNESS,
      metalness: FAINTLY_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceGas: makeSpec({
      color: SERVICE_GAS_YELLOW,
      roughness: SATIN_ROUGHNESS,
      metalness: FAINTLY_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceElectricity: makeSpec({
      color: SERVICE_ELECTRICITY_ORANGE,
      // Plastic conduit and trunking: the cable inside is never the surface seen.
      roughness: SATIN_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceLowVoltage: makeSpec({
      color: SERVICE_LOW_VOLTAGE_VIOLET,
      roughness: SATIN_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceClimateCool: makeSpec({
      color: SERVICE_CLIMATE_COOL_CYAN,
      roughness: SATIN_ROUGHNESS,
      metalness: FAINTLY_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceClimateHeat: makeSpec({
      color: SERVICE_CLIMATE_HEAT_PINK,
      roughness: SATIN_ROUGHNESS,
      metalness: FAINTLY_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceCover: makeSpec({
      color: SERVICE_COVER_LIGHT_GREY,
      // Painted boxing, so it is the one matte thing among the runs it hides.
      roughness: MATTE_ROUGHNESS,
      metalness: NON_METAL,
      dithering: DITHER_SMALL_ELEMENT,
    }),
    serviceChamber: makeSpec({
      color: SERVICE_CHAMBER_GREY,
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
