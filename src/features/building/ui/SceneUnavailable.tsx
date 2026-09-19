/** Why the building is not on screen. */
type SceneUnavailableReason = 'webgl-unsupported' | 'scene-failed';

/** Props of {@link SceneUnavailable}. */
interface SceneUnavailableProps {
  /** Which of the two failures put this panel here. */
  readonly reason: SceneUnavailableReason;
}

/** What each failure is called and what the viewer can do about it. */
const MESSAGES: Readonly<Record<SceneUnavailableReason, { title: string; advice: string }>> =
  Object.freeze({
    'webgl-unsupported': {
      title: '3D view unavailable',
      advice:
        'This browser cannot open the WebGL context the building is drawn with. Try a current version of Chrome, Edge, Firefox or Safari, and check that hardware acceleration is switched on in its settings.',
    },
    'scene-failed': {
      title: '3D view stopped',
      advice:
        'Something went wrong while drawing the building, so the view was stopped. Reload the page to start it again; if it stops a second time, the graphics driver of this device is the likeliest cause.',
    },
  });

/**
 * Covers the canvas area when there is no building to show.
 *
 * Two failures end here: a browser that has no WebGL at all
 * (`detectWebGLSupport`), and a scene that threw while rendering
 * (`SceneErrorBoundary`). Each gets its own heading and its own sentence, because the two
 * ask different things of the viewer — one is "this browser cannot", the other is "try
 * again" — and one shared apology would be useless for both.
 *
 * **Plain DOM: this file imports no three.js and no `@react-three/fiber`.** It is what is
 * shown when that whole stack is unavailable or has just failed, so pulling it in would make
 * the fallback depend on the thing that broke — and, with the scene on its own lazy chunk,
 * would drag the megabyte behind it back into the shell.
 *
 * **It carries no `role="status"`, deliberately.** The HUD rations that role to exactly one
 * element, the view status of `ViewModeToggle`: the end-to-end screenshot helper and several
 * `getByRole('status')` queries all assume a single one, and a second would make every one of
 * them ambiguous. Nothing is lost — this panel is not an update to something already on
 * screen, it is the screen, and it is read where it stands.
 *
 * Styled with the HUD's own panel classes (`NavigationHint`, `RoomMenu`), centred over the
 * area the canvas would have filled; white on `slate-900` clears WCAG AA comfortably at this
 * size. There is nothing to operate, so there is no target to size.
 *
 * @param props - {@link SceneUnavailableProps}
 * @returns The panel explaining why the building is not drawn.
 */
export function SceneUnavailable({ reason }: SceneUnavailableProps) {
  const { title, advice } = MESSAGES[reason];

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="max-w-md rounded-lg bg-slate-900 px-2 py-1 text-white shadow-lg sm:px-4 sm:py-2">
        <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
        <p className="mt-1 text-xs sm:text-sm">{advice}</p>
      </div>
    </div>
  );
}
