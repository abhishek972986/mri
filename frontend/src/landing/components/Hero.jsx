import { motion } from 'framer-motion';
import BrainVisualization from './BrainVisualization';
import ChallengeCard from './ChallengeCard';
import ImpactCard from './ImpactCard';
import { fadeUp, fadeUpBlur, stagger } from '../motion';

/**
 * The whole page above the fold: copy left, render centre, outcomes right.
 *
 * The grid is explicit about row and column placement rather than relying on
 * source order, because the two do not agree. On a phone the render has to
 * follow the headline and precede both panels — it is the thing worth
 * scrolling for — while on a desktop it sits between them and spans both rows.
 */
/* max-w is the 1440px shell plus the widest gutter, since this one element
   carries both. */
export default function Hero({ videoSrc }) {
  return (
    <motion.section
      variants={stagger(0.12, 0.15)}
      initial="hidden"
      animate="show"
      className="nv-gutter mx-auto grid w-full max-w-[1552px] grid-cols-1 items-start gap-8 pt-6 md:grid-cols-2 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.5fr)_minmax(0,0.92fr)] lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-8 lg:pt-4 xl:gap-x-10"
    >
      {/* --- headline block ------------------------------------------------ */}
      <div className="md:col-span-2 lg:col-span-1 lg:col-start-1 lg:row-start-1">
        <motion.div variants={fadeUp} className="flex items-center gap-3">
          <span aria-hidden className="h-[2px] w-9 rounded-full bg-brand" />
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
            AI for a Healthier Tomorrow
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUpBlur}
          className="mt-4 text-[clamp(2.1rem,3.2vw+0.5rem,2.6rem)] font-bold leading-[1.06] tracking-[-0.022em] text-ink xl:text-[2.5rem] 2xl:text-[2.95rem]"
        >
          {/* The reference stacks this in three lines. The column is only wide
              enough to hold "Turn Brain Scans" intact from xl up, so below that
              the first clause is left to wrap on its own rather than forced
              into a line that would overrun the column and meet the render. */}
          Turn Brain Scans
          <br className="hidden xl:inline" /> Into Clearer
          <br />
          <span className="text-brand">Answers</span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft lg:text-[15.5px]"
        >
          NeuroVision AI uses advanced AI to analyze brain MRI scans, detect abnormalities, and
          visualize affected regions in 3D — helping doctors make faster, more accurate decisions.
        </motion.p>
      </div>

      {/* --- central render ------------------------------------------------ */}
      <div className="md:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <BrainVisualization videoSrc={videoSrc} />
      </div>

      {/* --- challenge panel ------------------------------------------------ */}
      <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
        <ChallengeCard />
      </div>

      {/* --- impact panel ---------------------------------------------------- */}
      <div className="lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:mt-10 lg:self-start">
        <ImpactCard />
      </div>
    </motion.section>
  );
}
