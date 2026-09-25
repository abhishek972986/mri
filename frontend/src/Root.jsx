import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import NeuroVisionLanding from './landing/NeuroVisionLanding';

/*
 * The dashboard is loaded on demand. It pulls in three.js and the whole
 * viewer stack, and the landing page is what nearly every visitor sees first
 * — statically importing it here put that entire cost on their first paint,
 * including for people who never open the dashboard at all.
 */
const App = lazy(() => import('./App'));

/**
 * Two surfaces in one bundle: the marketing landing page and the clinical
 * dashboard. Routing is the URL hash rather than a router dependency — there
 * are exactly two routes and adding react-router for them would be the larger
 * change.
 *
 * The two pages have opposite palettes, and the dashboard's stylesheet sets a
 * dark `body` background globally, so the route also owns a class on <body>.
 */

/* Landing-page sections that a hash can point at. */
const ANCHORS = new Set(['features', 'how-it-works', 'for-doctors']);

/*
 * Only the dashboard is a route. Features is a section of the landing page,
 * so `#features` and `#how-it-works` (and the older `#/features`) resolve to
 * home and are handled as anchors below.
 */
function currentRoute() {
  return window.location.hash.replace(/^#\/?/, '') === 'app' ? 'app' : 'home';
}

export default function Root() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('route-home', route !== 'app');
    document.body.classList.toggle('route-app', route === 'app');
  }, [route]);

  /*
   * Anchor handling for the landing page. The browser's own jump-to-id fires
   * before React has rendered the section, so links arriving with a features
   * hash — including the `#/features` the page used to be routed at — are
   * scrolled here instead, once the element exists.
   */
  useEffect(() => {
    if (route !== 'home') return undefined;
    const hash = window.location.hash.replace(/^#\/?/, '');
    if (!ANCHORS.has(hash)) return undefined;

    const id = requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [route]);

  const enterApp = useCallback(() => {
    window.location.hash = '#/app';
    window.scrollTo(0, 0);
  }, []);

  if (route === 'app') {
    return (
      <Suspense fallback={<div className="app-loading">Loading…</div>}>
        <App onExitToHome={() => { window.location.hash = '#/'; }} />
      </Suspense>
    );
  }
  return <NeuroVisionLanding onEnterApp={enterApp} />;
}
