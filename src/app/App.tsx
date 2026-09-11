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
 * @returns The application shell.
 */
export function App() {
  return (
    <main className="relative h-full w-full overflow-hidden">
      <h1 className="sr-only">{appConfig.appTitle}</h1>
      <BuildingScene />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-start p-4">
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
