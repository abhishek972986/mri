import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import FeatureGrid from './components/FeatureGrid';
import FeaturesHero from './components/FeaturesHero';
import MetricsBar from './components/MetricsBar';
import { DEFAULT_REGION } from './brainRegions';
import { stagger } from '../landing/motion';

/**
 * Features section — the second screen of the landing page, reached by
 * scrolling rather than by navigating.
 *
 * The selected region is owned here because three things read it: the 3D
 * specimen's highlighting, the annotation labels and the segmented control.
 *
 * `armed` gates the specimen. The model is a 4.6 MB Draco payload and pulls in
 * three.js behind it, and neither should be on the critical path for a visitor
 * who may never scroll this far — so nothing is fetched until the section is
 * within a screen of the viewport. Once armed it stays armed; unloading a
 * brain someone has scrolled past helps nobody.
 */
export default function FeaturesSection() {
  const [regionKey, setRegionKey] = useState(DEFAULT_REGION);
  const [armed, setArmed] = useState(false);
  const sentinel = useRef(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return undefined;

    /* No IntersectionObserver (or no layout yet) should not mean no brain. */
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
      /* A third of a viewport of head start. A full viewport sounds safer
         but defers nothing: this section begins roughly one screen down, so
         a 100% margin fires at page load on every window size. */
      { rootMargin: '35% 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="features"
      ref={sentinel}
      /* Clears the sticky navbar when the section is jumped to by anchor. */
      className="relative scroll-mt-28 pt-14 sm:pt-20 lg:pt-24"
    >
      {/* A local wash that lightens this half of the page, so the transition
          from the hero reads as moving into a new space. Absolute, not fixed:
          the hero above owns the fixed backdrop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 bottom-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.75)_18%,rgba(255,255,255,0.9)_100%)]" />
        <div className="absolute -left-[10%] top-[16%] h-[40vw] w-[40vw] rounded-full bg-[radial-gradient(circle,rgba(203,223,252,0.30),transparent_70%)] blur-3xl" />
        <div className="absolute -right-[10%] top-[8%] h-[42vw] w-[42vw] rounded-full bg-[radial-gradient(circle,rgba(219,213,250,0.26),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-6%] left-1/2 h-[34vw] w-[66vw] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(198,234,241,0.26),transparent_70%)] blur-3xl" />
      </div>

      <FeaturesHero />

      <motion.div
        variants={stagger(0.08, 0.15)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.1 }}
        className="mt-6 lg:mt-4"
      >
        <FeatureGrid regionKey={regionKey} onRegionChange={setRegionKey} armed={armed} />

        <div className="nv-gutter mt-10 lg:mt-12">
          <MetricsBar />
        </div>
      </motion.div>
    </section>
  );
}
