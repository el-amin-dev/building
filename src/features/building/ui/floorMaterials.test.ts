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
  'ceiling',
  'lightPanel',
  'railing',
  'stairs',
  'tvPanel',
];
/** The three slab keys, one per walkable space kind. */
const SLAB_KEYS: readonly FloorMaterialKey[] = ['slabRoom', 'slabCirculation', 'slabOpenAir'];
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

const ENTRIES: readonly (readonly [FloorMaterialKey, FloorMaterialSpec])[] = Object.entries(
  MATERIAL_PALETTE,
) as readonly (readonly [FloorMaterialKey, FloorMaterialSpec])[];

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
    expect(dithered).toEqual(expect.arrayContaining([...SLAB_KEYS]));
    expect(dithered).not.toContain(EMISSIVE_KEY);
  });

  it('keeps a parapet visible against a wall', () => {
    expect(MATERIAL_PALETTE.parapet.color).not.toBe(MATERIAL_PALETTE.wall.color);
  });

  it('gives each walkable space kind its own slab colour', () => {
    const colors = SLAB_KEYS.map((key) => MATERIAL_PALETTE[key].color);

    expect(new Set(colors).size).toBe(SLAB_KEYS.length);
  });

  it('sets the stairs and the railing apart from the walls and from each other', () => {
    const { stairs, railing, wall } = MATERIAL_PALETTE;

    expect(new Set([stairs.color, railing.color, wall.color]).size).toBe(3);
    expect(railing.metalness).toBeGreaterThan(wall.metalness);
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
