import { motion } from 'framer-motion';
import { CloudUpload } from 'lucide-react';
import { useMotionPrefs } from '../../../landing/useMotionPrefs';

const FORMATS = ['DICOM', 'NIfTI', 'PNG/JPG'];

/**
 * Step 01. A dropzone that looks like the real one without pretending to be
 * it — there is no file input here, because this is an explanation of the
 * product, not the product.
 */
export default function UploadStep() {
  const { reduce } = useMotionPrefs();

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col justify-center rounded-2xl border border-dashed border-[#A8C9F2] bg-[#F5FAFF]/70 px-4 py-6 text-center transition-all duration-300 group-hover:border-[#8FBCF2] group-hover:bg-[#EDF5FE]">
        <motion.div
          className="mx-auto mb-3 w-fit text-brand"
          animate={reduce ? undefined : { y: [0, -3, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <CloudUpload className="h-8 w-8 transition-transform duration-300 group-hover:-translate-y-1" strokeWidth={1.6} />
        </motion.div>

        <p className="text-[12.5px] leading-snug text-ink-soft">
          Drag &amp; drop MRI files
          <br />
          or <span className="font-medium text-brand underline underline-offset-2">browse</span>
        </p>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-1.5">
        {FORMATS.map((format) => (
          <li
            key={format}
            className="rounded-full border border-[#E4EDF9] bg-white/80 px-2.5 py-1 text-[11px] font-medium text-ink-soft"
          >
            {format}
          </li>
        ))}
      </ul>
    </div>
  );
}
