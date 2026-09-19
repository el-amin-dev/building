/** The one line shown while the 3D chunk is on its way. */
const LOADING_TEXT = 'Loading the 3D view…';

/**
 * Suspense fallback for the lazily loaded scene.
 *
 * One neutral HUD panel with one sentence, centred over the area the canvas is about to
 * fill, wearing the same classes as every other panel so the shell does not change shape
 * when the building arrives.
 *
 * **No spinner, and no animation of any kind.** This codebase honours
 * `prefers-reduced-motion` everywhere it moves something (the camera flight, ADR in
 * `viewStore.ts`), and a spinner would either have to honour it too — a second branch, a
 * second thing to keep true — or quietly ignore it. A static line says exactly as much: the
 * view is loading, nothing is stuck.
 *
 * Like `SceneUnavailable`, it carries no `role="status"`: the HUD keeps exactly one, on the
 * view status of `ViewModeToggle`. It imports nothing from three.js, which is the point of a
 * fallback for a three.js chunk.
 *
 * @returns The loading panel.
 */
export function SceneLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <p className="max-w-md rounded-lg bg-slate-900 px-2 py-1 text-xs text-white shadow-lg sm:px-4 sm:py-2 sm:text-sm">
        {LOADING_TEXT}
      </p>
    </div>
  );
}
