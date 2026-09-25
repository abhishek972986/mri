import { motion } from 'framer-motion';
import { fadeUp, fadeUpBlur, stagger } from '../../landing/motion';

/** Centred title block for the section. */
export default function HowItWorksHero() {
  return (
    <motion.header
      variants={stagger(0.1, 0.05)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
      className="nv-gutter mx-auto max-w-[860px] text-center"
    >
      <motion.p
        variants={fadeUp}
        className="text-[11.5px] font-semibold uppercase tracking-[0.32em] text-[#5B7BA6]"
      >
        How It Works
      </motion.p>

      <motion.h2
        variants={fadeUpBlur}
        className="mt-4 text-[clamp(1.8rem,3.4vw+1rem,3rem)] font-bold leading-[1.08] tracking-[-0.022em] text-ink"
      >
        From MRI Scan to Clearer Insights
      </motion.h2>

      <motion.p
        variants={fadeUp}
        className="mx-auto mt-4 max-w-[660px] text-[15px] leading-relaxed text-ink-soft sm:text-[15.5px]"
      >
        NeuroVision AI combines advanced AI with interactive 3D visualization to analyze brain MRI
        scans and help doctors make faster, more accurate decisions.
      </motion.p>
    </motion.header>
  );
}
