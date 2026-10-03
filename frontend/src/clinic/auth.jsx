/**
 * Authentication state for the clinical app.
 *
 * The session itself is an HttpOnly cookie owned by the API — this layer only
 * knows *who* is signed in, by asking /api/auth/me. There is no token in
 * JavaScript and nothing in localStorage to steal.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, onUnauthorized } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // True between an explicit "Sign out" and the next sign-in. Distinguishes a
  // deliberate sign-out (start the next person on the dashboard) from an
  // expired session (take the same person back to where they were).
  const explicitSignOut = useRef(false);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const doctor = me.isError ? null : me.data ?? null;

  const signOutLocally = useCallback(() => {
    queryClient.setQueryData(['me'], null);
    // Patient data must not survive into the next person's session in this tab.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  }, [queryClient]);

  // Any 401 from any request (expired session, signed out elsewhere) returns
  // the doctor to the sign-in screen, remembering where they were. The path
  // is read when the 401 arrives, not captured, so it is never stale; and
  // 401s from requests still in flight during our own sign-out are ignored.
  useEffect(() => {
    onUnauthorized(() => {
      if (explicitSignOut.current) return;
      const doctorId = queryClient.getQueryData(['me'])?.id ?? null;
      signOutLocally();
      const path = window.location.pathname + window.location.search;
      if (path.startsWith('/app')) {
        navigate('/login', { replace: true, state: { from: path, doctorId, expired: true } });
      }
    });
    return () => onUnauthorized(null);
  }, [navigate, signOutLocally, queryClient]);

  const value = useMemo(() => ({
    doctor,
    loading: me.isPending,
    wasSignedOut: () => explicitSignOut.current,
    async signIn(credentials) {
      const signedIn = await api.login(credentials);
      explicitSignOut.current = false;
      queryClient.setQueryData(['me'], signedIn);
      return signedIn;
    },
    async register(payload) {
      const created = await api.register(payload);
      explicitSignOut.current = false;
      queryClient.setQueryData(['me'], created);
      return created;
    },
    async signOut() {
      explicitSignOut.current = true;
      // Stop polling first, so nothing is still fetching patient data while
      // the session is being destroyed.
      await queryClient.cancelQueries();
      try {
        await api.logout();
      } finally {
        navigate('/login', { replace: true });
        signOutLocally();
      }
    },
    setDoctor(next) {
      queryClient.setQueryData(['me'], next);
    },
  }), [doctor, me.isPending, queryClient, navigate, signOutLocally]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * Where to go after signing in. A remembered page is honoured only for the
 * doctor who was on it (session expiry); anyone else starts on the dashboard.
 */
export function returnPath(state, doctor) {
  if (!state?.from || !state.from.startsWith('/app')) return '/app';
  if (state.doctorId != null) return state.doctorId === doctor?.id ? state.from : '/app';
  // Owner unknown (a bookmark, or the Back button after someone signed out):
  // generic pages are fine, but never a specific patient or scan, which may
  // belong to whoever used this browser before.
  return /\/\d+(\/|$|\?)/.test(state.from) ? '/app' : state.from;
}

/** Route guard: renders children only for a signed-in doctor. */
export function RequireAuth({ children }) {
  const { doctor, loading, wasSignedOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f8fc]" role="status" aria-label="Checking session">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#CFE1FB] border-t-[#1677E8]" />
      </div>
    );
  }
  if (!doctor) {
    // After a deliberate sign-out there is no "return to" page: whoever signs
    // in next must not land on the previous doctor's screen.
    const state = wasSignedOut() ? undefined : { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return children;
}
