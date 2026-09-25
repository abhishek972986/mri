import { useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

/** True while `query` matches. Read synchronously so the first render — and
    any `initial` animation state taken from it — is already the right one. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const sync = () => setMatches(list.matches);
    sync();
    list.addEventListener('change', sync);
    return () => list.removeEventListener('change', sync);
  }, [query]);

  return matches;
}

/**
 * How much the decorative loops on this page are allowed to move.
 *
 * `reduce` follows the visitor's reduced-motion setting: every continuous loop
 * (floats, pulses, scan lines, travelling dots, auto-rotation) checks it and
 * stays still. `compact` is a phone-width screen, where the same loops run at
 * a shorter distance — a 5px drift that reads as calm on a monitor reads as
 * wobble on a 375px screen held in the hand.
 */
export function useMotionPrefs() {
  const reduce = useReducedMotion() ?? false;
  const compact = useMediaQuery('(max-width: 767px)');
  return { reduce, compact };
}

/** A pointer that cannot hover: phones, tablets. */
export function useCoarsePointer() {
  return useMediaQuery('(pointer: coarse)');
}
