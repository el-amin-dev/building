import { Fragment, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getExteriorFraming } from '../domain/exteriorFraming.ts';
import { PLOT_RECT } from '../domain/floorPlan/index.ts';
import { FLOOR_HEIGHTS } from '../domain/heights.ts';
import {
  getLightingSpec,
  getSunDistance,
  getSunPosition,
  SCENE_LIGHT_COUNT,
  SUN_AZIMUTH_FROM_B_DEGREES,
  SUN_ELEVATION_DEGREES,
} from './lightingSpec.ts';
import type { LightingView } from './lightingSpec.ts';
import { SceneLighting } from './SceneLighting.tsx';

/** Values standing for a viewer dragging a control, keyed by `folder.control`. */
const { panelOverrides } = vi.hoisted(() => ({ panelOverrides: new Map<string, unknown>() }));

// Leva is replaced by a plain reader of the control schemas: `useControls` resolves each
// schema (a function, since the component re-seeds on a view change) and returns the seed
// of every control, with anything in `panelOverrides` standing for a dragged control. No
// Leva store and no Leva DOM are needed, and the hook stays inert in jsdom — the same
// reasoning as the `@react-three/fiber` mock in `BuildingScene.test.tsx`.
vi.mock('leva', () => {
  interface SeededControl {
    readonly value: unknown;
  }
  function isSeeded(control: unknown): control is SeededControl {
    return typeof control === 'object' && control !== null && 'value' in control;
  }
  return {
    useControls: (folder: string, schemaOrFactory: unknown) => {
      const schema = (
        typeof schemaOrFactory === 'function'
          ? (schemaOrFactory as () => Record<string, unknown>)()
          : schemaOrFactory
      ) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(schema).map(([key, control]) => {
          const path = `${folder}.${key}`;
          const seed = isSeeded(control) ? control.value : control;
          return [key, panelOverrides.has(path) ? panelOverrides.get(path) : seed];
        }),
      );
      return [values, vi.fn(), vi.fn()];
    },
  };
});

const FOV_DEGREES = 50;
const WIDESCREEN_ASPECT = 16 / 9;
const FRAMING = getExteriorFraming(PLOT_RECT, FLOOR_HEIGHTS, FOV_DEGREES, WIDESCREEN_ASPECT);
const SUN_DISTANCE = getSunDistance(FRAMING);

const VIEWS: readonly LightingView[] = ['exterior', 'interior'];

const BACKGROUND = 'color';
const FOG = 'fog';
const HEMISPHERE_LIGHT = 'hemisphereLight';
const DIRECTIONAL_LIGHT = 'directionalLight';
const AMBIENT_LIGHT = 'ambientLight';
/** The light elements, whose number three.js compiles into every material's shader. */
const LIGHTS = [HEMISPHERE_LIGHT, DIRECTIONAL_LIGHT, AMBIENT_LIGHT];
/** The whole tree, in the order it must be rendered in. */
const EXPECTED_ORDER = [BACKGROUND, FOG, ...LIGHTS];
/** Exactly one of each element: the count-stability property of this component. */
const ONE = 1;

/** Panel values far from the seeds, to prove no control can change the light count. */
const OVERRIDE_SUN_INTENSITY = 0;
const OVERRIDE_ELEVATION_DEGREES = 10;
const OVERRIDE_AZIMUTH_DEGREES = -170;
const OVERRIDE_HEMISPHERE_INTENSITY = 3;
const OVERRIDE_AMBIENT_INTENSITY = 0;
const OVERRIDE_SKY_COLOR = '#101820';
const OVERRIDE_GROUND_COLOR = '#000000';

/** An element of the lighting tree, with its props readable by name. */
type LightingElement = ReactElement<Record<string, unknown>>;

/**
 * Flattens fragments and arrays out of a rendered tree, keeping the leaf elements in
 * order.
 *
 * @param node - The node to walk.
 * @param into - The elements found so far; appended to in place.
 */
function flatten(node: ReactNode, into: LightingElement[]): void {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      flatten(child, into);
    }
    return;
  }
  if (!isValidElement(node)) {
    return;
  }
  if (node.type === Fragment) {
    flatten((node.props as { readonly children?: ReactNode }).children, into);
    return;
  }
  into.push(node as LightingElement);
}

/**
 * Renders the lighting of one view as a flat list of elements.
 *
 * The component is called directly rather than mounted: with Leva mocked it uses no React
 * state, and reading the element tree keeps the three.js props (the position tuple, the
 * fog arguments) as the values they are, instead of the strings jsdom would stringify
 * them into on an unknown DOM tag.
 *
 * @param view - The view to light.
 * @returns The rendered elements, in order.
 */
function renderLighting(view: LightingView): readonly LightingElement[] {
  const elements: LightingElement[] = [];
  flatten(SceneLighting({ view, framing: FRAMING }), elements);
  return elements;
}

/**
 * Counts the elements of one type.
 *
 * @param elements - The rendered elements.
 * @param type - The element type to count, e.g. `'ambientLight'`.
 * @returns How many elements have that type.
 */
function countOf(elements: readonly LightingElement[], type: string): number {
  return elements.filter((element) => element.type === type).length;
}

/**
 * Returns the props of the single element of one type.
 *
 * @param elements - The rendered elements.
 * @param type - The element type to look up.
 * @returns The props of that element.
 * @throws Error when the type is absent from the tree.
 */
function propsOf(elements: readonly LightingElement[], type: string): Record<string, unknown> {
  const found = elements.find((element) => element.type === type);
  if (found === undefined) {
    throw new Error(`The lighting has no <${type}>`);
  }
  return found.props;
}

/**
 * Asserts the whole tree: one background, one fog and exactly the three lights, in order.
 *
 * @param elements - The rendered elements.
 */
function expectThreeLights(elements: readonly LightingElement[]): void {
  expect(elements.map((element) => element.type)).toStrictEqual(EXPECTED_ORDER);
  for (const type of EXPECTED_ORDER) {
    expect(countOf(elements, type), type).toBe(ONE);
  }
  expect(elements.filter((element) => LIGHTS.includes(String(element.type)))).toHaveLength(
    SCENE_LIGHT_COUNT,
  );
}

describe('SceneLighting', () => {
  beforeEach(() => {
    panelOverrides.clear();
  });

  it.each(VIEWS)('lights the %s view with a background, fog and exactly three lights', (view) => {
    expectThreeLights(renderLighting(view));
  });

  it.each(VIEWS)('seeds the %s lights from the spec of that view', (view) => {
    const spec = getLightingSpec(view, FRAMING);
    const elements = renderLighting(view);

    expect(propsOf(elements, HEMISPHERE_LIGHT)).toMatchObject({
      color: spec.skyColor,
      groundColor: spec.groundColor,
      intensity: spec.hemisphereIntensity,
    });
    expect(propsOf(elements, DIRECTIONAL_LIGHT)).toMatchObject({
      color: spec.sunColor,
      intensity: spec.sunIntensity,
    });
    expect(propsOf(elements, AMBIENT_LIGHT)).toMatchObject({
      intensity: spec.ambientIntensity,
    });
  });

  it.each(VIEWS)('puts the %s sun where the spec does', (view) => {
    const expected = getSunPosition(
      SUN_ELEVATION_DEGREES,
      SUN_AZIMUTH_FROM_B_DEGREES,
      SUN_DISTANCE,
    );
    const spec = getLightingSpec(view, FRAMING);

    expect(propsOf(renderLighting(view), DIRECTIONAL_LIGHT).position).toStrictEqual([
      expected.x,
      expected.y,
      expected.z,
    ]);
    expect(spec.sunPosition).toStrictEqual(expected);
  });

  it.each(VIEWS)('colours the %s fog and background like the sky', (view) => {
    const spec = getLightingSpec(view, FRAMING);
    const elements = renderLighting(view);

    expect(propsOf(elements, BACKGROUND)).toMatchObject({
      attach: 'background',
      args: [spec.skyColor],
    });
    expect(propsOf(elements, FOG)).toMatchObject({
      attach: 'fog',
      args: [spec.skyColor, spec.fogNear, spec.fogFar],
    });
  });

  it('changes intensities but not the number of lights when the view switches', () => {
    const exterior = renderLighting('exterior');
    const interior = renderLighting('interior');

    expect(interior.map((element) => element.type)).toStrictEqual(
      exterior.map((element) => element.type),
    );
    expect(propsOf(interior, HEMISPHERE_LIGHT).intensity).not.toBe(
      propsOf(exterior, HEMISPHERE_LIGHT).intensity,
    );
    expect(propsOf(interior, AMBIENT_LIGHT).intensity).not.toBe(
      propsOf(exterior, AMBIENT_LIGHT).intensity,
    );
    expect(propsOf(interior, DIRECTIONAL_LIGHT).position).toStrictEqual(
      propsOf(exterior, DIRECTIONAL_LIGHT).position,
    );
    expect(propsOf(interior, DIRECTIONAL_LIGHT).intensity).toBe(
      propsOf(exterior, DIRECTIONAL_LIGHT).intensity,
    );
  });

  it.each(VIEWS)('keeps the %s light count whatever the panel is set to', (view) => {
    panelOverrides.set('Sun.intensity', OVERRIDE_SUN_INTENSITY);
    panelOverrides.set('Sun.elevationDegrees', OVERRIDE_ELEVATION_DEGREES);
    panelOverrides.set('Sun.azimuthDegrees', OVERRIDE_AZIMUTH_DEGREES);
    panelOverrides.set('Sky.hemisphereIntensity', OVERRIDE_HEMISPHERE_INTENSITY);
    panelOverrides.set('Sky.ambientIntensity', OVERRIDE_AMBIENT_INTENSITY);
    panelOverrides.set('Sky.skyColor', OVERRIDE_SKY_COLOR);
    panelOverrides.set('Sky.groundColor', OVERRIDE_GROUND_COLOR);
    const expected = getSunPosition(
      OVERRIDE_ELEVATION_DEGREES,
      OVERRIDE_AZIMUTH_DEGREES,
      SUN_DISTANCE,
    );

    const elements = renderLighting(view);

    expectThreeLights(elements);
    expect(propsOf(elements, DIRECTIONAL_LIGHT)).toMatchObject({
      intensity: OVERRIDE_SUN_INTENSITY,
      position: [expected.x, expected.y, expected.z],
    });
    expect(propsOf(elements, HEMISPHERE_LIGHT)).toMatchObject({
      color: OVERRIDE_SKY_COLOR,
      groundColor: OVERRIDE_GROUND_COLOR,
      intensity: OVERRIDE_HEMISPHERE_INTENSITY,
    });
    expect(propsOf(elements, AMBIENT_LIGHT).intensity).toBe(OVERRIDE_AMBIENT_INTENSITY);
    expect(propsOf(elements, FOG).args).toStrictEqual([
      OVERRIDE_SKY_COLOR,
      FRAMING.fogNear,
      FRAMING.fogFar,
    ]);
  });
});
