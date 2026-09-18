import { useEffect } from 'react';
import { useViewStore } from '../features/building/application/viewStore.ts';
import { BuildingScene } from '../features/building/ui/BuildingScene.tsx';
import { CameraModeToggle } from '../features/building/ui/CameraModeToggle.tsx';
import { DebugPanel } from '../features/building/ui/DebugPanel.tsx';
import { FloorCountStepper } from '../features/building/ui/FloorCountStepper.tsx';
import { Minimap } from '../features/building/ui/Minimap.tsx';
import { NavigationHint } from '../features/building/ui/NavigationHint.tsx';
import { OrbitPad } from '../features/building/ui/OrbitPad.tsx';
import { RemoteControl } from '../features/building/ui/RemoteControl.tsx';
import { RoomMenu } from '../features/building/ui/RoomMenu.tsx';
import { RoomReadout } from '../features/building/ui/RoomReadout.tsx';
import { usePrefersReducedMotion } from '../features/building/ui/usePrefersReducedMotion.ts';
import { ViewModeToggle } from '../features/building/ui/ViewModeToggle.tsx';
import { appConfig } from './config.ts';

/**
 * Root component: a full-screen 3D scene with a HUD overlay on top.
 *
 * The HUD is one top-left stack — status, toggles and the floor stepper, the room menu, the
 * navigation hint, the room readout, the minimap, then the pad of the current view — and the
 * DOM order is the Tab order: the view region comes first (inside `BuildingScene`, before
 * this overlay), then the view toggle, the camera toggle, the stepper's "Remove a floor" and
 * "Add a floor", "Go to room", and the pad buttons. The readout, the stepper's own reading
 * and the minimap are not tab stops; they are read, not operated.
 *
 * **Every panel sits inside the one overlay div**, which is also the element the end-to-end
 * screenshot helper masks (`tests/e2e/sceneCapture.ts` finds it as the child of `<main>`
 * holding the view status). The readout, the minimap and a held pad button all change as
 * the viewer walks, so a panel left outside that mask would make a frame comparison pass on
 * its own pixels. Each panel decides for itself whether the current view wants it, so they
 * are all mounted unconditionally: the readout is `sr-only` and out of flow while there is
 * nothing to announce, the menu, hint, minimap and remote control render nothing outside the
 * interior, and the orbit pad renders nothing outside the exterior. The floor stepper is the
 * one panel with no such branch at all: how tall the building is, is as much a fact of the
 * exterior it is seen from as of the interior it is walked in.
 *
 * On a narrow viewport the stack would eat the top half of the screen and leave the 3D view a
 * strip, which defeats the pad it hosts: the pad is the only way to move for someone without a
 * keyboard, and they still need to see what they move through. So below the `sm` breakpoint the
 * panels shrink — the stepper's "Floors" caption goes `sr-only` there, which is what keeps the
 * wrapped first row down to a single extra panel height — the hint drops to a single line, the
 * minimap is hidden (everything it shows is also said by the readout and offered by the room
 * menu) and the pad takes itself out of this flow and anchors to the bottom of the screen,
 * within thumb reach and clear of the band above.
 * The DOM order — and with it the Tab order — is the same at every width.
 *
 * The viewer's motion preference is read here, in the DOM, and pushed into the view store from
 * an effect, because `matchMedia` is a browser fact and the store has to stay a plain,
 * deterministic object for the tests. It governs the exterior↔interior camera flight and
 * nothing else (`application/viewStore.ts`): an automatic walk is locomotion, not decoration.
 *
 * @returns The application shell.
 */
export function App() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const setPrefersReducedMotion = useViewStore((state) => state.setPrefersReducedMotion);

  useEffect(() => {
    setPrefersReducedMotion(prefersReducedMotion);
  }, [prefersReducedMotion, setPrefersReducedMotion]);

  return (
    <main className="relative h-full w-full overflow-hidden">
      <h1 className="sr-only">{appConfig.appTitle}</h1>
      <BuildingScene />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-start p-2 sm:p-4">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <ViewModeToggle />
            <CameraModeToggle />
            <FloorCountStepper />
          </div>
          <RoomMenu />
          <NavigationHint />
          <RoomReadout />
          <Minimap />
          <RemoteControl />
          <OrbitPad />
        </div>
      </div>
      <DebugPanel visible={appConfig.showDebugPanel} />
    </main>
  );
}
