import { motion } from 'framer-motion';
import { Box, Heart, Target, Zap } from 'lucide-react';
import ImpactItem from './ImpactItem';
import { fadeUp, hoverLift, stagger } from '../motion';

const IMPACTS = [
  {
    icon: Target,
    title: 'Consistent Measurement',
    body: 'Segmented volumes and dimensions, measured the same way on every scan.',
  },
  {
    icon: Zap,
    title: 'Faster Analysis',
    body: 'Reduce complex manual analysis time.',
  },
  {
    icon: Box,
    title: 'Interactive 3D Visualization',
    body: 'Explore affected regions in an immersive 3D model.',
  },
  {
    icon: Heart,
    title: 'Longitudinal Tracking',
    body: 'Compare scans over time, region by region, after registration.',
  },
];

/** The "after" panel, mirroring ChallengeCard across the brain. */
export default function ImpactCard() {
  return (
    <motion.section
      variants={fadeUp}
      whileHover={hoverLift}
      className="nv-lift rounded-[28px] border border-mint-line/70 bg-gradient-to-b from-[#e9f7f1] via-[#eef9f4] to-[#f3fbf7] p-6 shadow-soft sm:p-7"
    >
      <h2 className="text-[19px] font-bold tracking-[-0.01em] text-[#0f9a71]">
        The Impact with AI
      </h2>

      <motion.ul variants={stagger(0.1, 0.1)} className="mt-6 space-y-5">
        {IMPACTS.map((impact, i) => (
          <ImpactItem key={impact.title} {...impact} divider={i > 0} />
        ))}
      </motion.ul>
    </motion.section>
  );
}
