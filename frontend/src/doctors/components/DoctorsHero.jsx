import { motion } from 'framer-motion';
import DoctorBenefits from './DoctorBenefits';
import DoctorVisualization from './DoctorVisualization';
import HeroActions from './HeroActions';
import { fadeUp, fadeUpBlur, stagger } from '../../landing/motion';

/**
 * Two columns from lg: the case on the left, the clinician at work on the
 * right. Below lg the same content stacks — the whole argument first, then the
 * illustration at full width — because at tablet width the side-by-side
 * version leaves both halves too narrow: small text beside a small picture.
 *
 * The left column is capped at a readable measure rather than filling its
 * half — the benefit rows lose their rhythm once the lines get long.
 */
export default function DoctorsHero({ onTryDemo, onWatchVideo }) {
  return (
    <div className="mx-auto grid w-full max-w-shell grid-cols-1 items-center gap-10 md:gap-12 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)] lg:gap-0">
      <motion.div
        variants={stagger(0.1, 0.05)}
        initial="hidden"
        animate="show"
        className="nv-text-halo relative z-10 min-w-0 max-w-[800px] md:max-w-[680px] lg:max-w-[800px]"
      >
        <motion.p
          variants={fadeUp}
          className="text-[12px] font-semibold uppercase tracking-[0.26em] text-[#5B8BD0]"
        >
          Built for Clinicians
        </motion.p>

        {/* Phone: ~32px at 320 up to ~40px at 430. Tablet: a fixed 42px.
            From lg: the original desktop scale. On a phone the blue clause is
            broken after "Handle" so it sets as two even lines instead of
            leaving "Complexity." stranded on its own. */}
        <motion.h1
          variants={fadeUpBlur}
          className="mt-4 text-[clamp(2rem,6.4vw+0.55rem,2.6rem)] font-bold leading-[1.1] tracking-[-0.022em] text-ink md:text-[2.625rem] md:leading-[1.08] lg:text-[clamp(2rem,2.5vw+1rem,3.15rem)]"
        >
          Focus on Patients,
          <br />
          Let{' '}
          <span className="text-brand">
            AI Handle
            <br className="sm:hidden" /> the Complexity.
          </span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="mt-5 max-w-[56ch] text-[16px] leading-[1.65] text-ink-soft lg:text-[15.5px] lg:leading-relaxed"
        >
          NeuroVision AI helps doctors analyze brain MRI scans faster, visualize affected regions in
          3D, and get clear, structured reports — so you can make more informed decisions with
          confidence.
        </motion.p>

        <DoctorBenefits />
        <HeroActions onTryDemo={onTryDemo} onWatchVideo={onWatchVideo} />
      </motion.div>

      {/* From lg a negative margin closes the gap and lets the illustration
          run under the text column; the halo above keeps the words readable
          there. Stacked, it is centred and capped so it stays sharp. */}
      <div className="mx-auto w-full min-w-0 max-w-[760px] lg:-ml-4 lg:w-auto lg:max-w-none xl:-ml-24">
        <DoctorVisualization />
      </div>
    </div>
  );
}
