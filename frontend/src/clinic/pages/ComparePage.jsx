import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, GitCompareArrows } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { EASE } from '../../landing/motion';
import { formatDate, num, REGION_CHANGE, titleCase, TREND } from '../format';
import { useToast } from '../toast';
import { Badge, Button, Card, CardHeader, DecisionSupportNote, EmptyState, ErrorState, Field, InlineAlert, PageHeader, Select, Skeleton } from '../ui';

const BrainViewer = lazy(() => import('../../components/BrainViewer'));

const CHANGE_TONE = { new: 'red', increased: 'red', decreased: 'green', resolved: 'green', stable: 'slate' };

function ScanTag({ label, tone, scan }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone === 'blue' ? 'border-[#CFE1FB] bg-[#F3F8FF]' : 'border-[#E3EAF5] bg-[#F8FAFD]'}`}>
      <p className={`text-[11.5px] font-bold uppercase tracking-[0.1em] ${tone === 'blue' ? 'text-brand' : 'text-ink-faint'}`}>{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold text-ink">{formatDate(scan.acquired_on || scan.created_at)} · {scan.sequence ?? 'MRI'}</p>
      <p className="text-[12.5px] text-ink-soft">{scan.lesion_count ?? 0} {scan.lesion_count === 1 ? 'region' : 'regions'} · {num(scan.total_volume_cm3, 2, 'cm³') ?? 'volume not available'}</p>
    </div>
  );
}

function label(t) {
  return `${formatDate(t.acquired_on || t.created_at)} · ${t.sequence ?? 'MRI'} · ${t.lesion_count ?? 0} ${t.lesion_count === 1 ? 'region' : 'regions'}`;
}

function BestSlice({ analysisId, caption }) {
  const analysis = useQuery({ queryKey: ['analysis', analysisId], queryFn: () => api.getAnalysis(analysisId) });
  const entries = analysis.data?.slices?.axial ?? [];
  const best = entries.reduce((b, e) => ((e.lesion_area_mm2 || 0) > (b?.lesion_area_mm2 || 0) ? e : b), entries[0]);
  return (
    <figure className="overflow-hidden rounded-2xl border border-[#E3EAF5] bg-white">
      {best ? (
        <img src={api.sliceUrl(analysisId, best.overlay)} alt={`${caption}: axial slice ${best.index}`} className="aspect-square w-full bg-black object-contain" />
      ) : <Skeleton className="aspect-square w-full !rounded-none" />}
      <figcaption className="px-3 py-2.5 text-[13px] font-semibold text-ink">{caption}{best && <span className="font-normal text-ink-faint"> · axial {best.index}</span>}</figcaption>
    </figure>
  );
}

export default function ComparePage() {
  const { patientId } = useParams();
  const pid = Number(patientId);
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const patient = useQuery({ queryKey: ['patient', pid], queryFn: () => api.getPatient(pid) });
  const timeline = useQuery({ queryKey: ['timeline', pid], queryFn: () => api.timeline(pid) });
  const comparisonId = params.get('comparison');
  const comparison = useQuery({
    queryKey: ['comparison', Number(comparisonId)],
    queryFn: () => api.getComparison(comparisonId),
    enabled: Boolean(comparisonId),
  });
  const changeScene = useQuery({
    queryKey: ['comparison-scene', Number(comparisonId)],
    queryFn: () => api.getComparisonScene(comparisonId),
    enabled: Boolean(comparisonId),
    staleTime: Infinity,
  });

  const list = timeline.data ?? [];
  const [baseline, setBaseline] = useState('');
  const [followup, setFollowup] = useState('');
  const [error, setError] = useState(null);

  // Sensible defaults: the requested (or latest) scan as current, the one
  // acquired just before it as previous.
  useEffect(() => {
    if (!list.length) return;
    if (comparison.data) {
      setBaseline(String(comparison.data.baseline_analysis_id));
      setFollowup(String(comparison.data.followup_analysis_id));
      return;
    }
    const wanted = Number(params.get('followup'));
    const fIndex = Math.max(0, wanted ? list.findIndex((t) => t.id === wanted) : list.length - 1);
    const f = list[fIndex === -1 ? list.length - 1 : fIndex];
    const b = list[Math.max(0, list.indexOf(f) - 1)];
    setFollowup(String(f.id));
    setBaseline(String(b && b.id !== f.id ? b.id : list.find((t) => t.id !== f.id)?.id ?? ''));
  }, [list.length, comparison.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useMutation({
    mutationFn: () => api.createComparison({ baseline_analysis_id: Number(baseline), followup_analysis_id: Number(followup) }),
    onSuccess: (created) => {
      queryClient.setQueryData(['comparison', created.id], created);
      queryClient.invalidateQueries({ queryKey: ['comparisons', pid] });
      queryClient.invalidateQueries({ queryKey: ['events', pid] });
      setParams({ comparison: String(created.id) }, { replace: true });
      toast.success('Comparison complete and saved to the patient history.');
    },
    onError: (err) => setError(err.message),
  });

  const result = comparison.data?.result;
  const trend = TREND[result?.trend] ?? TREND.indeterminate;
  const byId = useMemo(() => Object.fromEntries(list.map((t) => [t.id, t])), [list]);
  const shownBase = comparison.data ? byId[comparison.data.baseline_analysis_id] : null;
  const shownFollow = comparison.data ? byId[comparison.data.followup_analysis_id] : null;

  const submit = () => {
    setError(null);
    if (!baseline || !followup) return setError('Choose two scans.');
    if (baseline === followup) return setError('Choose two different scans.');
    const b = byId[Number(baseline)];
    const f = byId[Number(followup)];
    if (b?.acquired_on && f?.acquired_on && f.acquired_on < b.acquired_on) {
      return setError('The current scan was acquired before the previous one. Swap them.');
    }
    return run.mutate();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Longitudinal comparison"
        title="Compare scans"
        subtitle={patient.data ? `${patient.data.display_name} · ${patient.data.code}` : ' '}
        back={<Link to={`/app/patients/${pid}?tab=comparison`} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft hover:text-brand"><ArrowLeft className="h-3.5 w-3.5" /> Back to patient</Link>}
      />

      {timeline.isError ? <Card><ErrorState error={timeline.error} onRetry={timeline.refetch} /></Card> : timeline.isPending ? <Skeleton className="h-40 w-full !rounded-3xl" /> : list.length < 2 ? (
        <Card><EmptyState icon={GitCompareArrows} title="Two analysed scans are needed" body="Upload and analyse a follow-up MRI for this patient to compare it with an earlier scan."
          action={<Button to={`/app/patients/${pid}/new-scan`}>Upload MRI</Button>} /></Card>
      ) : (
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_1fr_auto]">
              <Field label="Previous scan (older)">
                {({ id }) => (
                  <Select id={id} value={baseline} onChange={(e) => setBaseline(e.target.value)} disabled={run.isPending}>
                    {list.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}
                  </Select>
                )}
              </Field>
              <ArrowRight className="mb-3 hidden h-5 w-5 text-ink-faint md:block" />
              <Field label="Current scan (newer)">
                {({ id }) => (
                  <Select id={id} value={followup} onChange={(e) => setFollowup(e.target.value)} disabled={run.isPending}>
                    {list.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}
                  </Select>
                )}
              </Field>
              <Button icon={GitCompareArrows} onClick={submit} loading={run.isPending}>
                {run.isPending ? 'Registering…' : 'Compare'}
              </Button>
            </div>
            <InlineAlert tone="red" className="mt-4">{error}</InlineAlert>
            {run.isPending && (
              <div className="mt-4">
                <div className="cx-scanline" />
                <p className="mt-2 text-[13px] text-ink-soft">Aligning the two scans (rigid registration) and matching regions across time. This takes around 20–60 seconds.</p>
              </div>
            )}
          </Card>

          {comparisonId && comparison.isPending && <Skeleton className="h-64 w-full !rounded-3xl" />}
          {comparison.isError && <Card><ErrorState error={comparison.error} onRetry={comparison.refetch} /></Card>}

          {result && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="space-y-6">
              <Card className="p-5 sm:p-6">
                {shownBase && shownFollow && (
                  <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <ScanTag tone="slate" label="Older" scan={shownBase} />
                    <ArrowRight className="mx-auto hidden h-5 w-5 text-ink-faint sm:block" />
                    <ScanTag tone="blue" label="Newer" scan={shownFollow} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Pipeline change classification</span>
                  <Badge tone={trend.tone} dot>{trend.label}</Badge>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink">{result.summary}</p>
                <p className="mt-2 text-[12.5px] text-ink-faint">
                  Computed by the pipeline after rigid registration, from segmented volumes only; changes within ±20% are classed as stable.
                  It describes segmentation change, not clinical response — interpret with clinical context.
                </p>

                {result.metrics?.length > 0 && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {result.metrics.map((m) => (
                      <div key={m.label} className="rounded-2xl border border-[#E3EAF5] p-4">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{m.label}</p>
                        <p className="mt-2 flex items-baseline gap-2 text-ink">
                          <span className="text-[14px] text-ink-soft" title="Older scan">{m.baseline ?? 'Not available'}</span>
                          <ArrowRight className="h-3.5 w-3.5 self-center text-ink-faint" />
                          <span className="text-[18px] font-bold" title="Newer scan">{m.followup ?? 'Not available'}</span>
                          <span className="text-[12.5px] text-ink-soft">{m.unit}</span>
                        </p>
                        <p className={`mt-1 text-[12.5px] font-semibold ${m.direction === 'flat' ? 'text-ink-faint' : 'text-ink-soft'}`}>
                          {m.change == null ? 'Change not available' : (
                            <>
                              {m.change > 0 ? '+' : ''}{m.change}{m.unit ? ` ${m.unit}` : ''}
                              {m.change_percent != null ? ` (${m.change_percent > 0 ? '+' : ''}${m.change_percent}%)` : ' (% not available: previous value was 0)'}
                            </>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {result.alerts?.length > 0 && (
                  <ul className="mt-5 space-y-2">
                    {result.alerts.map((alert, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-xl border border-[#F4DDB2] bg-[#FFF9EE] px-3.5 py-2.5 text-[13px] text-[#7A4A00]">
                        <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0" />
                        <span>{alert.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-5 sm:p-6">
                <CardHeader title="Side by side" subtitle="Axial slice with the largest segmented area in each scan, each in its own space. Measurements above are computed after registration." />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <BestSlice analysisId={comparison.data.baseline_analysis_id} caption={`Older · ${shownBase ? formatDate(shownBase.acquired_on || shownBase.created_at) : ''}`} />
                  <BestSlice analysisId={comparison.data.followup_analysis_id} caption={`Newer · ${shownFollow ? formatDate(shownFollow.acquired_on || shownFollow.created_at) : ''}`} />
                </div>
              </Card>

              <Card className="p-5 sm:p-6">
                <CardHeader title="Change map (3D)" subtitle="Previous and current segmentations in the same registered frame" />
                <div className="cx-viewer-frame mt-4 h-[420px]">
                  {changeScene.isError ? (
                    <div className="grid h-full place-items-center p-6 text-center text-[13.5px] text-white/70">3D change map unavailable: {changeScene.error.message}</div>
                  ) : changeScene.data ? (
                    <Suspense fallback={<div className="grid h-full place-items-center text-white/60">Loading…</div>}>
                      <BrainViewer scene={changeScene.data} mode="change" brainSurface="patient" />
                    </Suspense>
                  ) : <div className="grid h-full place-items-center text-[13.5px] text-white/60">Loading 3D change map…</div>}
                </div>
              </Card>

              {result.lesion_changes?.length > 0 && (
                <Card className="p-5 sm:p-6">
                  <CardHeader title="Region-by-region change" />
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-[13.5px]">
                      <thead>
                        <tr className="border-b border-[#EEF2F8] text-[11.5px] uppercase tracking-[0.06em] text-ink-faint">
                          <th className="pb-2.5 pr-3 font-semibold">Change</th>
                          <th className="pb-2.5 pr-3 font-semibold">Location (approx.)</th>
                          <th className="pb-2.5 pr-3 font-semibold">Older scan</th>
                          <th className="pb-2.5 pr-3 font-semibold">Newer scan</th>
                          <th className="pb-2.5 font-semibold">Volume change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.lesion_changes.map((c, i) => (
                          <tr key={i} className="border-b border-[#F3F6FA] last:border-0">
                            <td className="py-2.5 pr-3"><Badge tone={CHANGE_TONE[c.status] ?? 'slate'}>{REGION_CHANGE[c.status] ?? titleCase(c.status)}</Badge></td>
                            <td className="py-2.5 pr-3 text-ink">{titleCase(`${c.side ?? ''} ${c.region ?? ''}`.trim())}</td>
                            <td className="py-2.5 pr-3 text-ink-soft">{c.status === 'new' ? 'Not present' : num(c.baseline_volume_cm3, 3, 'cm³') ?? 'Not available'}</td>
                            <td className="py-2.5 pr-3 text-ink-soft">{c.status === 'resolved' ? 'Not present' : num(c.followup_volume_cm3, 3, 'cm³') ?? 'Not available'}</td>
                            <td className="py-2.5 text-ink-soft">
                              {num(c.volume_change_cm3, 3, 'cm³')}{c.volume_change_percent != null ? ` (${c.volume_change_percent > 0 ? '+' : ''}${num(c.volume_change_percent, 0)}%)` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-[12px] text-ink-faint">Changes within ±20% are classed as stable, so segmentation noise is not reported as response.</p>
                </Card>
              )}

              <DecisionSupportNote />
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
