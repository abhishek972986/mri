import { motion } from 'framer-motion';
import { fadeUp, fadeUpBlur, stagger } from '../../landing/motion';

/** Centred page title block. */
export default function FeaturesHero() {
  return (
    <motion.header
      variants={stagger(0.1, 0.1)}
      initial="hidden"
      animate="show"
      className="nv-gutter mx-auto max-w-[900px] pt-8 text-center lg:pt-10"
    >
      <motion.p
        variants={fadeUp}
        className="text-[11.5px] font-semibold uppercase tracking-[0.32em] text-[#5B7BA6]"
      >
        Features
      </motion.p>

      <motion.h1
        variants={fadeUpBlur}
        className="mt-4 text-[clamp(2rem,3.4vw+0.9rem,3.25rem)] font-bold leading-[1.08] tracking-[-0.022em] text-ink"
      >
        Explore. Understand. <span className="text-brand">Decide Better.</span>
      </motion.h1>

      <motion.p
        variants={fadeUp}
        className="mx-auto mt-4 max-w-[640px] text-[15px] leading-relaxed text-ink-soft sm:text-[16px]"
      >
        Powerful AI tools and interactive 3D visualization to make brain MRI analysis faster,
        simpler and more accurate.
      </motion.p>
    </motion.header>
  );
}
