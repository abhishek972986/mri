/**
 * The sidebar's cross-patient views: every scan, every report, the 3D
 * visualization picker, and the "which patient?" step before an upload.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Box, ChevronRight, FileText, ScanLine, Search, Upload, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { formatDate, scanTitle, STATUS, titleCase } from '../format';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, SkeletonRows } from '../ui';
import { RecentScans } from './DashboardPage';

export function ScansPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [term, setTerm] = useState(params.get('q') || '');
  const [q, setQ] = useState(term);
  useEffect(() => { const t = setTimeout(() => setQ(term), 300); return () => clearTimeout(t); }, [term]);

  const scans = useQuery({
    queryKey: ['all-studies', { status, q }],
    queryFn: () => api.listAllStudies({ status, q }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.some((s) => s.status === 'queued' || s.status === 'processing') ? 4000 : false),
  });

  return (
    <div>
      <PageHeader eyebrow="Imaging" title="MRI scans" subtitle="Every scan across your patients, newest first."
        actions={<Button icon={Upload} to="/app/scans/upload">Upload MRI</Button>} />
      <Card className="p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative block">
            <span className="sr-only">Search by patient</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by patient name or ID" className="cx-input !pl-10" />
          </label>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {}, { replace: true })}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}
          </Select>
        </div>
        <div className="mt-5">
          {scans.isPending ? <SkeletonRows rows={6} /> : scans.isError ? <ErrorState error={scans.error} onRetry={scans.refetch} /> : scans.data.length === 0 ? (
            <EmptyState icon={ScanLine} title={status || q ? 'No scans match' : 'No scans yet'} body={status || q ? 'Try another filter.' : 'Upload a scan from a patient profile to begin.'} />
          ) : <RecentScans rows={scans.data} />}
        </div>
      </Card>
    </div>
  );
}

export function ReportsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const reports = useQuery({ queryKey: ['reports'], queryFn: api.reports });
  const rows = (reports.data ?? []).filter((r) => {
    if (r.superseded) return false;
    if (filter === 'pending') return !r.review_status;
    if (filter === 'reviewed') return Boolean(r.review_status);
    return true;
  });

  return (
    <div>
      <PageHeader eyebrow="Documentation" title="Reports" subtitle="AI-assisted preliminary reports, one per analysed scan." />
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-[#EEF2F8] p-1 text-[13px] font-semibold">
            {[['', 'All'], ['pending', 'Awaiting review'], ['reviewed', 'Reviewed']].map(([key, text]) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={`rounded-lg px-3.5 py-1.5 transition-colors ${filter === key ? 'bg-white text-ink shadow-soft' : 'text-ink-soft hover:text-ink'}`}>{text}</button>
            ))}
          </div>
          {reports.data && <span className="text-[13px] text-ink-faint">{rows.length} shown</span>}
        </div>
        <div className="mt-5">
          {reports.isPending ? <SkeletonRows rows={5} /> : reports.isError ? <ErrorState error={reports.error} onRetry={reports.refetch} /> : rows.length === 0 ? (
            <EmptyState icon={FileText} title="No reports" body="Reports are generated automatically when an MRI analysis completes." />
          ) : (
            <ul className="divide-y divide-[#EEF2F8]">
              {rows.map((r) => (
                <li key={r.analysis_id}>
                  <button type="button" onClick={() => navigate(`/app/scans/${r.study_id}/report`)} className="group flex w-full flex-wrap items-center gap-3 py-3.5 text-left sm:flex-nowrap">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><FileText className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{r.patient_name} <span className="font-mono text-[12px] font-normal text-ink-faint">{r.patient_code}</span></span>
                      <span className="block truncate text-[13px] text-ink-soft">{formatDate(r.acquired_on || r.completed_at)} · {r.sequence} · {r.headline}</span>
                    </span>
                    {r.review_status ? <Badge tone="green">{titleCase(r.review_status)}</Badge> : <Badge tone="amber">Needs review</Badge>}
                    <ChevronRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

export function VisualizationIndexPage() {
  const navigate = useNavigate();
  const scans = useQuery({ queryKey: ['all-studies', { status: '', q: '' }], queryFn: () => api.listAllStudies({}) });
  const ready = (scans.data ?? []).filter((s) => s.status === 'needs_review' || s.status === 'reviewed');

  return (
    <div>
      <PageHeader eyebrow="Imaging" title="3D visualization" subtitle="Choose an analysed scan to explore its detected regions in 3D." />
      <Card className="p-4 sm:p-5">
        {scans.isPending ? <SkeletonRows rows={4} /> : scans.isError ? <ErrorState error={scans.error} onRetry={scans.refetch} /> : ready.length === 0 ? (
          <EmptyState icon={Box} title="No analysed scans yet" body="A 3D model is generated for every completed MRI analysis." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ready.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => navigate(`/app/scans/${s.id}/visualization`)}
                  className="cx-card-hover flex w-full items-start gap-3 rounded-2xl border border-[#E3EAF5] bg-white p-4 text-left">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#1A2436] to-[#0B111C] text-[#7CC4FF]"><Box className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{s.patient_name}</span>
                    <span className="block text-[12.5px] text-ink-soft">{scanTitle(s)} · {formatDate(s.acquired_on || s.uploaded_at)}</span>
                    <span className="mt-1 block text-[12px] text-ink-faint">{s.lesion_count ?? 0} {s.lesion_count === 1 ? 'region' : 'regions'} detected</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Upload started without a patient: choose one, then go to their upload page. */
export function UploadPickerPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term), 250); return () => clearTimeout(t); }, [term]);
  const patients = useQuery({
    queryKey: ['patients', { q, picker: true }],
    queryFn: () => api.listPatients({ q, page_size: 30 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader eyebrow="Upload MRI" title="Which patient is this scan for?" subtitle="Every scan is stored against exactly one patient." />
      <Card className="p-4 sm:p-5">
        <label className="relative block">
          <span className="sr-only">Search patients</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input autoFocus type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name or patient ID" className="cx-input !pl-10" />
        </label>
        <div className="mt-4">
          {patients.isPending ? <SkeletonRows rows={4} /> : patients.isError ? <ErrorState error={patients.error} onRetry={patients.refetch} /> : patients.data.items.length === 0 ? (
            <EmptyState icon={Users} title={q ? 'No matching patient' : 'No patients yet'} body="Create the patient record first, then upload their scan."
              action={<Button icon={UserPlus} to="/app/patients/new">Add patient</Button>} />
          ) : (
            <ul className="divide-y divide-[#EEF2F8]">
              {patients.data.items.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => navigate(`/app/patients/${p.id}/new-scan`)} className="group flex w-full items-center gap-3 py-3 text-left">
                    <Avatar name={p.display_name} src={p.has_photo ? api.patientPhotoUrl(p.id) : null} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{p.display_name}</span>
                      <span className="block text-[12.5px] text-ink-faint">{p.code}{p.age_years != null ? ` · ${p.age_years} y` : ''} · {p.study_count} scans</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand">Upload <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 flex justify-end border-t border-[#EEF2F8] pt-4">
          <Button variant="ghost" icon={UserPlus} to="/app/patients/new">New patient instead</Button>
        </div>
      </Card>
    </div>
  );
}
