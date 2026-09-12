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
  /**
   * Radius of the body on the floor plan: half the width of the person seen
   * from above.
   *
   * The body is a circle on the plan, not a point, and this is its size. It
   * belongs here rather than in `heights.ts` for the reason stated above — it is
   * a size of the explorer, not of the building — and it is a plan size rather
   * than a vertical one, which is why it is the only member of this interface
   * that is not measured from the finished floor.
   *
   * Collision reads it as the distance the body keeps from every wall, hole and
   * railing (`collision.ts`), so it is also what decides which doors the person
   * fits through: a passage must be wider than `2 × radius`. The narrowest port
   * of the floor is 0.60 m, which leaves a 0.10 m window for a 0.50 m body.
   */
  readonly radius: number;
}

const PERSON_HEIGHT_METRES = 1.8;
const PERSON_EYE_HEIGHT_METRES = 1.68;

/**
 * Radius of the body on the plan, in metres: a 0.50 m shoulder width.
 *
 * Ordinary adult shoulders measure about 0.45–0.50 m across, so 0.25 is the
 * radius of the circle that contains them. It is deliberately not tuned to the
 * doors it has to pass: every port of this floor is wider than 0.50 m, so the
 * person fits through the plan rather than the plan being cut to the person.
 */
const PERSON_RADIUS_METRES = 0.25;

/** The 1.80 m person; eyes at 1.68 m, body radius 0.25 m (owner answer). Frozen. */
export const PERSON_SPEC: PersonSpec = Object.freeze({
  height: PERSON_HEIGHT_METRES,
  eyeHeight: PERSON_EYE_HEIGHT_METRES,
  radius: PERSON_RADIUS_METRES,
});
