/** Display helpers shared across the clinical app. */

/** Parse API datetimes. Naive strings from SQLite are UTC. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  // A bare date ("2026-09-30") is a calendar day, not an instant: build it in
  // local time so it never shifts to the previous day west of UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text);
  return new Date(hasZone ? text : `${text}Z`);
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const DAY_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function formatDate(value, fallback = '—') {
  const date = toDate(value);
  return date && !Number.isNaN(date.getTime()) ? DAY.format(date) : fallback;
}

export function formatDateTime(value, fallback = '—') {
  const date = toDate(value);
  return date && !Number.isNaN(date.getTime()) ? DAY_TIME.format(date) : fallback;
}

export function timeAgo(value) {
  const date = toDate(value);
  if (!date) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(date);
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function titleCase(text) {
  if (!text) return '';
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

export function initials(name) {
  return String(name || '?')
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function doctorName(doctor) {
  if (!doctor?.full_name) return '';
  return /^dr\.?\s/i.test(doctor.full_name) ? doctor.full_name : `Dr. ${doctor.full_name}`;
}

/** Numbers: fixed places, or "—" for null — never invent a zero. */
export function num(value, places = 2, unit = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const text = Number(value).toFixed(places);
  return unit ? `${text} ${unit}` : text;
}

export const SEQUENCES = [
  { value: 'FLAIR', label: 'FLAIR' },
  { value: 'T1C', label: 'T1 post-contrast' },
  { value: 'T1', label: 'T1' },
  { value: 'T2', label: 'T2' },
  { value: 'DWI', label: 'DWI' },
  { value: 'ADC', label: 'ADC' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

export function sequenceLabel(value) {
  return SEQUENCES.find((s) => s.value === value)?.label ?? value;
}

export function scanTitle(study) {
  const seq = study?.sequence && study.sequence !== 'UNKNOWN' ? `${study.sequence} ` : '';
  return `MRI Brain ${seq}`.trim();
}

/**
 * Scan status vocabulary. Keys are what the API returns (routers/patients.py
 * scan_status); every status the UI can show is defined here once.
 */
export const STATUS = {
  uploaded: { label: 'Uploaded', tone: 'slate', hint: 'Waiting for analysis to be started' },
  queued: { label: 'Queued', tone: 'blue', hint: 'Waiting for the pipeline', live: true },
  processing: { label: 'Processing', tone: 'blue', hint: 'AI analysis running', live: true },
  needs_review: { label: 'Needs review', tone: 'amber', hint: 'AI analysis complete — awaiting clinician review' },
  reviewed: { label: 'Reviewed', tone: 'green', hint: 'Reviewed by a clinician' },
  failed: { label: 'Failed', tone: 'red', hint: 'Analysis could not be completed' },
};

export function statusOf(key) {
  return STATUS[key] ?? { label: titleCase(key || 'Unknown'), tone: 'slate' };
}

/** Human labels for the pipeline stages the API reports (pipeline_service.STAGES). */
export const STAGE_LABELS = {
  queued: 'Queued',
  starting: 'Starting',
  validating: 'Validating scan',
  preprocessing: 'Preprocessing MRI',
  segmenting: 'Running AI model and segmenting',
  measuring: 'Calculating measurements',
  saving: 'Saving segmentation',
  mesh: 'Generating 3D visualization',
  slices: 'Rendering MRI slices',
  report: 'Preparing report',
  complete: 'Complete',
};

/**
 * Comparison trend keys come from the pipeline (pipeline/compare.py). They
 * classify change in *segmented volume* between two scans -- not the patient's
 * clinical course -- so the labels say exactly that.
 */
export const TREND = {
  improving: { label: 'Segmented volume decreased', tone: 'green' },
  worsening: { label: 'Segmented volume increased', tone: 'red' },
  stable: { label: 'Stable within ±20%', tone: 'slate' },
  mixed: { label: 'Mixed change', tone: 'amber' },
  indeterminate: { label: 'Indeterminate', tone: 'slate' },
};

/** Per-region change status from the pipeline, in segmentation terms. */
export const REGION_CHANGE = {
  new: 'New on newer scan',
  increased: 'Larger',
  decreased: 'Smaller',
  resolved: 'No longer segmented',
  stable: 'Stable',
};

/** What the segmentation model was trained on, from the analysis's stored provenance. */
export function modelScope(technique) {
  const provenance = technique?.model_provenance || {};
  if (provenance.pathology || provenance.trained_on) return provenance.pathology || provenance.trained_on;
  if (technique?.segmentation_method === 'classical') return 'No trained model (classical detector)';
  return null;
}

export function methodLabel(method) {
  if (!method) return null;
  if (method.startsWith('unet') || method.includes('unet')) return '3D U-Net (trained model)';
  if (method === 'classical') return 'Classical detector (fallback)';
  return method;
}
