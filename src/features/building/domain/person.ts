/**
 * Body sizes of the person who explores the building.
 *
 * The person is a size of the explorer, not of the building, so these values
 * live apart from the building dimensions in `FLOOR_HEIGHTS`. Every body size,
 * such as the eye height the cameras use, must be read from
 * {@link PERSON_SPEC} rather than redeclared.
 *
 * All values are expressed in metres.
 */

/** Body sizes of the explorer's person, metres. */
export interface PersonSpec {
  /** Standing height, from the finished floor to the top of the head. */
  readonly height: number;
  /** Height of the eyes above the finished floor. */
  readonly eyeHeight: number;
}

const PERSON_HEIGHT_METRES = 1.8;
const PERSON_EYE_HEIGHT_METRES = 1.68;

/** The 1.80 m person; eyes at 1.68 m (owner answer). Frozen. */
export const PERSON_SPEC: PersonSpec = Object.freeze({
  height: PERSON_HEIGHT_METRES,
  eyeHeight: PERSON_EYE_HEIGHT_METRES,
});
