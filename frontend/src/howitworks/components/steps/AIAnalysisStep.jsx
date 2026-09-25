import { motion } from 'framer-motion';
import { useMotionPrefs } from '../../../landing/useMotionPrefs';

/* Particles drifting toward the chip, to suggest the slices being consumed. */
const PARTICLES = [0, 0.7, 1.4, 2.1];

/**
 * Step 02. The stack of slices feeding a processor.
 *
 * The artwork is a light-background PNG, so it is multiplied into the card
 * rather than sat on top of it as a white rectangle.
 */
export default function AIAnalysisStep() {
  const { reduce, compact } = useMotionPrefs();

  /* Scales with its card up to a width the artwork still looks sharp at; the
     box reserves the art's ratio so the card does not jump on load. */
  return (
    <div className="relative mx-auto w-full max-w-[340px] xl:max-w-[260px]">
      <motion.picture
        className="block aspect-[760/507]"
        animate={reduce ? undefined : { y: [0, compact ? -2 : -4, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <source
          type="image/webp"
          srcSet="/howitworks-ai-analysis-520.webp 520w, /howitworks-ai-analysis-760.webp 760w"
          sizes="(min-width: 1280px) 260px, 340px"
        />
        <img
          src="/howitworks-ai-analysis.png"
          width="760"
          height="507"
          alt="A stack of MRI slices feeding into an AI processor"
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain mix-blend-multiply"
        />
      </motion.picture>

      {/* Pulse behind the chip, which sits in the right third of the art. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute right-[14%] top-1/2 h-16 w-16 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(56,132,255,0.30),transparent_70%)] blur-md"
        animate={reduce ? undefined : { opacity: [0.35, 0.8, 0.35], scale: [0.92, 1.08, 0.92] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      />

      {!reduce && PARTICLES.map((delay, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="pointer-events-none absolute h-1 w-1 rounded-full bg-[#3E8FF0]"
          style={{ top: `${38 + i * 9}%`, left: '34%', boxShadow: '0 0 6px #3E8FF0' }}
          animate={{ x: [0, compact ? 48 : 62], opacity: [0, 1, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay }}
        />
      ))}
    </div>
  );
}
