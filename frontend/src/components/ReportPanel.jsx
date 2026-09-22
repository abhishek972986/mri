import { useState } from 'react';
import { api } from '../api';

/**
 * The preliminary report, plus the doctor-in-the-loop review form.
 *
 * The disclaimer is rendered first and is not collapsible. A generated report
 * that scrolls its own caveat off the top is worse than one with no caveat,
 * because it looks like it was reviewed.
 */

function ConfidenceBar({ label, value, caption }) {
  const percent = Math.round((value ?? 0) * 100);
  const tone = percent >= 75 ? 'high' : percent >= 50 ? 'moderate' : percent >= 25 ? 'low' : 'very-low';
  return (
    <div className="confidence">
      <div className="confidence-head">
        <span>{label}</span>
        <span className="mono">{percent}%</span>
      </div>
      <div className="confidence-track">
        <div className={`confidence-fill ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      {caption && <p className="muted small">{caption}</p>}
    </div>
  );
}

export default function ReportPanel({ analysis, onReviewSaved }) {
  const report = analysis?.report;
  const [reviewer, setReviewer] = useState('');
  const [comments, setComments] = useState('');
  const [rejected, setRejected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  if (!report) return <div className="panel empty">No report available.</div>;

  const { confidence = {}, technique = {}, limitations = [] } = report;
  const lesions = report.lesions ?? [];

  const toggleRejected = (id) => {
    setRejected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async (status) => {
    if (!reviewer.trim()) {
      setMessage({ tone: 'error', text: 'Enter a reviewer name before signing off.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.createReview(analysis.id, {
        status,
        reviewer: reviewer.trim(),
        comments: comments.trim() || null,
        rejected_lesion_ids: rejected,
        confirmed_lesion_ids: lesions.map((l) => l.id).filter((id) => !rejected.includes(id)),
      });
      setMessage({ tone: 'ok', text: `Saved as ${status}.` });
      onReviewSaved?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="report">
      <div className="disclaimer">
        <strong>Not a diagnosis.</strong> {report.disclaimer}
      </div>

      <section>
        <h3>{report.headline}</h3>
        <p className="impression">{report.impression}</p>
      </section>

      <section className="confidence-grid">
        <ConfidenceBar
          label="Detection confidence"
          value={confidence.detection_confidence}
          caption={confidence.calibration_note}
        />
        <ConfidenceBar
          label="TB pattern score"
          value={confidence.tb_pattern_score}
          caption={
            confidence.tb_pattern_reasons?.length
              ? `Rule-based, from: ${confidence.tb_pattern_reasons.join('; ')}.`
              : 'Rule-based score over lesion location, multiplicity, size and shape. Not a trained classifier.'
          }
        />
      </section>

      <section>
        <h4>Findings</h4>
        <ul className="findings">
          {report.findings.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </section>

      {report.alerts?.length > 0 && (
        <section>
          <h4>Alerts</h4>
          <ul className="alerts">
            {report.alerts.map((alert, i) => (
              <li key={i} className={`alert ${alert.severity}`}>
                <span className="tag">{alert.severity}</span>
                {alert.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>Technique</h4>
        <dl className="technique">
          <div><dt>Sequences</dt><dd>{(technique.sequences_analysed ?? []).join(', ') || 'unknown'}</dd></div>
          <div><dt>Segmentation</dt><dd className="mono">{technique.segmentation_method}</dd></div>
          <div><dt>Atlas</dt><dd>{technique.anatomical_atlas}</dd></div>
          <div><dt>Threshold</dt><dd className="mono">{technique.segmentation_threshold}</dd></div>
          <div><dt>Voxel size</dt><dd className="mono">{(technique.processed_spacing_mm ?? []).join(' × ')} mm</dd></div>
        </dl>
        <div className="downloads">
          {['lesion-mask', 'probability', 'brain-mask', 'preprocessed', 'report'].map((artifact) => (
            <a key={artifact} href={api.downloadUrl(analysis.id, artifact)} download>
              {artifact}
            </a>
          ))}
        </div>
      </section>

      <section>
        <h4>Limitations</h4>
        <ul className="limitations">
          {limitations.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </section>

      <section className="review-box">
        <h4>Clinician review</h4>
        <p className="muted small">
          Reject any lesion that is a false positive, then sign off. Reviews are append-only:
          each submission is recorded alongside the original AI output rather than replacing it.
        </p>

        {lesions.length > 0 && (
          <div className="reject-list">
            {lesions.map((lesion) => (
              <label key={lesion.id} className={rejected.includes(lesion.id) ? 'rejected' : ''}>
                <input
                  type="checkbox"
                  checked={rejected.includes(lesion.id)}
                  onChange={() => toggleRejected(lesion.id)}
                />
                <span>
                  L{lesion.id} · {lesion.side} {lesion.region} · {lesion.volume_cm3.toFixed(3)} cm³
                </span>
              </label>
            ))}
          </div>
        )}

        <input
          type="text"
          placeholder="Reviewer name"
          value={reviewer}
          onChange={(event) => setReviewer(event.target.value)}
        />
        <textarea
          placeholder="Comments, corrections, clinical correlation…"
          value={comments}
          rows={3}
          onChange={(event) => setComments(event.target.value)}
        />

        <div className="row">
          <button type="button" onClick={() => submit('reviewed')} disabled={saving}>
            Save review
          </button>
          <button type="button" className="primary" onClick={() => submit('approved')} disabled={saving}>
            Approve report
          </button>
          <button type="button" className="danger" onClick={() => submit('rejected')} disabled={saving}>
            Reject
          </button>
        </div>

        {message && <p className={`message ${message.tone}`}>{message.text}</p>}
      </section>
    </div>
  );
}
