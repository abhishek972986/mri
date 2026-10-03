import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Brain, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { EASE, SPRING } from '../../landing/motion';
import { returnPath, useAuth } from '../auth';
import { Button, Field, InlineAlert, TextInput } from '../ui';
import '../clinic.css';

function PasswordInput({ id, invalid, ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
      <TextInput id={id} invalid={invalid} type={visible ? 'text' : 'password'} className="!pl-10 !pr-11" {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-faint hover:text-ink"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SignInForm({ onForgot }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '', remember: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const signedIn = await signIn({ email: form.email.trim(), password: form.password, remember: form.remember });
      navigate(returnPath(location.state, signedIn), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {location.state?.expired && !error && (
        <InlineAlert tone="blue">Your session ended. Please sign in again.</InlineAlert>
      )}
      <InlineAlert tone="red">{error}</InlineAlert>

      <Field label="Email">
        {({ id }) => (
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <TextInput
              id={id}
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="doctor@hospital.org"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="!pl-10"
            />
          </div>
        )}
      </Field>

      <Field label="Password">
        {({ id }) => (
          <PasswordInput
            id={id}
            autoComplete="current-password"
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        )}
      </Field>

      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-soft">
          <input
            type="checkbox"
            className="cx-check"
            checked={form.remember}
            onChange={(e) => setForm({ ...form, remember: e.target.checked })}
          />
          Remember me for 30 days
        </label>
        <button type="button" onClick={onForgot} className="text-[13.5px] font-semibold text-brand hover:underline">
          Forgot password?
        </button>
      </div>

      <Button type="submit" size="lg" className="w-full" loading={busy} arrow>
        {busy ? 'Signing in…' : 'Sign In'}
      </Button>
    </form>
  );
}

function SetupForm() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', specialty: '', hospital: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim() || !form.email.trim() || form.password.length < 8) {
      setError('Name, email and a password of at least 8 characters are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        ...form,
        specialty: form.specialty.trim() || null,
        hospital: form.hospital.trim() || null,
      });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <InlineAlert tone="blue">
        No doctor accounts exist yet. Create the first one — it becomes the owner of any records already in this installation.
      </InlineAlert>
      <InlineAlert tone="red">{error}</InlineAlert>
      <Field label="Full name" required>
        {({ id }) => <TextInput id={id} value={form.full_name} onChange={set('full_name')} autoComplete="name" placeholder="Asha Rao" />}
      </Field>
      <Field label="Email" required>
        {({ id }) => <TextInput id={id} type="email" value={form.email} onChange={set('email')} autoComplete="username" />}
      </Field>
      <Field label="Password" required hint="At least 8 characters, mixing letters with numbers or symbols.">
        {({ id }) => <PasswordInput id={id} value={form.password} onChange={set('password')} autoComplete="new-password" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Specialty">
          {({ id }) => <TextInput id={id} value={form.specialty} onChange={set('specialty')} placeholder="Neurology" />}
        </Field>
        <Field label="Hospital / clinic">
          {({ id }) => <TextInput id={id} value={form.hospital} onChange={set('hospital')} />}
        </Field>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={busy} arrow>
        Create account
      </Button>
    </form>
  );
}

function ForgotPanel({ onBack }) {
  return (
    <div className="space-y-4">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand">
        <KeyRound className="h-5 w-5" />
      </span>
      <h2 className="text-[20px] font-bold text-ink">Reset your password</h2>
      <p className="text-[14px] leading-relaxed text-ink-soft">
        Passwords on this installation are reset by your administrator — there is no email service configured to
        send a reset link. Ask them to run:
      </p>
      <pre className="overflow-x-auto rounded-xl bg-[#0D1424] px-4 py-3 text-[12.5px] leading-relaxed text-[#CFE1FB]">
        python backend/manage.py reset-password --email you@hospital.org
      </pre>
      <p className="text-[13px] text-ink-faint">Resetting a password signs the account out on every device.</p>
      <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>Back to sign in</Button>
    </div>
  );
}

export default function LoginPage() {
  const { doctor, loading } = useAuth();
  const location = useLocation();
  const [view, setView] = useState('signin');
  const status = useQuery({ queryKey: ['auth-status'], queryFn: api.authStatus, retry: 1 });

  useEffect(() => {
    document.body.classList.add('route-clinic');
    return () => document.body.classList.remove('route-clinic');
  }, []);

  if (!loading && doctor) return <Navigate to={returnPath(location.state, doctor)} replace />;

  const firstRun = status.data && !status.data.has_accounts;
  const panel = firstRun ? 'setup' : view;

  return (
    <div className="nv-root cx-root grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-[#0B1B36] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(22,119,232,0.55),transparent_55%),radial-gradient(ellipse_at_80%_90%,rgba(77,212,255,0.25),transparent_50%)]" />
        <img
          src="/neurovision-brain-700.webp"
          alt=""
          aria-hidden
          className="absolute left-1/2 top-[48%] w-[78%] max-w-[560px] -translate-x-1/2 -translate-y-1/2 opacity-90 mix-blend-screen"
        />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Link to="/" className="flex items-center gap-2.5 text-white/90 hover:text-white">
            <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-white/10 ring-1 ring-white/20">
              <Brain className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </span>
            <span className="font-display text-[16px] font-bold">NeuroVision AI</span>
          </Link>
          <div>
            <h2 className="max-w-[18ch] font-display text-[34px] font-bold leading-[1.1] tracking-[-0.02em]">
              Clinical AI for better brain imaging.
            </h2>
            <ul className="mt-6 space-y-2.5 text-[14.5px] text-white/80">
              <li className="flex items-center gap-2.5"><ShieldCheck className="h-4 w-4 text-[#7CC4FF]" /> Patient records visible only to their doctor</li>
              <li className="flex items-center gap-2.5"><ShieldCheck className="h-4 w-4 text-[#7CC4FF]" /> AI findings are decision support, reviewed by you</li>
            </ul>
          </div>
        </div>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="w-full max-w-[420px]"
        >
          <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-brand to-[#3FA0FF] text-white shadow-brand">
              <Brain className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </span>
            <span className="font-display text-[16px] font-bold text-ink">NeuroVision <span className="text-brand">AI</span></span>
          </Link>

          {panel !== 'forgot' && (
            <div className="mb-7">
              <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">
                {panel === 'setup' ? 'Set up NeuroVision AI' : 'Welcome back'}
              </h1>
              <p className="mt-1.5 text-[14.5px] text-ink-soft">
                {panel === 'setup' ? 'Create the first doctor account.' : 'Clinical AI for Better Brain Imaging'}
              </p>
            </div>
          )}

          {status.isError && (
            <InlineAlert tone="red" className="mb-4">
              Cannot reach the NeuroVision server. Start the backend (.\run.ps1 api) and reload.
            </InlineAlert>
          )}

          {/* Until we know whether this is a fresh install, show neither form —
              otherwise sign-in flashes up and is then swapped for setup. */}
          {status.isPending ? (
            <div className="space-y-4" role="status" aria-label="Loading">
              <div className="cx-skeleton h-11 w-full" />
              <div className="cx-skeleton h-11 w-full" />
              <div className="cx-skeleton h-12 w-full" />
            </div>
          ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panel}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={SPRING.card}
            >
              {panel === 'setup' && <SetupForm />}
              {panel === 'signin' && <SignInForm onForgot={() => setView('forgot')} />}
              {panel === 'forgot' && <ForgotPanel onBack={() => setView('signin')} />}
            </motion.div>
          </AnimatePresence>
          )}

          <p className="mt-8 text-center text-[12.5px] text-ink-faint">
            For use by authorised clinicians. AI output is not a diagnosis.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
