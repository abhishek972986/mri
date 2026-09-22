/**
 * Per-lesion measurements, linked to the 3D viewer's selection.
 *
 * Sorted by volume descending, matching the report, so "lesion 1" means the same
 * thing in both places.
 */
export default function LesionTable({ lesions = [], selectedId, onSelect }) {
  if (!lesions.length) {
    return <div className="panel empty">No lesions detected.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="lesion-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Location</th>
            <th className="num">Volume</th>
            <th className="num">Max ⌀</th>
            <th className="num">Dimensions</th>
            <th className="num">Sphericity</th>
            <th className="num">Conf.</th>
          </tr>
        </thead>
        <tbody>
          {lesions.map((lesion) => (
            <tr
              key={lesion.id}
              className={lesion.id === selectedId ? 'selected' : ''}
              onClick={() => onSelect?.(lesion.id === selectedId ? null : lesion.id)}
            >
              <td>
                <span className="lesion-dot" style={{
                  background: lesion.tb_typical_site ? '#ffb347' : '#ff5a5a',
                }} />
                {lesion.id}
              </td>
              <td>
                {lesion.side} {lesion.region}
                {lesion.tb_typical_site && <span className="chip">TB-typical site</span>}
              </td>
              <td className="num mono">{lesion.volume_cm3.toFixed(3)} cm³</td>
              <td className="num mono">{lesion.max_diameter_mm.toFixed(1)} mm</td>
              <td className="num mono small">
                {lesion.dimensions_mm.map((d) => d.toFixed(0)).join(' × ')} mm
              </td>
              <td className="num mono">{lesion.sphericity.toFixed(2)}</td>
              <td className="num mono">{Math.round(lesion.mean_probability * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Click a row to highlight that lesion in the 3D view. Volumes are computed from the
        resampled 1 mm isotropic grid.
      </p>
    </div>
  );
}
