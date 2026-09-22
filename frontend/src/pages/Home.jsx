import HeroBrain from '../components/HeroBrain';

/**
 * Marketing landing page.
 *
 * Deliberately light-themed, unlike the dashboard behind it: this page is read
 * once, in a browser tab next to other tabs, by someone deciding whether to try
 * the tool. The dashboard is dark because it sits beside greyscale MRI for long
 * stretches. They are different jobs and should not share a palette.
 */

const Icon = {
  brain: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 5a2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 0-2 4 2.5 2.5 0 0 0 .5 4.5A2.5 2.5 0 0 0 8 19a2.5 2.5 0 0 0 4 0Z" />
      <path d="M12 5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 2 4 2.5 2.5 0 0 1-.5 4.5A2.5 2.5 0 0 1 16 19a2.5 2.5 0 0 1-4 0Z" />
      <path d="M12 5v14M8.5 9h2M13.5 9h2M8 13h2.5M13.5 13H16" />
    </svg>
  ),
  arrow: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  play: (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M9 7.5v9a.6.6 0 0 0 .92.5l7-4.5a.6.6 0 0 0 0-1l-7-4.5A.6.6 0 0 0 9 7.5Z" />
    </svg>
  ),
  lock: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  sparkle: (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2.6l1.9 5.1 5.1 1.9-5.1 1.9L12 16.6l-1.9-5.1L5 9.6l5.1-1.9L12 2.6Z" />
      <path d="M18.6 14.4l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" opacity=".7" />
    </svg>
  ),
  upload: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6.5 17a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.5A3.75 3.75 0 0 1 18.5 17" />
      <path d="M12 12v8M9 15l3-3 3 3" />
    </svg>
  ),
  cube: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2l8-4.4Z" />
      <path d="M4 7.2l8 4.4 8-4.4M12 11.6V21" />
    </svg>
  ),
  pin: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  ),
  chart: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" {...props}>
      <path d="M6 19v-6M12 19V6M18 19v-9" />
    </svg>
  ),
};

const NAV = ['Home', 'Features', 'How It Works', 'About'];

const STEPS = [
  {
    n: '01',
    tone: 'blue',
    icon: Icon.upload,
    title: 'Upload MRI',
    body: 'Support for common formats (NIfTI, DICOM, JPG, PNG)',
  },
  {
    n: '02',
    tone: 'violet',
    icon: Icon.brain,
    title: 'AI Analysis',
    body: 'Detect and quantify TB-related lesions using advanced ML',
  },
  {
    n: '03',
    tone: 'mint',
    icon: Icon.cube,
    title: 'Visualize & Track',
    body: 'Explore in 3D and compare scans over time',
  },
];

const RESULTS = [
  { icon: Icon.brain, tone: 'blue', label: 'Lesion Volume', value: <>2.8 cm<sup>3</sup></> },
  { icon: Icon.pin, tone: 'blue', label: 'Affected Region', value: 'Right Temporal Lobe' },
  { icon: Icon.chart, tone: 'blue', label: 'AI Confidence', value: '92%' },
];

export default function Home({ onEnterApp }) {
  return (
    <div className="home">
      <div className="home-bg" aria-hidden="true">
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
      </div>

      <div className="home-shell">
        <header className="nav-card">
          <a className="nav-brand" href="#/" onClick={(e) => e.preventDefault()}>
            <span className="nav-logo"><Icon.brain /></span>
            <span className="nav-brand-text">
              <strong>NeuroTB <em>AI</em></strong>
              <small>Clearer Insights. Healthier Tomorrows.</small>
            </span>
          </a>

          <nav className="nav-links">
            {NAV.map((item, i) => (
              <a key={item} href="#/" className={i === 0 ? 'active' : ''} onClick={(e) => e.preventDefault()}>
                {item}
              </a>
            ))}
          </nav>

          <button type="button" className="btn btn-primary nav-cta" onClick={onEnterApp}>
            Get Started <Icon.arrow />
          </button>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <span className="badge">
              <Icon.sparkle />
              AI for a <strong>Healthier Tomorrow</strong>
            </span>

            <h1>
              See the Brain<br />
              <em>Beyond</em> the Scan
            </h1>

            <p className="hero-lede">
              Upload an MRI scan and let AI detect, visualize, and quantify brain TB
              lesions — with interactive 3D visualization and treatment progress
              tracking.
            </p>

            <div className="hero-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={onEnterApp}>
                Upload MRI Scan <Icon.arrow />
              </button>
              <button type="button" className="btn btn-ghost btn-lg" onClick={onEnterApp}>
                <span className="play"><Icon.play /></span>
                Watch Demo
              </button>
            </div>

            <p className="hero-secure">
              <Icon.lock />
              Your data is secure and private
            </p>
          </div>

          <div className="hero-stage">
            <p className="hero-annotation">
              3D Visualization<br />for Better Understanding
              <svg className="annotation-arrow" viewBox="0 0 80 60" fill="none" aria-hidden="true">
                <path d="M74 4C60 6 26 12 12 44" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeDasharray="1 5" />
                <path d="M6 36l6 10 11-3" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </p>

            <HeroBrain />

            <aside className="result-card">
              <h2>AI Analysis Result</h2>

              <ul>
                {RESULTS.map(({ icon: Glyph, tone, label, value }) => (
                  <li key={label}>
                    <span className={`result-icon ${tone}`}><Glyph /></span>
                    <span className="result-text">
                      <small>{label}</small>
                      <strong>{value}</strong>
                    </span>
                  </li>
                ))}
              </ul>

              <button type="button" className="btn btn-soft" onClick={onEnterApp}>
                View 3D Model <Icon.arrow />
              </button>
            </aside>
          </div>
        </section>

        <section className="steps-card">
          {STEPS.map(({ n, tone, icon: Glyph, title, body }, index) => (
            <div className="step-row" key={n}>
              <article className="step">
                <span className={`step-icon ${tone}`}><Glyph /></span>
                <div className="step-text">
                  <span className="step-n">{n}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </article>
              {index < STEPS.length - 1 && (
                <span className="step-arrow" aria-hidden="true"><Icon.arrow /></span>
              )}
            </div>
          ))}
        </section>

        <footer className="home-footer">
          Built for Better Brain Care <span>|</span> NeuroTB AI
        </footer>
      </div>
    </div>
  );
}
