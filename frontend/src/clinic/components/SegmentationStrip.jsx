import { motion } from 'framer-motion';
import { api } from '../../api';
import { EASE } from '../../landing/motion';

/*
 * The pre-rendered slice set (pipeline/slices.render_study_slices) at the slice
 * with the largest segmented area. Colours described here are the ones that
 * code draws — keep in sync.
 */
const MODES = [
  { key: 'image', label: 'Original', legend: 'Preprocessed MRI (skull-stripped, intensity-normalised)' },
  { key: 'overlay', label: 'Overlay', legend: 'Red outline: AI-segmented region · faint red tint: its interior' },
  { key: 'heatmap', label: 'Probability', legend: 'Model probability — purple (low) → orange → pale yellow (high). Uncalibrated.' },
];

/** Original · Segmentation · Probability, side by side, for one slice. */
export default function SegmentationStrip({ analysisId, slices }) {
  const plane = ['axial', 'coronal', 'sagittal'].find((p) => slices?.[p]?.length);
  const entries = plane ? slices[plane] : [];
  const entry = entries.reduce((best, e) => ((e.lesion_area_mm2 || 0) > (best?.lesion_area_mm2 || 0) ? e : best), entries[0]);
  if (!entry) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {MODES.map((m, i) => (
        <motion.figure
          key={m.key}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.45, ease: EASE, delay: i * 0.06 }}
          className="overflow-hidden rounded-2xl border border-[#E3EAF5] bg-white"
        >
          <img src={api.sliceUrl(analysisId, entry[m.key])} alt={`${m.label}, ${plane} slice ${entry.index}`} className="aspect-square w-full bg-black object-contain" loading="lazy" />
          <figcaption className="px-3 py-2.5">
            <p className="text-[13px] font-semibold text-ink">{m.label}</p>
            <p className="text-[11.5px] leading-snug text-ink-faint">{m.legend}</p>
          </figcaption>
        </motion.figure>
      ))}
    </div>
  );
}
