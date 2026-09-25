import { motion } from 'framer-motion';
import { fadeUp } from '../motion';

/**
 * One row of the impact panel. `divider` is set by the parent for every row
 * but the first, so the rule sits between rows and never under the last one.
 */
export default function ImpactItem({ icon: Icon, title, body, divider }) {
  return (
    <motion.li
      variants={fadeUp}
      className={divider ? 'border-t border-mint-line/80 pt-5' : undefined}
    >
      <div className="flex items-start gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-mint shadow-[0_2px_8px_rgba(18,169,124,0.16)]">
          <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} />
        </span>
        <div>
          <h3 className="text-[15.5px] font-semibold leading-snug text-ink">{title}</h3>
          <p className="mt-1 text-[13.5px] leading-snug text-ink-soft">{body}</p>
        </div>
      </div>
    </motion.li>
  );
}
