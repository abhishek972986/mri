import { Hand } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import BrainPlaceholder from '../../../features/components/BrainPlaceholder';

/* Same viewer the features section uses, in its own chunk. By the time anyone
   scrolls this far the atlas is usually already cached, so it appears at once. */
const Brain3D = lazy(() => import('../../../features/components/Brain3D'));

/**
 * Step 04. The real specimen, not a picture of one.
 *
 * It is armed on approach rather than at mount for the same reason as the
 * features section: the model is a 4.6 MB payload and should not be fetched
 * for a visitor who never reaches this row.
 */
export default function VisualizationStep() {
  const [armed, setArmed] = useState(false);
  const host = useRef(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setArmed(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          observer.disconnect();
        }
      },
      { rootMargin: '35% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      <div ref={host} className="relative h-[220px] w-full sm:h-[240px] xl:h-[210px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 grid place-items-center"
        >
          <div className="h-[80%] w-[80%] rounded-full bg-[radial-gradient(circle,rgba(214,226,252,0.55),transparent_68%)] blur-xl" />
        </div>

        {armed ? (
          <Suspense fallback={<BrainPlaceholder />}>
            <Brain3D regionKey="cerebral-cortex" />
          </Suspense>
        ) : (
          <BrainPlaceholder />
        )}
      </div>

      <p className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-ink-faint">
        <Hand className="h-[15px] w-[15px]" strokeWidth={1.7} />
        <span className="nv-fine-only">Click and drag to rotate</span>
        <span className="nv-touch-only">Drag to rotate</span>
      </p>
    </div>
  );
}
