import { motion } from 'framer-motion';
import { AlertTriangle, Box, ClipboardCheck, FileText, GitCompareArrows, Layers, Ruler } from 'lucide-react';
import { fadeUp, fadeUpBlur, hoverLift, stagger } from '../landing/motion';

/**
 * About — the last screen of the landing page.
 *
 * Everything here is a statement the project can back. The model facts come
 * from the shipped checkpoint's own metadata (backend/checkpoints, surfaced by
 * /api/health); the limitations are the ones every generated report carries.
 * Nothing here claims regulatory clearance, clinical validation, diagnostic
 * accuracy or deployment, because none of those exist.
 */

const CAPABILITIES = [
  {
    icon: Layers,
    title: 'Segmentation',
    body: 'A 3D U-Net outlines regions of abnormal signal in a brain MRI volume, on every slice.',
  },
  {
    icon: Ruler,
    title: 'Measurement',
    body: 'Each segmented region is measured on a 1 mm grid: volume, dimensions, maximum diameter and approximate location.',
  },
  {
    icon: Box,
    title: 'MRI and 3D visualization',
    body: 'Review the segmentation over the source slices in three planes, and as surfaces in an interactive 3D view.',
  },
  {
    icon: GitCompareArrows,
    title: 'Longitudinal comparison',
    body: 'Two scans of the same patient are aligned and compared region by region, so change is measured, not estimated.',
  },
  {
    icon: FileText,
    title: 'AI-assisted reporting',
    body: 'A structured preliminary report with findings, measurements, images and limitations, printable and as PDF.',
  },
  {
    icon: ClipboardCheck,
    title: 'Clinician review',
    body: 'Every report is marked preliminary until a doctor approves, corrects or rejects it; the AI output is kept alongside.',
  },
];

const LIMITATIONS = [
  'Not a medical device, and not cleared or approved by any regulator. It is not a diagnosis.',
  'It shows where signal is abnormal; it does not determine what a region is — tumour type or grade, infection, inflammation or anything else.',
  'The model was trained and validated on adult diffuse glioma only. Its performance on other conditions, scanners and protocols is unknown.',
  'Single-sequence analysis: contrast enhancement, mass effect, haemorrhage and infarction are not assessed.',
  'Anatomical labels are approximate geometric zones, and confidence values are uncalibrated rankings, not probabilities of disease.',
];

export default function AboutSection() {
  return (
    <section id="about" className="relative scroll-mt-28 pt-16 sm:pt-24 lg:pt-28">
      <motion.header
        variants={stagger(0.1, 0.05)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        className="nv-gutter mx-auto max-w-[860px] text-center"
      >
        <motion.p variants={fadeUp} className="text-[11.5px] font-semibold uppercase tracking-[0.32em] text-[#4F6D96]">
          About
        </motion.p>
        <motion.h2
          variants={fadeUpBlur}
          className="mt-4 text-[clamp(1.8rem,3.4vw+1rem,3rem)] font-bold leading-[1.08] tracking-[-0.022em] text-ink"
        >
          About NeuroVision AI
        </motion.h2>
        <motion.p variants={fadeUp} className="mx-auto mt-4 max-w-[680px] text-[15px] leading-relaxed text-ink-soft sm:text-[15.5px]">
          NeuroVision AI is AI-assisted software for reviewing brain MRI. It segments regions of abnormal
          signal, measures them, shows them on every slice and in 3D, compares scans over time, and drafts a
          structured report — for a doctor to review, correct and sign off. The doctor remains the
          decision-maker.
        </motion.p>
      </motion.header>

      <div className="nv-gutter">
        <motion.ul
          variants={stagger(0.06, 0.05)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
          className="mx-auto mt-10 grid max-w-shell gap-4 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3"
        >
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <motion.li
              key={title}
              variants={fadeUp}
              whileHover={hoverLift}
              className="nv-lift rounded-[24px] border border-[#E2ECFA] bg-white/80 p-5 shadow-soft backdrop-blur-xl sm:p-6"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{body}</p>
            </motion.li>
          ))}
        </motion.ul>

        <motion.div
          variants={stagger(0.08, 0.05)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="mx-auto mt-6 grid max-w-shell gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
        >
          <motion.div variants={fadeUp} className="rounded-[24px] border border-[#E2ECFA] bg-white/80 p-5 shadow-soft sm:p-7">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.22em] text-[#4F6D96]">The model</p>
            <h3 className="mt-2 text-[20px] font-bold tracking-[-0.015em] text-ink">A glioma-trained lesion segmenter</h3>
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">
              The segmentation model shipped with NeuroVision AI is a 3D U-Net trained on 210 adult diffuse
              glioma cases from the BraTS 2024 dataset, using the FLAIR sequence. On held-out validation
              patches it reaches a Dice overlap of 0.80 with expert segmentations.
            </p>
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">
              That figure describes glioma segmentation on BraTS data only. Every analysis records which
              model and threshold produced it, and every report states the model&apos;s training scope first
              among its limitations.
            </p>
          </motion.div>

          <motion.div variants={fadeUp} className="rounded-[24px] border border-[#F4DDB2] bg-[#FFF9EE] p-5 sm:p-7">
            <p className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.22em] text-[#9A5B00]">
              <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden /> Important limitations
            </p>
            <ul className="mt-3 space-y-2.5">
              {LIMITATIONS.map((item) => (
                <li key={item} className="flex gap-2.5 text-[14px] leading-relaxed text-[#5C3A00]">
                  <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#C98A1B]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
