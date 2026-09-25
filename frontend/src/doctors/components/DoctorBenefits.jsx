import { motion } from 'framer-motion';
import { BENEFITS } from '../benefits';
import { fadeUp, hoverNudge, stagger } from '../../landing/motion';

/**
 * The benefit list. Rows, not cards — a border around each one would turn a
 * scannable list into four competing boxes. The row keeps its icon-beside-text
 * shape at every width; on a phone it just gets a smaller icon and more air
 * between rows, so the four still read as separate points.
 */
export default function DoctorBenefits() {
  return (
    <motion.ul variants={stagger(0.09)} className="mt-8 space-y-3 sm:space-y-1.5 lg:space-y-1">
      {BENEFITS.map(({ icon: Icon, title, body, icons, rule, tint }) => (
        <motion.li
          key={title}
          variants={fadeUp}
          whileHover={hoverNudge}
          className={`group flex items-start gap-3 rounded-2xl py-2 transition-colors duration-300 sm:gap-3.5 sm:p-2.5 ${tint}`}
        >
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-shadow duration-300 group-hover:shadow-[0_0_0_5px_rgba(22,119,232,0.07)] sm:h-11 sm:w-11 ${icons}`}
          >
            <Icon className="h-[18px] w-[18px] sm:h-[19px] sm:w-[19px]" strokeWidth={1.9} />
          </span>

          {/* The short rule is what makes these read as one list rather than
              four unrelated rows. */}
          <span aria-hidden className={`mt-1 hidden h-10 w-[2px] shrink-0 rounded-full opacity-70 min-[400px]:block ${rule}`} />

          <span className="min-w-0 pt-0.5">
            <h3 className="text-[15.5px] font-semibold leading-snug text-ink sm:text-[15px]">{title}</h3>
            <p className="mt-1 text-[14.5px] leading-[1.55] text-ink-soft sm:text-[13.5px] sm:leading-[1.5]">{body}</p>
          </span>
        </motion.li>
      ))}
    </motion.ul>
  );
}
