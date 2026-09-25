import { motion } from 'framer-motion';
import { EASE, hoverLift, SPRING } from '../motion';

const TONES = {
  blush: {
    card: 'border-blush-line/70 bg-[#fdf0f0]/85',
    title: 'text-[#d9434b]',
  },
  brand: {
    card: 'border-[#d8e6fb]/80 bg-[#edf4fe]/85',
    title: 'text-brand',
  },
};

/**
 * A label pinned beside the brain. Deliberately narrow: it annotates the
 * render, so it has to stay subordinate to it.
 */
export default function BrainCallout({ tone = 'brand', title, body, delay = 0, className = '' }) {
  const styles = TONES[tone] ?? TONES.brand;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      /* The entrance carries its own transition (and delay); the prop-level one
         is what hover returns on, so leaving hover settles immediately. */
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE, delay } }}
      transition={SPRING.card}
      whileHover={hoverLift}
      className={`nv-lift rounded-[18px] border px-4 py-3 shadow-float backdrop-blur-sm ${styles.card} ${className}`}
    >
      <h3 className={`text-[14px] font-bold leading-tight ${styles.title}`}>{title}</h3>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{body}</p>
    </motion.div>
  );
}
