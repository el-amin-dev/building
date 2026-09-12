import { useRemoteControlStore } from '../application/remoteControlStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { EyeAction } from '../domain/eyeNavigation.ts';
import { HoldPad } from './HoldPad.tsx';
import type { HoldPadCluster } from './HoldPad.tsx';
import { INTERIOR_REGION_ID } from './hudIds.ts';

/** Accessible name of the whole pad. */
const GROUP_LABEL = 'Remote control';

/**
 * The pad's clusters, in reading order: walking laid out as a cross (forward above,
 * left/back/right below), then turning (yaw), then looking (pitch). Frozen.
 *
 * The captions are for sighted users; each button carries its own accessible name.
 */
const CLUSTERS: readonly HoldPadCluster<EyeAction>[] = Object.freeze([
  Object.freeze({
    caption: 'Move',
    rows: Object.freeze([
      Object.freeze([Object.freeze({ action: 'moveForward', label: 'Move forward', glyph: '↑' })]),
      Object.freeze([
        Object.freeze({ action: 'strafeLeft', label: 'Strafe left', glyph: '←' }),
        Object.freeze({ action: 'moveBackward', label: 'Move back', glyph: '↓' }),
        Object.freeze({ action: 'strafeRight', label: 'Strafe right', glyph: '→' }),
      ]),
    ]),
  }),
  Object.freeze({
    caption: 'Turn',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ action: 'turnLeft', label: 'Turn left', glyph: '⟲' }),
        Object.freeze({ action: 'turnRight', label: 'Turn right', glyph: '⟳' }),
      ]),
    ]),
  }),
  Object.freeze({
    caption: 'Look',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ action: 'lookUp', label: 'Look up', glyph: '▲' }),
        Object.freeze({ action: 'lookDown', label: 'Look down', glyph: '▼' }),
      ]),
    ]),
  }),
] as const);

/**
 * HUD remote control: an on-screen replacement for every interior navigation key.
 *
 * Each of the eight navigation actions (forward, back, strafe left/right, turn left/right,
 * look up/down) has its own hold-to-act button, so navigation never requires a keyboard.
 * Rendered only in the interior view, where the actions apply; after a pointer hold focus
 * returns to the interior 3D view region, so the keys keep working.
 *
 * Everything about holding, releasing and never sticking lives in {@link HoldPad}, which the
 * exterior `OrbitPad` shares: this component is the interior vocabulary and nothing else.
 *
 * @returns The remote control in the interior view, otherwise `null`.
 */
export function RemoteControl() {
  const isInterior = useViewStore((state) => state.viewMode === 'interior');

  return (
    <HoldPad
      groupLabel={GROUP_LABEL}
      clusters={CLUSTERS}
      store={useRemoteControlStore}
      focusTargetId={INTERIOR_REGION_ID}
      active={isInterior}
    />
  );
}
