import { lazy, Suspense, useEffect, useState } from 'react';
import { useViewStore } from '../features/building/application/viewStore.ts';
import { CameraModeToggle } from '../features/building/ui/CameraModeToggle.tsx';
import { FloorCountStepper } from '../features/building/ui/FloorCountStepper.tsx';
import { LayerSwitcher } from '../features/building/ui/LayerSwitcher.tsx';
import { Minimap } from '../features/building/ui/Minimap.tsx';
import { NavigationHint } from '../features/building/ui/NavigationHint.tsx';
import { OrbitPad } from '../features/building/ui/OrbitPad.tsx';
import { RemoteControl } from '../features/building/ui/RemoteControl.tsx';
import { RoomInfoPanel } from '../features/building/ui/RoomInfoPanel.tsx';
import { SceneErrorBoundary } from '../features/building/ui/SceneErrorBoundary.tsx';
import { SceneLoading } from '../features/building/ui/SceneLoading.tsx';
import { SceneUnavailable } from '../features/building/ui/SceneUnavailable.tsx';
import { detectWebGLSupport } from '../features/building/ui/webglSupport.ts';
import { RoomMenu } from '../features/building/ui/RoomMenu.tsx';
import { RoomReadout } from '../features/building/ui/RoomReadout.tsx';
import { usePrefersReducedMotion } from '../features/building/ui/usePrefersReducedMotion.ts';
import { ViewModeToggle } from '../features/building/ui/ViewModeToggle.tsx';
import { appConfig } from './config.ts';

/**
 * The 3D scene, loaded on its own chunk.
 *
 * Every HUD panel above is three.js-free; the whole 3D payload — three, `@react-three/fiber`,
 * drei and the building model — is reachable only through `BuildingScene`, so this one dynamic
 * import is what separates the shell from the megabyte behind it. Statically imported it made a
 * single 1.4 MB entry chunk (402 kB gzipped), and the HUD could not paint until all of it had
 * parsed. The budget in `tooling/bundleBudget.ts` is what keeps it that way: it asserts on the
 * *initial* set — the entry plus what it statically imports — so a stray top-level import of
 * anything under the scene would fail `pnpm size` rather than quietly rejoin the two.
 */
const BuildingScene = lazy(() =>
  import('../features/building/ui/BuildingScene.tsx').then((module) => ({
    default: module.BuildingScene,
  })),
);

/**
 * The Leva tweak panel, loaded on its own chunk and hidden unless it is wanted.
 *
 * Lazy so that Leva is not in the initial chunk — it is development furniture and a visitor
 * should not wait for it.
 *
 * **It is always mounted, and that is load-bearing.** Leva injects a panel of its own the
 * moment anything calls `useControls` without a `<Leva>` root in the tree, and `SceneLighting`
 * does exactly that (ADR-009). The injected panel arrives uncollapsed and positioned over the
 * HUD, where at a phone width it sits on top of the view toggle and swallows its clicks. So
 * the mount suppresses Leva's own panel and the `visible` prop decides whether ours is shown;
 * gating the mount on the flag looks like a tidier saving and silently hands the page back to
 * Leva. `DebugPanel`'s own docblock says so, and this comment exists because that was not
 * enough to stop it happening once.
 *
 * Mounting it costs no bytes a visitor would otherwise avoid: `SceneLighting` imports Leva
 * regardless, so it travels with the scene chunk either way.
 */
const DebugPanel = lazy(() =>
  import('../features/building/ui/DebugPanel.tsx').then((module) => ({
    default: module.DebugPanel,
  })),
);

/**
 * Root component: a full-screen 3D scene with a HUD overlay on top.
 *
 * The HUD is one top-left stack — status, toggles and the floor stepper, the room menu, the
 * room panel and the layer switcher, the navigation hint, the room readout, the minimap, then
 * the pad of the current view — and the DOM order is the Tab order: the view region comes
 * first (inside `BuildingScene`, before this overlay), then the view toggle, the camera
 * toggle, the stepper's "Remove a floor" and "Add a floor", "Go to room", "About this room",
 * "Layers", and the pad buttons. The readout, the stepper's own reading and the minimap are
 * not tab stops; they are read, not operated.
 *
 * **Every panel sits inside the one overlay div, and that div carries `data-hud-overlay`.**
 * That attribute is a **test contract**, not decoration: the end-to-end screenshot helper
 * (`tests/e2e/sceneCapture.ts`) finds the HUD by this exact string and hides it before every
 * frame comparison, and the stylesheet that hides it keys on the same string, so locator and
 * rule cannot drift apart. It is deliberately a production attribute, in the same family as
 * `data-camera-transition` on the view region (`ui/BuildingScene.tsx`, the gate that stops a
 * screenshot mid-flight) and `data-plan-x` / `data-plan-z` on the minimap marker
 * (`ui/Minimap.tsx`, how a walking test reads a live coordinate). **Do not remove it while
 * refactoring this markup.** Nothing would break loudly: the readout, the minimap and a held
 * pad button all change as the viewer walks, so an unhidden HUD makes a frame comparison pass
 * on its own pixels — every screenshot baseline would silently start comparing the HUD again,
 * and the scene it is meant to compare would go unchecked.
 *
 * Each panel decides for itself whether the current view wants it, so they are all mounted
 * unconditionally: the readout is `sr-only` and out of flow while there is nothing to announce,
 * the menu, hint, minimap and remote control render nothing outside the interior, and the orbit
 * pad renders nothing outside the exterior. The floor stepper and the layer switcher are the
 * two panels with no such branch at all: how tall the building is and how it is layered are as
 * much facts of the exterior it is seen from as of the interior it is walked in. The switcher
 * joins the row the room menu and the room panel share, where the exterior leaves it the only
 * panel and the interior has the width for a third trigger a single word wide; its nine
 * checkboxes never enter that flow, because the panel they live in is `absolute` and
 * `z-30` — z-30 and not the z-20 every other overlay uses, because the hold-to-act pads
 * are z-20 and come later in the DOM, so at equal z they paint over it and its first
 * checkbox cannot be clicked at all.
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
 * The scene is wrapped rather than merely lazied, and each layer answers a different failure:
 * the capability check decides before anything is fetched, the boundary catches a render-phase
 * throw and a chunk that will not load — which the deploy of ADR-018 makes reachable, since a
 * client holding a cached `index.html` can ask for a hashed chunk a later release has pruned —
 * and the Suspense fallback covers the wait in between. Without the boundary a rejected
 * `import()` unmounts the whole root and takes the HUD with it.
 *
 * @returns The application shell.
 */
export function App() {
  const prefersReducedMotion = usePrefersReducedMotion();
  // Asked once for the life of the page, and asked BEFORE the lazy subtree renders: a browser
  // that cannot draw the scene must not download it. `detectWebGLSupport` reports the
  // unsupported case itself, so there is nothing to report here.
  const [webglSupport] = useState(detectWebGLSupport);
  const setPrefersReducedMotion = useViewStore((state) => state.setPrefersReducedMotion);

  useEffect(() => {
    setPrefersReducedMotion(prefersReducedMotion);
  }, [prefersReducedMotion, setPrefersReducedMotion]);

  return (
    <main className="relative h-full w-full overflow-hidden">
      <h1 className="sr-only">{appConfig.appTitle}</h1>
      {webglSupport === 'unsupported' ? (
        <SceneUnavailable reason="webgl-unsupported" />
      ) : (
        <SceneErrorBoundary>
          <Suspense fallback={<SceneLoading />}>
            <BuildingScene />
          </Suspense>
        </SceneErrorBoundary>
      )}
      <div
        data-hud-overlay=""
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-start p-2 sm:p-4"
      >
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <ViewModeToggle />
            <CameraModeToggle />
            <FloorCountStepper />
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <RoomMenu />
            <RoomInfoPanel />
            <LayerSwitcher />
          </div>
          <NavigationHint />
          <RoomReadout />
          <Minimap />
          <RemoteControl />
          <OrbitPad />
        </div>
      </div>
      <Suspense fallback={null}>
        <DebugPanel visible={appConfig.showDebugPanel} />
      </Suspense>
    </main>
  );
}
