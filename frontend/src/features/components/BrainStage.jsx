import { motion } from 'framer-motion';
import { Hand } from 'lucide-react';
import {
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import BrainCallout from './BrainCallout';
import BrainPlaceholder from './BrainPlaceholder';
import BrainRegionSelector from './BrainRegionSelector';
import { regionByKey } from '../brainRegions';
import { EASE } from '../../landing/motion';

/* Lazy so three.js and the viewer land in their own chunk, fetched when the
   section is approached rather than on first paint of the landing page. */
const Brain3D = lazy(() => import('./Brain3D'));

const TETHER = {
  focus: '#D98324',
  reference: '#2E86F0',
};

/**
 * The centre of the page: the interactive specimen, its two annotations and
 * the region control.
 *
 * The annotation tethers are updated imperatively from the render loop rather
 * than through React state. At 60fps a state update per frame would re-render
 * this subtree sixty times a second for the sake of two line endpoints; here
 * the frame callback writes straight to the SVG attributes instead.
 */
const BrainStage = forwardRef(function BrainStage({ regionKey, onRegionChange, armed }, ref) {
  const stageRef = useRef(null);
  const region = regionByKey(regionKey);
  const [loaded, setLoaded] = useState(false);

  /* Expose the stage box so the feature connectors can aim at it. */
  useImperativeHandle(ref, () => stageRef.current, [loaded]);

  const labelRefs = { focus: useRef(null), reference: useRef(null) };
  const pathRefs = { focus: useRef(null), reference: useRef(null) };
  const dotRefs = { focus: useRef(null), reference: useRef(null) };

  /* Where each tether leaves its label, in stage pixels. Measured rather than
     assumed so the lines survive a resize or a font swap. */
  const labelAnchors = useRef({ focus: null, reference: null });

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();

    const edge = (el, side) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: (side === 'left' ? b.right : b.left) - box.left,
        y: b.top + b.height / 2 - box.top,
      };
    };

    labelAnchors.current = {
      focus: edge(labelRefs.focus.current, 'left'),
      reference: edge(labelRefs.reference.current, 'right'),
    };
  }, []);

  useEffect(() => {
    measure();
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, regionKey]);

  const handleAnchors = useCallback((anchors) => {
    ['focus', 'reference'].forEach((kind) => {
      const path = pathRefs[kind].current;
      const dot = dotRefs[kind].current;
      const from = labelAnchors.current[kind];
      const to = anchors[kind];
      if (!path || !dot) return;

      if (!from || !to || !to.visible) {
        path.style.opacity = '0';
        dot.style.opacity = '0';
        return;
      }

      /* Bow the curve slightly away from the straight line so it reads as an
         annotation leader rather than a chord across the render. */
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2 - Math.abs(to.x - from.x) * 0.06 - 6;

      path.setAttribute('d', `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`);
      path.style.opacity = '0.85';
      dot.setAttribute('cx', to.x);
      dot.setAttribute('cy', to.y);
      dot.style.opacity = '1';
    });
  }, []);

  return (
    <div className="flex w-full flex-col items-center">
      <div
        ref={stageRef}
        className="relative h-[clamp(300px,88vw,360px)] w-full sm:h-[420px] lg:h-[500px] xl:h-[540px]"
      >
        {/* Soft field behind the specimen, so it sits in light rather than on
            a flat white panel. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 grid place-items-center">
          <div className="h-[72%] w-[72%] rounded-full bg-[radial-gradient(circle,rgba(206,226,252,0.55),transparent_68%)] blur-2xl" />
          <div className="absolute h-[42%] w-[52%] translate-x-[-12%] translate-y-[-8%] rounded-full bg-[radial-gradient(circle,rgba(250,214,164,0.42),transparent_70%)] blur-3xl" />
        </div>

        {armed ? (
          <Suspense fallback={<BrainPlaceholder />}>
            <Brain3D regionKey={regionKey} onAnchors={handleAnchors} onLoaded={setLoaded} />
          </Suspense>
        ) : (
          <BrainPlaceholder />
        )}

        {/* Annotation tethers. Endpoints are written by the render loop. */}
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          {['focus', 'reference'].map((kind) => (
            <g key={kind}>
              <path
                ref={pathRefs[kind]}
                d=""
                fill="none"
                stroke={TETHER[kind]}
                strokeWidth="1.1"
                strokeLinecap="round"
                style={{ opacity: 0, transition: 'opacity 220ms ease' }}
              />
              <circle
                ref={dotRefs[kind]}
                r="4"
                fill={TETHER[kind]}
                stroke="#fff"
                strokeWidth="1.6"
                style={{ opacity: 0, transition: 'opacity 220ms ease' }}
              />
            </g>
          ))}
        </svg>

        {loaded && (
          <>
            <BrainCallout
              key={`focus-${region.key}`}
              ref={labelRefs.focus}
              tone="focus"
              label={region.focus.label}
              note={region.focus.note}
              delay={0.15}
              className="absolute left-0 top-[4%] max-w-[44%] sm:left-[4%] sm:top-[10%] sm:max-w-[46%]"
            />
            <BrainCallout
              key={`reference-${region.key}`}
              ref={labelRefs.reference}
              tone="reference"
              label={region.reference.label}
              note={region.reference.note}
              delay={0.25}
              className="absolute bottom-[4%] right-0 max-w-[44%] text-right sm:bottom-[14%] sm:right-[4%] sm:max-w-[46%]"
            />
          </>
        )}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.7 }}
        className="mt-3 flex items-center gap-2 text-[13px] text-ink-faint"
      >
        <Hand className="h-[17px] w-[17px]" strokeWidth={1.7} />
        <span className="nv-fine-only">Click and drag to rotate</span>
        <span className="nv-touch-only">Drag to rotate · pinch to zoom</span>
      </motion.p>

      <div className="mt-4 w-full px-2">
        <BrainRegionSelector value={regionKey} onChange={onRegionChange} />
      </div>
    </div>
  );
});

export default BrainStage;
