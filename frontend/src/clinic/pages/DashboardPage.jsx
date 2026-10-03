import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  FileText,
  ScanLine,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { EASE, SPRING } from '../../landing/motion';
import { useAuth } from '../auth';
import { doctorName, formatDate, greeting, methodLabel, scanTitle, titleCase } from '../format';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Reveal, Skeleton, SkeletonRows, StatusBadge } from '../ui';

function StatCard({ label, value, icon: Icon, tone, hint, index, onClick }) {
  const tones = {
    blue: 'from-[#EAF2FE] to-[#F4F8FF] text-brand',
    violet: 'from-[#F1EDFE] to-[#F8F6FF] text-[#6A4FD8]',
    green: 'from-[#E7F6EF] to-[#F3FBF7] text-mint',
    amber: 'from-[#FFF3E0] to-[#FFF9F0] text-[#C27803]',
  };
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE, delay: index * 0.06 }}
      whileHover={{ y: -3, transition: SPRING.card }}
      whileTap={{ scale: 0.985 }}
      className="cx-card cx-card-hover flex items-start justify-between gap-3 p-5 text-left"
    >
      <span>
        <span className="block text-[13px] font-semibold text-ink-soft">{label}</span>
        <span className="mt-2 block font-display text-[32px] font-bold leading-none tracking-[-0.02em] text-ink">
          {value ?? <span className="cx-skeleton inline-block h-8 w-14 align-middle" aria-hidden />}
        </span>
        {hint && <span className="mt-2 block text-[12px] text-ink-faint">{hint}</span>}
      </span>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${tones[tone]}`}>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
    </motion.button>
  );
}

function QuickAction({ icon: Icon, label, sub, onClick, primary }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2, transition: SPRING.card }}
      whileTap={{ scale: 0.98 }}
      className={`group flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-300 ${
        primary
          ? 'border-[#1169D6]/40 bg-gradient-to-b from-[#2A86F0] to-[#1169D6] text-white shadow-[0_8px_22px_rgba(22,119,232,0.25)]'
          : 'border-[#E3EAF5] bg-white hover:border-[#CFDBEE]'
      }`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${primary ? 'bg-white/15' : 'bg-brand-soft text-brand'}`}>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] font-semibold ${primary ? 'text-white' : 'text-ink'}`}>{label}</span>
        <span className={`block text-[12.5px] ${primary ? 'text-white/75' : 'text-ink-faint'}`}>{sub}</span>
      </span>
      <ChevronRight className={`h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 ${primary ? 'text-white/80' : 'text-ink-faint'}`} />
    </motion.button>
  );
}

function EngineCard() {
  const { data, isError } = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 5 * 60 * 1000 });
  if (isError) return null;
  const model = data?.model || {};
  const fallback = data?.segmentation_backend === 'classical-fallback';
  return (
    <Card className="p-5">
      <CardHeader icon={Cpu} title="AI engine" subtitle="What produces the findings you review" />
      {!data ? (
        <div className="mt-4 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
      ) : (
        <>
        <dl className="mt-4 space-y-2.5 text-[13.5px]">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Segmentation</dt>
            <dd className="text-right font-semibold text-ink">{fallback ? 'Classical detector' : '3D U-Net'}</dd>
          </div>
          {model.pathology || model.trained_on ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Trained on</dt>
              <dd className="text-right font-semibold text-ink">{titleCase(model.pathology || model.trained_on)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Probabilities</dt>
            <dd className="text-right font-semibold text-ink">{model.calibrated ? 'Calibrated' : 'Uncalibrated'}</dd>
          </div>
        </dl>
        <p className="mt-3 rounded-xl bg-[#FFF9EE] px-3 py-2 text-[12px] leading-snug text-[#7A4A00]">
          {fallback
            ? 'No trained model is loaded — findings come from a demonstration detector with no validated accuracy.'
            : 'A focal-lesion segmenter validated on held-out glioma cases. Findings are for review, not diagnosis.'}
        </p>
        </>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { doctor } = useAuth();
  const navigate = useNavigate();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    refetchInterval: (q) => (q.state.data?.counts?.processing ? 5000 : false),
  });
  const counts = dashboard.data?.counts;

  return (
    <div>
      <Reveal className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(1.55rem,1.2rem+1.1vw,2.1rem)] font-bold tracking-[-0.022em] text-ink">
            {greeting()}, {doctorName(doctor)}
          </h1>
          <p className="mt-1 text-[15px] text-ink-soft">Here&apos;s your clinical overview.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Upload} to="/app/scans/upload">Upload MRI</Button>
          <Button icon={UserPlus} to="/app/patients/new">Add patient</Button>
        </div>
      </Reveal>

      {dashboard.isError ? (
        <Card><ErrorState error={dashboard.error} onRetry={dashboard.refetch} title="Could not load your dashboard" /></Card>
      ) : (
        <>
          {/* Counts render only once loaded (skeletons until then), so a zero is
              always a real zero. data-state lets tests wait for exactly that. */}
          <div
            className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
            aria-busy={dashboard.isPending}
            data-state={dashboard.isPending ? 'loading' : 'ready'}
            data-testid="dashboard-counts"
          >
            <StatCard index={0} label="Total patients" value={counts?.patients} icon={Users} tone="blue" onClick={() => navigate('/app/patients')} />
            <StatCard index={1} label="MRI scans" value={counts?.scans} icon={ScanLine} tone="violet" onClick={() => navigate('/app/scans')}
              hint={counts?.processing ? `${counts.processing} processing now` : counts?.awaiting_analysis ? `${counts.awaiting_analysis} not yet analysed` : null} />
            <StatCard index={2} label="Scans analysed" value={counts?.analyzed} icon={Activity} tone="green" onClick={() => navigate('/app/reports')}
              hint={counts?.failed ? `${counts.failed} failed` : null} />
            <StatCard index={3} label="Pending review" value={counts?.pending_review} icon={ClipboardCheck} tone="amber" onClick={() => navigate('/app/scans?status=needs_review')}
              hint="AI findings awaiting your sign-off" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <Reveal index={2}>
                <Card className="p-5 sm:p-6">
                  <CardHeader
                    title="Recent patients"
                    subtitle="Most recently active first"
                    action={<Button variant="ghost" size="sm" to="/app/patients" arrow>View all</Button>}
                  />
                  <div className="mt-4">
                    {dashboard.isPending ? <SkeletonRows rows={4} /> : dashboard.data.recent_patients.length === 0 ? (
                      <EmptyState icon={Users} title="No patients yet" body="Add your first patient to start uploading and analysing MRI scans."
                        action={<Button icon={UserPlus} to="/app/patients/new">Add patient</Button>} />
                    ) : (
                      <RecentPatients rows={dashboard.data.recent_patients} />
                    )}
                  </div>
                </Card>
              </Reveal>

              <Reveal index={3}>
                <Card className="p-5 sm:p-6">
                  <CardHeader
                    title="Recent MRI scans"
                    subtitle="Latest uploads and their AI analysis status"
                    action={<Button variant="ghost" size="sm" to="/app/scans" arrow>All scans</Button>}
                  />
                  <div className="mt-4">
                    {dashboard.isPending ? <SkeletonRows rows={4} /> : dashboard.data.recent_scans.length === 0 ? (
                      <EmptyState icon={ScanLine} title="No scans uploaded" body="Open a patient and upload a NIfTI brain MRI to run the AI pipeline." />
                    ) : (
                      <RecentScans rows={dashboard.data.recent_scans} />
                    )}
                  </div>
                </Card>
              </Reveal>
            </div>

            <div className="space-y-6">
              <Reveal index={3}>
                <Card className="p-5">
                  <CardHeader title="Quick actions" />
                  <div className="mt-4 space-y-2.5">
                    <QuickAction primary icon={UserPlus} label="Add new patient" sub="Create a complete patient record" onClick={() => navigate('/app/patients/new')} />
                    <QuickAction icon={Upload} label="Upload MRI scan" sub="Choose a patient, then upload" onClick={() => navigate('/app/scans/upload')} />
                    <QuickAction icon={Users} label="View patients" sub="Search, filter and open records" onClick={() => navigate('/app/patients')} />
                    <QuickAction icon={FileText} label="View reports" sub="All AI-assisted reports" onClick={() => navigate('/app/reports')} />
                  </div>
                </Card>
              </Reveal>
              <Reveal index={4}><EngineCard /></Reveal>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RecentPatients({ rows }) {
  const navigate = useNavigate();
  return (
    <>
      {/* Table from md, cards below */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-[#EEF2F8] text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              <th className="pb-2.5 pr-3 font-semibold">Patient</th>
              <th className="pb-2.5 pr-3 font-semibold">Age</th>
              <th className="pb-2.5 pr-3 font-semibold">Last scan</th>
              <th className="pb-2.5 pr-3 font-semibold">Status</th>
              <th className="pb-2.5 pr-3 font-semibold">Last result</th>
              <th className="pb-2.5 font-semibold"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="group cursor-pointer border-b border-[#F1F4F9] last:border-0 hover:bg-[#F8FAFE]" onClick={() => navigate(`/app/patients/${p.id}`)}>
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={p.display_name} src={p.has_photo ? api.patientPhotoUrl(p.id) : null} size={34} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{p.display_name}</p>
                      <p className="text-[12px] text-ink-faint">{p.code}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-3 text-ink-soft">{p.age_years ?? '—'}</td>
                <td className="py-3 pr-3 text-ink-soft">{formatDate(p.last_scan_at)}</td>
                <td className="py-3 pr-3">{p.latest_status ? <StatusBadge status={p.latest_status} /> : <Badge>No scans</Badge>}</td>
                <td className="max-w-[260px] py-3 pr-3"><p className="line-clamp-2 text-ink-soft">{p.latest_result || '—'}</p></td>
                <td className="py-3 text-right">
                  <span className="inline-flex items-center gap-1 font-semibold text-brand">View <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2.5 md:hidden">
        {rows.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => navigate(`/app/patients/${p.id}`)} className="flex w-full items-center gap-3 rounded-2xl border border-[#EEF2F8] p-3 text-left">
              <Avatar name={p.display_name} src={p.has_photo ? api.patientPhotoUrl(p.id) : null} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{p.display_name}</span>
                <span className="block text-[12.5px] text-ink-faint">{p.age_years != null ? `${p.age_years} y · ` : ''}{p.code}</span>
              </span>
              {p.latest_status && <StatusBadge status={p.latest_status} />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RecentScans({ rows, showPatient = true }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-[#EEF2F8] text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              {showPatient && <th className="pb-2.5 pr-3 font-semibold">Patient</th>}
              <th className="pb-2.5 pr-3 font-semibold">Scan date</th>
              <th className="pb-2.5 pr-3 font-semibold">Scan type</th>
              <th className="pb-2.5 pr-3 font-semibold">Status</th>
              <th className="pb-2.5 pr-3 font-semibold">AI result</th>
              <th className="pb-2.5 font-semibold"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="group cursor-pointer border-b border-[#F1F4F9] last:border-0 hover:bg-[#F8FAFE]" onClick={() => navigate(`/app/scans/${s.id}`)}>
                {showPatient && (
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-ink">{s.patient_name}</p>
                    <p className="text-[12px] text-ink-faint">{s.patient_code}</p>
                  </td>
                )}
                <td className="py-3 pr-3 text-ink-soft">{formatDate(s.acquired_on || s.uploaded_at)}</td>
                <td className="py-3 pr-3 text-ink-soft">{scanTitle(s)}</td>
                <td className="py-3 pr-3"><StatusBadge status={s.status} /></td>
                <td className="max-w-[280px] py-3 pr-3">
                  <p className="line-clamp-2 text-ink-soft">
                    {s.status === 'failed' ? <span className="text-blush">Analysis failed</span> : s.headline || (s.status === 'uploaded' ? 'Not analysed yet' : s.status === 'processing' || s.status === 'queued' ? 'Analysis in progress' : '—')}
                  </p>
                  {s.method && <p className="text-[11.5px] text-ink-faint">{methodLabel(s.method)}</p>}
                </td>
                <td className="py-3 text-right">
                  <span className="inline-flex items-center gap-1 font-semibold text-brand">Open <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2.5 md:hidden">
        {rows.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => navigate(`/app/scans/${s.id}`)} className="w-full rounded-2xl border border-[#EEF2F8] p-3.5 text-left">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  {showPatient && <span className="block truncate font-semibold text-ink">{s.patient_name}</span>}
                  <span className="block text-[12.5px] text-ink-soft">{scanTitle(s)} · {formatDate(s.acquired_on || s.uploaded_at)}</span>
                </span>
                <StatusBadge status={s.status} />
              </span>
              {s.headline && <span className="mt-2 line-clamp-2 block text-[12.5px] text-ink-soft">{s.headline}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
