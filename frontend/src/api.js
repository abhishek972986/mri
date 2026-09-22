/**
 * API client.
 *
 * Every call goes through `request`, so failures surface as thrown Errors
 * carrying the backend's own `detail` message. The backend writes those messages
 * for clinicians ("Refusing to compare studies from different patients"), and
 * replacing them with a generic "Request failed" would discard the only useful
 * part of the response.
 */

const BASE = '/api';

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch (cause) {
    throw new Error('Cannot reach the API. Is the backend running on port 8000?', { cause });
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) {
        detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new Error(detail);
  }

  if (response.status === 204) return null;
  return response.json();
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request('/health'),

  listPatients: () => request('/patients'),
  createPatient: (payload) => request('/patients', json(payload)),
  deletePatient: (id) => request(`/patients/${id}`, { method: 'DELETE' }),

  listStudies: (patientId) => request(`/patients/${patientId}/studies`),
  deleteStudy: (id) => request(`/studies/${id}`, { method: 'DELETE' }),

  uploadStudy: (patientId, formData) =>
    request(`/patients/${patientId}/studies`, { method: 'POST', body: formData }),

  startAnalysis: (studyId) => request(`/studies/${studyId}/analyze`, { method: 'POST' }),
  getAnalysis: (id) => request(`/analyses/${id}`),
  getScene: (id) => request(`/analyses/${id}/scene`),
  timeline: (patientId) => request(`/patients/${patientId}/timeline`),

  createComparison: (payload) => request('/comparisons', json(payload)),
  getComparisonScene: (id) => request(`/comparisons/${id}/scene`),
  listComparisons: (patientId) => request(`/patients/${patientId}/comparisons`),

  createReview: (analysisId, payload) => request(`/analyses/${analysisId}/reviews`, json(payload)),
  listReviews: (analysisId) => request(`/analyses/${analysisId}/reviews`),

  seedDemo: (payload) => request('/demo/seed', json(payload)),

  sliceUrl: (analysisId, filename) => `${BASE}/analyses/${analysisId}/slices/${filename}`,
  downloadUrl: (analysisId, artifact) => `${BASE}/analyses/${analysisId}/download/${artifact}`,
};

/**
 * Poll an analysis until it leaves the pending/running states.
 *
 * Analyses take ~20s, so this backs off from 1s to 4s rather than hammering a
 * server that is busy doing the very work being waited on.
 */
export async function waitForAnalysis(id, { onUpdate, signal, timeoutMs = 600000 } = {}) {
  const startedAt = Date.now();
  let delay = 1000;

  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled');

    const analysis = await api.getAnalysis(id);
    onUpdate?.(analysis);

    if (analysis.status === 'complete' || analysis.status === 'failed') return analysis;

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Analysis timed out. Check the backend logs.');
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 4000);
  }
}
