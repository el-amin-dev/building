import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExplorerPoseStore } from '../application/explorerPoseStore.ts';
import { useFloorCountStore } from '../application/floorCountStore.ts';
import { useRoomWalkStore } from '../application/roomWalkStore.ts';
import { useViewStore } from '../application/viewStore.ts';
import type { EyePose } from '../domain/eyeNavigation.ts';
import { FLOOR_PLAN } from '../domain/floorPlan/index.ts';
import type { SpaceId } from '../domain/floorPlan/index.ts';
import { makeFloorSpaceRef } from '../domain/floorSpace.ts';
import { getSlabs } from '../domain/slabs.ts';
import { MIN_FLOOR_COUNT } from '../domain/storeys.ts';
import { INTERIOR_REGION_ID } from './hudIds.ts';
import { Minimap } from './Minimap.tsx';
import { MINIMAP_SAMPLE_INTERVAL_MS, getMinimapShapes } from './minimapShapes.ts';

/**
 * The storey the explorer is on in most tests.
 *
 * Not the ground floor: `F1-` and `Floor 1 of …` are what a minimap that ignored the storey
 * would print anyway, so every assertion below would pass on a component that read nothing.
 */
const CURRENT_FLOOR = 3;

/** How many storeys the stack has in most tests, so `Floor 3 of 7` has both numbers real. */
const FLOOR_COUNT = 7;

/** A second storey, to show the highlight and the name follow the viewer up the stairs. */
const OTHER_FLOOR = 5;

/** A point inside the kitchen's east rect (x 12.20–14.10, z 5.80–8.60). */
const IN_KITCHEN: EyePose = Object.freeze({
  x: 13,
  z: 7,
  yaw: -Math.PI / 2,
  pitch: 0,
  floor: CURRENT_FLOOR,
  rise: 0,
});

/** The same spot one storey up: the same drawing, a different place. */
const IN_KITCHEN_UPSTAIRS: EyePose = Object.freeze({ ...IN_KITCHEN, floor: OTHER_FLOOR });

/** The same room, half a metre on: a pose change with no room change. */
const FURTHER_IN_KITCHEN: EyePose = Object.freeze({ ...IN_KITCHEN, x: 13.5 });

/** The same spot, turned about-face: a heading change with no room change and no step. */
const TURNED_IN_KITCHEN: EyePose = Object.freeze({ ...IN_KITCHEN, yaw: Math.PI / 2 });

/** A point inside the corridor's first rect (x 5.60–20.20, z 4.00–5.50). */
const IN_CORRIDOR: EyePose = Object.freeze({
  x: 10,
  z: 4.5,
  yaw: 0,
  pitch: 0,
  floor: CURRENT_FLOOR,
  rise: 0,
});

/** What the label says once the explorer stands in the kitchen facing +x. */
const KITCHEN_SUMMARY =
  'Floor 3 of 7 minimap. You are in F3-R11/KIT · Kitchen, facing toward side D.';

/** What it says after the about-face, which points the eye the other way along x. */
const TURNED_KITCHEN_SUMMARY =
  'Floor 3 of 7 minimap. You are in F3-R11/KIT · Kitchen, facing toward side A.';

/**
 * What it says in the interior view before the first room resolves.
 *
 * The storey is named even here: the pose store knows which floor the viewer is on before
 * any room resolves, and the drawing has to say which storey it is of either way. The ground
 * floor is the fallback, because no pose has placed the viewer yet.
 */
const UNKNOWN_SUMMARY = 'Floor 1 of 7 minimap. Your position on the floor is not known yet.';

/** The visible chip above the drawing, saying the same storey the name opens with. */
const FLOOR_CHIP_TEXT = 'Floor 3 of 7';

/** The highlight the room the explorer is in wears. */
const CURRENT_ROOM_CLASS = 'fill-amber-400';

/** The id of the region the pointer hands focus back to, as a test stand-in. */
const REGION_TEST_ID = 'interior-region';

/** `tabIndex` making that stand-in focusable, as the real view region is. */
const FOCUSABLE_TAB_INDEX = 0;

/** The classes that keep the minimap off a phone-width screen. */
const PHONE_HIDDEN_CLASS = 'hidden';
const TABLET_SHOWN_CLASS = 'sm:block';

/** Timestamps handed to the frame loop, in milliseconds. */
const FIRST_FRAME_MS = 0;
const WITHIN_INTERVAL_MS = MINIMAP_SAMPLE_INTERVAL_MS / 2;
const AFTER_INTERVAL_MS = MINIMAP_SAMPLE_INTERVAL_MS;
const SECOND_INTERVAL_MS = MINIMAP_SAMPLE_INTERVAL_MS * 2;

const NO_CALLS = 0;

/** The animation frame the minimap is waiting on, and the handles it has cancelled. */
let pendingFrame: FrameRequestCallback | undefined;
let lastHandle: number;
let cancelledHandles: number[];

/** Runs the frame the minimap asked for, at `time`; it immediately asks for the next. */
function runFrame(time: number): void {
  const frame = pendingFrame;
  if (frame === undefined) {
    throw new Error('the minimap is not waiting on an animation frame');
  }
  pendingFrame = undefined;
  act(() => {
    frame(time);
  });
}

function enterInterior(): void {
  act(() => {
    useViewStore.getState().toggleViewMode();
  });
}

/** Reports a pose through the real channel, which also resolves the room. */
function standAt(pose: EyePose): void {
  act(() => {
    useExplorerPoseStore.getState().reportPose(pose);
  });
}

/** The minimap's viewer marker: the only group in the drawing. */
function marker(): SVGGElement {
  const element = document.querySelector('g');
  if (element === null) {
    throw new Error('the minimap drew no viewer marker');
  }
  return element;
}

/** The rectangle drawn for the first shape of `spaceId`. */
function roomRect(spaceId: SpaceId): Element {
  const index = getMinimapShapes(FLOOR_PLAN).findIndex((shape) => shape.spaceId === spaceId);
  const rects = document.querySelectorAll('rect');
  const rect = rects[index];
  if (rect === undefined) {
    throw new Error(`the minimap drew no rectangle for "${spaceId}"`);
  }
  return rect;
}

/** Every rectangle drawn for `spaceId`, which is several for a space of several rects. */
function roomRects(spaceId: SpaceId): readonly Element[] {
  const shapes = getMinimapShapes(FLOOR_PLAN);
  const rects = [...document.querySelectorAll('rect')];
  return rects.filter((_rect, index) => shapes[index].spaceId === spaceId);
}

/** The arrow showing the heading: the only polygon in the drawing. */
function arrow(): Element {
  const element = document.querySelector('polygon');
  if (element === null) {
    throw new Error('the minimap drew no heading arrow');
  }
  return element;
}

/** Renders a focusable stand-in for the interior region before the minimap, as in the app. */
function renderWithRegion(): HTMLElement {
  render(
    <>
      <div id={INTERIOR_REGION_ID} data-testid={REGION_TEST_ID} tabIndex={FOCUSABLE_TAB_INDEX} />
      <Minimap />
    </>,
  );
  return screen.getByTestId(REGION_TEST_ID);
}

describe('Minimap', () => {
  beforeEach(() => {
    pendingFrame = undefined;
    lastHandle = 0;
    cancelledHandles = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      lastHandle += 1;
      return lastHandle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      cancelledHandles.push(handle);
      pendingFrame = undefined;
    });

    useViewStore.setState(useViewStore.getInitialState(), true);
    useRoomWalkStore.setState(useRoomWalkStore.getInitialState(), true);
    useExplorerPoseStore.setState(useExplorerPoseStore.getInitialState(), true);
    useFloorCountStore.setState(useFloorCountStore.getInitialState(), true);
    useFloorCountStore.getState().setFloorCount(FLOOR_COUNT);
    useExplorerPoseStore.getState().clearPose();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws nothing in the exterior view, where the whole floor is already on screen', () => {
    const { container } = render(<Minimap />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('img')).toBeNull();
    // No marker to move, so no frame loop either.
    expect(pendingFrame).toBeUndefined();
  });

  it('stays off a phone-width screen and appears from the sm breakpoint up', () => {
    render(<Minimap />);
    enterInterior();

    const panel = screen.getByRole('img').parentElement;

    expect(panel).toHaveClass(PHONE_HIDDEN_CLASS);
    expect(panel).toHaveClass(TABLET_SHOWN_CLASS);
  });

  it('wears the HUD panel look', () => {
    render(<Minimap />);
    enterInterior();

    expect(screen.getByRole('img').parentElement).toHaveClass('bg-slate-900');
  });

  it('says something short and true before the first room resolves', () => {
    render(<Minimap />);

    enterInterior();

    expect(screen.getByRole('img')).toHaveAccessibleName(UNKNOWN_SUMMARY);
  });

  it('names the room and the heading, because a dot on a map says nothing aloud', () => {
    render(<Minimap />);
    enterInterior();

    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    expect(screen.getByRole('img')).toHaveAccessibleName(KITCHEN_SUMMARY);
  });

  it('names the room without a heading until the first pose has been sampled', () => {
    render(<Minimap />);
    enterInterior();

    // The room resolves from the report; the heading arrives with the next frame. Said
    // short rather than guessed at in between.
    standAt(IN_KITCHEN);

    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Floor 3 of 7 minimap. You are in F3-R11/KIT · Kitchen.',
    );
  });

  it('carries the same summary in a title, for a pointer user hovering it', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    expect(document.querySelector('title')).toHaveTextContent(KITCHEN_SUMMARY);
  });

  it('re-announces the heading when the room changes', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    standAt(IN_CORRIDOR);
    runFrame(AFTER_INTERVAL_MS);

    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Floor 3 of 7 minimap. You are in F3-R07/COR · Corridor, facing toward side C.',
    );
  });

  it('re-announces the heading when the eye turns in place, in the same room', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);
    expect(screen.getByRole('img')).toHaveAccessibleName(KITCHEN_SUMMARY);

    // An about-face without a step. The name used to be frozen at the last room change, so
    // a screen-reader user was told the old heading as current fact.
    standAt(TURNED_IN_KITCHEN);
    runFrame(AFTER_INTERVAL_MS);

    expect(screen.getByRole('img')).toHaveAccessibleName(TURNED_KITCHEN_SUMMARY);
  });

  it('leaves the name alone while the eye turns inside one heading bucket', () => {
    let renders = 0;
    render(
      <Profiler
        id="minimap"
        onRender={() => {
          renders += 1;
        }}
      >
        <Minimap />
      </Profiler>,
    );
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);
    const rendersBefore = renders;

    // A step with no turn: same bucket, same words, so no render is asked for at all —
    // which is what keeps eight buckets from costing sixty renders a second.
    standAt(FURTHER_IN_KITCHEN);
    runFrame(AFTER_INTERVAL_MS);

    expect(screen.getByRole('img')).toHaveAccessibleName(KITCHEN_SUMMARY);
    expect(renders).toBe(rendersBefore);
  });

  it('draws one rectangle per floor slab', () => {
    render(<Minimap />);
    enterInterior();

    expect(document.querySelectorAll('rect')).toHaveLength(getSlabs(FLOOR_PLAN).length);
  });

  it('hides every rectangle from assistive technology, which is told the summary instead', () => {
    render(<Minimap />);
    enterInterior();

    for (const rect of document.querySelectorAll('rect')) {
      expect(rect).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('keeps hairlines from being multiplied by the viewBox', () => {
    render(<Minimap />);
    enterInterior();

    expect(roomRect('kitchen')).toHaveAttribute('vector-effect', 'non-scaling-stroke');
    expect(document.querySelector('polygon')).toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke',
    );
  });

  it('walks the explorer to a room they click', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);

    fireEvent.click(roomRect('kitchen'));

    expect(useRoomWalkStore.getState().target).toEqual(makeFloorSpaceRef(CURRENT_FLOOR, 'kitchen'));
    expect(useRoomWalkStore.getState().status).toBe('walking');
  });

  it('asks for the room that was clicked, not the first one', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);

    fireEvent.click(roomRect('utilityRoom'));

    expect(useRoomWalkStore.getState().target).toEqual(
      makeFloorSpaceRef(CURRENT_FLOOR, 'utilityRoom'),
    );
  });

  it('hands focus back to the view after a pick, so Escape still stops the walk', () => {
    const region = renderWithRegion();
    enterInterior();
    region.focus();

    // A rect is not focusable, so the pointer-down blurs the region; without the hand-back
    // Escape — one of the three ways to stop a walk — would do nothing until a Tab.
    fireEvent.click(roomRect('kitchen'));

    expect(useRoomWalkStore.getState().status).toBe('walking');
    expect(region).toHaveFocus();
  });

  it('highlights the room the explorer is in, every rectangle of it', () => {
    render(<Minimap />);
    enterInterior();

    standAt(IN_KITCHEN);

    for (const rect of roomRects('kitchen')) {
      expect(rect).toHaveClass(CURRENT_ROOM_CLASS);
    }
    expect(roomRect('corridor')).not.toHaveClass(CURRENT_ROOM_CLASS);
  });

  it('moves the highlight with the room', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);

    standAt(IN_CORRIDOR);

    expect(roomRect('corridor')).toHaveClass(CURRENT_ROOM_CLASS);
    expect(roomRect('kitchen')).not.toHaveClass(CURRENT_ROOM_CLASS);
  });

  it('keeps the arrow legible on the room it always stands on', () => {
    render(<Minimap />);
    enterInterior();

    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    // The marker is by definition inside the highlighted room, so an arrow wearing the
    // highlight's own fill read only by its hairline outline.
    expect(arrow()).not.toHaveClass(CURRENT_ROOM_CLASS);
    expect(arrow()).toHaveClass('fill-slate-900');
    expect(arrow()).toHaveClass('stroke-white');
    for (const rect of roomRects('kitchen')) {
      expect(rect).toHaveClass(CURRENT_ROOM_CLASS);
    }
  });

  it('hides the marker until a pose is known, so it never sits in the plot corner', () => {
    render(<Minimap />);
    enterInterior();

    expect(marker()).toHaveAttribute('visibility', 'hidden');

    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    expect(marker()).toHaveAttribute('visibility', 'visible');
  });

  it('places and aims the marker from the pose, in plan coordinates', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);

    runFrame(FIRST_FRAME_MS);

    expect(marker()).toHaveAttribute('transform', 'translate(13 7) rotate(90)');
    expect(marker()).toHaveAttribute('data-plan-x', '13');
    expect(marker()).toHaveAttribute('data-plan-z', '7');
    expect(marker()).toHaveAttribute('data-yaw', '-1.571');
  });

  it('samples the pose no more often than the sample interval', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    standAt(FURTHER_IN_KITCHEN);
    runFrame(WITHIN_INTERVAL_MS);
    expect(marker()).toHaveAttribute('transform', 'translate(13 7) rotate(90)');

    runFrame(AFTER_INTERVAL_MS);
    expect(marker()).toHaveAttribute('transform', 'translate(13.5 7) rotate(90)');
  });

  it('touches no attribute on a frame that would write the same transform', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    const setAttribute = vi.spyOn(marker(), 'setAttribute');
    runFrame(AFTER_INTERVAL_MS);

    expect(setAttribute).toHaveBeenCalledTimes(NO_CALLS);
  });

  it('moves the marker without re-rendering React', () => {
    let renders = 0;
    render(
      <Profiler
        id="minimap"
        onRender={() => {
          renders += 1;
        }}
      >
        <Minimap />
      </Profiler>,
    );
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);
    const before = marker().getAttribute('transform');
    const rendersBefore = renders;

    // A pose change inside the same room: the marker has to follow it, React must not hear
    // about it at all — that is the whole point of the non-reactive pose channel.
    standAt(FURTHER_IN_KITCHEN);
    runFrame(AFTER_INTERVAL_MS);

    expect(marker().getAttribute('transform')).not.toBe(before);
    expect(renders).toBe(rendersBefore);
  });

  it('keeps asking for frames while the interior view is open', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);

    runFrame(FIRST_FRAME_MS);
    runFrame(AFTER_INTERVAL_MS);

    expect(pendingFrame).toBeTypeOf('function');
  });

  it('cancels the loop when it unmounts', () => {
    const { unmount } = render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    unmount();

    expect(cancelledHandles).toContain(lastHandle);
    expect(pendingFrame).toBeUndefined();
  });

  it('cancels the loop when the interior view is left, and runs none in the exterior', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    act(() => {
      useViewStore.getState().toggleViewMode();
    });

    expect(cancelledHandles).toContain(lastHandle);
    expect(pendingFrame).toBeUndefined();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('draws the marker again after the interior view is re-entered', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    act(() => {
      useViewStore.getState().toggleViewMode();
    });
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(SECOND_INTERVAL_MS);

    expect(marker()).toHaveAttribute('transform', 'translate(13 7) rotate(90)');
    expect(marker()).toHaveAttribute('visibility', 'visible');
  });

  it('shows the storey above the drawing, which is the same on every floor', () => {
    render(<Minimap />);
    enterInterior();

    standAt(IN_KITCHEN);

    // The chip is the visible half of what the name opens with; the rectangles below it are
    // identical on all seven storeys, so only these words say which one is underfoot.
    expect(screen.getByText(FLOOR_CHIP_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(FLOOR_CHIP_TEXT);
  });

  it('keeps the chip out of the accessible tree, so the storey is not read twice', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);

    expect(screen.getByText(FLOOR_CHIP_TEXT)).toHaveAttribute('aria-hidden', 'true');
  });

  it('follows the viewer up the stairs, in the chip and in the name', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);

    standAt(IN_KITCHEN_UPSTAIRS);
    runFrame(AFTER_INTERVAL_MS);

    expect(
      screen.getByText(`Floor ${String(OTHER_FLOOR)} of ${String(FLOOR_COUNT)}`),
    ).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      `Floor ${String(OTHER_FLOOR)} of ${String(FLOOR_COUNT)} minimap. You are in F${String(OTHER_FLOOR)}-R11/KIT · Kitchen, facing toward side D.`,
    );
  });

  it('names the storey even before the position is known', () => {
    render(<Minimap />);

    enterInterior();

    // The floor is stated in both halves of the unresolved case: the drawing is of a storey
    // whether or not a pose has placed anyone on it.
    expect(screen.getByRole('img')).toHaveAccessibleName(UNKNOWN_SUMMARY);
    expect(
      screen.getByText(`Floor ${String(MIN_FLOOR_COUNT)} of ${String(FLOOR_COUNT)}`),
    ).toBeInTheDocument();
  });

  it('says the storey of a one-storey building too', () => {
    act(() => {
      useFloorCountStore.getState().setFloorCount(MIN_FLOOR_COUNT);
    });
    render(<Minimap />);
    enterInterior();

    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Floor 1 of 1 minimap. Your position on the floor is not known yet.',
    );
  });

  it('highlights nothing when the room resolved is on another storey', () => {
    render(<Minimap />);
    enterInterior();

    // Both halves of the identity have to match. The plan is one plan, so `kitchen` is a
    // room on every storey: matching the space id alone would light this drawing's kitchen
    // while the viewer stood in another one's.
    act(() => {
      useExplorerPoseStore.setState({
        currentSpace: makeFloorSpaceRef(OTHER_FLOOR, 'kitchen'),
        currentFloor: CURRENT_FLOOR,
      });
    });

    expect(roomRect('kitchen')).not.toHaveClass(CURRENT_ROOM_CLASS);
  });

  it('highlights the room when the storey matches as well as the space', () => {
    render(<Minimap />);
    enterInterior();

    act(() => {
      useExplorerPoseStore.setState({
        currentSpace: makeFloorSpaceRef(CURRENT_FLOOR, 'kitchen'),
        currentFloor: CURRENT_FLOOR,
      });
    });

    for (const rect of roomRects('kitchen')) {
      expect(rect).toHaveClass(CURRENT_ROOM_CLASS);
    }
  });

  it('stamps the storey drawn onto the walk a click asks for', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN_UPSTAIRS);

    fireEvent.click(roomRect('utilityRoom'));

    expect(useRoomWalkStore.getState().target).toEqual(
      makeFloorSpaceRef(OTHER_FLOOR, 'utilityRoom'),
    );
  });

  it('walks to the ground floor before a pose has said which storey it is on', () => {
    render(<Minimap />);
    enterInterior();

    fireEvent.click(roomRect('kitchen'));

    expect(useRoomWalkStore.getState().target).toEqual(
      makeFloorSpaceRef(MIN_FLOOR_COUNT, 'kitchen'),
    );
  });

  it('keeps the heading live now that the storey is in the name too', () => {
    render(<Minimap />);
    enterInterior();
    standAt(IN_KITCHEN);
    runFrame(FIRST_FRAME_MS);
    expect(screen.getByRole('img')).toHaveAccessibleName(KITCHEN_SUMMARY);

    // The storey is added to the same string the heading bucket rewrites, so it must not
    // have turned the heading back into a value frozen at the last room change.
    standAt(TURNED_IN_KITCHEN);
    runFrame(AFTER_INTERVAL_MS);

    expect(screen.getByRole('img')).toHaveAccessibleName(TURNED_KITCHEN_SUMMARY);
  });

  it('draws one storey of rectangles however tall the stack is', () => {
    render(<Minimap />);
    enterInterior();
    const atSevenStoreys = document.querySelectorAll('rect').length;

    act(() => {
      useFloorCountStore.getState().setFloorCount(MIN_FLOOR_COUNT);
    });

    // Every storey repeats the typical floor, so stacking copies of these rectangles would
    // cost ten times the panel height and show nothing new.
    expect(document.querySelectorAll('rect')).toHaveLength(atSevenStoreys);
    expect(atSevenStoreys).toBe(getSlabs(FLOOR_PLAN).length);
  });
});
