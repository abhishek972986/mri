import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import { TONES } from '../featuresData';
import { fadeUp, hoverLift } from '../../landing/motion';

/**
 * One feature panel.
 *
 * The ref is forwarded because ConnectorOverlay measures the card's box to
 * work out where its line should start; without it the lines would have to be
 * positioned by hand and would drift on resize.
 */
const FeatureCard = forwardRef(function FeatureCard({ feature, side = 'left' }, ref) {
  const tone = TONES[feature.tone];
  const Icon = feature.icon;

  return (
    <motion.article
      ref={ref}
      variants={fadeUp}
      whileHover={hoverLift}
      className={`nv-lift relative rounded-[22px] border bg-gradient-to-br ${tone.card} p-4 pr-11 shadow-soft backdrop-blur-sm sm:p-5 sm:pr-12`}
    >
      <span
        className={`absolute right-3.5 top-3.5 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone.badge}`}
      >
        {feature.number}
      </span>

      <div className="flex items-start gap-3.5">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone.icon}`}>
          <Icon className="h-[21px] w-[21px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h3 className={`text-[15.5px] font-bold leading-snug tracking-[-0.01em] ${tone.title}`}>
            {feature.title}
          </h3>
          <p className="mt-1 text-[13.5px] leading-[1.5] text-ink-soft">{feature.body}</p>
        </div>
      </div>
    </motion.article>
  );
});

export default FeatureCard;
