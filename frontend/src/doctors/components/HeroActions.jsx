import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import TrustIndicator from './TrustIndicator';
import Button from '../../landing/components/Button';
import { fadeUp } from '../../landing/motion';

/**
 * Primary and secondary calls to action, plus the trust line beside them.
 *
 * On a phone the buttons stack at full width (big, easy thumb targets) and the
 * trust line centres beneath them. From sm the two buttons share a row at equal
 * width; from lg they size to their labels and the trust line sits beside them.
 */
export default function HeroActions({ onTryDemo, onWatchVideo }) {
  return (
    <motion.div
      variants={fadeUp}
      className="mt-9 flex flex-col gap-6 lg:flex-row lg:flex-wrap lg:items-center"
    >
      <div className="grid grid-cols-1 gap-3 sm:max-w-[460px] sm:grid-cols-2 lg:flex lg:max-w-none lg:items-center">
        <Button size="lg" onClick={onTryDemo}>
          Try Demo
        </Button>

        <Button
          size="lg"
          variant="secondary"
          onClick={onWatchVideo}
          className="gap-2.5 px-6"
          leading={
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-white shadow-brand">
              <Play className="h-3 w-3 translate-x-[1px]" fill="currentColor" strokeWidth={0} />
            </span>
          }
        >
          Watch Video
        </Button>
      </div>

      <span aria-hidden className="hidden h-12 w-px bg-[#E2EAF7] xl:block" />

      <TrustIndicator />
    </motion.div>
  );
}
