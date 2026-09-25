import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { TONES } from '../featuresData';
import { EASE } from '../../landing/motion';

/**
 * The dashed leaders running from each feature card to the brain.
 *
 * Geometry is measured from the live DOM rather than hard-coded, so the lines
 * stay attached through any reflow — a resize, a font swap, a card that wraps
 * to three lines. Measuring is cheap and only happens on layout change, never
 * per frame.
 */
export default function ConnectorOverlay({ containerRef, cardRefs, stageRef, features, enabled }) {
  const [paths, setPaths] = useState([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage || !enabled) {
      setPaths([]);
      return;
    }

    const box = container.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();

    const next = features.flatMap((feature, i) => {
      const card = cardRefs.current[i];
      if (!card) return [];
      const cardBox = card.getBoundingClientRect();

      /* Leave from whichever edge of the card faces the brain. */
      const fromRight = cardBox.left + cardBox.width / 2 < stageBox.left + stageBox.width / 2;
      const from = {
        x: (fromRight ? cardBox.right : cardBox.left) - box.left,
        y: cardBox.top + cardBox.height / 2 - box.top,
      };

      /* Land on the point of the stage this card is meant to indicate. */
      const to = {
        x: stageBox.left + stageBox.width * feature.anchor.x - box.left,
        y: stageBox.top + stageBox.height * feature.anchor.y - box.top,
      };

      /* A horizontal-first cubic: it leaves the card sideways and arrives at
         the brain on a gentle curve, which keeps six leaders from tangling. */
      const dx = (to.x - from.x) * 0.45;
      const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx * 0.6} ${to.y}, ${to.x} ${to.y}`;

      return [{ key: feature.number, d, to, color: TONES[feature.tone].line }];
    });

    setPaths(next);
  }, [containerRef, stageRef, cardRefs, features, enabled]);

  useEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    cardRefs.current.forEach((card) => card && observer.observe(card));
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, containerRef, cardRefs, stageRef]);

  if (!paths.length) return null;

  /*
   * z-[5] puts the leaders above the WebGL canvas (z-0) so they reach the
   * brain instead of vanishing behind it, and below the cards (z-10) so they
   * appear to emerge from underneath them.
   */
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible">
      {paths.map((path, i) => (
        <g key={path.key}>
          <motion.path
            d={path.d}
            fill="none"
            stroke={path.color}
            strokeWidth="1.3"
            strokeDasharray="4 5"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.7 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.5 + i * 0.09 }}
          />
          <motion.circle
            cx={path.to.x}
            cy={path.to.y}
            r="3.4"
            fill={path.color}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1 }}
            transition={{ duration: 0.35, ease: EASE, delay: 1.2 + i * 0.09 }}
            style={{ transformOrigin: `${path.to.x}px ${path.to.y}px`, filter: `drop-shadow(0 0 5px ${path.color}aa)` }}
          />
        </g>
      ))}
    </svg>
  );
}
