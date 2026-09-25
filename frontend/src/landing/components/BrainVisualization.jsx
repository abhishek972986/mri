import { motion } from 'framer-motion';
import BrainCallout from './BrainCallout';
import { EASE } from '../motion';
import { useMotionPrefs } from '../useMotionPrefs';

/** Served from /public, so it is referenced by URL rather than imported. */
const BRAIN_STILL = '/neurovision-brain.png';

/*
 * Anchor points, in percent of the container box, for the two annotated
 * regions. Percentages rather than pixels so the connectors stay on their
 * landmarks as the render scales.
 */
const LESION = { x: 33.5, y: 33 };
const HEALTHY = { x: 62.5, y: 30 };

/*
 * The render is 1389x1128, and the connector overlay is sized to it. Giving
 * that SVG a viewBox of the same shape keeps its scaling uniform, which is
 * what lets the draw-on animation work — see the note at the <svg>.
 */
const ART_RATIO = 1128 / 1389;
const VIEW_H = +(100 * ART_RATIO).toFixed(2);

/** Percent-of-height anchor → the connector overlay's user units. */
const y = (pct) => +(pct * ART_RATIO).toFixed(2);

const PARTICLES = [
  { x: 14, y: 26, size: 5, tone: 'rgba(229,72,77,0.45)', delay: 0 },
  { x: 86, y: 22, size: 6, tone: 'rgba(22,119,232,0.40)', delay: 1.1 },
  { x: 9, y: 62, size: 4, tone: 'rgba(77,212,255,0.55)', delay: 2.2 },
  { x: 91, y: 58, size: 5, tone: 'rgba(22,119,232,0.32)', delay: 0.6 },
  { x: 22, y: 82, size: 4, tone: 'rgba(229,72,77,0.30)', delay: 1.7 },
  { x: 78, y: 86, size: 5, tone: 'rgba(77,212,255,0.40)', delay: 2.8 },
];

const CALLOUTS = [
  {
    tone: 'blush',
    title: 'Detected Lesion',
    body: 'AI identifies abnormal regions with high accuracy.',
    delay: 0.5,
    absolute: 'left-0 top-[3%] w-[46%] max-w-[230px]',
  },
  {
    tone: 'brand',
    title: 'Healthy Region',
    body: 'Clear visualization for better understanding.',
    delay: 0.65,
    absolute: 'right-0 top-[3%] w-[46%] max-w-[230px]',
  },
];

const MARKERS = [
  { key: 'lesion', pos: LESION, color: '#e5484d', delay: 1.6 },
  { key: 'healthy', pos: HEALTHY, color: '#1677e8', delay: 1.75 },
];

/**
 * The central 3D brain render, plus everything that orbits it.
 *
 * `videoSrc` takes precedence when supplied — drop an MP4 in /public and pass
 * its path to swap the still for a looping render without touching the rest of
 * the composition. Both are masked and blended identically (.nv-brain-media)
 * so the media never reads as a rectangle sitting on the page.
 */
export default function BrainVisualization({ videoSrc }) {
  const { reduce, compact } = useMotionPrefs();

  return (
    <div className="relative mx-auto w-full max-w-[640px] lg:max-w-none">
      {/* --- glow field -------------------------------------------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[4%] top-[14%] h-[52%] w-[52%] animate-haze rounded-full bg-[radial-gradient(circle,rgba(233,120,125,0.34),transparent_68%)] blur-3xl" />
        <div className="absolute right-[4%] top-[12%] h-[54%] w-[54%] animate-haze rounded-full bg-[radial-gradient(circle,rgba(84,158,255,0.32),transparent_68%)] blur-3xl [animation-delay:2s]" />
        <div className="absolute bottom-[10%] left-1/2 h-[34%] w-[70%] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(77,212,255,0.20),transparent_70%)] blur-2xl" />
      </div>

      {/* --- orbit rings -------------------------------------------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 grid place-items-center">
        <div className="h-[72%] w-[92%] animate-spin-slow rounded-[50%] border border-dashed border-[#f0c9cc]/60" />
        <div className="absolute h-[58%] w-[104%] animate-spin-slower rounded-[50%] border border-[#cfe0f7]/70" />
      </div>

      {/* --- floating particles ------------------------------------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {PARTICLES.map((p, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              left: p.x + '%',
              top: p.y + '%',
              width: p.size,
              height: p.size,
              background: p.tone,
              boxShadow: '0 0 12px ' + p.tone,
              opacity: 0.5,
            }}
            animate={reduce ? undefined : { y: [0, compact ? -6 : -16, 0], opacity: [0.35, 0.9, 0.35] }}
            transition={{ duration: 7 + i, repeat: Infinity, ease: 'easeInOut', delay: p.delay }}
          />
        ))}
      </div>

      {/* --- the render ---------------------------------------------------- */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.1, ease: EASE }}
        className="relative"
      >
        <div className="animate-float">
          {videoSrc ? (
            <video
              className="nv-brain-media mx-auto w-full"
              src={videoSrc}
              poster={BRAIN_STILL}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <picture>
              <source
                type="image/webp"
                srcSet="/neurovision-brain-700.webp 700w, /neurovision-brain-1374.webp 1374w"
                sizes="(min-width: 1024px) 42vw, (min-width: 768px) 640px, 100vw"
              />
              {/* h-auto matters: without preflight nothing resets height, so
                  the height attribute would otherwise be used literally. The
                  width/height pair still reserves the aspect ratio on load. */}
              <img
                className="nv-brain-media mx-auto h-auto w-full"
                src={BRAIN_STILL}
                width="1374"
                height="1145"
                alt="3D visualization of a brain MRI with an abnormal region highlighted on one hemisphere"
                draggable="false"
                fetchpriority="high"
              />
            </picture>
          )}
        </div>

        {/* --- connector lines ---------------------------------------------
            The viewBox matches the render's own aspect ratio (see ART_RATIO),
            so `preserveAspectRatio="none"` scales both axes by the same factor
            and nothing is smeared. That also rules out non-scaling-stroke:
            under it the browser measures dashes in screen units while
            `pathLength` is normalised in user units, and the draw-on animation
            stops partway along the line. A small strokeWidth in user units
            gives a hairline without it. */}
        <svg
          aria-hidden
          viewBox={'0 0 100 ' + VIEW_H}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
        >
          <motion.path
            d={'M 25 15.5 C 29 19.5, 30 22, ' + LESION.x + ' ' + y(LESION.y)}
            fill="none"
            stroke="#e5484d"
            strokeWidth="0.13"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.8 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.85 }}
          />
          <motion.path
            d={'M 75 15.5 C 71 18.5, 67 21, ' + HEALTHY.x + ' ' + y(HEALTHY.y)}
            fill="none"
            stroke="#1677e8"
            strokeWidth="0.13"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.8 }}
            transition={{ duration: 0.9, ease: EASE, delay: 1 }}
          />
        </svg>

        {/* Endpoint markers are DOM nodes rather than SVG circles so their
            size stays constant: inside the overlay they would scale with the
            render, and the dot has to stay a dot at every width. */}
        {MARKERS.map(({ key, pos, color, delay }) => (
          <motion.span
            key={key}
            aria-hidden
            className="absolute hidden h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full md:block"
            style={{
              left: pos.x + '%',
              top: pos.y + '%',
              background: color,
              boxShadow: '0 0 0 4px ' + color + '22',
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.15, 1], opacity: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay }}
          />
        ))}

        {/* --- callouts pinned beside the render (md and up) ---------------- */}
        <div className="pointer-events-none absolute inset-0 hidden md:block">
          {CALLOUTS.map((c) => (
            <BrainCallout
              key={c.title}
              tone={c.tone}
              title={c.title}
              body={c.body}
              delay={c.delay}
              className={'pointer-events-auto absolute ' + c.absolute}
            />
          ))}
        </div>
      </motion.div>

      {/* --- callouts stacked below the render (small screens) ------------- */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:hidden">
        {CALLOUTS.map((c) => (
          <BrainCallout key={c.title} tone={c.tone} title={c.title} body={c.body} delay={c.delay} />
        ))}
      </div>

      {/* --- uncertainty → care transition --------------------------------- */}
      {/* The box is taller than the viewBox on a phone, where the labels need
          a band of their own above the arc. The SVG's default `meet` fit
          centres the curve in that extra height rather than stretching it. */}
      <div className="relative mx-auto mt-2 aspect-[400/118] w-full max-w-[620px] sm:aspect-[400/78]">
        {/* Same rule as the connectors: the box carries the viewBox's aspect
            ratio, so the arc and its head scale evenly and the draw-on
            animation runs the full length of the curve. */}
        <svg aria-hidden viewBox="0 0 400 72" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="nv-transition" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f0989c" />
              <stop offset="45%" stopColor="#bda3d6" />
              <stop offset="100%" stopColor="#2bb8d6" />
            </linearGradient>
          </defs>
          <motion.path
            d="M 46 26 C 150 78, 260 76, 352 22"
            fill="none"
            stroke="url(#nv-transition)"
            strokeWidth="1.9"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.3, ease: EASE, delay: 0.9 }}
          />
          <motion.path
            d="M 339 22.5 L 352 22 L 345.5 33"
            fill="none"
            stroke="#2bb8d6"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ transformOrigin: '352px 22px' }}
            transition={{ duration: 0.4, ease: EASE, delay: 2.05 }}
          />
        </svg>

        <motion.span
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 1.15 }}
          className="absolute left-0 top-0 block max-w-[40%] text-[13px] font-bold leading-tight text-[#e0575d] sm:text-[15px]"
        >
          From
          <br />
          Uncertainty
        </motion.span>
        <motion.span
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 1.3 }}
          className="absolute right-0 top-0 block max-w-[40%] text-right text-[13px] font-bold leading-tight text-[#0f9a8e] sm:text-[15px]"
        >
          To Better
          <br />
          Care
        </motion.span>
      </div>
    </div>
  );
}
