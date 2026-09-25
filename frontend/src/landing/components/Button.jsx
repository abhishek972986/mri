import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { SPRING } from '../motion';

/*
 * Variant labels rather than inline targets, so the hover state reaches the
 * arrow: it moves on its own, looser spring and trails the button slightly.
 */
const surface = {
  rest: { y: 0, scale: 1 },
  hover: { y: -2, scale: 1.015 },
  press: { y: 1, scale: 0.97, transition: SPRING.press },
};

const arrow = {
  rest: { x: 0 },
  hover: { x: 4 },
  press: { x: 5 },
};

/* Written out in full so Tailwind's content scan keeps the classes. */
const VARIANTS = {
  primary: 'nv-btn-primary',
  secondary: 'nv-btn-secondary',
};

const SIZES = {
  sm: 'min-h-[44px] px-5 text-[13.5px]',
  md: 'min-h-[48px] px-6 text-[14.5px]',
  lg: 'min-h-[52px] px-7 text-[15px] lg:text-[14.5px]',
};

/**
 * The landing page's call-to-action button.
 *
 * `variant` is "primary" (filled blue) or "secondary" (white, outlined).
 * Layout — width, display, grid placement — comes in through `className`;
 * the surface itself lives in landing.css (.nv-btn) so hover shadows and
 * fills are defined once.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  arrow: showArrow = variant === 'primary',
  leading,
  className = '',
  children,
  ...rest
}) {
  return (
    <motion.button
      type="button"
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap="press"
      variants={surface}
      transition={SPRING.button}
      className={`nv-btn ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {leading}
      <span>{children}</span>
      {showArrow && (
        <motion.span aria-hidden variants={arrow} transition={SPRING.icon} className="inline-grid">
          <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
        </motion.span>
      )}
    </motion.button>
  );
}
