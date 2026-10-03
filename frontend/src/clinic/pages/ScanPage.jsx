import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Brain,
  Check,
  ClipboardCheck,
  Download,
  FileText,
  GitCompareArrows,
  Layers,
  MapPin,
  Play,
  RotateCcw,
  Ruler,
  Sigma,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, saveBlob } from '../../api';
import { EASE, SPRING } from '../../landing/motion';
import MriVolumeViewer from '../components/MriVolumeViewer';
import SegmentationStrip from '../components/SegmentationStrip';
import {
  formatDate,
  formatDateTime,
  methodLabel,
  modelScope,
  num,
  scanTitle,
  STAGE_LABELS,
  titleCase,
  toDate,
  TREND,
} from '../format';
import { useScan } from '../useScan';
import { useToast } from '../toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DecisionSupportNote,
  ErrorState,
  Field,
  InlineAlert,
  Select,
  Skeleton,
  StatusBadge,
  TextArea,
} from '../ui';

const BrainViewer = lazy(() => import('../../components/BrainViewer'));

/* ------------------------------------------------------------ header */

function ScanHeader({ study, patient, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="mb-6">
      <Link to={patient ? `/app/patients/${patient.id}` : '/app/scans'} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft hover:text-brand">
        <ArrowLeft className="h-3.5 w-3.5" /> {patient ? patient.display_name : 'MRI scans'}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">MRI analysis</p>
          <h1 className="text-[clamp(1.45rem,1.15rem+1vw,1.95rem)] font-bold tracking-[-0.022em] text-ink">
            {patient?.display_name ?? <Skeleton as="span" className="inline-block h-7 w-48 align-middle" />}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-soft">
            {patient && <span className="font-mono text-[12.5px] font-semibold text-ink">{patient.code}</span>}
            <span>Scan ID <span className="font-mono text-[12.5px] text-ink">{study.code}</span></span>
            <span>{scanTitle(study)}</span>
            <span>Scan date {formatDate(study.acquired_on, 'not recorded')}</span>
            <StatusBadge status={study.status} />
          </p>
        </div>
        {children && <div className="flex flex-wrap gap-2">{children}</div>}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------ processing */

function StageRow({ label, state, index }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: index * 0.04 }}
      className="flex items-center gap-3.5 py-2.5"
    >
      <span className="relative grid h-7 w-7 shrink-0 place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          {state === 'done' && (
            <motion.span key="done" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={SPRING.icon}
              className="grid h-7 w-7 place-items-center rounded-full bg-mint text-white">
              <Check className="h-4 w-4" strokeWidth={3} />
            </motion.span>
          )}
          {state === 'active' && (
            <motion.span key="active" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={SPRING.icon} className="relative grid h-7 w-7 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand/25 motion-reduce:animate-none" />
              <span className="relative h-3.5 w-3.5 rounded-full bg-brand ring-4 ring-brand/15" />
            </motion.span>
          )}
          {state === 'pending' && (
            <motion.span key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-3.5 w-3.5 rounded-full border-2 border-[#CFDBEE]" />
          )}
        </AnimatePresence>
      </span>
      <span className={`text-[14.5px] transition-colors duration-300 ${state === 'active' ? 'font-bold text-ink' : state === 'done' ? 'font-medium text-ink' : 'text-ink-faint'}`}>
        {label}
      </span>
      {state === 'active' && <span className="ml-auto text-[12px] font-semibold text-brand">In progress</span>}
    </motion.li>
  );
}

function ProcessingView({ study, analysis }) {
  const stages = useQuery({ queryKey: ['pipeline-stages'], queryFn: api.pipelineStages, staleTime: Infinity });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const list = stages.data ?? [];
  const current = analysis?.stage;
  const currentIndex = list.findIndex((s) => s.key === current);
  const started = toDate(analysis?.created_at);
  const elapsed = started ? Math.max(0, Math.round((now - started.getTime()) / 1000)) : 0;
  const queued = analysis?.status === 'pending' || current === 'queued' || current === 'starting';

  const rows = [
    { key: 'uploaded', label: 'MRI uploaded', state: 'done' },
    ...list.map((s, i) => ({
      key: s.key,
      label: s.label,
      state: currentIndex === -1 ? 'pending' : i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending',
    })),
  ];

  return (
    <div className="mx-auto max-w-[760px]">
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-b from-[#F3F8FF] to-white px-6 pb-6 pt-8 text-center sm:px-10">
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-brand to-[#3FA0FF] text-white shadow-brand motion-reduce:!transform-none"
          >
            <Brain className="h-8 w-8" strokeWidth={1.6} />
          </motion.div>
          <h2 className="mt-5 text-[24px] font-bold tracking-[-0.02em] text-ink">Analyzing MRI Scan</h2>
          <p className="mx-auto mt-1.5 max-w-[48ch] text-[14px] text-ink-soft">
            {queued
              ? 'Waiting for the pipeline to start…'
              : <>Now: <span className="font-semibold text-ink">{STAGE_LABELS[current] ?? titleCase(current)}</span></>}
          </p>
          <div className="cx-scanline mx-auto mt-5 max-w-[420px]" aria-hidden />
          <p className="mt-3 font-mono text-[12px] text-ink-faint" aria-live="polite">Elapsed {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</p>
        </div>
        <ol className="divide-y divide-[#F1F4F9] px-6 pb-4 sm:px-10" aria-label="Pipeline stages">
          {rows.map(({ key, ...row }, i) => <StageRow key={key} {...row} index={i} />)}
        </ol>
        <p className="border-t border-[#EEF2F8] bg-[#F8FAFD] px-6 py-3 text-center text-[12.5px] text-ink-faint sm:px-10">
          Stages are reported live by the analysis worker. You can leave this page — the analysis continues and the result is saved to {study.patient_name ?? 'the patient'}’s record.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ failure */

function FailureView({ study, analysis, onRetry, retrying }) {
  return (
    <div className="mx-auto max-w-[680px]">
      <Card className="p-6 text-center sm:p-10">
        <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING.icon}
          className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blush-soft text-blush">
          <AlertTriangle className="h-7 w-7" strokeWidth={1.8} />
        </motion.span>
        <h2 className="mt-4 text-[22px] font-bold text-ink">Analysis could not be completed.</h2>
        <div className="mx-auto mt-4 max-w-[52ch] rounded-2xl border border-[#F8D3D1] bg-[#FFF6F5] px-4 py-3 text-left">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#B42318]">Reason</p>
          <p className="mt-1 text-[14px] text-[#5C1A14]">{analysis?.error || 'The pipeline stopped without reporting an error.'}</p>
          {analysis?.stage && <p className="mt-1.5 text-[12.5px] text-[#8F1D14]">Last stage reached: {STAGE_LABELS[analysis.stage] ?? analysis.stage}</p>}
        </div>
        <p className="mx-auto mt-4 max-w-[50ch] text-[13px] text-ink-soft">No results were produced, so none are shown. The uploaded scan is kept; you can retry, or upload a different file.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} to={`/app/patients/${study.patient_id}`}>Return to patient</Button>
          <Button icon={RotateCcw} onClick={onRetry} loading={retrying}>Retry analysis</Button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ results */

function SummaryTile({ icon: Icon, label, value, sub, tone = 'blue', index }) {
  const tones = { blue: 'bg-brand-soft text-brand', red: 'bg-blush-soft text-blush', violet: 'bg-[#F1EDFE] text-[#6A4FD8]', green: 'bg-mint-soft text-mint', slate: 'bg-[#EEF2F8] text-ink-soft' };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay: 0.1 + index * 0.06 }}
      className="rounded-2xl border border-[#E3EAF5] bg-white p-4"
    >
      <div className="flex items-center gap-2.5">
        <span className={`grid h-8 w-8 place-items-center rounded-xl ${tones[tone]}`}><Icon className="h-4 w-4" strokeWidth={2} /></span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</span>
      </div>
      <p className="mt-2.5 text-[16px] font-bold leading-snug text-ink">{value ?? <span className="text-[14px] font-medium text-ink-faint">Not available</span>}</p>
      {sub && <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{sub}</p>}
    </motion.div>
  );
}

function ReviewPanel({ analysis }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const reviews = useQuery({ queryKey: ['reviews', analysis.id], queryFn: () => api.listReviews(analysis.id) });
  const [form, setForm] = useState({ status: 'approved', comments: '', edited_impression: '' });
  const [error, setError] = useState(null);

  const save = useMutation({
    mutationFn: () => api.createReview(analysis.id, {
      status: form.status,
      comments: form.comments.trim() || null,
      edited_impression: form.edited_impression.trim() || null,
    }),
    onSuccess: () => {
      setForm({ status: 'approved', comments: '', edited_impression: '' });
      ['reviews', 'study', 'studies', 'dashboard', 'notifications', 'events', 'reports'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      toast.success('Review recorded and saved to the patient history.');
    },
    onError: (err) => setError(err.message),
  });

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader icon={ClipboardCheck} title="Clinician review" subtitle="Record your verdict. Reviews are append-only: the AI output is never overwritten." />
      {reviews.data?.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {reviews.data.map((r) => (
            <li key={r.id} className="rounded-2xl border border-[#E3EAF5] bg-[#F8FAFD] p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.status === 'rejected' ? 'red' : r.status === 'approved' ? 'green' : 'blue'}>{titleCase(r.status)}</Badge>
                <span className="text-[13.5px] font-semibold text-ink">{r.reviewer}</span>
                <span className="text-[12px] text-ink-faint">{formatDateTime(r.created_at)}</span>
              </div>
              {r.edited_impression && <p className="mt-2 text-[13.5px] text-ink"><span className="font-semibold">Revised impression:</span> {r.edited_impression}</p>}
              {r.comments && <p className="mt-1 text-[13.5px] text-ink-soft">{r.comments}</p>}
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}
      >
        <Field label="Verdict" required>
          {({ id }) => (
            <Select id={id} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="approved">Approve AI findings</option>
              <option value="reviewed">Reviewed — with comments</option>
              <option value="rejected">Reject AI findings</option>
            </Select>
          )}
        </Field>
        <div className="hidden sm:block" />
        <Field label="Revised impression" className="sm:col-span-2" hint="Optional. Stored alongside, not instead of, the AI impression.">
          {({ id }) => <TextArea id={id} value={form.edited_impression} onChange={(e) => setForm({ ...form, edited_impression: e.target.value })} />}
        </Field>
        <Field label="Clinical notes" className="sm:col-span-2">
          {({ id }) => <TextArea id={id} value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />}
        </Field>
        <InlineAlert tone="red" className="sm:col-span-2">{error}</InlineAlert>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" icon={ClipboardCheck} loading={save.isPending}>Save review</Button>
        </div>
      </form>
    </Card>
  );
}

function ThreePreview({ analysisId, studyId }) {
  const scene = useQuery({ queryKey: ['scene', analysisId], queryFn: () => api.getScene(analysisId), staleTime: Infinity });
  const [inView, setInView] = useState(false);
  const box = useRef(null);
  // WebGL and the 16 MB atlas are only worth loading once the section is on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInView(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        icon={Box}
        title="3D brain"
        subtitle="Detected regions in the patient's own millimetre frame"
        action={<Button size="sm" variant="secondary" icon={Box} to={`/app/scans/${studyId}/visualization`}>Open 3D viewer</Button>}
      />
      <div ref={box} className="cx-viewer-frame mt-4 h-[380px]">
        {scene.isError ? (
          <ErrorState error={scene.error} title="3D model unavailable" className="!text-white" />
        ) : inView && scene.data ? (
          <Suspense fallback={<Skeleton className="h-full w-full !rounded-none !bg-[#101828]" />}>
            <BrainViewer scene={scene.data} showFooter />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-white/60">Loading 3D model…</div>
        )}
      </div>
    </Card>
  );
}

function ResultsView({ study, analysis, patient }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const report = analysis.report || {};
  const burden = analysis.burden || report.burden || {};
  const lesions = analysis.lesions || [];
  const confidence = report.confidence || {};
  const technique = report.technique || analysis.technique || {};
  const regions = burden.regions_involved || [];
  const largest = lesions.reduce((best, l) => ((l.volume_cm3 || 0) > (best?.volume_cm3 || 0) ? l : best), null);

  const comparisons = useQuery({ queryKey: ['comparisons', study.patient_id], queryFn: () => api.listComparisons(study.patient_id) });
  const timeline = useQuery({ queryKey: ['timeline', study.patient_id], queryFn: () => api.timeline(study.patient_id) });
  const asFollowup = comparisons.data?.find((c) => c.followup_analysis_id === analysis.id);
  const otherAnalysed = (timeline.data ?? []).filter((t) => t.id !== analysis.id);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const blob = await api.reportPdf(analysis.id);
      saveBlob(blob, `NeuroVision_report_${patient?.code ?? study.id}_${study.acquired_on ?? 'scan'}.pdf`);
    } catch (err) {
      toast.error(`Report generation failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const noFinding = burden.lesion_count === 0;

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green" dot>Analysis complete</Badge>
              <Badge tone="amber">{study.status === 'reviewed' ? 'Reviewed' : 'Review recommended'}</Badge>
            </div>
            <h2 className="mt-3 text-[18px] font-bold tracking-[-0.01em] text-ink">AI analysis summary</h2>
            <p className="mt-1 max-w-[80ch] text-[14.5px] leading-relaxed text-ink">{report.headline}</p>
          </div>
          <p className="text-[12px] text-ink-faint sm:text-right">
            Completed {formatDateTime(analysis.completed_at)}
            {analysis.duration_seconds != null && <><br />in {num(analysis.duration_seconds, 1)} s · {methodLabel(analysis.method)}</>}
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile index={0} icon={Layers} tone={noFinding ? 'green' : 'red'} label="Finding"
            value={noFinding ? 'No focal region segmented' : `${burden.lesion_count} abnormal ${burden.lesion_count === 1 ? 'region' : 'regions'} detected`}
            sub={noFinding ? 'Below the detection threshold on this sequence' : `Lesion load ${num(burden.lesion_load_percent, 2, '% of brain') ?? '—'}`} />
          <SummaryTile index={1} icon={MapPin} tone="violet" label="Location"
            value={regions.length ? titleCase(regions[0]) : noFinding ? '—' : null}
            sub={regions.length > 1 ? `+ ${regions.slice(1).join(', ')}` : regions.length ? 'Approximate, geometric zoning' : null} />
          <SummaryTile index={2} icon={Sigma} tone="blue" label="Model confidence"
            value={confidence.detection_confidence != null ? `${num(confidence.detection_confidence, 2)} · ${titleCase(confidence.detection_confidence_label || '')}` : null}
            sub={confidence.calibrated ? 'Calibrated probability' : 'Uncalibrated: ranks voxels, not disease likelihood'} />
          <SummaryTile index={3} icon={Ruler} tone="slate" label="Total volume"
            value={num(burden.total_volume_cm3, 2, 'cm³')}
            sub={largest ? `Largest ${num(largest.volume_cm3, 2, 'cm³')}, ⌀ ${num(largest.max_diameter_mm, 1, 'mm')}` : null} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button icon={Box} to={`/app/scans/${study.id}/visualization`}>View 3D</Button>
          <Button variant="secondary" icon={FileText} to={`/app/scans/${study.id}/report`}>View report</Button>
          <Button variant="secondary" icon={GitCompareArrows} disabled={otherAnalysed.length === 0}
            title={otherAnalysed.length === 0 ? 'Needs another analysed scan for this patient' : undefined}
            to={`/app/patients/${study.patient_id}/compare?followup=${analysis.id}`}>
            Compare scan
          </Button>
          <Button variant="secondary" icon={Download} onClick={downloadPdf} loading={downloading}>Download report</Button>
        </div>
        <DecisionSupportNote className="mt-5" />
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader icon={Layers} title="MRI viewer" subtitle="Every slice of the preprocessed volume, with the AI segmentation from this analysis." />
        <div className="mt-5"><MriVolumeViewer analysisId={analysis.id} /></div>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader title="Segmentation" subtitle="The slice with the largest segmented area, in each rendering" />
        <div className="mt-5"><SegmentationStrip analysisId={analysis.id} slices={analysis.slices} /></div>
      </Card>

      <ThreePreview analysisId={analysis.id} studyId={study.id} />

      <Card className="p-5 sm:p-6">
        <CardHeader title="Detailed results" subtitle="Per-region measurements produced by the pipeline" />
        {lesions.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-[#EEF2F8] text-[11.5px] uppercase tracking-[0.06em] text-ink-faint">
                  <th className="pb-2.5 pr-3 font-semibold">#</th>
                  <th className="pb-2.5 pr-3 font-semibold">Location (approx.)</th>
                  <th className="pb-2.5 pr-3 font-semibold">Volume</th>
                  <th className="pb-2.5 pr-3 font-semibold">Max ⌀</th>
                  <th className="pb-2.5 pr-3 font-semibold">Extent (mm)</th>
                  <th className="pb-2.5 pr-3 font-semibold">Sphericity</th>
                  <th className="pb-2.5 font-semibold">Mean prob.</th>
                </tr>
              </thead>
              <tbody>
                {lesions.map((l) => (
                  <tr key={l.id} className="border-b border-[#F3F6FA] last:border-0">
                    <td className="py-2.5 pr-3 font-mono text-ink-soft">{l.id}</td>
                    <td className="py-2.5 pr-3 font-semibold text-ink">{titleCase(`${l.side ?? ''} ${l.region ?? ''}`.trim()) || '—'}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{num(l.volume_cm3, 3, 'cm³') ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{num(l.max_diameter_mm, 1, 'mm') ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{l.dimensions_mm ? l.dimensions_mm.map((d) => Number(d).toFixed(0)).join(' × ') : '—'}</td>
                    <td className="py-2.5 pr-3 text-ink-soft">{num(l.sphericity, 2) ?? '—'}</td>
                    <td className="py-2.5 text-ink-soft">{num(l.mean_probability, 2) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-[13.5px] text-ink-soft">No regions were segmented above the threshold ({num(technique.segmentation_threshold, 2) ?? 'default'}).</p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-faint">Findings</h3>
            <ul className="mt-2 space-y-1.5 text-[13.5px] text-ink">
              {(report.findings || []).map((f) => <li key={f} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />{f}</li>)}
            </ul>
            {report.impression && (
              <>
                <h3 className="mt-5 text-[13px] font-bold uppercase tracking-[0.08em] text-ink-faint">AI impression</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{report.impression}</p>
              </>
            )}
          </div>
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-faint">Model output</h3>
            <dl className="mt-2 space-y-1.5 text-[13.5px]">
              {[
                ['Method', methodLabel(technique.segmentation_method || analysis.method)],
                ['Model trained on', modelScope(technique) ?? 'Not available'],
                ['Threshold', num(technique.segmentation_threshold, 2)],
                ['Mean probability', num(burden.mean_probability, 3)],
                ['Brain volume', num(burden.brain_volume_cm3, 0, 'cm³')],
                ['Input', technique.original_shape ? `${technique.original_shape.join('×')} @ ${technique.original_spacing_mm?.join('×')} mm` : null],
                ['Resampled to', technique.processed_spacing_mm ? `${technique.processed_spacing_mm.join('×')} mm isotropic` : null],
              ].filter(([, v]) => v != null).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-[#F3F6FA] pb-1.5">
                  <dt className="text-ink-soft">{k}</dt><dd className="text-right font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {confidence.calibration_note && <p className="mt-3 text-[12px] leading-snug text-ink-faint">{confidence.calibration_note}</p>}
          </div>
        </div>
        {report.limitations?.length > 0 && (
          <details className="group mt-6 rounded-2xl border border-[#E3EAF5] bg-[#F8FAFD] p-4">
            <summary className="cursor-pointer text-[13.5px] font-semibold text-ink">Limitations of this analysis ({report.limitations.length})</summary>
            <ul className="mt-3 space-y-1.5 text-[13px] text-ink-soft">
              {report.limitations.map((l) => <li key={l} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />{l}</li>)}
            </ul>
          </details>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader icon={GitCompareArrows} title="Comparison" subtitle="Change against an earlier analysed scan of this patient" />
        <div className="mt-4">
          {asFollowup ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={(TREND[asFollowup.trend] ?? TREND.indeterminate).tone}>{(TREND[asFollowup.trend] ?? TREND.indeterminate).label}</Badge>
              <p className="min-w-0 flex-1 text-[13.5px] text-ink">{asFollowup.result?.summary}</p>
              <Button variant="secondary" size="sm" to={`/app/patients/${study.patient_id}/compare?comparison=${asFollowup.id}`} arrow>Open comparison</Button>
            </div>
          ) : otherAnalysed.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px] text-ink-soft">{otherAnalysed.length} other analysed {otherAnalysed.length === 1 ? 'scan is' : 'scans are'} available for this patient.</p>
              <Button icon={GitCompareArrows} to={`/app/patients/${study.patient_id}/compare?followup=${analysis.id}`}>Compare with previous scan</Button>
            </div>
          ) : (
            <p className="text-[13.5px] text-ink-soft">This is the only analysed scan for this patient. Upload a follow-up to track change over time.</p>
          )}
        </div>
      </Card>

      <ReviewPanel analysis={analysis} />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><FileText className="h-5 w-5" /></span>
          <div>
            <p className="font-semibold text-ink">Preliminary report</p>
            <p className="text-[13px] text-ink-soft">Saved to {patient?.display_name ?? 'the patient'}’s history.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={FileText} onClick={() => navigate(`/app/scans/${study.id}/report`)}>View report</Button>
          <Button icon={Download} onClick={downloadPdf} loading={downloading}>Download PDF</Button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ page */

export default function ScanPage() {
  const { scanId } = useParams();
  const { id, study, analysis, patient } = useScan(scanId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const lastStatus = useRef(null);

  // When the worker finishes, refresh everything that summarises this scan.
  useEffect(() => {
    const status = analysis.data?.status;
    if (lastStatus.current && lastStatus.current !== status && (status === 'complete' || status === 'failed')) {
      ['study', 'studies', 'dashboard', 'notifications', 'events', 'timeline', 'reports', 'patients'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      if (status === 'complete') toast.success('AI analysis complete. Results are saved to the patient history.');
    }
    lastStatus.current = status;
  }, [analysis.data?.status, queryClient, toast]);

  const start = useMutation({
    mutationFn: () => api.startAnalysis(id),
    onSuccess: (created) => {
      queryClient.setQueryData(['analysis', created.id], created);
      queryClient.invalidateQueries({ queryKey: ['study', id] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (study.isError) {
    return (
      <Card>
        <ErrorState error={study.error} title={study.error.status === 404 ? 'Scan not found' : 'Could not load this scan'} onRetry={study.error.status === 404 ? undefined : study.refetch} />
        <div className="pb-8 text-center"><Button variant="secondary" to="/app/scans">All scans</Button></div>
      </Card>
    );
  }
  if (study.isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-44 w-full !rounded-3xl" />
        <Skeleton className="h-[420px] w-full !rounded-3xl" />
      </div>
    );
  }

  const s = study.data;
  const a = analysis.data;
  // Prefer the analysis row (polled fastest) over the derived study status.
  const view = !s.latest_analysis_id ? 'uploaded'
    : !a ? 'loading'
      : a.status === 'complete' ? 'complete'
        : a.status === 'failed' ? 'failed'
          : 'processing';

  return (
    <div>
      {/* The study row can lag the analysis row by one poll; don't show
          "Processing" above finished results. */}
      <ScanHeader
        study={{ ...s, status: view === 'complete' && ['queued', 'processing'].includes(s.status) ? 'needs_review' : s.status }}
        patient={patient.data}
      />

      <AnimatePresence mode="wait">
        <motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.4, ease: EASE }}>
          {view === 'uploaded' && (
            <Card className="mx-auto max-w-[680px] p-6 text-center sm:p-10">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Play className="h-6 w-6" /></span>
              <h2 className="mt-4 text-[20px] font-bold text-ink">Ready for analysis</h2>
              <p className="mx-auto mt-1.5 max-w-[48ch] text-[14px] text-ink-soft">
                {s.original_filename} · {s.shape} voxels at {s.spacing_mm} mm. Start the AI pipeline to generate segmentation, measurements, a 3D model and a report.
              </p>
              <Button size="lg" icon={Play} className="mt-6" onClick={() => start.mutate()} loading={start.isPending}>Analyze MRI</Button>
            </Card>
          )}
          {view === 'loading' && <Skeleton className="h-[420px] w-full !rounded-3xl" />}
          {view === 'processing' && <ProcessingView study={s} analysis={a} />}
          {view === 'failed' && <FailureView study={s} analysis={a} onRetry={() => start.mutate()} retrying={start.isPending} />}
          {view === 'complete' && <ResultsView study={s} analysis={a} patient={patient.data} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
