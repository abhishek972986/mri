import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import BrainStage from './BrainStage';
import ConnectorOverlay from './ConnectorOverlay';
import FeatureCard from './FeatureCard';
import { LEFT_FEATURES, RIGHT_FEATURES } from '../featuresData';
import { stagger } from '../../landing/motion';

const ALL = [...LEFT_FEATURES, ...RIGHT_FEATURES];

/** Leaders are drawn only where the cards actually flank the brain. */
function useFlankingLayout() {
  const [flanking, setFlanking] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = () => setFlanking(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return flanking;
}

/**
 * The three-part composition: cards down each side, specimen in the middle.
 *
 * On a narrow screen the same content becomes a single column led by the
 * brain, and the leaders switch off — they would have nothing meaningful to
 * connect once the cards sit above and below rather than beside.
 */
export default function FeatureGrid({ regionKey, onRegionChange, armed }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const cardRefs = useRef([]);
  const flanking = useFlankingLayout();

  return (
    <div ref={containerRef} className="nv-gutter relative mx-auto w-full max-w-[1552px]">
      <ConnectorOverlay
        containerRef={containerRef}
        stageRef={stageRef}
        cardRefs={cardRefs}
        features={ALL}
        enabled={flanking}
      />

      <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)_minmax(0,0.9fr)] lg:gap-5 xl:gap-8">
        {/* Brain first in the DOM so a phone meets it before the cards, and
            placed back into the middle column from lg up. */}
        <div className="relative z-0 order-1 sm:col-span-2 lg:order-2 lg:col-span-1 lg:col-start-2">
          <BrainStage
            ref={stageRef}
            regionKey={regionKey}
            onRegionChange={onRegionChange}
            armed={armed}
          />
        </div>

        <motion.div
          variants={stagger(0.1, 0.25)}
          className="relative z-10 order-2 grid grid-cols-1 gap-4 lg:order-1 lg:col-start-1 lg:gap-5"
        >
          {LEFT_FEATURES.map((feature, i) => (
            <FeatureCard
              key={feature.number}
              feature={feature}
              side="left"
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
            />
          ))}
        </motion.div>

        <motion.div
          variants={stagger(0.1, 0.35)}
          className="relative z-10 order-3 grid grid-cols-1 gap-4 lg:col-start-3 lg:gap-5"
        >
          {RIGHT_FEATURES.map((feature, i) => (
            <FeatureCard
              key={feature.number}
              feature={feature}
              side="right"
              ref={(el) => {
                cardRefs.current[LEFT_FEATURES.length + i] = el;
              }}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}
