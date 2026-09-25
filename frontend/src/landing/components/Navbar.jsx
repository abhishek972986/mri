import { AnimatePresence, motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EASE } from '../motion';
import Button from './Button';

/* Home, Features, How It Works and For Doctors are sections of the one
   landing page, so these are anchors rather than routes. The rest are
   placeholders and point at the top of the page rather than navigating. */
const LINKS = [
  { label: 'Home', href: '#top' },
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'For Doctors', href: '#for-doctors' },
  { label: 'About', href: '#top' },
  { label: 'Contact', href: '#top' },
];

const MENU_ID = 'nv-mobile-menu';

/**
 * Three bars that fold into an X. Drawn rather than swapped between two icons
 * so the change reads as one control changing state, not a flicker.
 */
function MenuGlyph({ open }) {
  const bar = 'absolute left-0 h-[2px] w-[18px] rounded-full bg-current';
  const t = { duration: 0.28, ease: EASE };
  return (
    <span aria-hidden className="relative block h-[14px] w-[18px]">
      <motion.span className={bar} style={{ top: 0 }} animate={open ? { top: 6, rotate: 45 } : { top: 0, rotate: 0 }} transition={t} />
      <motion.span className={bar} style={{ top: 6 }} animate={{ opacity: open ? 0 : 1, scaleX: open ? 0.4 : 1 }} transition={t} />
      <motion.span className={bar} style={{ top: 12 }} animate={open ? { top: 6, rotate: -45 } : { top: 12, rotate: 0 }} transition={t} />
    </span>
  );
}

/**
 * Floating navigation bar. It sits on the page rather than spanning it edge to
 * edge, which is what keeps the top of the layout feeling light.
 *
 * The six links need about 1024px beside the logo and the button before they
 * start to crowd each other, so below lg they fold into a menu. Get Started
 * stays in the bar on a tablet, where there is room for it beside the menu
 * button, and moves into the menu on a phone.
 */
export default function Navbar({ onGetStarted, active = 'Home' }) {
  const [open, setOpen] = useState(false);
  const header = useRef(null);
  const toggle = useRef(null);

  /* Close on Escape (returning focus to the toggle), on a tap outside the
     bar, and when the window grows past the point the menu exists at. */
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onPointer = (e) => {
      if (header.current && !header.current.contains(e.target)) setOpen(false);
    };
    const wide = window.matchMedia('(min-width: 1024px)');
    const onWide = () => wide.matches && setOpen(false);

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const startFromMenu = () => {
    setOpen(false);
    onGetStarted?.();
  };

  return (
    <motion.header
      ref={header}
      initial={{ opacity: 0, y: -18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="nv-gutter sticky top-0 z-50 pt-3 sm:pt-4 lg:pt-5"
    >
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-shell items-center gap-3 rounded-[22px] border border-white/70 bg-white/75 py-2.5 pl-3 pr-2.5 shadow-nav backdrop-blur-xl sm:gap-4 sm:px-4 sm:py-3 lg:px-5"
      >
        {/* Brand */}
        <a href="#top" className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-brand to-[#3FA0FF] text-white shadow-brand">
            <Brain className="h-[22px] w-[22px]" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
              NeuroVision <span className="text-brand">AI</span>
            </span>
            <span className="hidden text-[11px] font-medium text-ink-faint sm:block">
              Clearer Scans. Healthier Lives.
            </span>
          </span>
        </a>

        {/* Centre links */}
        <ul className="mx-auto hidden items-center gap-0.5 lg:flex xl:gap-1">
          {LINKS.map((link) => {
            const current = link.label === active;
            return (
              <li key={link.label}>
                <a
                  href={link.href}
                  aria-current={current ? 'page' : undefined}
                  className={`relative block whitespace-nowrap rounded-full px-3 py-2 text-[13.5px] font-medium transition-colors duration-200 xl:px-4 ${
                    current ? 'text-brand' : 'text-ink-soft hover:bg-brand-soft hover:text-ink'
                  }`}
                >
                  {link.label}
                  {current && (
                    <motion.span
                      layoutId="nv-nav-underline"
                      className="absolute inset-x-3 -bottom-0.5 h-[2px] rounded-full bg-brand xl:inset-x-4"
                    />
                  )}
                </a>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          <Button size="sm" onClick={onGetStarted} className="hidden shrink-0 md:inline-flex">
            Get Started
          </Button>

          <button
            ref={toggle}
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls={MENU_ID}
            onClick={() => setOpen((v) => !v)}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors duration-200 lg:hidden ${
              open ? 'border-[#cfe0f7] bg-brand-soft text-brand' : 'border-[#e6edf8] text-ink'
            }`}
          >
            <MenuGlyph open={open} />
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            id={MENU_ID}
            key="menu"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="mx-auto mt-2 max-h-[calc(100svh-6rem)] max-w-shell overflow-y-auto rounded-[22px] border border-white/70 bg-white/95 p-2 shadow-nav backdrop-blur-xl lg:hidden"
          >
            <ul>
              {LINKS.map((link) => {
                const current = link.label === active;
                return (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      onClick={() => setOpen(false)}
                      aria-current={current ? 'page' : undefined}
                      className={`flex min-h-[48px] items-center rounded-2xl px-4 text-[15px] font-medium ${
                        current ? 'bg-brand-soft text-brand' : 'text-ink-soft hover:bg-brand-soft hover:text-ink'
                      }`}
                    >
                      {link.label}
                    </a>
                  </li>
                );
              })}
            </ul>

            {/* On a tablet the bar already shows this button. */}
            <div className="mt-2 border-t border-[#EDF2FA] p-2 pt-3 md:hidden">
              <Button size="lg" onClick={startFromMenu} className="w-full">
                Get Started
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
