import { useOrbitControlStore } from '../application/orbitControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { OrbitAction } from '../domain/orbitNavigation.ts';
import { HoldPad } from './HoldPad.tsx';
import type { HoldPadCluster } from './HoldPad.tsx';
import { INTERIOR_REGION_ID } from './hudIds.ts';

/** Accessible name of the whole pad. */
const GROUP_LABEL = 'Camera control';

/**
 * The pad's clusters, in the reading order of `ORBIT_ACTIONS`: orbit, tilt, zoom. Frozen.
 *
 * The captions are for sighted users; each button carries its own accessible name. The
 * cluster captions say what the pair does to the camera — rotate around the building, tilt
 * over it, zoom towards it — where the action names say it in the domain's own words.
 */
const CLUSTERS: readonly HoldPadCluster<OrbitAction>[] = Object.freeze([
  Object.freeze({
    caption: 'Rotate',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ action: 'orbitLeft', label: 'Rotate left', glyph: '⟲' }),
        Object.freeze({ action: 'orbitRight', label: 'Rotate right', glyph: '⟳' }),
      ]),
    ]),
  }),
  Object.freeze({
    caption: 'Tilt',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ action: 'tiltUp', label: 'Tilt up', glyph: '▲' }),
        Object.freeze({ action: 'tiltDown', label: 'Tilt down', glyph: '▼' }),
      ]),
    ]),
  }),
  Object.freeze({
    caption: 'Zoom',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ action: 'zoomIn', label: 'Zoom in', glyph: '＋' }),
        Object.freeze({ action: 'zoomOut', label: 'Zoom out', glyph: '－' }),
      ]),
    ]),
  }),
] as const);

/**
 * HUD orbit pad: an on-screen replacement for every exterior camera key.
 *
 * Each of the six orbit actions (rotate left/right, tilt up/down, zoom in/out) has its own
 * hold-to-act button, so the exterior view is no longer drag-and-wheel-or-keyboard only: the
 * arrow and zoom keys bound in `orbitNavigation.ts` each have an on-screen equivalent, which
 * is what the standing accessibility rule asks for. Rendered only in the exterior view,
 * where the orbit applies.
 *
 * After a pointer hold focus returns to the 3D view region, so the orbit keys keep working
 * without the viewer having to Tab back out of the pad; a keyboard hold leaves focus on the
 * button, where the user put it, since moving it would be an unexpected focus change. The
 * region is focusable in both views and keeps the id `INTERIOR_REGION_ID` although it now
 * serves the exterior view too — the naming debt is recorded in ADR-013 rather than renamed.
 *
 * Everything about holding, releasing and never sticking lives in {@link HoldPad}, which the
 * interior `RemoteControl` shares: this component is the exterior vocabulary and nothing else.
 *
 * @returns The orbit pad in the exterior view, otherwise `null`.
 */
export function OrbitPad() {
  const isExterior = useViewStore((state) => state.viewMode === 'exterior');

  return (
    <HoldPad
      groupLabel={GROUP_LABEL}
      clusters={CLUSTERS}
      store={useOrbitControlStore}
      focusTargetId={INTERIOR_REGION_ID}
      active={isExterior}
    />
  );
}
