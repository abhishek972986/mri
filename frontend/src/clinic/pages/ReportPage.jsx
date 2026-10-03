import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Brain, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, saveBlob } from '../../api';
import { useAuth } from '../auth';
import { doctorName, formatDate, formatDateTime, methodLabel, modelScope, num, titleCase, TREND } from '../format';
import { useScan } from '../useScan';
import { useToast } from '../toast';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '../ui';

function Section({ title, children }) {
  return (
    <section className="break-inside-avoid border-t border-[#E3EAF5] pt-5">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.1em] text-brand">{title}</h2>
      {children}
    </section>
  );
}

function KV({ rows }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-[#F1F4F9] pb-1.5 text-[13.5px]">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="text-right font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Pick the overlay slice with the most segmented area in each plane. */
function bestSlices(slices) {
  return ['axial', 'coronal', 'sagittal']
    .map((plane) => {
      const entries = slices?.[plane] ?? [];
      if (!entries.length) return null;
      const best = entries.reduce((b, e) => ((e.lesion_area_mm2 || 0) > (b.lesion_area_mm2 || 0) ? e : b), entries[0]);
      return { plane, ...best };
    })
    .filter(Boolean);
}

export default function ReportPage() {
  const { scanId } = useParams();
  const { id, study, analysis, patient } = useScan(scanId);
  const { doctor } = useAuth();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const a = analysis.data;
  const complete = a?.status === 'complete';
  const reviews = useQuery({ queryKey: ['reviews', a?.id], queryFn: () => api.listReviews(a.id), enabled: complete });
  const comparisons = useQuery({
    queryKey: ['comparisons', study.data?.patient_id],
    queryFn: () => api.listComparisons(study.data.patient_id),
    enabled: complete && Boolean(study.data?.patient_id),
  });
  const comparison = comparisons.data?.find((c) => c.followup_analysis_id === a?.id);
  const latestReview = reviews.data?.length ? reviews.data[reviews.data.length - 1] : null;
  const reviewBadge = {
    approved: { label: 'Approved by clinician', className: 'bg-[#E9F7F1] text-[#0B7A57] ring-[#CDEBDD]' },
    reviewed: { label: 'Reviewed by clinician', className: 'bg-[#EAF2FE] text-[#0B5CC4] ring-[#CFE1FB]' },
    rejected: { label: 'AI findings rejected by clinician', className: 'bg-[#FDEEEE] text-[#B42318] ring-[#F8D3D1]' },
  }[latestReview?.status] ?? { label: 'Preliminary · review required', className: 'bg-[#FFF5E6] text-[#9A5B00] ring-[#F7DDB0]' };

  const download = async () => {
    setDownloading(true);
    try {
      saveBlob(await api.reportPdf(a.id), `NeuroVision_report_${patient.data?.code ?? id}_${study.data?.acquired_on ?? 'scan'}.pdf`);
    } catch (err) {
      toast.error(`Report generation failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  if (study.isError) return <Card><ErrorState error={study.error} title="Could not load this report" onRetry={study.refetch} /></Card>;
  if (study.isPending || analysis.isPending || (complete && patient.isPending)) {
    return <Card className="space-y-4 p-8"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-64 w-full" /></Card>;
  }
  if (!complete) {
    return (
      <Card>
        <EmptyState icon={Brain} title="No report yet"
          body={a?.status === 'failed' ? 'The analysis failed, so no report was generated.' : 'The report is generated when the AI analysis completes.'}
          action={<Button to={`/app/scans/${id}`}>Go to analysis</Button>} />
      </Card>
    );
  }

  const s = study.data;
  const p = patient.data;
  const report = a.report || {};
  const burden = report.burden || a.burden || {};
  const lesions = report.lesions || a.lesions || [];
  const confidence = report.confidence || {};
  const technique = report.technique || {};
  const picks = bestSlices(a.slices);

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="cx-no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/app/scans/${id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft hover:text-brand">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to analysis
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
          <Button icon={Download} onClick={download} loading={downloading}>Download PDF</Button>
        </div>
      </div>

      <article className="cx-card cx-print-root space-y-6 p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[13px] font-bold text-brand"><Brain className="h-4 w-4" /> NeuroVision AI</p>
            <h1 className="mt-2 text-[24px] font-bold tracking-[-0.02em] text-ink">Brain MRI — AI-assisted analysis report</h1>
            <p className="mt-1 text-[13px] text-ink-soft">
              Generated {formatDateTime(report.generated_at || a.completed_at)} · Requested by {doctorName(doctor)}{doctor?.hospital ? `, ${doctor.hospital}` : ''}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${reviewBadge.className}`}>
            {reviewBadge.label}
          </span>
        </header>

        <div className="rounded-xl border border-[#F4DDB2] bg-[#FFF9EE] px-4 py-3 text-[12.5px] leading-relaxed text-[#7A4A00]">
          <p>{report.disclaimer || 'AI-generated preliminary analysis. Decision support only — not a diagnosis. Review by a qualified clinician is required.'}</p>
          {/* Review state comes only from stored reviews, never from report text. */}
          <p className="mt-2 border-t border-[#F4DDB2] pt-2 font-semibold text-[#5C3A00]">
            {latestReview
              ? `Clinician review: ${titleCase(latestReview.status)} by ${latestReview.reviewer} on ${formatDateTime(latestReview.created_at)}. See Clinical review below.`
              : 'Clinician review: not yet reviewed — these AI-generated findings are preliminary.'}
          </p>
        </div>

        <Section title="Patient">
          <KV rows={[
            ['Name', p?.display_name],
            ['Patient ID', p?.code],
            ['Date of birth', p?.date_of_birth ? formatDate(p.date_of_birth) : null],
            ['Age', p?.age_years != null ? `${p.age_years} years` : null],
            ['Sex', titleCase(p?.sex)],
          ]} />
        </Section>

        <Section title="Scan">
          <KV rows={[
            ['Scan ID', s.code],
            ['Scan date', formatDate(s.acquired_on, 'Not recorded')],
            ['Sequence', s.sequence],
            ['Uploaded', formatDateTime(s.uploaded_at)],
            ['Analysis completed', formatDateTime(a.completed_at)],
            ['Volume', s.shape ? `${s.shape} voxels at ${s.spacing_mm} mm` : null],
            ['Method', methodLabel(technique.segmentation_method || a.method)],
            ['Model trained on', modelScope(technique) ?? 'Not available'],
            ['Threshold applied', num(technique.segmentation_threshold, 2) ?? 'Not available'],
          ]} />
        </Section>

        <Section title="AI analysis summary">
          <p className="text-[15px] font-semibold leading-relaxed text-ink">{report.headline}</p>
          {report.impression && <p className="mt-2 text-[14px] leading-relaxed text-ink">{report.impression}</p>}
          {report.findings?.length > 0 && (
            <ul className="mt-3 space-y-1 text-[13.5px] text-ink">
              {report.findings.map((f) => <li key={f} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />{f}</li>)}
            </ul>
          )}
        </Section>

        <Section title="Measurements">
          <KV rows={[
            ['Regions detected', burden.lesion_count != null ? String(burden.lesion_count) : null],
            ['Total volume', num(burden.total_volume_cm3, 2, 'cm³')],
            ['Largest region', num(burden.largest_volume_cm3, 2, 'cm³')],
            ['Lesion load', num(burden.lesion_load_percent, 3, '% of brain')],
            ['Brain volume', num(burden.brain_volume_cm3, 0, 'cm³')],
            ['Detection confidence', confidence.detection_confidence != null ? `${num(confidence.detection_confidence, 2)} (${confidence.detection_confidence_label}, ${confidence.calibrated ? 'calibrated' : 'uncalibrated'})` : null],
          ]} />
          {lesions.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#E3EAF5] text-[11.5px] uppercase tracking-[0.06em] text-ink-faint">
                    <th className="pb-2 pr-3 font-semibold">#</th>
                    <th className="pb-2 pr-3 font-semibold">Location (approx.)</th>
                    <th className="pb-2 pr-3 font-semibold">Volume</th>
                    <th className="pb-2 pr-3 font-semibold">Max ⌀</th>
                    <th className="pb-2 pr-3 font-semibold">Extent (mm)</th>
                    <th className="pb-2 font-semibold">Mean prob.</th>
                  </tr>
                </thead>
                <tbody>
                  {lesions.map((l) => (
                    <tr key={l.id} className="border-b border-[#F3F6FA] last:border-0">
                      <td className="py-2 pr-3">{l.id}</td>
                      <td className="py-2 pr-3">{titleCase(`${l.side ?? ''} ${l.region ?? ''}`.trim())}</td>
                      <td className="py-2 pr-3">{num(l.volume_cm3, 3, 'cm³')}</td>
                      <td className="py-2 pr-3">{num(l.max_diameter_mm, 1, 'mm')}</td>
                      <td className="py-2 pr-3">{l.dimensions_mm?.map((d) => Number(d).toFixed(0)).join(' × ')}</td>
                      <td className="py-2">{num(l.mean_probability, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {picks.length > 0 && (
          <Section title="Segmentation">
            <div className="grid gap-3 sm:grid-cols-3">
              {picks.map((pick) => (
                <figure key={pick.plane}>
                  <img src={api.sliceUrl(a.id, pick.overlay)} alt={`${pick.plane} slice ${pick.index} with segmentation outline`} className="aspect-square w-full rounded-xl bg-black object-contain" />
                  <figcaption className="mt-1.5 text-[12px] text-ink-soft">{titleCase(pick.plane)} · slice {pick.index}</figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-ink-faint">Red outline: AI-segmented region, at the slice of greatest segmented area per plane.</p>
          </Section>
        )}

        <Section title="3D visualization">
          {a.has_snapshot ? (
            <>
              <img src={api.snapshotUrl(a.id, analysis.dataUpdatedAt)} alt="3D rendering of the brain with detected regions" className="w-full max-w-[560px] rounded-xl" />
              <p className="mt-2 text-[12px] text-ink-faint">Snapshot saved from the interactive 3D view. The surrounding brain may be a normalised atlas, not this patient&apos;s anatomy.</p>
            </>
          ) : (
            <p className="text-[13.5px] text-ink-soft">
              No snapshot saved. <Link to={`/app/scans/${id}/visualization`} className="cx-no-print font-semibold text-brand hover:underline">Open the 3D viewer</Link> and use “Save snapshot to report”.
            </p>
          )}
        </Section>

        <Section title="Comparison with previous scan">
          {comparison ? (
            <>
              <p className="text-[14px] text-ink"><span className="font-semibold">{(TREND[comparison.trend] ?? TREND.indeterminate).label}.</span> {comparison.result?.summary}</p>
              {comparison.result?.metrics?.length > 0 && (
                <table className="mt-3 w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[#E3EAF5] text-[11.5px] uppercase tracking-[0.06em] text-ink-faint">
                      <th className="pb-2 pr-3 font-semibold">Measure</th><th className="pb-2 pr-3 font-semibold">Previous</th><th className="pb-2 pr-3 font-semibold">Current</th><th className="pb-2 font-semibold">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.result.metrics.map((m) => (
                      <tr key={m.label} className="border-b border-[#F3F6FA] last:border-0">
                        <td className="py-2 pr-3">{m.label}</td>
                        <td className="py-2 pr-3">{m.baseline} {m.unit}</td>
                        <td className="py-2 pr-3">{m.followup} {m.unit}</td>
                        <td className="py-2">{m.change}{m.change_percent != null ? ` (${m.change_percent > 0 ? '+' : ''}${m.change_percent}%)` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="text-[13.5px] text-ink-soft">No comparison has been run with this scan as the follow-up.</p>
          )}
        </Section>

        <Section title="Clinical review and notes">
          {reviews.data?.length ? (
            <ul className="space-y-2.5">
              {reviews.data.map((r) => (
                <li key={r.id} className="text-[13.5px]">
                  <p className="font-semibold text-ink">{formatDateTime(r.created_at)} — {titleCase(r.status)} by {r.reviewer}</p>
                  {r.edited_impression && <p className="text-ink">Revised impression: {r.edited_impression}</p>}
                  {r.comments && <p className="text-ink-soft">Notes: {r.comments}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-ink-soft">Not yet reviewed by a clinician. These findings are preliminary.</p>
          )}
          {p?.clinical_notes && <p className="mt-3 text-[13px] text-ink-soft">Patient clinical notes: {p.clinical_notes}</p>}
        </Section>

        {report.limitations?.length > 0 && (
          <Section title="Limitations">
            <ul className="space-y-1 text-[12.5px] text-ink-soft">
              {report.limitations.map((l) => <li key={l} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />{l}</li>)}
            </ul>
          </Section>
        )}
      </article>
    </div>
  );
}
