import { motion } from 'framer-motion';
import Button from '../../landing/components/Button';
import { EASE } from '../../landing/motion';

/**
 * The closing call to action for clinicians.
 *
 * Three arrangements of the same three parts:
 *  - phone: one centred column — doctor, heading, line, button, note;
 *  - tablet (md): doctor on the left across two rows, the copy and then the
 *    button stacked on the right, so neither is squeezed onto one line;
 *  - desktop (lg): the reference — doctor | copy | button in a single row.
 */
export default function DoctorsCTA({ onGetStarted }) {
  return (
    <motion.section
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
      className="relative mx-auto w-full max-w-shell overflow-hidden rounded-[28px] border border-[#D8E7FA] bg-[linear-gradient(105deg,#EAF3FE_0%,#F2F8FF_45%,#EDF4FE_100%)] shadow-[0_2px_10px_rgba(16,38,76,0.04),0_20px_50px_rgba(22,119,232,0.08)]"
    >
      <div className="flex flex-col items-center px-6 pb-8 pt-6 text-center min-[400px]:px-7 md:grid md:grid-cols-[minmax(0,42%)_minmax(0,1fr)] md:grid-rows-[1fr_auto] md:items-center md:gap-x-6 md:px-0 md:pb-0 md:pt-0 md:text-left lg:flex lg:flex-row lg:gap-8">
        <motion.picture
          variants={{ hidden: { opacity: 0, x: -28 }, show: { opacity: 1, x: 0 } }}
          transition={{ duration: 0.7, ease: EASE }}
          className="block w-[clamp(180px,62vw,240px)] md:row-span-2 md:w-full md:self-center md:pl-4 lg:w-[26%] lg:self-stretch lg:pl-0 lg:shrink-0"
        >
          <source type="image/webp" srcSet="/doctors-cta-403.webp" />
          <img
            src="/doctors-cta.png"
            width="403"
            height="178"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="nv-cta-media h-auto w-full object-contain lg:h-full"
          />
        </motion.picture>

        <motion.div
          variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.7, ease: EASE }}
          className="mt-5 min-w-0 md:mt-0 md:self-end md:pr-8 md:pt-8 lg:flex-1 lg:self-auto lg:py-10 lg:pr-0"
        >
          <h2 className="text-[clamp(1.75rem,3vw+1.05rem,2rem)] font-bold leading-[1.18] tracking-[-0.025em] text-ink md:text-[28px] lg:text-[27px] 2xl:text-[30px]">
            Focus More on Patients,
            <br />
            Let{' '}
            <span className="text-brand">
              AI Handle
              <br className="lg:hidden" /> the Complexity.
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-[34ch] text-[15px] leading-relaxed text-ink-soft md:mx-0 md:mt-2.5 md:max-w-none md:text-[14.5px]">
            Experience a smarter way to analyze brain MRI scans.
          </p>
        </motion.div>

        <motion.div
          variants={{ hidden: { opacity: 0, scale: 0.96 }, show: { opacity: 1, scale: 1 } }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mt-6 w-full max-w-[340px] md:col-start-2 md:mt-5 md:max-w-none md:self-start md:pb-8 md:pr-8 lg:mt-0 lg:w-auto lg:shrink-0 lg:self-auto lg:px-10 lg:pb-0 lg:text-center"
        >
          <Button size="lg" onClick={onGetStarted} className="w-full md:w-auto">
            Get Started Today
          </Button>

          <p className="mt-3 text-[13px] text-ink-faint md:mt-2.5 md:text-[12.5px]">No complex setup. Easy to use.</p>
        </motion.div>
      </div>
    </motion.section>
  );
}
