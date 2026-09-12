import { BuildingScene } from '../features/building/ui/BuildingScene.tsx';
import { CameraModeToggle } from '../features/building/ui/CameraModeToggle.tsx';
import { DebugPanel } from '../features/building/ui/DebugPanel.tsx';
import { NavigationHint } from '../features/building/ui/NavigationHint.tsx';
import { RemoteControl } from '../features/building/ui/RemoteControl.tsx';
import { ViewModeToggle } from '../features/building/ui/ViewModeToggle.tsx';
import { appConfig } from './config.ts';

/**
 * Root component: a full-screen 3D scene with a HUD overlay on top.
 *
 * The HUD is one top-left stack — status and toggles, the navigation hint, then the remote
 * control — in that order, so the Tab order stays "3D view, view toggle, camera toggle, pad"
 * (the view region precedes this overlay in the DOM).
 *
 * On a narrow viewport the stack would eat the top half of the screen and leave the 3D view a
 * strip, which defeats the pad it hosts: the pad is the only way to move for someone without a
 * keyboard, and they still need to see what they move through. So below the `sm` breakpoint the
 * panels shrink, the hint drops to a single line and the pad takes itself out of this flow and
 * anchors to the bottom of the screen (`RemoteControl`), within thumb reach and clear of the
 * band above. The DOM order — and with it the Tab order — is the same at every width.
 *
 * @returns The application shell.
 */
export function App() {
  return (
    <main className="relative h-full w-full overflow-hidden">
      <h1 className="sr-only">{appConfig.appTitle}</h1>
      <BuildingScene />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-start p-2 sm:p-4">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <ViewModeToggle />
            <CameraModeToggle />
          </div>
          <NavigationHint />
          <RemoteControl />
        </div>
      </div>
      <DebugPanel visible={appConfig.showDebugPanel} />
    </main>
  );
}
