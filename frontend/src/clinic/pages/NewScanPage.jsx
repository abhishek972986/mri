import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, FileBox, Info, Play, RotateCcw, UploadCloud, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { EASE, SPRING } from '../../landing/motion';
import { formatDate, SEQUENCES } from '../format';
import { Avatar, Button, Card, CardHeader, DecisionSupportNote, ErrorState, Field, InlineAlert, PageHeader, Select, Skeleton, TextInput } from '../ui';
import { useToast } from '../toast';

const MAX_MB = 512;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Checks that can be made before sending anything: the name, the size, and
 * the first bytes. A .nii.gz must start with the gzip magic number; a raw .nii
 * must carry a NIfTI-1 (348) or NIfTI-2 (540) header size. The server then
 * does the real check — it opens the volume and verifies it is 3D brain-sized.
 */
async function precheck(file) {
  const name = file.name.toLowerCase();
  const gz = name.endsWith('.nii.gz');
  if (!gz && !name.endsWith('.nii')) {
    return 'Unsupported file format. Upload a NIfTI volume (.nii or .nii.gz). Convert DICOM series with dcm2niix first.';
  }
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_MB * 1024 * 1024) return `The file is larger than the ${MAX_MB} MB limit.`;

  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (gz) {
    if (head[0] !== 0x1f || head[1] !== 0x8b) return 'File appears to be corrupted: it is named .nii.gz but is not gzip-compressed.';
  } else {
    const view = new DataView(head.buffer);
    const le = view.getInt32(0, true);
    const be = view.getInt32(0, false);
    if (![348, 540].includes(le) && ![348, 540].includes(be)) return 'File appears to be corrupted: no valid NIfTI header was found.';
  }
  return null;
}

/** fetch() cannot report upload progress, so the upload itself uses XHR. */
function uploadWithProgress(patientId, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/patients/${patientId}/studies`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'NeuroVision');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else {
        const detail = body?.detail;
        const message = typeof detail === 'string' ? detail
          : Array.isArray(detail) ? detail.map((d) => d.msg).join(' · ')
            : xhr.status === 401 ? 'Your session has expired. Sign in again.' : 'Upload failed. Please try again.';
        reject(Object.assign(new Error(message), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed: the server could not be reached. Please try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(form);
  });
}

export default function NewScanPage() {
  const { patientId } = useParams();
  const id = Number(patientId);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef(null);

  const patient = useQuery({ queryKey: ['patient', id], queryFn: () => api.getPatient(id) });

  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState({ sequence: 'FLAIR', acquired_on: new Date().toISOString().slice(0, 10), description: '' });
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('select'); // select | uploading | uploaded
  const [study, setStudy] = useState(null);

  const choose = async (picked) => {
    if (!picked) return;
    setError(null);
    const problem = await precheck(picked);
    if (problem) {
      setFile(null);
      setError(problem);
      return;
    }
    setFile(picked);
  };

  const upload = async () => {
    if (!file) { setError('Choose an MRI file first.'); return; }
    if (meta.acquired_on && meta.acquired_on > new Date().toISOString().slice(0, 10)) { setError('Scan date cannot be in the future.'); return; }
    setError(null);
    setPhase('uploading');
    setProgress(0);
    const form = new FormData();
    form.append('file', file);
    form.append('sequence', meta.sequence);
    if (meta.acquired_on) form.append('acquired_on', meta.acquired_on);
    if (meta.description.trim()) form.append('description', meta.description.trim());
    try {
      const created = await uploadWithProgress(id, form, setProgress);
      setStudy(created);
      setPhase('uploaded');
      queryClient.invalidateQueries({ queryKey: ['studies', id] });
      queryClient.invalidateQueries({ queryKey: ['events', id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setPhase('select');
      setError(err.message);
    }
  };

  const analyze = useMutation({
    mutationFn: () => api.startAnalysis(study.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studies', id] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('AI analysis started.');
      navigate(`/app/scans/${study.id}`, { replace: true });
    },
    onError: (err) => setError(err.message),
  });

  if (patient.isError) {
    return <Card><ErrorState error={patient.error} title="Could not load this patient" onRetry={patient.refetch} /></Card>;
  }
  const p = patient.data;

  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader
        eyebrow="New MRI scan"
        title="Upload MRI Scan"
        subtitle="The scan is stored against this patient and analysed by the NeuroVision AI pipeline."
        back={<Link to={`/app/patients/${id}`} className="mb-2 inline-block text-[13px] font-semibold text-ink-soft hover:text-brand">← Back to patient</Link>}
      />

      <Card className="mb-5 flex items-center gap-4 p-4 sm:p-5">
        {p ? (
          <>
            <Avatar name={p.display_name} src={p.has_photo ? api.patientPhotoUrl(id) : null} size={48} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Patient</p>
              <p className="truncate text-[16px] font-bold text-ink">{p.display_name}</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Patient ID</p>
              <p className="font-mono text-[14px] font-semibold text-ink">{p.code}</p>
            </div>
          </>
        ) : <Skeleton className="h-12 w-full" />}
      </Card>

      <AnimatePresence mode="wait">
        {phase !== 'uploaded' ? (
          <motion.div key="select" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }} className="space-y-5">
            <Card className="p-5 sm:p-6">
              <InlineAlert tone="red" className="mb-4">{error}</InlineAlert>

              <input ref={input} type="file" accept=".nii,.gz,application/gzip" className="hidden" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />

              {!file ? (
                <motion.div
                  role="button"
                  tabIndex={0}
                  onClick={() => input.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0]); }}
                  animate={{ scale: dragging ? 1.01 : 1 }}
                  transition={SPRING.card}
                  className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors duration-300 ${
                    dragging ? 'border-brand bg-brand-soft' : 'border-[#CFDBEE] bg-[#F8FAFD] hover:border-[#9CC2F4] hover:bg-[#F3F8FF]'
                  }`}
                >
                  <motion.span animate={{ y: dragging ? -4 : 0 }} transition={SPRING.icon} className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-brand shadow-soft">
                    <UploadCloud className="h-7 w-7" strokeWidth={1.7} />
                  </motion.span>
                  <p className="mt-4 text-[16px] font-bold text-ink">Drag &amp; drop MRI scan</p>
                  <p className="mt-1 text-[14px] text-ink-soft">or <span className="font-semibold text-brand">browse files</span></p>
                  <p className="mt-3 text-[12.5px] text-ink-faint">NIfTI volumes: .nii or .nii.gz · up to {MAX_MB} MB · one 3D sequence per upload</p>
                </motion.div>
              ) : (
                <div className="flex items-center gap-4 rounded-2xl border border-[#E3EAF5] bg-[#F8FAFD] p-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-brand shadow-soft"><FileBox className="h-6 w-6" strokeWidth={1.7} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{file.name}</p>
                    <p className="text-[12.5px] text-ink-soft">{formatBytes(file.size)} · header check passed</p>
                    {phase === 'uploading' && (
                      <div className="mt-2.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#E3EAF5]">
                          <motion.div className="h-full rounded-full bg-gradient-to-r from-brand to-[#4DD4FF]" animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ ease: 'easeOut', duration: 0.3 }} />
                        </div>
                        <p className="mt-1 text-[12px] text-ink-faint">
                          {progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Verifying the volume on the server…'}
                        </p>
                      </div>
                    )}
                  </div>
                  {phase === 'select' && (
                    <button type="button" onClick={() => setFile(null)} className="grid h-9 w-9 place-items-center rounded-xl text-ink-faint hover:bg-white hover:text-ink" aria-label="Remove file">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Sequence" required hint="Which MRI sequence this volume is. FLAIR suits the trained model best.">
                  {({ id: fid }) => (
                    <Select id={fid} value={meta.sequence} onChange={(e) => setMeta({ ...meta, sequence: e.target.value })} disabled={phase === 'uploading'}>
                      {SEQUENCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Scan date" hint="When the MRI was acquired. Orders the patient's history.">
                  {({ id: fid }) => (
                    <TextInput id={fid} type="date" max={new Date().toISOString().slice(0, 10)} value={meta.acquired_on} onChange={(e) => setMeta({ ...meta, acquired_on: e.target.value })} disabled={phase === 'uploading'} />
                  )}
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  {({ id: fid }) => (
                    <TextInput id={fid} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="e.g. Follow-up after 3 months of therapy" disabled={phase === 'uploading'} />
                  )}
                </Field>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" to={`/app/patients/${id}`}>Cancel</Button>
                <Button icon={UploadCloud} onClick={upload} loading={phase === 'uploading'} disabled={!file}>
                  {phase === 'uploading' ? 'Uploading…' : 'Upload scan'}
                </Button>
              </div>
            </Card>

            <p className="flex items-start gap-2 px-1 text-[12.5px] text-ink-faint">
              <Info className="mt-[1px] h-4 w-4 shrink-0" />
              DICOM is not accepted directly: convert a series with <code className="rounded bg-[#EEF2F8] px-1">dcm2niix -z y</code> first. Uploaded files are stored on the server, never in a public folder, and only you can open them.
            </p>
          </motion.div>
        ) : (
          <motion.div key="uploaded" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="space-y-5">
            <Card className="p-5 sm:p-6">
              <CardHeader icon={CheckCircle2} title="Scan uploaded and validated" subtitle="The server opened the volume and confirmed it is a readable 3D MRI." />
              <dl className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-[#F8FAFD] p-4 sm:grid-cols-4">
                <div><dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">File</dt><dd className="mt-1 truncate text-[14px] text-ink">{study.original_filename}</dd></div>
                <div><dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Sequence</dt><dd className="mt-1 text-[14px] text-ink">{study.sequence}</dd></div>
                <div><dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Dimensions</dt><dd className="mt-1 text-[14px] text-ink">{study.shape} vox</dd></div>
                <div><dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Spacing</dt><dd className="mt-1 text-[14px] text-ink">{study.spacing_mm} mm</dd></div>
                <div><dt className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Scan date</dt><dd className="mt-1 text-[14px] text-ink">{formatDate(study.acquired_on, 'Not recorded')}</dd></div>
              </dl>
              <InlineAlert tone="red" className="mt-4">{error}</InlineAlert>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-[46ch] text-[13px] text-ink-soft">
                  Analysis runs preprocessing, the segmentation model, measurements, 3D surfaces and the report. It typically takes under a minute on a GPU and a few minutes on CPU.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" icon={RotateCcw} onClick={() => { setStudy(null); setFile(null); setPhase('select'); }}>Upload another</Button>
                  <Button size="lg" icon={Play} onClick={() => analyze.mutate()} loading={analyze.isPending}>Analyze MRI</Button>
                </div>
              </div>
            </Card>
            <DecisionSupportNote />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
