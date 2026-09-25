import { motion } from 'framer-motion';
import { STEP_TONES } from '../stepTones';
import { fadeUp, hoverLift } from '../../landing/motion';

/**
 * Shell for one stage of the pipeline: number, title, one line of
 * explanation, then whatever illustrates it.
 *
 * The illustration is a child rather than a prop so each step can own its own
 * markup and animation without this component knowing anything about it.
 */
export default function WorkflowStep({ number, tone, title, children, description, className = '' }) {
  const styles = STEP_TONES[tone] ?? STEP_TONES.blue;

  return (
    <motion.article
      variants={fadeUp}
      whileHover={hoverLift}
      className={`nv-lift group flex min-w-0 flex-1 flex-col rounded-[22px] border bg-gradient-to-b ${styles.card} p-4 shadow-soft transition-shadow duration-300 hover:shadow-card sm:p-5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums ${styles.badge}`}
        >
          {number}
        </span>
        <div className="min-w-0">
          <h3 className={`text-[17px] font-bold sm:text-[16px] leading-snug tracking-[-0.01em] ${styles.title}`}>
            {title}
          </h3>
          <p className="mt-1.5 text-[14px] leading-[1.5] text-ink-soft sm:text-[13px]">{description}</p>
        </div>
      </div>

      {/* The illustration takes the rest of the card. Stretching rather than
          bottom-aligning is what lets step 01's dropzone fill its card the
          way the taller artwork fills the others. */}
      <div className="mt-4 flex flex-1 flex-col justify-end">{children}</div>
    </motion.article>
  );
}
