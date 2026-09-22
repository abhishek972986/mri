/**
 * Disease-progression timeline: lesion burden across every analysed study.
 *
 * Drawn as inline SVG rather than a chart library. It is one series with a
 * handful of points, and the bar heights are a linear map of a single value --
 * anything more would be a dependency carrying a rendering engine to do this.
 */

function formatDate(value) {
  if (!value) return 'undated';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Timeline({ entries = [], selectedIds = [], onSelect }) {
  if (entries.length === 0) {
    return <div className="panel empty">No completed analyses yet.</div>;
  }

  const maxVolume = Math.max(...entries.map((e) => e.total_volume_cm3 ?? 0), 0.001);

  return (
    <div className="timeline">
      <div className="timeline-track">
        {entries.map((entry) => {
          const volume = entry.total_volume_cm3 ?? 0;
          const height = Math.max(4, (volume / maxVolume) * 100);
          const selected = selectedIds.includes(entry.id);

          return (
            <button
              key={entry.id}
              type="button"
              className={`timeline-point ${selected ? 'selected' : ''}`}
              onClick={() => onSelect?.(entry.id)}
              title={entry.trend_headline ?? ''}
            >
              <div className="timeline-bar-wrap">
                <div className="timeline-bar" style={{ height: `${height}%` }} />
              </div>
              <span className="mono strong">{volume.toFixed(2)} cm³</span>
              <span className="muted small">{entry.lesion_count} lesion{entry.lesion_count === 1 ? '' : 's'}</span>
              <span className="muted small">{formatDate(entry.acquired_on)}</span>
              <span className="muted small mono">{entry.sequence}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">
        Bar height is total lesion volume, scaled to the largest time point. Select two studies to
        compare them.
      </p>
    </div>
  );
}
