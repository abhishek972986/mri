import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitCompareArrows,
  History,
  Pencil,
  ScanLine,
  Upload,
  UserPlus,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { EASE } from '../../landing/motion';
import VolumeTrendChart from '../components/VolumeTrendChart';
import { formatDate, formatDateTime, num, scanTitle, titleCase, TREND } from '../format';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Detail,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonRows,
  StatusBadge,
  Tabs,
} from '../ui';
import { RecentScans } from './DashboardPage';

const EVENT_ICON = {
  patient_created: UserPlus,
  scan_uploaded: Upload,
  analysis_completed: Activity,
  analysis_failed: AlertTriangle,
  report_generated: FileText,
  reviewed: CheckCircle2,
  compared: GitCompareArrows,
};

export function Timeline({ events, onOpen, limit }) {
  const shown = limit ? events.slice(0, limit) : events;
  return (
    <ol className="relative">
      {shown.map((event, index) => {
        const Icon = EVENT_ICON[event.kind] ?? History;
        const tone = event.kind === 'analysis_failed' ? 'text-blush bg-blush-soft'
          : event.kind === 'reviewed' ? 'text-mint bg-mint-soft'
            : 'text-brand bg-brand-soft';
        const clickable = event.study_id && onOpen;
        return (
          <motion.li
            key={`${event.kind}-${event.at}-${index}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: Math.min(index, 10) * 0.03 }}
            className="relative flex gap-3 pb-5 last:pb-0"
          >
            {index < shown.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-28px)] w-px bg-[#E3EAF5]" aria-hidden />}
            <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full ${tone}`}>
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                {clickable ? (
                  <button type="button" onClick={() => onOpen(event)} className="text-left text-[14px] font-semibold text-ink hover:text-brand">
                    {event.title}
                  </button>
                ) : (
                  <p className="text-[14px] font-semibold text-ink">{event.title}</p>
                )}
                <time className="text-[12px] text-ink-faint">{formatDateTime(event.at)}</time>
              </div>
              {event.detail && <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-soft">{event.detail}</p>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

export default function PatientProfilePage() {
  const { patientId } = useParams();
  const id = Number(patientId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';

  const patient = useQuery({ queryKey: ['patient', id], queryFn: () => api.getPatient(id) });
  const studies = useQuery({
    queryKey: ['studies', id],
    queryFn: () => api.listStudies(id),
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'queued' || s.status === 'processing') ? 4000 : false),
  });
  const events = useQuery({ queryKey: ['events', id], queryFn: () => api.patientEvents(id) });
  const timeline = useQuery({ queryKey: ['timeline', id], queryFn: () => api.timeline(id) });
  const comparisons = useQuery({ queryKey: ['comparisons', id], queryFn: () => api.listComparisons(id) });

  if (patient.isError) {
    return (
      <Card>
        <ErrorState
          error={patient.error}
          title={patient.error.status === 404 ? 'Patient not found' : 'Could not load this patient'}
          onRetry={patient.error.status === 404 ? undefined : patient.refetch}
        />
        <div className="pb-8 text-center"><Button variant="secondary" to="/app/patients">Back to patients</Button></div>
      </Card>
    );
  }

  const p = patient.data;
  const scans = studies.data ?? [];
  const analysed = scans.filter((s) => s.status === 'needs_review' || s.status === 'reviewed');
  const latest = scans[0];
  const latestAnalysed = analysed[0];
  const setTab = (key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true });

  return (
    <div>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <Card className="overflow-hidden">
          <div className="h-20 bg-[radial-gradient(ellipse_at_20%_0%,#DCEBFE,transparent_60%),radial-gradient(ellipse_at_90%_100%,#E8F6FB,transparent_55%)] sm:h-24" />
          <div className="-mt-10 flex flex-wrap items-end gap-4 px-5 pb-5 sm:-mt-12 sm:px-6">
            {p ? (
              <Avatar name={p.display_name} src={p.has_photo ? api.patientPhotoUrl(id, patient.dataUpdatedAt) : null} size={84} className="ring-4 ring-white" />
            ) : <Skeleton className="h-[84px] w-[84px] rounded-full ring-4 ring-white" />}
            <div className="min-w-0 flex-1 pb-1">
              {p ? (
                <>
                  <h1 className="truncate text-[clamp(1.4rem,1.1rem+1vw,1.9rem)] font-bold tracking-[-0.02em] text-ink">{p.display_name}</h1>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-soft">
                    <span className="font-mono text-[12.5px] font-semibold text-ink">{p.code}</span>
                    {p.age_years != null && <span>{p.age_years} years</span>}
                    {p.sex && <span>{titleCase(p.sex)}</span>}
                    {p.date_of_birth && <span>DOB {formatDate(p.date_of_birth)}</span>}
                  </p>
                </>
              ) : (
                <div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-72" /></div>
              )}
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button variant="secondary" icon={Pencil} to={`/app/patients/${id}/edit`}>Edit</Button>
              {latestAnalysed && (
                <Button variant="secondary" icon={FileText} to={`/app/scans/${latestAnalysed.id}/report`}>Latest report</Button>
              )}
              <Button icon={Upload} to={`/app/patients/${id}/new-scan`}>Upload new MRI</Button>
            </div>
          </div>
        </Card>
      </motion.div>

      <Tabs
        className="mt-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'clinical', label: 'Clinical information' },
          { key: 'scans', label: 'MRI scans', count: studies.data ? scans.length : null },
          { key: 'reports', label: 'Reports', count: studies.data ? analysed.length : null },
          { key: 'comparison', label: 'Comparison' },
        ]}
      />

      <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="mt-6">
        {tab === 'overview' && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-6">
              <Card className="p-5 sm:p-6">
                <CardHeader title="MRI summary" />
                <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Detail always label="Total scans" value={studies.data ? scans.length : '…'} />
                  <Detail always label="Latest scan" value={latest ? formatDate(latest.acquired_on || latest.uploaded_at) : 'None'} />
                  <Detail always label="Last analysis" value={latestAnalysed ? formatDate(latestAnalysed.completed_at) : 'None'} />
                  <Detail always label="Latest status" value={latest ? <StatusBadge status={latest.status} /> : 'No scans'} />
                </dl>
                {latestAnalysed?.headline && (
                  <button
                    type="button"
                    onClick={() => navigate(`/app/scans/${latestAnalysed.id}`)}
                    className="mt-5 flex w-full items-start gap-3 rounded-2xl border border-[#E3EAF5] bg-[#F8FAFD] p-4 text-left transition-colors hover:border-[#CFDBEE]"
                  >
                    <Activity className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Latest AI result · review required</span>
                      <span className="mt-1 block text-[14px] text-ink">{latestAnalysed.headline}</span>
                    </span>
                    <ChevronRight className="mt-0.5 h-4 w-4 text-ink-faint" />
                  </button>
                )}
                {!latest && studies.data && (
                  <EmptyState icon={ScanLine} title="No MRI scans yet" body="Upload this patient's first scan to run the AI analysis."
                    action={<Button icon={Upload} to={`/app/patients/${id}/new-scan`}>Upload MRI</Button>} />
                )}
              </Card>

              <Card className="p-5 sm:p-6">
                <CardHeader title="Patient overview" />
                {p ? (
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Detail always label="Name" value={p.display_name} />
                    <Detail always label="Patient ID" value={p.code} />
                    <Detail always label="Date of birth" value={p.date_of_birth ? formatDate(p.date_of_birth) : null} />
                    <Detail always label="Age" value={p.age_years != null ? `${p.age_years} years` : null} />
                    <Detail always label="Sex" value={titleCase(p.sex) || null} />
                    <Detail always label="Phone" value={p.phone} />
                    <Detail label="Email" value={p.email} />
                    <Detail label="Address" value={p.address} className="sm:col-span-2" />
                    <Detail
                      label="Emergency contact"
                      value={p.emergency_name ? [p.emergency_name, p.emergency_relation && `(${p.emergency_relation})`, p.emergency_phone].filter(Boolean).join(' ') : null}
                      className="sm:col-span-2"
                    />
                  </dl>
                ) : <SkeletonRows rows={3} className="mt-4" />}
              </Card>
            </div>

            <Card className="p-5 sm:p-6">
              <CardHeader icon={History} title="Patient timeline" subtitle="Everything recorded for this patient" />
              <div className="mt-5">
                {events.isPending ? <SkeletonRows rows={4} /> : events.isError ? (
                  <ErrorState error={events.error} onRetry={events.refetch} />
                ) : (
                  <Timeline events={events.data} onOpen={(e) => navigate(`/app/scans/${e.study_id}`)} />
                )}
              </div>
            </Card>
          </div>
        )}

        {tab === 'clinical' && p && (
          <Card className="p-5 sm:p-6">
            <CardHeader title="Clinical information" action={<Button variant="ghost" size="sm" icon={Pencil} to={`/app/patients/${id}/edit`}>Edit</Button>} />
            <dl className="mt-5 grid gap-6 md:grid-cols-2">
              <Detail always label="Medical history" value={p.medical_history} className="md:col-span-2" />
              <Detail always label="Known conditions" value={p.conditions} />
              <Detail always label="Current medications" value={p.medications} />
              <Detail always label="Allergies" value={p.allergies} />
              <Detail always label="Previous neurological history" value={p.neuro_history} />
              <Detail always label="Clinical notes" value={p.clinical_notes} className="md:col-span-2" />
            </dl>
          </Card>
        )}

        {tab === 'scans' && (
          <Card className="p-5 sm:p-6">
            <CardHeader
              title="MRI scan history"
              subtitle="Newest first. Open a scan for its analysis, 3D view and report."
              action={<Button icon={Upload} size="sm" to={`/app/patients/${id}/new-scan`}>Upload MRI</Button>}
            />
            <div className="mt-4">
              {studies.isPending ? <SkeletonRows rows={3} /> : studies.isError ? <ErrorState error={studies.error} onRetry={studies.refetch} /> : scans.length === 0 ? (
                <EmptyState icon={ScanLine} title="No scans yet" action={<Button icon={Upload} to={`/app/patients/${id}/new-scan`}>Upload MRI</Button>} />
              ) : (
                <RecentScans rows={scans} showPatient={false} />
              )}
            </div>
          </Card>
        )}

        {tab === 'reports' && (
          <Card className="p-5 sm:p-6">
            <CardHeader title="Reports" subtitle="AI-assisted preliminary reports, one per analysed scan" />
            <div className="mt-4">
              {studies.isPending ? <SkeletonRows rows={3} /> : analysed.length === 0 ? (
                <EmptyState icon={FileText} title="No reports yet" body="A report is generated automatically when an MRI analysis completes." />
              ) : (
                <ul className="divide-y divide-[#EEF2F8]">
                  {analysed.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 py-3.5">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><FileText className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">{scanTitle(s)} · {formatDate(s.acquired_on || s.uploaded_at)}</p>
                        <p className="line-clamp-1 text-[13px] text-ink-soft">{s.headline}</p>
                      </div>
                      <StatusBadge status={s.status} />
                      <Button variant="secondary" size="sm" to={`/app/scans/${s.id}/report`} arrow>Open</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {tab === 'comparison' && (
          <div className="space-y-6">
            <Card className="p-5 sm:p-6">
              <CardHeader
                icon={GitCompareArrows}
                title="Progress over time"
                subtitle="Total segmented lesion volume per analysed scan"
                action={analysed.length >= 2 && <Button size="sm" icon={GitCompareArrows} to={`/app/patients/${id}/compare`}>Compare scans</Button>}
              />
              <div className="mt-4">
                {timeline.isPending ? <Skeleton className="h-48 w-full" /> : (timeline.data?.length ?? 0) < 2 ? (
                  <EmptyState icon={GitCompareArrows} title="Two analysed scans are needed"
                    body={`Progress can be tracked once this patient has at least two completed analyses. ${analysed.length === 1 ? 'One is available so far.' : ''}`}
                    action={<Button icon={Upload} variant="secondary" to={`/app/patients/${id}/new-scan`}>Upload a follow-up scan</Button>} />
                ) : (
                  <>
                    <VolumeTrendChart points={timeline.data} onSelect={(d) => navigate(`/app/scans/${d.study_id}`)} />
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-left text-[13px]">
                        <thead>
                          <tr className="border-b border-[#EEF2F8] text-[11.5px] uppercase tracking-[0.06em] text-ink-faint">
                            <th className="pb-2 pr-3 font-semibold">Scan date</th>
                            <th className="pb-2 pr-3 font-semibold">Lesions</th>
                            <th className="pb-2 pr-3 font-semibold">Total volume</th>
                            <th className="pb-2 font-semibold">Largest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {timeline.data.map((t) => (
                            <tr key={t.id} className="border-b border-[#F3F6FA] last:border-0">
                              <td className="py-2 pr-3 text-ink">{formatDate(t.acquired_on || t.created_at)}</td>
                              <td className="py-2 pr-3 text-ink-soft">{t.lesion_count ?? '—'}</td>
                              <td className="py-2 pr-3 text-ink-soft">{num(t.total_volume_cm3, 2, 'cm³') ?? '—'}</td>
                              <td className="py-2 text-ink-soft">{num(t.largest_volume_cm3, 2, 'cm³') ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card className="p-5 sm:p-6">
              <CardHeader title="Registered comparisons" subtitle="Scans aligned and compared lesion by lesion" />
              <div className="mt-4">
                {comparisons.isPending ? <SkeletonRows rows={2} /> : comparisons.data?.length ? (
                  <ul className="divide-y divide-[#EEF2F8]">
                    {comparisons.data.map((c) => {
                      const trend = TREND[c.trend] ?? TREND.indeterminate;
                      return (
                        <li key={c.id} className="flex flex-wrap items-center gap-3 py-3.5">
                          <Badge tone={trend.tone}>{trend.label}</Badge>
                          <p className="min-w-0 flex-1 text-[13.5px] text-ink-soft">{c.result?.summary}</p>
                          <span className="text-[12px] text-ink-faint">{formatDate(c.created_at)}</span>
                          <Button variant="ghost" size="sm" to={`/app/patients/${id}/compare?comparison=${c.id}`} arrow>View</Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[13.5px] text-ink-faint">No comparisons run yet.</p>
                )}
              </div>
            </Card>
          </div>
        )}
      </motion.div>
    </div>
  );
}
