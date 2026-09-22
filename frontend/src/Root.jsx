import { useCallback, useEffect, useState } from 'react';
import App from './App';
import Home from './pages/Home';
import './pages/home.css';

/**
 * Two surfaces in one bundle: the marketing landing page and the clinical
 * dashboard. Routing is the URL hash rather than a router dependency — there
 * are exactly two routes and adding react-router for them would be the larger
 * change.
 *
 * The two pages have opposite palettes, and the dashboard's stylesheet sets a
 * dark `body` background globally, so the route also owns a class on <body>.
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
    document.body.classList.toggle('route-home', route === 'home');
    document.body.classList.toggle('route-app', route === 'app');
  }, [route]);

  const enterApp = useCallback(() => {
    window.location.hash = '#/app';
    window.scrollTo(0, 0);
  }, []);

  if (route === 'app') return <App onExitToHome={() => { window.location.hash = '#/'; }} />;
  return <Home onEnterApp={enterApp} />;
}
