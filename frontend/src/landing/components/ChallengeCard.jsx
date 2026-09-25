import { motion } from 'framer-motion';
import { Clock, LineChart, UserSearch } from 'lucide-react';
import { fadeUp, hoverLift, stagger } from '../motion';

const CHALLENGES = [
  {
    icon: Clock,
    title: 'Hard to Detect',
    body: 'Subtle abnormalities can be difficult to identify.',
  },
  {
    icon: UserSearch,
    title: 'Time Consuming',
    body: 'Manual analysis of multiple MRI slices is complex.',
  },
  {
    icon: LineChart,
    title: 'Uncertain Progress',
    body: 'Comparing previous scans and tracking changes can be difficult.',
  },
];

/** The "before" panel: what the reading room deals with today. */
export default function ChallengeCard() {
  return (
    <motion.section
      variants={fadeUp}
      whileHover={hoverLift}
      className="nv-lift rounded-[28px] border border-blush-line/70 bg-gradient-to-b from-[#fdf1f1] via-[#fdf4f4] to-[#fdf8f7] p-6 shadow-soft sm:p-7"
    >
      <h2 className="text-[19px] font-bold tracking-[-0.01em] text-[#d9434b]">
        The Challenge Today
      </h2>

      <motion.ul variants={stagger(0.1, 0.1)} className="mt-5 space-y-5">
        {CHALLENGES.map(({ icon: Icon, title, body }) => (
          <motion.li key={title} variants={fadeUp} className="flex items-start gap-3.5">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#e0575d] shadow-[0_2px_8px_rgba(224,87,93,0.14)]">
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </span>
            <span>
              <h3 className="text-[15px] font-semibold leading-snug text-ink">{title}</h3>
              <p className="mt-0.5 text-[13.5px] leading-snug text-ink-soft">{body}</p>
            </span>
          </motion.li>
        ))}
      </motion.ul>
    </motion.section>
  );
}
