import { motion } from 'framer-motion';
import { STEP_TONES } from '../stepTones';
import { EASE } from '../../landing/motion';
import { useMotionPrefs } from '../../landing/useMotionPrefs';

/**
 * The arrow between two stages, with a dot that runs along it.
 *
 * The travelling dot is the only thing on the page that says the stages are a
 * sequence rather than a list, so it loops rather than playing once — but
 * slowly, and offset per connector so the five never pulse in unison.
 *
 * It is drawn horizontally and turned a quarter to point down in the phone
 * timeline, so the dot travels downward there too.
 */
export default function WorkflowConnector({ from, to, index = 0, className = '' }) {
  const { reduce } = useMotionPrefs();
  const a = (STEP_TONES[from] ?? STEP_TONES.blue).line;
  const b = (STEP_TONES[to] ?? STEP_TONES.blue).line;
  const id = `nv-flow-${index}`;

  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center py-4 md:w-11 md:py-0 ${className}`}
    >
      <svg
        viewBox="0 0 40 14"
        className="h-4 w-11 rotate-90 md:rotate-0"
        fill="none"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={a} />
            <stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>

        <motion.path
          d="M 2 7 H 31"
          stroke={`url(#${id})`}
          strokeWidth="1.6"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.25 + index * 0.12 }}
        />
        <motion.path
          d="M 28 3.5 L 32.5 7 L 28 10.5"
          stroke={b}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.9 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.6 + index * 0.12 }}
        />

        {!reduce && (
        <motion.circle
          r="2.1"
          cy="7"
          fill={b}
          /* cx belongs in `initial` as well as the keyframes: while the loop
             waits out its delay the attribute is otherwise written as
             undefined, which the SVG parser rejects. */
          initial={{ opacity: 0, cx: 3 }}
          whileInView={{ cx: [3, 30], opacity: [0, 1, 1, 0] }}
          viewport={{ once: true }}
          transition={{
            duration: 1.7,
            ease: 'easeInOut',
            repeat: Infinity,
            repeatDelay: 1.6,
            delay: 0.9 + index * 0.35,
          }}
        />
        )}
      </svg>
    </div>
  );
}
