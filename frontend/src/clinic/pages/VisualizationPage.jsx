import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Camera, Eye, EyeOff, Maximize2, Minimize2, Minus, Move3d, Plus, RotateCcw } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { EASE } from '../../landing/motion';
import { formatDate, num, scanTitle, titleCase } from '../format';
import { useScan } from '../useScan';
import { useToast } from '../toast';
import { Button, Card, DecisionSupportNote, EmptyState, ErrorState, Skeleton } from '../ui';

const BrainViewer = lazy(() => import('../../components/BrainViewer'));

const MODES = [
  { key: 'anatomy', label: 'Atlas surface', hint: 'Z-Anatomy reference brain fitted to this patient — not their anatomy' },
  { key: 'patient', label: 'Patient surface', hint: "Isosurface of this patient's own segmented brain" },
  { key: 'wireframe', label: 'Wireframe', hint: 'Surfaces as mesh edges, to see regions through the brain' },
];

function Toggle({ on, onChange, label, icon: OnIcon = Eye, offIcon: OffIcon = EyeOff }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-[40px] w-full items-center justify-between gap-3 rounded-xl px-3 text-[13.5px] font-semibold text-ink transition-colors hover:bg-[#F3F7FD]"
    >
      <span className="flex items-center gap-2.5">{on ? <OnIcon className="h-4 w-4 text-brand" /> : <OffIcon className="h-4 w-4 text-ink-faint" />}{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors duration-300 ${on ? 'bg-brand' : 'bg-[#D5DEEB]'}`}>
        <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${on ? 'right-0.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function Metric({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#F1F4F9] py-2 last:border-0">
      <dt className="text-[13px] text-ink-soft">{label}</dt>
      <dd className={`text-right text-[13.5px] font-semibold ${value == null ? 'font-normal text-ink-faint' : 'text-ink'}`}>{value ?? 'Not available'}</dd>
    </div>
  );
}

export default function VisualizationPage() {
  const { scanId } = useParams();
  const { id, study, analysis, patient } = useScan(scanId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const viewer = useRef(null);
  const frame = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else frame.current?.requestFullscreen?.().catch(() => toast.error('Fullscreen is not available in this browser.'));
  };

  const a = analysis.data;
  const complete = a?.status === 'complete';
  const scene = useQuery({
    queryKey: ['scene', a?.id],
    queryFn: () => api.getScene(a.id),
    enabled: complete,
    staleTime: Infinity,
  });

  const [mode, setMode] = useState('anatomy');
  const [showLesions, setShowLesions] = useState(true);
  const [showBrain, setShowBrain] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const [selected, setSelected] = useState(null);

  const lesions = a?.lesions ?? [];
  const byId = useMemo(() => Object.fromEntries(lesions.map((l) => [l.id, l])), [lesions]);
  const focus = byId[selected] ?? lesions.reduce((best, l) => ((l.volume_cm3 || 0) > (best?.volume_cm3 || 0) ? l : best), null);

  const snapshot = useMutation({
    mutationFn: async () => {
      const dataUrl = viewer.current?.capture();
      if (!dataUrl) throw new Error('The 3D view is not ready yet.');
      const blob = await (await fetch(dataUrl)).blob();
      return api.uploadSnapshot(a.id, blob);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['analysis', a.id], updated);
      toast.success('Snapshot saved. It will appear in the PDF report.');
    },
    onError: (err) => toast.error(`Could not save snapshot: ${err.message}`),
  });

  if (study.isError) return <Card><ErrorState error={study.error} title="Could not load this scan" onRetry={study.refetch} /></Card>;

  const s = study.data;
  const p = patient.data;
  const brainSurface = mode === 'patient' ? 'patient' : 'anatomy';

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`/app/scans/${id}`} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft hover:text-brand">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to analysis
          </Link>
          <h1 className="text-[clamp(1.4rem,1.1rem+1vw,1.9rem)] font-bold tracking-[-0.022em] text-ink">3D brain visualization</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {p ? `${p.display_name} · ${p.code}` : <Skeleton as="span" className="inline-block h-4 w-40 align-middle" />}
            {s && ` · ${scanTitle(s)} · ${formatDate(s.acquired_on || s.uploaded_at)}`}
          </p>
        </div>
        {complete && (
          <Button variant="secondary" icon={Camera} onClick={() => snapshot.mutate()} loading={snapshot.isPending}>
            {a.has_snapshot ? 'Replace report snapshot' : 'Save snapshot to report'}
          </Button>
        )}
      </motion.div>

      {study.isPending || analysis.isPending ? (
        <Skeleton className="h-[560px] w-full !rounded-3xl" />
      ) : !complete ? (
        <Card>
          <EmptyState icon={Move3d} title="3D model not available yet"
            body={a?.status === 'failed' ? 'The analysis failed, so no 3D model was generated.' : 'The 3D model is generated as part of the AI analysis. It will appear here when the analysis completes.'}
            action={<Button to={`/app/scans/${id}`}>Go to analysis</Button>} />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div ref={frame} className={`cx-viewer-frame relative ${fullscreen ? 'h-full !rounded-none' : 'h-[min(72vh,680px)] min-h-[420px]'}`}>
            {scene.isError ? (
              <div className="grid h-full place-items-center p-6">
                <ErrorState error={scene.error} title="3D generation failed" onRetry={scene.refetch} />
              </div>
            ) : scene.isPending ? (
              <div className="grid h-full place-items-center text-[13.5px] text-white/60">Loading 3D model…</div>
            ) : (
              <Suspense fallback={<div className="grid h-full place-items-center text-[13.5px] text-white/60">Starting 3D viewer…</div>}>
                <BrainViewer
                  ref={viewer}
                  scene={scene.data}
                  brainSurface={brainSurface}
                  brainOpacity={opacity}
                  showBrain={showBrain}
                  showLesions={showLesions}
                  wireframe={mode === 'wireframe'}
                  selectedLesionId={selected}
                  onSelectLesion={setSelected}
                />
              </Suspense>
            )}

            {/* Minimal camera controls; drag already rotates, the wheel zooms. */}
            <div className="absolute left-3 top-3 flex flex-col gap-1.5">
              {[
                { icon: Plus, label: 'Zoom in', fn: () => viewer.current?.zoom(0.85) },
                { icon: Minus, label: 'Zoom out', fn: () => viewer.current?.zoom(1.18) },
                { icon: RotateCcw, label: 'Reset camera', fn: () => viewer.current?.resetView() },
                ...(canFullscreen ? [{ icon: fullscreen ? Minimize2 : Maximize2, label: fullscreen ? 'Exit fullscreen' : 'Enter fullscreen', fn: toggleFullscreen }] : []),
              ].map(({ icon: Icon, label, fn }) => (
                <motion.button key={label} type="button" onClick={fn} aria-label={label} title={label} whileTap={{ scale: 0.92 }}
                  className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/20">
                  <Icon className="h-4 w-4" />
                </motion.button>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <Card className="p-4">
              <p className="px-1 text-[12px] font-bold uppercase tracking-[0.1em] text-ink-faint">View</p>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-[#EEF2F8] p-1">
                {MODES.map((m) => (
                  <button key={m.key} type="button" onClick={() => setMode(m.key)} title={m.hint}
                    className={`relative rounded-lg px-2 py-2 text-[12.5px] font-semibold transition-colors ${mode === m.key ? 'text-ink' : 'text-ink-soft hover:text-ink'}`}>
                    {mode === m.key && <motion.span layoutId="cx-viz-mode" className="absolute inset-0 rounded-lg bg-white shadow-soft" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span className="relative">{m.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 px-1 text-[12px] leading-snug text-ink-faint">{MODES.find((m) => m.key === mode).hint}</p>
              <div className="mt-3 space-y-0.5">
                <Toggle on={showLesions} onChange={setShowLesions} label="Affected regions" />
                <Toggle on={showBrain} onChange={setShowBrain} label="Healthy anatomy" />
              </div>
              <label className="mt-3 block px-1">
                <span className="flex justify-between text-[12.5px] font-semibold text-ink-soft"><span>Brain opacity</span><span>{Math.round(opacity * 100)}%</span></span>
                <input type="range" min="0.2" max="2" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="mt-1.5 w-full accent-[#1677E8]" disabled={!showBrain} />
              </label>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between px-1">
                <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-ink-faint">Detected region</p>
                {lesions.length > 1 && <span className="text-[12px] text-ink-faint">{lesions.length} regions</span>}
              </div>
              {lesions.length === 0 ? (
                <p className="mt-3 px-1 text-[13.5px] text-ink-soft">No region was segmented in this scan.</p>
              ) : (
                <>
                  {lesions.length > 1 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 px-1">
                      {lesions.map((l) => (
                        <button key={l.id} type="button" onClick={() => setSelected(l.id === selected ? null : l.id)}
                          className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset transition-colors ${focus?.id === l.id ? 'bg-brand text-white ring-brand' : 'bg-white text-ink-soft ring-[#DDE5F0] hover:ring-[#B9CBE6]'}`}>
                          #{l.id}
                        </button>
                      ))}
                    </div>
                  )}
                  <AnimatePresence mode="wait">
                    <motion.dl key={focus?.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mt-3 px-1">
                      <Metric label="Region" value={focus ? titleCase(`${focus.side ?? ''} ${focus.region ?? ''}`.trim()) || null : null} />
                      <Metric label="Volume" value={num(focus?.volume_cm3, 3, 'cm³')} />
                      <Metric label="Dimensions" value={focus?.dimensions_mm ? `${focus.dimensions_mm.map((d) => Number(d).toFixed(0)).join(' × ')} mm` : null} />
                      <Metric label="Max diameter" value={num(focus?.max_diameter_mm, 1, 'mm')} />
                      <Metric label="Confidence (mean prob.)" value={num(focus?.mean_probability, 2)} />
                    </motion.dl>
                  </AnimatePresence>
                  <p className="mt-2 px-1 text-[11.5px] leading-snug text-ink-faint">Click a region in the 3D view to select it. Locations are approximate geometric zones; probabilities are uncalibrated.</p>
                </>
              )}
            </Card>
            <DecisionSupportNote>Surfaces are generated from the AI segmentation for orientation only. Verify every finding on the source slices.</DecisionSupportNote>
          </div>
        </div>
      )}
    </div>
  );
}
