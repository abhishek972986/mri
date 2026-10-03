import { motion } from 'framer-motion';
import { BarChart3, Box, ClipboardCheck, Ruler } from 'lucide-react';
import { fadeUp, hoverLiftSm, stagger } from '../../landing/motion';

/*
 * Facts the project can back: the model's own validation figure (read from
 * the checkpoint, and only for the glioma cases it was validated on), the
 * pipeline's measurement grid, and the workflow. No accuracy or speed-up
 * claim appears here that the evidence does not support.
 */
const METRICS = [
  { icon: BarChart3, value: '0.80', label: 'Validation Dice · BraTS glioma', tone: 'bg-[#E3EEFD] text-[#1F6FE0]' },
  { icon: Ruler, value: '1 mm', label: 'Isotropic measurement grid', tone: 'bg-[#E3EEFD] text-[#1F6FE0]' },
  { icon: Box, value: '3D', label: 'Interactive Visualization', tone: 'bg-[#E4EFFB] text-[#3B82C4]' },
  { icon: ClipboardCheck, value: 'Every', label: 'Report reviewed by a clinician', tone: 'bg-[#E0F4EA] text-[#12A06F]' },
];

/** The closing band of figures under the feature section. */
export default function MetricsBar() {
  return (
    <motion.section
      variants={fadeUp}
      whileHover={hoverLiftSm}
      className="nv-lift mx-auto w-full max-w-[1320px] rounded-[26px] border border-[#E2ECFA] bg-white/70 px-3 py-5 shadow-card backdrop-blur-xl sm:px-6"
    >
      <motion.ul
        variants={stagger(0.08, 0.1)}
        className="grid grid-cols-1 gap-y-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        {METRICS.map(({ icon: Icon, value, label, tone }, i) => (
          <motion.li
            key={label}
            variants={fadeUp}
            className={`flex items-center gap-4 px-2 sm:px-4 ${
              i > 0 ? 'lg:border-l lg:border-[#E4EDF9]' : ''
            } ${i === 2 ? 'sm:border-l-0 lg:border-l' : ''} ${
              i % 2 === 1 ? 'sm:border-l sm:border-[#E4EDF9]' : ''
            }`}
          >
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tone}`}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span className="block text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink">
                {value}
              </span>
              <span className="block text-[13.5px] leading-snug text-ink-soft">{label}</span>
            </span>
          </motion.li>
        ))}
      </motion.ul>
    </motion.section>
  );
}
