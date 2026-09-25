import { motion } from 'framer-motion';
import { EASE } from '../../landing/motion';
import { useMotionPrefs } from '../../landing/useMotionPrefs';

/*
 * Overlay positions, as a fraction of the illustration box. They track
 * features inside the artwork — the lesion on the main scan and the AI panel
 * on the right of the monitor — so they have to move with it, not with the
 * card around it.
 */
const LESION = { x: 63.5, y: 36 };
const SCREEN = { left: 39, top: 17, width: 49, height: 40 };

/* The artwork's own size. The box reserves this ratio before the file arrives,
   so nothing below it jumps when it loads. */
const ART = { width: 1280, height: 853 };

/**
 * The clinician at the workstation.
 *
 * The illustration is a single flat asset, so the life in it comes from a few
 * overlays registered to points inside the art: a glow on the detected
 * region, a scan line crossing the monitor, and a pulse on the AI panel.
 * Everything drifts together on one slow float so the parts never separate.
 *
 * It always scales as a whole — never cropped — because the doctor, the
 * monitor, the AI panel and the report tablet are the point of the picture,
 * and they reach almost to its edges.
 */
export default function DoctorVisualization() {
  const { reduce, compact } = useMotionPrefs();

  return (
    <motion.div
      initial={{ opacity: 0, x: compact ? 0 : 36, y: compact ? 16 : 0 }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
      className="relative w-full"
    >
      {/* Soft clinical wash behind the artwork. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[78%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-[46%] bg-[radial-gradient(circle,rgba(200,223,251,0.45),transparent_68%)] blur-2xl" />
        <div className="absolute right-[6%] top-[12%] h-[38%] w-[38%] rounded-full bg-[radial-gradient(circle,rgba(180,212,250,0.34),transparent_70%)] blur-3xl" />
      </div>

      <motion.div
        className="relative"
        style={{ aspectRatio: `${ART.width} / ${ART.height}` }}
        animate={reduce ? undefined : { y: [0, compact ? -3 : -5, 0] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* The artwork is flattened onto white, so the soft edge is done
            here: the mask fades its rim into the page instead of ending the
            illustration on a hard rectangle. */}
        <picture>
          <source
            type="image/webp"
            srcSet="/doctors-workstation-640.webp 640w, /doctors-workstation-960.webp 960w, /doctors-workstation-1280.webp 1280w"
            sizes="(min-width: 1536px) 780px, (min-width: 1024px) 52vw, (min-width: 800px) 760px, 100vw"
          />
          <img
            src="/doctors-workstation.jpg"
            width={ART.width}
            height={ART.height}
            alt="Doctor reviewing AI-assisted brain MRI analysis, with the scan, an AI analysis panel and a report tablet on the desk"
            className="nv-doctor-media h-full w-full object-contain"
            loading="lazy"
            decoding="async"
          />
        </picture>

        {/* Glow over the detected region on the main scan. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute h-[9%] w-[6.5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,94,71,0.55),transparent_70%)]"
          style={{ left: `${LESION.x}%`, top: `${LESION.y}%`, opacity: reduce ? 0.5 : undefined }}
          animate={reduce ? undefined : { opacity: [0.35, 0.85, 0.35], scale: [0.88, 1.12, 0.88] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Scan line crossing the monitor. Clipped to the screen area so it
            reads as part of the interface rather than a bar over the page. */}
        {!reduce && (
          <span
            aria-hidden
            className="pointer-events-none absolute overflow-hidden rounded-[4px]"
            style={{
              left: `${SCREEN.left}%`,
              top: `${SCREEN.top}%`,
              width: `${SCREEN.width}%`,
              height: `${SCREEN.height}%`,
            }}
          >
            <motion.span
              className="absolute inset-x-0 h-[18%] bg-[linear-gradient(180deg,transparent,rgba(120,190,255,0.22),transparent)]"
              animate={{ y: ['-12%', '560%'] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 2.2 }}
            />
          </span>
        )}

        {/* The AI panel breathing, to suggest a live readout. A light tint
            only — no blur, so the panel's text stays crisp. */}
        {!reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute right-[10.5%] top-[19%] h-[26%] w-[16%] rounded-xl bg-[radial-gradient(circle,rgba(110,175,255,0.16),transparent_72%)]"
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
