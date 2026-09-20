/**
 * The screenshots the README shows, captured from the running app on demand.
 *
 * **Not a test, and not part of any gate.** It writes files, which no test may do, so it is
 * skipped unless `CAPTURE_DOCS` is set and it asserts nothing about what it captures. Run it
 * with `pnpm capture:docs` after a change that alters what the app looks like.
 *
 * Why it does not reuse the committed baselines in `exterior.spec.ts`. Those are captures of
 * the canvas with the HUD hidden, pinned to `chromium-linux` and regenerated whenever the
 * geometry, the palette, the lighting or the camera moves. Using them as documentation images
 * would show a product with no interface at all, and would silently rewrite the README every
 * time a baseline is renewed — coupling a document to a fixture whose whole job is to change
 * when the scene does. These are separate captures, of the **whole page with the HUD visible**,
 * which is what a reader of the README is trying to see.
 *
 * What it does borrow is the settle rule: {@link captureSettledScene} waits for the camera
 * flight to finish and then for two consecutive frames to come back byte-identical, so a
 * documentation image is never a frame of a moving camera or a half-drawn scene. Software
 * WebGL can leave seconds between two frames, so that wait is the whole reason this is a
 * Playwright spec rather than a screenshot taken by hand.
 *
 * ## Why these three, now
 *
 * The default view is no longer the furnished floor, so leaving the sequence alone would have
 * produced three pictures of naked walls and a README in which **no image showed a service run
 * at all** — with the layer switcher the headline of the part that drew them. The three shots
 * are chosen so that between them a reader sees the control, the services and the finished
 * building, and each one shows something the other two do not:
 *
 * 1. `exterior.png` — the whole floor from outside, the six services ticked and the **panel
 *    open**. The one frame that shows the new control and what it does in the same picture,
 *    and the only viewpoint from which all 116 runs are visible at once.
 * 2. `interior-first-person.png` — standing inside, the same six services on over naked walls.
 *    The runs at eye level, in a room, which is what the exterior view flattens away.
 * 3. `room-menu.png` — third person with the room list open, `Furniture` and `Finishing` on
 *    and every service off. This is the v1.0.0 floor — the building as a place to be in rather
 *    than a set of runs — so the set does not lose the finished look while gaining the
 *    services, and it is still the shot that explains the room menu.
 *
 * The file names are fixed by the README, which names all three, so the set is improved in
 * place rather than renamed.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { CAMERA_TOGGLE_NAME, VIEW_TOGGLE_NAME } from './constants.ts';
import {
  closeLayerPanel,
  FURNISHED_LAYER_NAMES,
  openLayerPanel,
  SERVICE_LAYER_NAMES,
  setLayers,
} from './layerSwitcher.ts';
import { captureSettledScene, expectCanvasVisible, getViewRegion } from './sceneCapture.ts';

/** Where the README looks for them. Relative to the repository root, as Playwright runs from it. */
const IMAGE_DIRECTORY = path.join('docs', 'images');

/**
 * The viewport the documentation is shot at: wide enough for the desktop HUD, and the same
 * 16:9 the exterior framing is tuned for, so the building fills the frame the way ADR-008
 * describes rather than being cropped by an arbitrary window.
 */
const DOCS_VIEWPORT = { width: 1280, height: 720 };

/**
 * Captures write files, so they run only when asked for by name.
 *
 * Guarded at describe level rather than per test: a run that forgets the flag should do
 * nothing at all rather than three quarters of the job.
 */
const isCapturing = process.env.CAPTURE_DOCS === '1';

/**
 * Hides the two things a README image should not carry: the Leva tweak panel and the 3D
 * view's focus ring.
 *
 * **Leva** — the end-to-end build runs with the debug flag on, so it mounts, and it is a
 * development control for the lighting factors (ADR-009), not part of the product. A reader of
 * the README should see the HUD the app ships with and nothing else. The HUD itself stays
 * visible: that is the whole difference between these captures and the committed baselines,
 * which hide it.
 *
 * **The focus ring** — every HUD control hands focus to the 3D view region after a pointer
 * press (ADR-013), so that the navigation keys keep working, and the region draws its focus
 * indicator as an amber outline with a dark inset ring around its whole box. Since these
 * captures drive the HUD with a pointer, that box is the viewport: the ring frames all 1280 ×
 * 720 of every image. It is not wrong — it is what the app really paints — but a still picture
 * cannot convey focus anyway, so all it does is put a border on the picture and read as a
 * screenshot artefact. Hidden here for the same reason and in the same way `hideHud.css` hides
 * it for the baselines, and on the pseudo-element rather than the region, because the region is
 * the canvas's container.
 *
 * Nothing else is touched. The panels, their text and their pressed states are the product and
 * they stay.
 */
const HIDE_NON_PRODUCT = [
  '#leva__root { display: none !important; }',
  '#interior-3d-view::after { opacity: 0 !important; }',
].join('\n');

/**
 * Budget for the one capture test.
 *
 * `test.slow()` triples the 30 s default, which covered three settled scenes and nothing else.
 * This sequence also walks the layer switcher twice — eighteen checkbox states set through a
 * real pointer, each of which re-renders the scene and so waits on a software-rasterised frame
 * — so the work grew and the budget is stated rather than multiplied. Nothing here waits out
 * one of the app's own timings; it is an upper bound on how long a frame may take to arrive.
 */
const CAPTURE_TEST_TIMEOUT_MS = 300_000;

/** The disclosure the third shot is of, and the room whose row proves its list is really open. */
const ROOM_MENU_NAME = 'Go to room';
const KITCHEN_ITEM_NAME = 'R11/KIT · Kitchen';

test.describe('documentation screenshots', () => {
  test.skip(!isCapturing, 'set CAPTURE_DOCS=1 (pnpm capture:docs) to write the README images');
  test.use({ viewport: DOCS_VIEWPORT });

  test('captures the services, the runs from inside, and the finished floor', async ({ page }) => {
    // Every shot waits for a settled scene under a software rasteriser, three times over, and
    // the switcher is walked between them; the arithmetic is in the constant's docblock.
    test.setTimeout(CAPTURE_TEST_TIMEOUT_MS);
    await mkdir(IMAGE_DIRECTORY, { recursive: true });
    await page.goto('/');
    await expectCanvasVisible(page);

    // 1. The whole floor from outside, in the default frame the camera derives for this aspect,
    //    with the six services drawn over the naked walls and the switcher standing open beside
    //    them. The panel is opened AFTER the scene has settled: the ticks are what change the
    //    picture, and waiting with them already applied is what keeps the runs from being
    //    half-drawn in the file.
    await setLayers(page, SERVICE_LAYER_NAMES);
    await captureSettledScene(page);
    await openLayerPanel(page);
    await page.screenshot({
      path: path.join(IMAGE_DIRECTORY, 'exterior.png'),
      style: HIDE_NON_PRODUCT,
    });

    // 2. Standing inside, first person, at the stair arrival the interior always opens on —
    //    the same six services, so the runs are seen from within the rooms they serve rather
    //    than from above. The panel is shut first: it is still open from the shot before, and
    //    over the first-person view it would cover the corridor this picture is of.
    await closeLayerPanel(page);
    await page.getByRole('button', { name: VIEW_TOGGLE_NAME }).click();
    await expect(getViewRegion(page)).toBeVisible();
    await captureSettledScene(page);
    await page.screenshot({
      path: path.join(IMAGE_DIRECTORY, 'interior-first-person.png'),
      style: HIDE_NON_PRODUCT,
    });

    // 3. The room list open, which is the one piece of the HUD a still picture can explain,
    //    over the furnished and finished floor: the v1.0.0 building, which is what the other
    //    two shots no longer show. Third person first: a picture of a walk is more legible
    //    with the walker in it.
    await setLayers(page, FURNISHED_LAYER_NAMES);
    await page.getByRole('button', { name: CAMERA_TOGGLE_NAME }).click();
    await captureSettledScene(page);
    const roomMenu = page.getByRole('button', { name: ROOM_MENU_NAME });
    await roomMenu.click();
    // Wait for the list to be really open and then let the scene come back to rest before the
    // shutter. Shooting straight after the click caught the HUD mid-layout — the previous set
    // of images has a blank white panel under the list where the minimap should be — and a
    // documentation image of a half-drawn interface is worse than no image.
    await expect(roomMenu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: KITCHEN_ITEM_NAME })).toBeVisible();
    await captureSettledScene(page);
    await page.screenshot({
      path: path.join(IMAGE_DIRECTORY, 'room-menu.png'),
      style: HIDE_NON_PRODUCT,
    });
  });
});
