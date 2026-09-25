import { MotionConfig, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import BottomCTA from './components/BottomCTA';
import Hero from './components/Hero';
import Navbar from './components/Navbar';
import FeaturesSection from '../features/FeaturesSection';
import HowItWorksSection from '../howitworks/HowItWorksSection';
import ForDoctorsSection from '../doctors/ForDoctorsSection';
import { useSmoothScroll } from './useSmoothScroll';
import './landing.css';

/**
 * NeuroVision AI landing page.
 *
 * Light-themed on purpose, unlike the clinical dashboard behind it: this page
 * is read once, in a tab beside other tabs, by someone deciding whether to try
 * the tool. The dashboard is dark because it sits next to greyscale MRI for
 * long stretches. Different jobs, different palettes.
 *
 * Pass `videoSrc` (e.g. "/neurovision_3d_brain_center.mp4") to swap the still
 * render in the centre for a looping video.
 *
 * The features section lives on this page rather than behind its own route:
 * it is the second screen, reached by scrolling. The nav item for it is an
 * anchor, and the highlighted nav item follows whichever screen is in view.
 */
export default function NeuroVisionLanding({ onEnterApp, videoSrc }) {
  const [active, setActive] = useState('Home');
  const reduceMotion = useReducedMotion() ?? false;

  useSmoothScroll(!reduceMotion);

  /*
   * Scroll-spy for the navbar. The band is the top third of the viewport, so
   * a section becomes current as it takes over the screen rather than the
   * moment its first pixel appears. Sections are tracked in document order
   * and the last one inside the band wins, which keeps the highlight moving
   * forward as you scroll down and back as you scroll up.
   */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const sections = [
      ['features', 'Features'],
      ['how-it-works', 'How It Works'],
      ['for-doctors', 'For Doctors'],
    ]
      .map(([id, label]) => [document.getElementById(id), label])
      .filter(([node]) => node);

    if (!sections.length) return undefined;

    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });

        const current = sections.filter(([node]) => visible.has(node.id)).pop();
        setActive(current ? current[1] : 'Home');
      },
      { rootMargin: '-33% 0px -60% 0px' },
    );

    sections.forEach(([node]) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  /* reducedMotion="user": with the OS setting on, framer skips transform and
     layout animations and keeps only opacity. The continuous loops also check
     it themselves (see useMotionPrefs), since an opacity pulse still loops. */
  return (
    <MotionConfig reducedMotion="user">
    <div className="nv-root" id="top">
      {/* Page wash. Two soft colour fields either side of the centre, so the
          brain's own red/blue glow has something to sit in. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(170deg,#f4f8ff_0%,#fbfdff_45%,#f2f7fe_100%)]" />
        <div className="absolute -left-[12%] top-[6%] h-[46vw] w-[46vw] rounded-full bg-[radial-gradient(circle,rgba(244,197,200,0.30),transparent_70%)] blur-3xl" />
        <div className="absolute -right-[12%] top-[2%] h-[48vw] w-[48vw] rounded-full bg-[radial-gradient(circle,rgba(172,207,252,0.34),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-14%] left-1/2 h-[40vw] w-[70vw] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(196,232,238,0.32),transparent_70%)] blur-3xl" />
      </div>

      <Navbar active={active} onGetStarted={onEnterApp} />

      <main className="pb-14 sm:pb-20">
        {/* The hero holds a screen of its own, so the features section below
            starts off-screen and scrolling down genuinely moves between the
            two. min-height rather than height: on a short window the content
            still grows instead of being clipped. */}
        <div className="flex flex-col justify-center lg:min-h-[calc(100svh-104px)]">
          <Hero videoSrc={videoSrc} />

          <div className="nv-gutter mt-10 lg:-mt-2">
            <BottomCTA onExploreDemo={onEnterApp} />
          </div>
        </div>

        <FeaturesSection />

        <HowItWorksSection />

        <ForDoctorsSection onEnterApp={onEnterApp} />
      </main>
    </div>
    </MotionConfig>
  );
}
