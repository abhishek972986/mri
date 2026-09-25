import FeatureSummary from './components/FeatureSummary';
import HowItWorksHero from './components/HowItWorksHero';
import Workflow from './components/Workflow';

/**
 * How It Works — the third screen of the landing page.
 *
 * The whole section is one story told in five stages: a scan goes in, the
 * models read it, abnormal regions are marked, those regions can be inspected
 * in 3D, and a report comes out. The titles alone should carry that, with the
 * illustrations as support rather than the other way round.
 *
 * The language throughout describes assistance, not diagnosis: the system
 * marks regions and generates reports for a clinician to read.
 */
export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative scroll-mt-28 pt-16 sm:pt-24 lg:pt-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 bottom-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.7)_14%,rgba(255,255,255,0.92)_100%)]" />
        <div className="absolute -left-[8%] top-[20%] h-[36vw] w-[36vw] rounded-full bg-[radial-gradient(circle,rgba(206,226,252,0.28),transparent_70%)] blur-3xl" />
        <div className="absolute -right-[8%] top-[10%] h-[38vw] w-[38vw] rounded-full bg-[radial-gradient(circle,rgba(226,216,250,0.24),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[4%] left-1/2 h-[30vw] w-[62vw] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(205,240,235,0.22),transparent_70%)] blur-3xl" />
      </div>

      <HowItWorksHero />

      <div className="nv-gutter mt-10 lg:mt-12">
        <Workflow />
      </div>

      <div className="nv-gutter mt-8 lg:mt-10">
        <FeatureSummary />
      </div>
    </section>
  );
}
