/**
 * API client.
 *
 * Every call goes through `request`, so failures surface as thrown ApiErrors
 * carrying the backend's own `detail` message. The backend writes those messages
 * for clinicians ("Refusing to compare studies from different patients"), and
 * replacing them with a generic "Request failed" would discard the only useful
 * part of the response.
 *
 * Authentication is an HttpOnly session cookie set by the API; this module
 * never sees the token. State-changing requests also send X-Requested-With,
 * which the API requires as a CSRF defence. A 401 anywhere notifies the auth
 * layer (onUnauthorized) so the app can return to the sign-in screen.
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler = null;
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

function formatDetail(detail) {
  if (typeof detail === 'string') return detail;
  // FastAPI validation errors: [{loc: [..., field], msg}, ...]
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
        const label = typeof field === 'string' ? field.replace(/_/g, ' ') : null;
        return label ? `${label}: ${d.msg}` : d.msg;
      })
      .join(' · ');
  }
  return JSON.stringify(detail);
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (method !== 'GET' && method !== 'HEAD') headers['X-Requested-With'] = 'NeuroVision';

  let response;
  try {
    response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...options, method, headers });
  } catch (cause) {
    throw new ApiError('Cannot reach the NeuroVision server. Check that the backend is running.', 0, { cause });
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = formatDetail(body.detail);
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    if (response.status === 401 && !path.startsWith('/auth/login')) unauthorizedHandler?.();
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.blob();
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const query = (params) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  health: () => request('/health'),

  // --- auth & profile
  authStatus: () => request('/auth/status'),
  login: (payload) => request('/auth/login', json('POST', payload)),
  register: (payload) => request('/auth/register', json('POST', payload)),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  updateProfile: (payload) => request('/doctor/profile', json('PUT', payload)),
  changePassword: (payload) => request('/doctor/password', json('PUT', payload)),
  uploadProfilePhoto: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/doctor/profile/photo', { method: 'POST', body: form });
  },

  // --- dashboard
  dashboard: () => request('/dashboard'),
  notifications: () => request('/notifications'),
  reports: () => request('/reports'),
  pipelineStages: () => request('/pipeline/stages'),

  // --- patients
  listPatients: (params) => request(`/patients${query(params)}`),
  getPatient: (id) => request(`/patients/${id}`),
  createPatient: (payload) => request('/patients', json('POST', payload)),
  updatePatient: (id, payload) => request(`/patients/${id}`, json('PUT', payload)),
  deletePatient: (id) => request(`/patients/${id}`, { method: 'DELETE' }),
  uploadPatientPhoto: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return request(`/patients/${id}/photo`, { method: 'POST', body: form });
  },
  patientEvents: (id) => request(`/patients/${id}/events`),
  timeline: (patientId) => request(`/patients/${patientId}/timeline`),

  // --- scans (studies)
  listStudies: (patientId) => request(`/patients/${patientId}/studies`),
  listAllStudies: (params) => request(`/studies${query(params)}`),
  getStudy: (id) => request(`/studies/${id}`),
  studyAnalyses: (id) => request(`/studies/${id}/analyses`),
  deleteStudy: (id) => request(`/studies/${id}`, { method: 'DELETE' }),
  uploadStudy: (patientId, formData) =>
    request(`/patients/${patientId}/studies`, { method: 'POST', body: formData }),

  // --- analyses
  startAnalysis: (studyId) => request(`/studies/${studyId}/analyze`, { method: 'POST' }),
  getAnalysis: (id) => request(`/analyses/${id}`),
  getScene: (id) => request(`/analyses/${id}/scene`),
  volumeInfo: (id) => request(`/analyses/${id}/volume`),
  uploadSnapshot: (id, blob) => {
    const form = new FormData();
    form.append('file', blob, 'snapshot.png');
    return request(`/analyses/${id}/snapshot`, { method: 'POST', body: form });
  },
  reportPdf: (id) => request(`/analyses/${id}/report.pdf`),

  // --- comparisons
  createComparison: (payload) => request('/comparisons', json('POST', payload)),
  getComparison: (id) => request(`/comparisons/${id}`),
  getComparisonScene: (id) => request(`/comparisons/${id}/scene`),
  listComparisons: (patientId) => request(`/patients/${patientId}/comparisons`),

  // --- reviews
  createReview: (analysisId, payload) => request(`/analyses/${analysisId}/reviews`, json('POST', payload)),
  listReviews: (analysisId) => request(`/analyses/${analysisId}/reviews`),

  // --- URLs for <img>/<a>, which carry the session cookie on their own
  sliceUrl: (analysisId, filename) => `${BASE}/analyses/${analysisId}/slices/${filename}`,
  volumeSliceUrl: (analysisId, plane, index, layer) => `${BASE}/analyses/${analysisId}/slice/${plane}/${index}?layer=${layer}`,
  downloadUrl: (analysisId, artifact) => `${BASE}/analyses/${analysisId}/download/${artifact}`,
  snapshotUrl: (analysisId, version = '') => `${BASE}/analyses/${analysisId}/snapshot${version ? `?v=${version}` : ''}`,
  patientPhotoUrl: (patientId, version = '') => `${BASE}/patients/${patientId}/photo${version ? `?v=${version}` : ''}`,
  profilePhotoUrl: (version = '') => `${BASE}/doctor/profile/photo${version ? `?v=${version}` : ''}`,
};

/** Trigger a browser download of a Blob. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
