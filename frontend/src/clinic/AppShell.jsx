import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Brain,
  Box,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanLine,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { api } from '../api';
import { EASE, SPRING } from '../landing/motion';
import { useAuth } from './auth';
import { doctorName, statusOf, timeAgo } from './format';
import { Avatar } from './ui';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/patients', label: 'Patients', icon: Users },
  { to: '/app/scans', label: 'MRI Scans', icon: ScanLine },
  { to: '/app/reports', label: 'Reports', icon: FileText },
  { to: '/app/visualization', label: '3D Visualization', icon: Box },
  { to: '/app/profile', label: 'Settings', icon: Settings },
];

/** Title shown in the top bar, from the most specific matching route. */
function titleFor(pathname) {
  if (pathname === '/app') return 'Dashboard';
  if (pathname === '/app/patients/new') return 'New patient';
  if (/^\/app\/patients\/\d+\/edit/.test(pathname)) return 'Edit patient';
  if (/^\/app\/patients\/\d+\/new-scan/.test(pathname)) return 'Upload MRI';
  if (/^\/app\/patients\/\d+\/compare/.test(pathname)) return 'Scan comparison';
  if (/^\/app\/patients\/\d+/.test(pathname)) return 'Patient profile';
  if (pathname.startsWith('/app/patients')) return 'Patients';
  if (/\/visualization$/.test(pathname)) return '3D visualization';
  if (/\/report$/.test(pathname)) return 'Report';
  if (/^\/app\/scans\/\d+/.test(pathname)) return 'MRI analysis';
  if (pathname.startsWith('/app/scans')) return 'MRI scans';
  if (pathname.startsWith('/app/reports')) return 'Reports';
  if (pathname.startsWith('/app/visualization')) return '3D visualization';
  if (pathname.startsWith('/app/profile')) return 'Settings';
  return 'NeuroVision AI';
}

function Brand() {
  return (
    <Link to="/app" className="flex items-center gap-2.5 px-2">
      <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-brand to-[#3FA0FF] text-white shadow-brand">
        <Brain className="h-[22px] w-[22px]" strokeWidth={1.8} />
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-bold tracking-[-0.01em] text-ink">
          NeuroVision <span className="text-brand">AI</span>
        </span>
        <span className="block text-[11px] font-medium text-ink-faint">Clinical workspace</span>
      </span>
    </Link>
  );
}

function SidebarContent({ onNavigate }) {
  const { doctor, signOut } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-6 pt-5">
        <Brand />
      </div>

      <nav aria-label="Application" className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition-colors duration-200 ${
                isActive ? 'text-brand' : 'text-ink-soft hover:bg-[#F1F6FD] hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="cx-nav-active"
                    transition={SPRING.button}
                    className="absolute inset-0 rounded-xl bg-brand-soft ring-1 ring-inset ring-[#D6E6FB]"
                  />
                )}
                <Icon className="relative h-[18px] w-[18px]" strokeWidth={isActive ? 2.1 : 1.8} />
                <span className="relative">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="m-3 rounded-2xl border border-[#E3EAF5] bg-[#F8FAFD] p-3">
        <Link to="/app/profile" onClick={onNavigate} className="flex items-center gap-3 rounded-xl p-1 hover:bg-white">
          <Avatar name={doctor?.full_name} src={doctor?.has_photo ? api.profilePhotoUrl(doctor.id) : null} size={38} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13.5px] font-semibold text-ink">{doctorName(doctor)}</span>
            <span className="block truncate text-[12px] text-ink-faint">{doctor?.specialty || doctor?.email}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="mt-2 flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] font-semibold text-ink-soft transition-colors hover:bg-white hover:text-blush"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.9} />
          Sign out
        </button>
      </div>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();
  const { data = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    refetchInterval: (query) => (query.state.data?.some((n) => n.kind === 'processing' || n.kind === 'queued') ? 5000 : 30000),
  });
  const actionable = data.filter((n) => n.kind === 'needs_review' || n.kind === 'failed').length;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${actionable ? `, ${actionable} need attention` : ''}`}
        aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-soft transition-colors hover:bg-[#EEF4FD] hover:text-ink"
      >
        <Bell className="h-[19px] w-[19px]" strokeWidth={1.9} />
        {actionable > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-blush px-1 text-[10.5px] font-bold text-white ring-2 ring-white">
            {actionable}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ duration: 0.22, ease: EASE }}
            className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-24px))] origin-top-right overflow-hidden rounded-2xl border border-[#E3EAF5] bg-white shadow-[0_4px_10px_rgba(16,38,76,0.05),0_24px_60px_rgba(16,38,76,0.14)]"
          >
            <div className="border-b border-[#EEF2F8] px-4 py-3 text-[14px] font-bold text-ink">Notifications</div>
            <ul className="max-h-[360px] overflow-y-auto py-1">
              {data.length === 0 && <li className="px-4 py-6 text-center text-[13.5px] text-ink-faint">Nothing needs your attention.</li>}
              {data.map((n) => {
                const tone = statusOf(n.kind).tone;
                const dot = { amber: 'bg-[#F59E0B]', red: 'bg-blush', blue: 'bg-brand' }[tone] ?? 'bg-ink-faint';
                return (
                  <li key={`${n.kind}-${n.study_id}`}>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); navigate(`/app/scans/${n.study_id}`); }}
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#F6F9FE]"
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold text-ink">{n.patient_name}</span>
                        <span className="block text-[12.5px] text-ink-soft">{n.message}</span>
                        <span className="block text-[11.5px] text-ink-faint">{timeAgo(n.at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TopBar({ onMenu }) {
  const { pathname } = useLocation();
  const { doctor } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');

  const search = (e) => {
    e.preventDefault();
    navigate(`/app/patients${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#E7EDF6] bg-[#F5F8FC]/85 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onMenu}
          className="grid h-10 w-10 place-items-center rounded-xl text-ink hover:bg-[#EEF4FD] lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="min-w-0 truncate font-display text-[17px] font-bold tracking-[-0.01em] text-ink">{titleFor(pathname)}</p>

        <form onSubmit={search} role="search" className="ml-auto hidden md:block">
          <label className="relative block">
            <span className="sr-only">Search patients</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search patients by name or ID"
              className="cx-input !min-h-[40px] w-[280px] !rounded-xl !pl-9 !text-[13.5px] lg:w-[320px]"
            />
          </label>
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <Notifications />
          <Link to="/app/profile" className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 hover:bg-[#EEF4FD]">
            <Avatar name={doctor?.full_name} src={doctor?.has_photo ? api.profilePhotoUrl(doctor.id) : null} size={34} />
            <span className="hidden text-[13.5px] font-semibold text-ink xl:block">{doctorName(doctor)}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  // Captured per render so the exiting page keeps its own content while it
  // fades out, instead of <Outlet/> swapping in the next page early.
  const outlet = useOutlet();

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  useEffect(() => {
    document.body.classList.add('route-clinic');
    return () => document.body.classList.remove('route-clinic');
  }, []);

  return (
    <div className="nv-root cx-root min-h-screen">
      <a href="#cx-main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-[#E7EDF6] bg-white lg:block">
        <SidebarContent />
      </aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-[#0D1424]/30 backdrop-blur-[2px] lg:hidden"
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="fixed inset-y-0 left-0 z-50 w-[min(300px,86vw)] bg-white shadow-[0_24px_60px_rgba(16,38,76,0.2)] lg:hidden"
              aria-label="Navigation"
            >
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="absolute right-3 top-5 grid h-9 w-9 place-items-center rounded-xl text-ink-soft hover:bg-[#EEF4FD]"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
              <SidebarContent onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-[264px]">
        <TopBar onMenu={() => setDrawer(true)} />
        <main id="cx-main" className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
