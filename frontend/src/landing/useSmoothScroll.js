import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { useEffect } from 'react';

/**
 * Inertial wheel scrolling for the landing page (Lenis).
 *
 * Only the wheel and trackpad are smoothed: touch scrolling stays native,
 * since phones already have their own momentum and fighting it feels wrong.
 * With reduced motion on, nothing is installed at all.
 *
 * In-page anchors (#features, #how-it-works, …) are routed through Lenis too,
 * so a nav click glides instead of jumping. The target's own
 * `scroll-margin-top` (the sections use scroll-mt-28 to clear the sticky
 * navbar) is honoured, so a click lands where a native jump would.
 */
export function useSmoothScroll(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;

    const lenis = new Lenis({
      lerp: 0.1,
      wheelMultiplier: 1,
      smoothWheel: true,
    });

    let frame = requestAnimationFrame(function raf(time) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    });

    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest?.('a[href^="#"]');
      if (!link) return;
      const hash = link.getAttribute('href');
      /* "#/app" and the like are routes, not anchors — leave them to Root. */
      if (hash.startsWith('#/') || hash === '#') return;
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!target) return;

      e.preventDefault();
      const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const top = target.id === 'top' ? 0 : target.getBoundingClientRect().top + window.scrollY - margin;
      lenis.scrollTo(top, { duration: 1.1 });
      /* Keep the address bar in step without firing hashchange (Root routes on it). */
      history.pushState(null, '', hash);
    };
    document.addEventListener('click', onClick);

    return () => {
      document.removeEventListener('click', onClick);
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [enabled]);
}
