import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Crosshair, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Skeleton } from '../ui';

const PLANES = [
  { key: 'axial', label: 'Axial' },
  { key: 'coronal', label: 'Coronal' },
  { key: 'sagittal', label: 'Sagittal' },
];

/*
 * Layers rendered by the backend (pipeline/slices.render_slice). The colours
 * described here are the ones that code draws — keep them in sync.
 */
const LAYERS = [
  { key: 'image', label: 'Original', legend: 'Preprocessed MRI (skull-stripped, intensity-normalised).' },
  { key: 'overlay', label: 'Overlay', legend: 'Red outline: AI-segmented region, over the MRI. Opacity blends it with the original.' },
  { key: 'mask', label: 'Segmentation', legend: 'The raw AI segmentation mask (red) with no anatomy underneath.' },
  { key: 'heatmap', label: 'Probability', legend: 'Model probability, purple (low) → orange → pale yellow (high). Uncalibrated.' },
];

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const CENTER = { zoom: 1, x: 0, y: 0 };

/**
 * Full-volume slice viewer.
 *
 * Every slice of the preprocessed volume is available (rendered on demand by
 * the API), not just a pre-selected handful. Slices containing segmented
 * voxels are marked on the slider and can be stepped between directly.
 */
export default function MriVolumeViewer({ analysisId }) {
  const volume = useQuery({
    queryKey: ['volume', analysisId],
    queryFn: () => api.volumeInfo(analysisId),
    staleTime: Infinity,
  });

  const [plane, setPlane] = useState('axial');
  const [layer, setLayer] = useState('overlay');
  const [opacity, setOpacity] = useState(1);
  const [index, setIndex] = useState(null);
  const [view, setView] = useState(CENTER);
  const [imageState, setImageState] = useState('loading'); // loading | ready | error
  const [reloadKey, setReloadKey] = useState(0);
  const stage = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  const info = volume.data?.planes?.[plane];
  const count = info?.count ?? 0;
  const lesionSlices = info?.lesion_slices ?? [];

  // Open each plane on the slice with the most segmented area.
  useEffect(() => {
    if (info) setIndex(info.peak_slice);
    setView(CENTER);
  }, [plane, info]); // eslint-disable-line react-hooks/exhaustive-deps

  const safeIndex = index == null ? 0 : Math.max(0, Math.min(count - 1, index));
  useEffect(() => { setImageState('loading'); }, [plane, safeIndex, layer, reloadKey]);

  const clamp = useCallback((next) => {
    const rect = stage.current?.getBoundingClientRect();
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.zoom));
    if (!rect) return { ...next, zoom };
    const maxX = (rect.width * (zoom - 1)) / 2;
    const maxY = (rect.height * (zoom - 1)) / 2;
    return { zoom, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  }, []);

  const zoomBy = useCallback((factor) => setView((v) => clamp({ ...v, zoom: v.zoom * factor })), [clamp]);
  const go = useCallback((next) => setIndex(Math.max(0, Math.min(count - 1, next))), [count]);

  const nextLesion = (direction) => {
    const target = direction > 0
      ? lesionSlices.find((s) => s > safeIndex)
      : [...lesionSlices].reverse().find((s) => s < safeIndex);
    if (target != null) go(target);
  };

  // Wheel: zoom with Ctrl/⌘ or on a trackpad pinch, otherwise step slices —
  // the convention of clinical viewers.
  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
      else setIndex((i) => Math.max(0, Math.min(count - 1, (i ?? 0) + (e.deltaY > 0 ? 1 : -1))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, count]);

  /* Pointer gestures: one pointer pans (when zoomed), two pointers pinch-zoom. */
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = pts.length === 2
      ? { type: 'pinch', start: view, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) }
      : { type: 'pan', start: view, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch' && pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setView(clamp({ ...g.start, zoom: g.start.zoom * (dist / Math.max(1, g.dist)) }));
    } else if (g.type === 'pan' && g.start.zoom > 1) {
      setView(clamp({ ...g.start, x: g.start.x + e.clientX - g.x, y: g.start.y + e.clientY - g.y }));
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    gesture.current = pointers.current.size === 1
      ? { type: 'pan', start: view, ...[...pointers.current.values()][0] }
      : null;
  };

  const onKeyDown = (e) => {
    const keys = {
      ArrowUp: () => go(safeIndex + 1), ArrowRight: () => go(safeIndex + 1),
      ArrowDown: () => go(safeIndex - 1), ArrowLeft: () => go(safeIndex - 1),
      PageUp: () => go(safeIndex + 10), PageDown: () => go(safeIndex - 10),
      Home: () => go(0), End: () => go(count - 1),
      '+': () => zoomBy(1.25), '=': () => zoomBy(1.25), '-': () => zoomBy(0.8), 0: () => setView(CENTER),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  };

  if (volume.isPending) return <Skeleton className="mx-auto aspect-square w-full max-w-[min(100%,72vh)] !rounded-2xl" />;
  if (volume.isError) {
    return (
      <div className="rounded-2xl border border-[#F8D3D1] bg-[#FFF6F5] p-6 text-center text-[13.5px] text-[#8F1D14]" role="alert">
        MRI volume could not be loaded: {volume.error.message}
        <div className="mt-3"><button type="button" onClick={() => volume.refetch()} className="font-semibold text-brand hover:underline">Try again</button></div>
      </div>
    );
  }

  const layerInfo = LAYERS.find((l) => l.key === layer);
  const withBase = layer === 'overlay' || layer === 'heatmap';
  const url = (l) => `${api.volumeSliceUrl(analysisId, plane, safeIndex, l)}${reloadKey ? `&r=${reloadKey}` : ''}`;
  const onLesion = lesionSlices.includes(safeIndex);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented options={PLANES} value={plane} onChange={setPlane} id="cx-vol-plane" label="Plane" />
        <Segmented options={LAYERS} value={layer} onChange={setLayer} id="cx-vol-layer" label="Layer" />
      </div>

      <div
        ref={stage}
        tabIndex={0}
        role="group"
        aria-roledescription="MRI slice viewer"
        aria-label={`${plane} slice ${safeIndex + 1} of ${count}, ${layerInfo.label}. Arrow keys change slice; plus and minus zoom; 0 resets.`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setView(CENTER)}
        className="cx-mri-stage mx-auto mt-4 aspect-square w-full max-w-[min(100%,72vh)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <div
          className="absolute inset-0"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transition: gesture.current ? 'none' : 'transform 200ms cubic-bezier(0.16,1,0.3,1)' }}
        >
          {withBase && <img src={url('image')} alt="" aria-hidden draggable={false} className="absolute inset-0 h-full w-full object-contain" />}
          <img
            key={url(layer)}
            src={url(layer)}
            alt=""
            draggable={false}
            onLoad={() => setImageState('ready')}
            onError={() => setImageState('error')}
            className="absolute inset-0 h-full w-full object-contain transition-opacity duration-150"
            style={{ opacity: withBase ? opacity : 1 }}
          />
        </div>

        {imageState === 'loading' && (
          <div className="pointer-events-none absolute right-3 top-3 h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" aria-hidden />
        )}
        {imageState === 'error' && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-[13.5px] text-white/85" role="alert">
            <div>
              This slice could not be loaded.
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/55 px-2 py-1 font-mono text-[11.5px] text-white/90 backdrop-blur">
          {plane.toUpperCase()} · slice {safeIndex + 1} / {count}{onLesion ? ' · segmentation' : ''}
        </div>
        {view.zoom > 1 && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/55 px-2 py-1 font-mono text-[11.5px] text-white/85">
            {view.zoom.toFixed(1)}× · drag to pan
          </div>
        )}
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          {[
            { icon: Plus, label: 'Zoom in', fn: () => zoomBy(1.3) },
            { icon: Minus, label: 'Zoom out', fn: () => zoomBy(1 / 1.3) },
            { icon: RotateCcw, label: 'Reset view', fn: () => setView(CENTER) },
          ].map(({ icon: Icon, label, fn }) => (
            <button key={label} type="button" onClick={fn} onPointerDown={(e) => e.stopPropagation()} aria-label={label} title={label}
              className="grid h-10 w-10 place-items-center rounded-xl bg-black/55 text-white/90 backdrop-blur transition-colors hover:bg-black/75">
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Slice navigation */}
      <div className="mt-3 flex items-center gap-2">
        <NavButton label="First slice" icon={ChevronsLeft} onClick={() => go(0)} disabled={safeIndex === 0} />
        <NavButton label="Previous slice" icon={ChevronLeft} onClick={() => go(safeIndex - 1)} disabled={safeIndex === 0} />
        <div className="relative flex-1">
          {/* Where the segmentation is, along the slider. */}
          <div className="pointer-events-none absolute inset-x-[7px] top-1/2 h-1.5 -translate-y-1/2" aria-hidden>
            {count > 1 && lesionSlices.map((s) => (
              <span key={s} className="absolute top-0 h-1.5 w-[2px] bg-[#FF5252]/70" style={{ left: `${(s / (count - 1)) * 100}%` }} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, count - 1)}
            value={safeIndex}
            onChange={(e) => go(Number(e.target.value))}
            className="relative h-1.5 w-full cursor-pointer accent-[#1677E8]"
            aria-label="Slice"
            aria-valuetext={`Slice ${safeIndex + 1} of ${count}`}
          />
        </div>
        <NavButton label="Next slice" icon={ChevronRight} onClick={() => go(safeIndex + 1)} disabled={safeIndex >= count - 1} />
        <NavButton label="Last slice" icon={ChevronsRight} onClick={() => go(count - 1)} disabled={safeIndex >= count - 1} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {lesionSlices.length > 0 ? (
            <>
              <span className="text-ink-soft">Segmentation on {lesionSlices.length} of {count} slices</span>
              <button type="button" onClick={() => nextLesion(-1)} disabled={!lesionSlices.some((s) => s < safeIndex)}
                className="rounded-lg border border-[#E3EAF5] bg-white px-2.5 py-1 font-semibold text-ink disabled:opacity-40">← Prev finding</button>
              <button type="button" onClick={() => nextLesion(1)} disabled={!lesionSlices.some((s) => s > safeIndex)}
                className="rounded-lg border border-[#E3EAF5] bg-white px-2.5 py-1 font-semibold text-ink disabled:opacity-40">Next finding →</button>
              <button type="button" onClick={() => go(info.peak_slice)} className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-brand hover:bg-brand-soft">
                <Crosshair className="h-3.5 w-3.5" /> Largest
              </button>
            </>
          ) : (
            <span className="text-ink-soft">No segmented voxels in this plane.</span>
          )}
        </div>
        {withBase && (
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-soft">
            Overlay opacity
            <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-28 accent-[#1677E8]" />
            <span className="w-9 text-right font-mono">{Math.round(opacity * 100)}%</span>
          </label>
        )}
      </div>
      <p className="mt-2 text-[12.5px] text-ink-soft">{layerInfo.legend} Scroll to change slice; Ctrl + scroll or pinch to zoom.</p>
    </div>
  );
}

function Segmented({ options, value, onChange, id, label }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-[#EEF2F8] p-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={`relative shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${value === o.key ? 'text-ink' : 'text-ink-soft hover:text-ink'}`}
        >
          {value === o.key && <motion.span layoutId={id} className="absolute inset-0 rounded-lg bg-white shadow-soft" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function NavButton({ label, icon: Icon, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E3EAF5] bg-white text-ink transition-colors hover:border-[#CFDBEE] disabled:opacity-40">
      <Icon className="h-4 w-4" />
    </button>
  );
}
