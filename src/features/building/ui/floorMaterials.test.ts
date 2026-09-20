import { describe, expect, it } from 'vitest';
import { SPACE_KINDS } from '../domain/floorPlan/index.ts';
import type { SpaceKind } from '../domain/floorPlan/index.ts';
import { getSlabMaterialKey, MATERIAL_PALETTE } from './floorMaterials.ts';
import type { FloorMaterialKey, FloorMaterialSpec } from './floorMaterials.ts';

/** Every key the palette must define, in the order they are declared. */
const EXPECTED_KEYS: readonly FloorMaterialKey[] = [
  'wall',
  'parapet',
  'slabRoom',
  'slabCirculation',
  'slabOpenAir',
  'slabServiced',
  'ceiling',
  'lightPanel',
  'railing',
  'stairs',
  'tvPanel',
  'sanitaryWare',
  // Part 4 furnished the floor, so the palette gained the four families a room's
  // contents are drawn with. They are listed in palette order, and this test is
  // what makes adding a fifth a deliberate act rather than a silent one.
  'appliance',
  'joinery',
  'worktop',
  'softFurnishing',
  'artwork',
  // Part 5 split the building's own fabric out of the furniture and gave the unfinished
  // state a material of its own. `fabricJoinery` is `joinery`'s twin on purpose and
  // `plainSurface` owns no box at all — see the two cases that pin exactly that.
  'fabricJoinery',
  'plainSurface',
  // Part 5 laid the services in. These ten are the palette's one group that is read by
  // hue rather than by texture, so they stay flat and stay listed here: adding an
  // eleventh service has to be as deliberate as adding a fifth furniture family was.
  'serviceDrainage',
  'serviceWaterCold',
  'serviceWaterHot',
  'serviceGas',
  'serviceElectricity',
  'serviceLowVoltage',
  'serviceClimateCool',
  'serviceClimateHeat',
  'serviceCover',
  'serviceChamber',
];
/**
 * The three slab keys a space KIND can choose, one per walkable kind.
 *
 * `slabServiced` is deliberately not here: being plumbed or powered is not a space
 * kind — the two bathrooms, the four cubicles, the kitchen, the laundry and the
 * control center are all ordinary `room` spaces — so `getSlabMaterialKey` cannot
 * return it and `floorLayout.ts` picks it per space, from what stands in the room.
 */
const SLAB_KEYS: readonly FloorMaterialKey[] = ['slabRoom', 'slabCirculation', 'slabOpenAir'];
/**
 * The ten service layers, which are read by hue rather than by texture.
 *
 * They carry no `map` and no entry in `FAMILY_TEXTURE` (`FloorModel.tsx`) by design: a
 * services view answers "which service is this pipe", and only colour answers it.
 */
const SERVICE_KEYS: readonly FloorMaterialKey[] = [
  'serviceDrainage',
  'serviceWaterCold',
  'serviceWaterHot',
  'serviceGas',
  'serviceElectricity',
  'serviceLowVoltage',
  'serviceClimateCool',
  'serviceClimateHeat',
  'serviceCover',
  'serviceChamber',
];
/** The slab of a serviced room, chosen per space rather than per kind. */
const SERVICED_SLAB_KEY: FloorMaterialKey = 'slabServiced';
/** The only key allowed to emit light: the ceiling panel that lights a room. */
const EMISSIVE_KEY: FloorMaterialKey = 'lightPanel';
/** Slab key expected for each space kind; a `void` space has no slab. */
const EXPECTED_SLAB_KEYS: Readonly<Record<Exclude<SpaceKind, 'void'>, FloorMaterialKey>> = {
  room: 'slabRoom',
  circulation: 'slabCirculation',
  openAir: 'slabOpenAir',
};
/** A `#rrggbb` colour in lower case. */
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const MIN_UNIT = 0;
const MAX_UNIT = 1;
/** An emissive surface must actually emit something. */
const MIN_EMISSIVE_INTENSITY = 0;

/**
 * The one pair of keys allowed to carry the same finish, and why.
 *
 * `fabricJoinery` is the millwork that is the BUILDING rather than a room's contents — the
 * food-pass counter, which is half a wall with a hole in it. It is the same oak as `joinery`
 * on purpose; what differs is which checkbox hides it (`FloorModel.tsx`, `BUCKET_RULES`).
 */
const TWIN_KEYS: readonly [FloorMaterialKey, FloorMaterialKey] = ['joinery', 'fabricJoinery'];
/** One of a twinned pair still contributes one distinct finish to the palette. */
const ONE_SURVIVOR = 1;
/** The material the `finishing` checkbox re-surfaces the finish-bearing buckets with. */
const PLAIN_KEY: FloorMaterialKey = 'plainSurface';

const ENTRIES: readonly (readonly [FloorMaterialKey, FloorMaterialSpec])[] = Object.entries(
  MATERIAL_PALETTE,
) as readonly (readonly [FloorMaterialKey, FloorMaterialSpec])[];

/**
 * The whole surface of a spec, as the one string two families may not both carry.
 *
 * Colour, roughness and metalness together: two surfaces of the same oak at the same
 * roughness really are the same surface, whatever the second one is called.
 *
 * @param spec - The palette spec to read.
 * @returns Its finish, as a comparable string.
 */
function finishOf(spec: FloorMaterialSpec): string {
  return `${spec.color}/${String(spec.roughness)}/${String(spec.metalness)}`;
}

describe('MATERIAL_PALETTE', () => {
  it('defines exactly the expected keys', () => {
    expect(Object.keys(MATERIAL_PALETTE)).toEqual([...EXPECTED_KEYS]);
  });

  it('is frozen, down to every spec', () => {
    expect(Object.isFrozen(MATERIAL_PALETTE)).toBe(true);
    for (const [, spec] of ENTRIES) {
      expect(Object.isFrozen(spec)).toBe(true);
    }
  });

  it.each(EXPECTED_KEYS)('gives %s a readable physical spec', (key) => {
    const spec = MATERIAL_PALETTE[key];

    expect(spec.color).toMatch(HEX_COLOR);
    expect(spec.roughness).toBeGreaterThanOrEqual(MIN_UNIT);
    expect(spec.roughness).toBeLessThanOrEqual(MAX_UNIT);
    expect(spec.metalness).toBeGreaterThanOrEqual(MIN_UNIT);
    expect(spec.metalness).toBeLessThanOrEqual(MAX_UNIT);
    expect(typeof spec.dithering).toBe('boolean');
  });

  it('lets the light panel, and only the light panel, emit light', () => {
    const emitting = ENTRIES.filter(([, spec]) => spec.emissive !== undefined).map(([key]) => key);

    expect(emitting).toEqual([EMISSIVE_KEY]);
    const panel = MATERIAL_PALETTE[EMISSIVE_KEY];
    expect(panel.emissive).toMatch(HEX_COLOR);
    expect(panel.emissiveIntensity).toBeGreaterThan(MIN_EMISSIVE_INTENSITY);
    for (const [, spec] of ENTRIES.filter(([key]) => key !== EMISSIVE_KEY)) {
      expect(spec.emissiveIntensity).toBeUndefined();
    }
  });

  it('dithers the large surfaces and leaves the small elements alone', () => {
    const dithered = ENTRIES.filter(([, spec]) => spec.dithering).map(([key]) => key);

    expect(dithered).toContain('wall');
    expect(dithered).toContain('ceiling');
    expect(dithered).toEqual(expect.arrayContaining([...SLAB_KEYS, SERVICED_SLAB_KEY]));
    expect(dithered).not.toContain(EMISSIVE_KEY);
    expect(dithered).not.toContain('sanitaryWare');
  });

  it('keeps a parapet visible against a wall', () => {
    expect(MATERIAL_PALETTE.parapet.color).not.toBe(MATERIAL_PALETTE.wall.color);
  });

  it('gives each walkable space kind its own slab colour', () => {
    const colors = SLAB_KEYS.map((key) => MATERIAL_PALETTE[key].color);

    expect(new Set(colors).size).toBe(SLAB_KEYS.length);
  });

  it('gives every family a finish of its own, bar the one declared twin', () => {
    // Colour alone is not enough and must not be asserted: a scheme means unrelated
    // families share a hue on purpose. What is asserted is the whole finish — and it is
    // unique across the palette with exactly ONE exception, listed above as
    // {@link TWIN_KEYS}: `fabricJoinery` is `joinery`'s oak down to the last setting,
    // because it IS the same oak and the split between them is about which checkbox owns
    // the box, not about how it looks.
    //
    // This used to be "every family, no exception", and it was load-bearing:
    // `FloorModel.test.tsx` named the bucket a mesh drew by looking its settings up here.
    // That lookup is gone — a mesh now carries its bucket's key as the material's `name` —
    // precisely because a palette with a deliberate twin in it, and buckets that get
    // re-surfaced with `plainSurface`, can no longer be read backwards from a colour.
    const finishes = ENTRIES.map(([, spec]) => finishOf(spec));

    expect(new Set(finishes).size).toBe(EXPECTED_KEYS.length - TWIN_KEYS.length + ONE_SURVIVOR);
  });

  it('keeps the fabric twin identical to the family it was split out of', () => {
    // The point of the split is the bucket and nothing else: a viewer must see one pass
    // counter, not an oak carcass with a slightly different lid. A drifted hex here would
    // be the split leaking out of the layer table and into the surface.
    const [first, second] = TWIN_KEYS;

    expect(MATERIAL_PALETTE[first]).toStrictEqual(MATERIAL_PALETTE[second]);
    expect(finishOf(MATERIAL_PALETTE[first])).toBe(finishOf(MATERIAL_PALETTE[second]));
  });

  it('gives the plain finish a surface of its own, unlike any family it re-surfaces', () => {
    // `plainSurface` is a material, not a group of solids: it is what the `finishing`
    // checkbox draws the finish-bearing buckets with. It therefore has to be TELLABLE from
    // every finish it replaces, or unticking the box would change nothing on screen.
    const plain = MATERIAL_PALETTE[PLAIN_KEY];
    const others = ENTRIES.filter(([key]) => key !== PLAIN_KEY).map(([, spec]) => finishOf(spec));

    expect(plain.color).toMatch(HEX_COLOR);
    expect(others).not.toContain(finishOf(plain));
  });

  /**
   * The service layers, which are the one group in the palette the scheme does not reach.
   *
   * Everything else may share a hue on purpose — oak is oak wherever it stands. A services
   * view inverts that: it exists so gas can be told from water at a glance, so here a shared
   * hue is a bug and not a scheme. Pinned because the surrounding tests say the opposite
   * about every other family, and the next reader will otherwise assume the same licence.
   */
  it('gives every service layer a hue of its own', () => {
    const colors = SERVICE_KEYS.map((key) => MATERIAL_PALETTE[key].color);

    expect(new Set(colors).size).toBe(SERVICE_KEYS.length);
  });

  it('tells a serviced room underfoot from every other slab', () => {
    const colors = [...SLAB_KEYS, SERVICED_SLAB_KEY].map((key) => MATERIAL_PALETTE[key].color);

    expect(new Set(colors).size).toBe(SLAB_KEYS.length + 1);
  });

  /**
   * Pairs that are seen touching, and so may not share a colour.
   *
   * This replaces a test that required every key in the palette to be a different
   * colour. Since the scheme went whole-building that rule is simply false — oak
   * joinery and an oak stair tread are the same oak on purpose — and a test that
   * asserts a falsehood about the design is worse than no test. What actually
   * matters is narrower and checkable: a thing standing on a surface has to be
   * visible against it.
   */
  it.each([
    ['sanitary ware on the marble it stands on', 'sanitaryWare', 'slabServiced'],
    ['a stair tread against the landing it lands on', 'stairs', 'slabCirculation'],
    ['upholstery on the carpet it stands on', 'softFurnishing', 'slabRoom'],
    ['a wardrobe on the carpet it stands on', 'joinery', 'slabRoom'],
    ['a marble top on its oak carcass', 'worktop', 'joinery'],
    ['a parapet against the wall behind it', 'parapet', 'wall'],
    ['the television against its wall', 'tvPanel', 'wall'],
  ] as const satisfies readonly (readonly [string, FloorMaterialKey, FloorMaterialKey])[])(
    'keeps %s readable',
    (_what, standing, beneath) => {
      expect(MATERIAL_PALETTE[standing].color).not.toBe(MATERIAL_PALETTE[beneath].color);
    },
  );

  /**
   * The other half of that: the families the scheme deliberately unifies.
   *
   * A scheme is exactly an agreement that unrelated things share a material, so
   * this is pinned rather than left to be read as an accident by whoever next
   * sees two identical hexadecimal strings and tidies one of them away.
   */
  it('draws the millwork and the stair treads from one oak, by design', () => {
    const { joinery, stairs } = MATERIAL_PALETTE;

    expect(joinery.color).toBe(stairs.color);
    // They part company on finish, not on hue: a tread is sealed, a door is not.
    expect(stairs.roughness).toBeLessThan(joinery.roughness);
  });

  it('sets the stairs and the railing apart from the walls and from each other', () => {
    const { stairs, railing, wall } = MATERIAL_PALETTE;

    expect(new Set([stairs.color, railing.color, wall.color]).size).toBe(3);
    // The railing used to separate by metalness; since ADR-020 it is matte black and
    // separates by value instead, which is what the brief asks for and is the stronger
    // signal anyway — a software rasteriser renders a value difference reliably and a
    // metalness difference only as well as its environment lets it.
    expect(railing.color).not.toBe(wall.color);
  });

  it('keeps the television panel the darkest surface', () => {
    const others = ENTRIES.filter(([key]) => key !== 'tvPanel').map(([, spec]) => spec.color);

    for (const color of others) {
      expect(MATERIAL_PALETTE.tvPanel.color < color).toBe(true);
    }
  });
});

describe('getSlabMaterialKey', () => {
  it.each(Object.entries(EXPECTED_SLAB_KEYS))('maps %s to %s', (kind, expected) => {
    expect(getSlabMaterialKey(kind as SpaceKind)).toBe(expected);
  });

  it('rejects a void space, which has no floor', () => {
    expect(() => getSlabMaterialKey('void')).toThrow(RangeError);
  });

  it('covers every space kind', () => {
    for (const kind of SPACE_KINDS) {
      if (kind === 'void') {
        continue;
      }
      expect(MATERIAL_PALETTE[getSlabMaterialKey(kind)]).toBeDefined();
    }
  });
});
