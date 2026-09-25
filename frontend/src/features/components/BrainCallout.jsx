import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import { EASE } from '../../landing/motion';

const TONES = {
  focus: { border: 'border-[#F2D9B4]', title: 'text-[#0D1424]', bg: 'bg-white/90' },
  reference: { border: 'border-[#CFE0F8]', title: 'text-[#0D1424]', bg: 'bg-white/90' },
};

/**
 * A medical annotation label.
 *
 * It holds a fixed spot on the stage rather than following its region around,
 * because a label that swings with the model is unreadable while the model is
 * moving. The tether drawn by BrainStage does the tracking instead.
 */
const BrainCallout = forwardRef(function BrainCallout(
  { tone = 'focus', label, note, className = '', delay = 0 },
  ref,
) {
  const styles = TONES[tone] ?? TONES.focus;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE, delay }}
      className={`rounded-xl border ${styles.border} ${styles.bg} px-3 py-2 shadow-float backdrop-blur-sm ${className}`}
    >
      <p className={`text-[13px] font-bold leading-tight ${styles.title}`}>{label}</p>
      <p className="mt-0.5 text-[11.5px] leading-tight text-ink-faint">({note})</p>
    </motion.div>
  );
});

export default BrainCallout;
