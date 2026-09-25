import { motion } from 'framer-motion';
import { User } from 'lucide-react';
import { fadeUp } from '../../landing/motion';

/*
 * Generic avatars rather than photographs. Stock faces beside a line about
 * clinicians using the product would read as real named users endorsing it,
 * which is a claim the page cannot make.
 */
const AVATARS = ['bg-[#DCEAFB] text-[#3C74B8]', 'bg-[#D8EFEA] text-[#1B8C79]', 'bg-[#E4E2FA] text-[#6A5BC4]'];

/**
 * The small social-proof line next to the hero buttons. Under the stacked
 * buttons on a phone it centres, avatars over text, so it reads as a caption
 * to the pair rather than hanging off the left edge.
 */
export default function TrustIndicator() {
  return (
    <motion.div
      variants={fadeUp}
      className="flex flex-col items-center gap-2.5 text-center sm:flex-row sm:gap-3 sm:text-left"
    >
      <ul className="flex -space-x-2.5">
        {AVATARS.map((tone, i) => (
          <li
            key={i}
            className={`grid h-9 w-9 place-items-center rounded-full ring-2 ring-white ${tone}`}
          >
            <User className="h-[17px] w-[17px]" strokeWidth={1.9} />
          </li>
        ))}
      </ul>

      <p className="text-[13.5px] leading-snug text-ink-soft sm:text-[13px]">
        Trusted by <span className="font-semibold text-ink">500+</span> clinicians
        <br /> and researchers
      </p>
    </motion.div>
  );
}
