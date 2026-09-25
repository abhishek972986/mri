import { motion } from 'framer-motion';
import { fadeUp } from '../../landing/motion';

/** One of the four summary features under the workflow. */
export default function FeatureItem({ icon: Icon, title, body, divider }) {
  return (
    <motion.li
      variants={fadeUp}
      className={`px-0 sm:px-5 ${divider ? 'sm:border-l sm:border-[#E4EDF9]' : ''}`}
    >
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#E9F1FD] text-brand">
        <Icon className="h-[21px] w-[21px]" strokeWidth={1.8} />
      </span>
      <h3 className="mt-3 text-[14.5px] font-semibold leading-snug text-ink">{title}</h3>
      <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft">{body}</p>
    </motion.li>
  );
}
