/*
 * Shared motion presets. Kept in one place so every section rises from the
 * same distance at the same speed — the page should feel like one object
 * settling, not eight independent widgets animating.
 *
 * Two families, for two jobs:
 *  - Entrances run once on a tween with a long, soft tail (EASE). Arriving on
 *    the page should never wobble.
 *  - Interactions (hover, press) run on springs. That is where the soft,
 *    physical feel comes from; damping stays high enough that any overshoot
 *    is felt rather than seen.
 */

export const EASE = [0.22, 1, 0.36, 1];
export const EASE_SOFT = [0.16, 1, 0.3, 1];

export const SPRING = {
  /* Cards and panels: heavier, slower to settle. */
  card: { type: 'spring', stiffness: 260, damping: 24, mass: 0.9 },
  /* Buttons: quick to answer the pointer. */
  button: { type: 'spring', stiffness: 380, damping: 24, mass: 0.7 },
  /* Press: near-instant down; release rides the element's own spring. */
  press: { type: 'spring', stiffness: 700, damping: 34, mass: 0.5 },
  /* Arrows and small icons: a little looser, so they trail their button. */
  icon: { type: 'spring', stiffness: 420, damping: 18, mass: 0.5 },
};

export const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: EASE } },
};

/** Headlines: rise, fade and come into focus. */
export const fadeUpBlur = {
  hidden: { opacity: 0, y: 20, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.9, ease: EASE } },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.8, ease: EASE } },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.9, ease: EASE } },
};

/** Children of a container stagger in reading order. */
export const stagger = (staggerChildren = 0.08, delayChildren = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/** Cards lift a few pixels on hover, on a soft spring. */
export const hoverLift = {
  y: -4,
  transition: SPRING.card,
};

/** Smaller lift for dense items (metric tiles, list rows). */
export const hoverLiftSm = {
  y: -2,
  transition: SPRING.card,
};

/** Sideways nudge for list rows that point at something. */
export const hoverNudge = {
  x: 4,
  transition: SPRING.card,
};
