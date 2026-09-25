import { motion } from 'framer-motion';
import { Box, FileText, Layers, ShieldCheck } from 'lucide-react';
import FeatureItem from './FeatureItem';
import { fadeUp, stagger } from '../../landing/motion';

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'AI-Powered Detection',
    body: 'Identifies tumors, lesions and other anomalies with high accuracy.',
  },
  {
    icon: Box,
    title: 'Interactive 3D Visualization',
    body: 'Explore affected regions in an intuitive 3D brain model.',
  },
  {
    icon: FileText,
    title: 'Automated Reports',
    body: 'Detailed, easy-to-understand reports with key findings.',
  },
  {
    icon: Layers,
    title: 'Multi-Scan Comparison',
    body: 'Track progress by comparing previous scans over time.',
  },
];

/** The closing panel: what the workflow adds up to. */
export default function FeatureSummary() {
  return (
    <motion.section
      variants={stagger(0.08, 0.1)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      className="mx-auto w-full max-w-shell rounded-[26px] border border-[#E3ECF9] bg-white/70 p-5 min-[400px]:p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,2.2fr)] lg:gap-10">
        <motion.div variants={fadeUp}>
          <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[26px]">
            Key Features at Each Step
          </h2>
          <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-ink-soft">
            A complete workflow designed for accurate detection, better understanding, and improved
            patient outcomes.
          </p>
        </motion.div>

        <ul className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {FEATURES.map((feature, i) => (
            <FeatureItem key={feature.title} {...feature} divider={i > 0} />
          ))}
        </ul>
      </div>
    </motion.section>
  );
}
