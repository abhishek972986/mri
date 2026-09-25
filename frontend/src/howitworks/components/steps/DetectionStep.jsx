import { motion } from 'framer-motion';
import { EASE } from '../../../landing/motion';
import { useMotionPrefs } from '../../../landing/useMotionPrefs';

/* Where the lesion sits in the artwork, as a fraction of the image box. */
const LESION = { x: 60, y: 38 };

/**
 * Step 03. The scan with the abnormal region called out.
 *
 * The wording is deliberate: the label says a region was detected, not that a
 * diagnosis was made. Everything on this page describes assistance to a
 * clinician reading the scan.
 */
export default function DetectionStep() {
  const { reduce } = useMotionPrefs();

  return (
    <div className="relative mx-auto w-full max-w-[300px] xl:max-w-[230px]">
      <picture className="block aspect-[700/640]">
        <source
          type="image/webp"
          srcSet="/howitworks-detection-460.webp 460w, /howitworks-detection-700.webp 700w"
          sizes="(min-width: 1280px) 230px, 300px"
        />
        <img
          src="/howitworks-detection.png"
          width="700"
          height="640"
          alt="An MRI slice with an abnormal region highlighted by AI-assisted analysis"
          loading="lazy"
          decoding="async"
          className="h-full w-full rounded-xl object-contain mix-blend-multiply"
        />
      </picture>

      {/* Pulse over the highlighted region. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,86,86,0.35),transparent_70%)]"
        style={{ left: `${LESION.x}%`, top: `${LESION.y}%` }}
        animate={reduce ? undefined : { opacity: [0.35, 0.85, 0.35], scale: [0.85, 1.15, 0.85] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Leader from the label down to the region. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <motion.line
          x1="72" y1="12" x2={LESION.x} y2={LESION.y}
          stroke="#E0484F"
          strokeWidth="0.5"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 0.8 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.7 }}
        />
      </svg>

      <motion.span
        className="absolute -top-1 right-0 rounded-full bg-[#E0484F] px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_4px_12px_rgba(224,72,79,0.35)]"
        initial={{ opacity: 0, y: -4 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45, ease: EASE, delay: 0.45 }}
      >
        Detected Lesion
      </motion.span>
    </div>
  );
}
