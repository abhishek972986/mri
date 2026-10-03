import { Suspense, lazy, useCallback, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import NeuroVisionLanding from './landing/NeuroVisionLanding';
import { AuthProvider } from './clinic/auth';
import { ToastProvider } from './clinic/toast';

/*
 * Two experiences in one bundle:
 *
 *   Public site      /  /features  /how-it-works  /for-doctors  /about
 *   Clinical app     /login  and everything under /app (signed-in doctors only)
 *
 * The clinical app is loaded on demand. It pulls in three.js and the viewer
 * stack, and the landing page is what nearly every visitor sees first.
 */
const ClinicApp = lazy(() => import('./clinic/ClinicApp'));
const LoginPage = lazy(() => import('./clinic/pages/LoginPage'));

/* The public "pages" are sections of the one landing page. */
const SECTION_FOR_PATH = {
  '/features': 'features',
  '/how-it-works': 'how-it-works',
  '/for-doctors': 'for-doctors',
  '/about': 'about',
};

function Landing() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    document.body.classList.add('route-home');
    return () => document.body.classList.remove('route-home');
  }, []);

  // Scroll to the section a path names, once it has rendered.
  useEffect(() => {
    const id = SECTION_FOR_PATH[pathname] ?? window.location.hash.replace(/^#\/?/, '');
    if (!id) return undefined;
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const enterApp = useCallback(() => {
    navigate('/app');
    window.scrollTo(0, 0);
  }, [navigate]);

  return <NeuroVisionLanding onEnterApp={enterApp} />;
}

/** Auth and toasts exist only for the clinical side; the landing page never calls /auth/me. */
function ClinicalProviders() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Suspense fallback={<div className="app-loading">Loading…</div>}>
          <Outlet />
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}

export default function Root() {
  const { hash } = useLocation();

  // Links from before the router existed used "#/app".
  if (hash === '#/app') return <Navigate to="/app" replace />;

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      {Object.keys(SECTION_FOR_PATH).map((path) => (
        <Route key={path} path={path} element={<Landing />} />
      ))}
      <Route element={<ClinicalProviders />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app/*" element={<ClinicApp />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
