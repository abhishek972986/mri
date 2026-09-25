import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { REGIONS } from '../brainRegions';
import { EASE } from '../../landing/motion';

/**
 * Segmented control over the cortical regions.
 *
 * The active pill is a shared layout element, so moving between regions slides
 * the highlight across rather than blinking it from one cell to the next.
 *
 * On a phone the pills wrap onto a second line instead of scrolling sideways,
 * so every region is visible and tappable at once; the "next" arrow is
 * dropped there because it has nothing left to reveal.
 */
export default function BrainRegionSelector({ value, onChange }) {
  const index = REGIONS.findIndex((r) => r.key === value);

  const step = () => {
    onChange(REGIONS[(index + 1) % REGIONS.length].key);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.55 }}
      className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-[24px] border border-[#E3EBF7] bg-white/85 p-1 shadow-soft backdrop-blur-xl sm:flex-nowrap sm:rounded-full"
    >
      {REGIONS.map((region) => {
        const active = region.key === value;
        return (
          <button
            key={region.key}
            type="button"
            onClick={() => onChange(region.key)}
            aria-pressed={active}
            className={`relative min-h-[40px] shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors duration-200 sm:px-4 ${
              active ? 'text-white' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {active && (
              <motion.span
                layoutId="nv-region-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                className="absolute inset-0 rounded-full bg-brand shadow-[0_6px_16px_rgba(22,119,232,0.35)]"
              />
            )}
            <span className="relative whitespace-nowrap">{region.label}</span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={step}
        aria-label="Next region"
        className="ml-0.5 hidden h-10 w-10 shrink-0 sm:grid place-items-center rounded-full text-ink-soft transition-colors duration-200 hover:bg-brand-soft hover:text-brand"
      >
        <ArrowRight className="h-4 w-4" strokeWidth={2} />
      </button>
    </motion.div>
  );
}
