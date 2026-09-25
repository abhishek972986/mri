import { motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import { fadeUp, hoverLift } from '../motion';
import Button from './Button';

/** The closing line under the brain: the promise, restated in one sentence. */
export default function BottomCTA({ onExploreDemo }) {
  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      /* Runs on load rather than on scroll: on a short viewport this card
         starts below the fold, and a whileInView trigger would leave the page
         ending in blank space until the visitor happened to scroll. */
      animate="show"
      transition={{ delay: 0.55 }}
      whileHover={hoverLift}
      className="mx-auto flex w-full max-w-[820px] flex-col gap-5 nv-lift rounded-[26px] border border-white/80 bg-white/70 p-5 shadow-card backdrop-blur-xl sm:flex-row sm:items-center sm:gap-6 sm:p-6"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand to-[#3FA0FF] text-white shadow-brand">
        <Brain className="h-6 w-6" strokeWidth={1.7} />
      </span>

      <span aria-hidden className="hidden h-12 w-px bg-[#e2eaf7] sm:block" />

      <div className="min-w-0 flex-1">
        <h2 className="text-[20px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[23px]">
          Same Scans. <span className="text-brand">A Brighter Tomorrow.</span>
        </h2>
        <p className="mt-1 text-[14px] text-ink-soft">Powered by AI. Designed for People.</p>
      </div>

      <Button onClick={onExploreDemo} className="shrink-0">
        Explore Demo
      </Button>
    </motion.section>
  );
}
