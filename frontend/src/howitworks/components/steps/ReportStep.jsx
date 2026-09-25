import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';
import { EASE } from '../../../landing/motion';

/*
 * Illustrative values, not results. They show the shape of a generated
 * report — a finding, where it is, how big, and how it compares with the
 * previous scan — without standing in for one.
 */
const FINDINGS = [
  { dot: '#F0555B', label: 'Lesion detected' },
  { dot: '#F2757A', label: 'Location: Frontal Lobe' },
  { dot: '#B563D8', label: 'Volume: 12.4 cm³' },
  { dot: '#7C5BD6', label: 'Comparison: Increased by 8%' },
];

/** Step 05. A preview of the report the application generates. */
export default function ReportStep() {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.2 } } }}
      className="rounded-2xl border border-[#E7EEF9] bg-white/85 p-3.5 shadow-soft"
    >
      <motion.div
        variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
        transition={{ duration: 0.4, ease: EASE }}
        className="flex items-center gap-2"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#E6F0FD] text-brand">
          <FileText className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <span className="text-[13.5px] font-bold text-ink">AI Report</span>
      </motion.div>

      <div className="mt-3 flex items-start gap-3">
        <motion.div
          variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
          transition={{ duration: 0.45, ease: EASE }}
          className="flex-1 space-y-1.5 pt-0.5"
          aria-hidden
        >
          {[100, 85, 92, 70].map((w, i) => (
            <span key={i} className="block h-1.5 rounded-full bg-[#EDF1F8]" style={{ width: `${w}%` }} />
          ))}
        </motion.div>

        <motion.img
          variants={{ hidden: { opacity: 0, scale: 0.94 }, show: { opacity: 1, scale: 1 } }}
          transition={{ duration: 0.45, ease: EASE }}
          src="/howitworks-detection-460.webp"
          alt=""
          loading="lazy"
          decoding="async"
          className="h-14 w-14 shrink-0 rounded-lg object-cover mix-blend-multiply"
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {FINDINGS.map((finding) => (
          <motion.li
            key={finding.label}
            variants={{ hidden: { opacity: 0, x: -4 }, show: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex items-center gap-2 text-[12.5px] text-ink-soft xl:text-[11.5px]"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: finding.dot }} />
            {finding.label}
          </motion.li>
        ))}
      </ul>

      <p className="mt-2.5 text-[10px] leading-tight text-ink-faint">
        Sample values, shown to illustrate the report format.
      </p>
    </motion.div>
  );
}
