import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const LIVE = new Set(['queued', 'processing']);

/**
 * A scan (study) plus its latest analysis and patient, with polling while the
 * pipeline runs. Polls the analysis row — which the backend worker updates at
 * every pipeline stage — every 1.5 s, and stops the moment it settles.
 */
export function useScan(scanId) {
  const id = Number(scanId);

  const study = useQuery({
    queryKey: ['study', id],
    queryFn: () => api.getStudy(id),
    refetchInterval: (q) => (LIVE.has(q.state.data?.status) ? 1500 : false),
  });

  const analysisId = study.data?.latest_analysis_id;
  const analysis = useQuery({
    queryKey: ['analysis', analysisId],
    queryFn: () => api.getAnalysis(analysisId),
    enabled: Boolean(analysisId),
    refetchInterval: (q) => (q.state.data && ['pending', 'running'].includes(q.state.data.status) ? 1500 : false),
  });

  const patient = useQuery({
    queryKey: ['patient', study.data?.patient_id],
    queryFn: () => api.getPatient(study.data.patient_id),
    enabled: Boolean(study.data?.patient_id),
  });

  return { id, study, analysis, patient };
}
