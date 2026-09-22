import { useState } from 'react';
import BrainViewer from './BrainViewer';

/**
 * Longitudinal comparison: progression dashboard, per-lesion change table, and
 * the change-map 3D view.
 *
 * Direction is never shown as bare colour. A red arrow means one thing for
 * lesion volume (worse) and the opposite for, say, a recovery metric, so each
 * row states the change in words as well.
 */

const TREND_COPY = {
  improving: { label: 'Improving', tone: 'good', detail: 'Overall lesion burden has fallen.' },
  worsening: { label: 'Worsening', tone: 'bad', detail: 'Overall lesion burden has risen.' },
  stable: { label: 'Stable', tone: 'neutral', detail: 'No significant interval change.' },
  mixed: { label: 'Mixed response', tone: 'warn', detail: 'Some lesions regressing, others new or enlarging.' },
  indeterminate: { label: 'Indeterminate', tone: 'neutral', detail: 'Change could not be classified.' },
};

const STATUS_COPY = {
  new: 'New',
  resolved: 'Resolved',
  increased: 'Enlarged',
  decreased: 'Regressed',
  stable: 'Stable',
};

function MetricCard({ metric }) {
  const { label, baseline, followup, unit, change_percent: pct, direction } = metric;
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■';
  // For lesion burden, down is good. Every metric here is a burden metric.
  const tone = direction === 'down' ? 'good' : direction === 'up' ? 'bad' : 'neutral';

  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <span className="metric-values mono">
        {baseline}{unit && ` ${unit}`} <span className="arrow">→</span> {followup}{unit && ` ${unit}`}
      </span>
      <span className={`metric-change ${tone}`}>
        {arrow} {pct === null || pct === undefined ? 'n/a' : `${pct > 0 ? '+' : ''}${pct}%`}
      </span>
    </div>
  );
}

export default function ComparisonPanel({ comparison, scene }) {
  const [layers, setLayers] = useState({ new: true, resolved: true, persistent: true });
  const result = comparison?.result;

  if (!result) return <div className="panel empty">No comparison data.</div>;

  const trend = TREND_COPY[result.trend] ?? TREND_COPY.indeterminate;
  const registration = result.registration ?? {};

  const toggle = (key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="comparison">
      <div className={`trend-banner ${trend.tone}`}>
        <div>
          <span className="trend-label">{trend.label}</span>
          <p>{trend.detail}</p>
        </div>
        <p className="trend-summary">{result.summary}</p>
      </div>

      <section>
        <h4>Progression dashboard</h4>
        <div className="metric-grid">
          {result.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
        </div>
      </section>

      {result.alerts?.length > 0 && (
        <section>
          <h4>Alerts</h4>
          <ul className="alerts">
            {result.alerts.map((alert, i) => (
              <li key={i} className={`alert ${alert.severity}`}>
                <span className="tag">{alert.severity}</span>
                {alert.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="split">
        <div>
          <h4>Change map</h4>
          <div className="layer-toggles">
            {['new', 'persistent', 'resolved'].map((key) => (
              <label key={key}>
                <input type="checkbox" checked={layers[key]} onChange={() => toggle(key)} />
                <i className={`swatch ${key}`} />
                {STATUS_COPY[key] ?? key}
              </label>
            ))}
          </div>
          <div className="viewer-frame short">
            {scene
              ? <BrainViewer scene={scene} mode="comparison" visibleChangeLayers={layers} brainSurface="anatomy" brainOpacity={0.8} />
              : <div className="panel empty">Loading change map…</div>}
          </div>
        </div>

        <div>
          <h4>Per-lesion change</h4>
          <div className="table-wrap tall">
            <table className="lesion-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Location</th>
                  <th className="num">Before</th>
                  <th className="num">After</th>
                  <th className="num">Δ</th>
                </tr>
              </thead>
              <tbody>
                {result.lesion_changes.map((change, i) => (
                  <tr key={i}>
                    <td><span className={`status-pill ${change.status}`}>{STATUS_COPY[change.status]}</span></td>
                    <td>{change.side} {change.region}</td>
                    <td className="num mono">{change.baseline_volume_cm3.toFixed(3)}</td>
                    <td className="num mono">{change.followup_volume_cm3.toFixed(3)}</td>
                    <td className="num mono">
                      {change.volume_change_percent === null
                        ? '—'
                        : `${change.volume_change_percent > 0 ? '+' : ''}${change.volume_change_percent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Volumes in cm³. Lesions are matched across time points by spatial
          overlap after rigid registration; a match is not a guarantee of identity.</p>
        </div>
      </section>

      <section>
        <h4>Registration</h4>
        <dl className="technique">
          <div><dt>Method</dt><dd className="mono">{registration.method}</dd></div>
          <div><dt>Similarity (NMI)</dt><dd className="mono">{registration.similarity}</dd></div>
          <div><dt>Translation</dt><dd className="mono">{(registration.translation_mm ?? []).join(', ')} mm</dd></div>
          <div><dt>Rotation</dt><dd className="mono">{(registration.rotation_deg ?? []).join(', ')}°</dd></div>
        </dl>
        {registration.warnings?.length > 0 && (
          <ul className="alerts">
            {registration.warnings.map((warning, i) => (
              <li key={i} className="alert medium"><span className="tag">registration</span>{warning}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
