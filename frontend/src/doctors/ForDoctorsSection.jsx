import DoctorsCTA from './components/DoctorsCTA';
import DoctorsHero from './components/DoctorsHero';

/**
 * For Doctors — the fourth screen of the landing page.
 *
 * The argument is that a clinician's time is better spent with patients than
 * on manual scan review, and that the system takes on the complexity rather
 * than the judgement. Everything here describes assistance: AI-assisted
 * analysis, AI-generated reports, material for a doctor to interpret.
 */
export default function ForDoctorsSection({ onEnterApp }) {
  return (
    <section id="for-doctors" className="relative scroll-mt-28 pt-16 sm:pt-24 lg:pt-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 bottom-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.78)_14%,rgba(255,255,255,0.95)_100%)]" />
        <div className="absolute -right-[6%] top-[6%] h-[40vw] w-[40vw] rounded-full bg-[radial-gradient(circle,rgba(199,222,252,0.34),transparent_70%)] blur-3xl" />
        <div className="absolute -left-[8%] top-[34%] h-[32vw] w-[32vw] rounded-full bg-[radial-gradient(circle,rgba(214,231,252,0.26),transparent_70%)] blur-3xl" />
      </div>

      <div className="nv-gutter">
        <DoctorsHero onTryDemo={onEnterApp} onWatchVideo={onEnterApp} />
      </div>

      {/* The breathing space before the closing banner is deliberate and holds
          nothing: ~64px on a phone, ~80px on a tablet, 92–120px on desktop,
          where it scales with the viewport rather than collapsing. */}
      <div aria-hidden className="h-16 md:h-20 lg:h-[clamp(5.75rem,8vw,7.5rem)]" />

      <div className="nv-gutter">
        <DoctorsCTA onGetStarted={onEnterApp} />
      </div>
    </section>
  );
}
