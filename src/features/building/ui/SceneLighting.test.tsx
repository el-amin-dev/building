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

/**
 * The value Leva holds for each control, keyed by `folder.control`, and the seed each
 * control was last rendered with.
 *
 * Kept separate on purpose: a control's value and its seed are two different things in
 * Leva, and the defect these tests guard lived exactly in the gap between them.
 */
const { controlValues, renderedSeeds } = vi.hoisted(() => ({
  controlValues: new Map<string, unknown>(),
  renderedSeeds: new Map<string, unknown>(),
}));

// Leva is replaced by a mock of the one behaviour that matters here: its store creates a
// control's value from the seed the first time that control is rendered and never re-seeds
// it afterwards (`addData` strips `value` from the properties it overrides, and
// `useValuesForPath` lets the store win over a fresh seed), while a plain number input
// survives unmounting, so the value outlives the component. Reproducing that is what makes
// the regression tests below meaningful: a mock that simply returned the current seed would
// pass however the component is written. No Leva DOM is needed and the hook stays inert in
// jsdom — the same reasoning as the `@react-three/fiber` mock in `BuildingScene.test.tsx`.
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
          renderedSeeds.set(path, seed);
          if (!controlValues.has(path)) {
            controlValues.set(path, seed);
          }
          return [key, controlValues.get(path)];
        }),
      );
      return [values, vi.fn(), vi.fn()];
    },
  };
});

/** Stands for a viewer dragging one control: it writes into the store, as Leva would. */
function dragControl(path: string, value: unknown): void {
  controlValues.set(path, value);
}

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
const OVERRIDE_SUN_FACTOR = 0;
const OVERRIDE_ELEVATION_DEGREES = 10;
const OVERRIDE_AZIMUTH_DEGREES = -170;
const OVERRIDE_HEMISPHERE_FACTOR = 3;
const OVERRIDE_AMBIENT_FACTOR = 0;
const OVERRIDE_SKY_COLOR = '#101820';
const OVERRIDE_GROUND_COLOR = '#000000';
/** How many times the view is toggled back and forth, to prove the spec keeps being applied. */
const TOGGLE_ROUNDS = 3;

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
    controlValues.clear();
    renderedSeeds.clear();
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
    dragControl('Sun.intensityFactor', OVERRIDE_SUN_FACTOR);
    dragControl('Sun.elevationDegrees', OVERRIDE_ELEVATION_DEGREES);
    dragControl('Sun.azimuthDegrees', OVERRIDE_AZIMUTH_DEGREES);
    dragControl('Sky.hemisphereFactor', OVERRIDE_HEMISPHERE_FACTOR);
    dragControl('Sky.ambientFactor', OVERRIDE_AMBIENT_FACTOR);
    dragControl('Sky.skyColor', OVERRIDE_SKY_COLOR);
    dragControl('Sky.groundColor', OVERRIDE_GROUND_COLOR);
    const expected = getSunPosition(
      OVERRIDE_ELEVATION_DEGREES,
      OVERRIDE_AZIMUTH_DEGREES,
      SUN_DISTANCE,
    );
    const spec = getLightingSpec(view, FRAMING);

    const elements = renderLighting(view);

    expectThreeLights(elements);
    // A dragged factor scales the spec of the current view: the panel overrides the
    // lighting, it never replaces the spec as the value the view is lit from.
    expect(propsOf(elements, DIRECTIONAL_LIGHT)).toMatchObject({
      intensity: spec.sunIntensity * OVERRIDE_SUN_FACTOR,
      position: [expected.x, expected.y, expected.z],
    });
    expect(propsOf(elements, HEMISPHERE_LIGHT)).toMatchObject({
      color: OVERRIDE_SKY_COLOR,
      groundColor: OVERRIDE_GROUND_COLOR,
      intensity: spec.hemisphereIntensity * OVERRIDE_HEMISPHERE_FACTOR,
    });
    expect(propsOf(elements, AMBIENT_LIGHT).intensity).toBe(
      spec.ambientIntensity * OVERRIDE_AMBIENT_FACTOR,
    );
    expect(propsOf(elements, FOG).args).toStrictEqual([
      OVERRIDE_SKY_COLOR,
      FRAMING.fogNear,
      FRAMING.fogFar,
    ]);
  });

  // Regression, the two-shading defect: Leva's store keeps the value a control was first
  // rendered with, so while the panel owned the intensities themselves, whichever view
  // rendered first pinned its fill and ambient term onto the other one. The interior then
  // showed the exterior shading — the same geometry lit two different ways, one stable image
  // per page load, decided by mount order rather than by the view.
  it('applies the spec of the current view however many times the view is toggled', () => {
    const exterior = getLightingSpec('exterior', FRAMING);
    const interior = getLightingSpec('interior', FRAMING);
    // Guards the test itself: with equal intensities it could not tell the views apart.
    expect(interior.hemisphereIntensity).not.toBe(exterior.hemisphereIntensity);
    expect(interior.ambientIntensity).not.toBe(exterior.ambientIntensity);

    for (let round = 0; round < TOGGLE_ROUNDS; round += 1) {
      for (const view of VIEWS) {
        // The store is never cleared inside the loop: every render after the first sees the
        // values the previous view left behind, exactly as Leva's store does in the browser.
        const spec = getLightingSpec(view, FRAMING);
        const elements = renderLighting(view);

        expectThreeLights(elements);
        expect(propsOf(elements, HEMISPHERE_LIGHT).intensity, view).toBe(spec.hemisphereIntensity);
        expect(propsOf(elements, AMBIENT_LIGHT).intensity, view).toBe(spec.ambientIntensity);
      }
    }
  });

  it.each(VIEWS)('lights the %s view from its own spec whatever seeded the panel first', (view) => {
    const other = VIEWS.find((candidate) => candidate !== view);
    const spec = getLightingSpec(view, FRAMING);

    // The other view renders first, so it is the one that creates every Leva value.
    renderLighting(other ?? view);
    const elements = renderLighting(view);

    expect(propsOf(elements, HEMISPHERE_LIGHT).intensity).toBe(spec.hemisphereIntensity);
    expect(propsOf(elements, AMBIENT_LIGHT).intensity).toBe(spec.ambientIntensity);
    expect(propsOf(elements, DIRECTIONAL_LIGHT).intensity).toBe(spec.sunIntensity);
  });

  it('seeds no control from a value that depends on the view', () => {
    // The root cause, asserted directly: Leva creates a control's value once and keeps it, so
    // any seed that differs between the views is a value one view can pin onto the other. The
    // component must hand Leva view-independent seeds only — factors, angles and the colours
    // both views share — and apply the view's own spec itself.
    renderLighting('exterior');
    const exteriorSeeds = Object.fromEntries(renderedSeeds);
    controlValues.clear();
    renderedSeeds.clear();

    renderLighting('interior');

    expect(Object.keys(exteriorSeeds).length).toBeGreaterThan(0);
    expect(Object.fromEntries(renderedSeeds)).toStrictEqual(exteriorSeeds);
  });
});
