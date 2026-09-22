import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

/**
 * 2D slice panel.
 *
 * The 3D view answers "where and how much"; this is where a reader actually
 * checks whether the segmentation is right, so the three layers (plain,
 * contour, heatmap) are a toggle over the same slice rather than separate
 * views -- the comparison only means something if the image does not move.
 */

const PLANES = ['axial', 'coronal', 'sagittal'];
const LAYERS = [
  { key: 'image', label: 'MRI' },
  { key: 'overlay', label: 'Segmentation' },
  { key: 'heatmap', label: 'AI heatmap' },
];

export default function SliceViewer({ analysisId, slices }) {
  const [plane, setPlane] = useState('axial');
  const [layer, setLayer] = useState('overlay');
  const [index, setIndex] = useState(0);

  const entries = useMemo(() => slices?.[plane] ?? [], [slices, plane]);

  // Land on a slice that actually contains a lesion; opening on an empty slice
  // makes a correct segmentation look like a missed one.
  useEffect(() => {
    if (!entries.length) { setIndex(0); return; }
    const firstWithLesion = entries.findIndex((entry) => entry.has_lesion);
    setIndex(firstWithLesion >= 0 ? firstWithLesion : Math.floor(entries.length / 2));
  }, [entries]);

  if (!slices || !entries.length) {
    return <div className="panel empty">No slice images were generated for this analysis.</div>;
  }

  const current = entries[Math.min(index, entries.length - 1)];

  return (
    <div className="slice-viewer">
      <div className="slice-controls">
        <div className="segmented">
          {PLANES.map((p) => (
            <button
              key={p}
              className={p === plane ? 'active' : ''}
              onClick={() => setPlane(p)}
              type="button"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="segmented">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              className={l.key === layer ? 'active' : ''}
              onClick={() => setLayer(l.key)}
              type="button"
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="slice-image">
        <img
          src={api.sliceUrl(analysisId, current[layer])}
          alt={`${plane} slice ${current.index}, ${layer} layer`}
        />
        {current.has_lesion && <span className="slice-badge">lesion on this slice</span>}
      </div>

      <div className="slice-scrub">
        <input
          type="range"
          min={0}
          max={entries.length - 1}
          value={Math.min(index, entries.length - 1)}
          onChange={(event) => setIndex(Number(event.target.value))}
          aria-label="Slice position"
        />
        <span className="mono">
          slice {current.index} · {index + 1}/{entries.length}
          {current.lesion_area_mm2 > 0 && ` · ${current.lesion_area_mm2.toFixed(0)} mm² lesion`}
        </span>
      </div>
    </div>
  );
}
