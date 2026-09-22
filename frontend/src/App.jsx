import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, waitForAnalysis } from './api';
import BrainViewer from './components/BrainViewer';
import { CATEGORIES } from './lib/anatomicalBrain';
import ComparisonPanel from './components/ComparisonPanel';
import LesionTable from './components/LesionTable';
import ReportPanel from './components/ReportPanel';
import SliceViewer from './components/SliceViewer';
import Timeline from './components/Timeline';

const TABS = [
  { key: 'viewer', label: '3D & slices' },
  { key: 'lesions', label: 'Lesions' },
  { key: 'report', label: 'Report' },
  { key: 'compare', label: 'Comparison' },
];

function StatCard({ label, value, unit, sub }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}{unit && <em>{unit}</em>}
      </span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export default function App({ onExitToHome }) {
  const [health, setHealth] = useState(null);
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState(null);
  const [studies, setStudies] = useState([]);
  const [timeline, setTimeline] = useState([]);

  const [analysis, setAnalysis] = useState(null);
  const [scene, setScene] = useState(null);
  const [selectedLesion, setSelectedLesion] = useState(null);

  const [comparison, setComparison] = useState(null);
  const [comparisonScene, setComparisonScene] = useState(null);
  const [compareSelection, setCompareSelection] = useState([]);

  const [tab, setTab] = useState('viewer');
  const [brainSurface, setBrainSurface] = useState('anatomy');
  const [brainOpacity, setBrainOpacity] = useState(1.0);
  const [visibleCategories, setVisibleCategories] = useState(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.key, c.defaultOn])),
  );
  const [showLayers, setShowLayers] = useState(false);

  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  // --- bootstrap ----------------------------------------------------------
  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message));
    refreshPatients();
  }, []);

  const refreshPatients = useCallback(async () => {
    try {
      const list = await api.listPatients();
      setPatients(list);
      setPatientId((current) => current ?? list[0]?.id ?? null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const refreshPatientData = useCallback(async (id) => {
    if (!id) { setStudies([]); setTimeline([]); return; }
    try {
      const [studyList, timelineList] = await Promise.all([api.listStudies(id), api.timeline(id)]);
      setStudies(studyList);
      setTimeline(timelineList);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refreshPatientData(patientId);
    setAnalysis(null);
    setScene(null);
    setComparison(null);
    setComparisonScene(null);
    setCompareSelection([]);
  }, [patientId, refreshPatientData]);

  // --- actions ------------------------------------------------------------
  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const seedDemo = (response) => run('Generating synthetic patient…', async () => {
    const seeded = await api.seedDemo({ response, n_lesions: 5 });
    await refreshPatients();
    setPatientId(seeded.patient_id);

    setBusy('Analysing baseline and follow-up (~40s)…');
    await Promise.all(seeded.analysis_ids.map((id) => waitForAnalysis(id)));
    await refreshPatientData(seeded.patient_id);

    setCompareSelection(seeded.analysis_ids);
    await openAnalysis(seeded.analysis_ids[0]);
  });

  const createPatient = () => run('Creating patient…', async () => {
    const label = window.prompt('Patient label (a pseudonym — never a real name)');
    if (label === null) return;
    const created = await api.createPatient({ label: label.trim() || null });
    await refreshPatients();
    setPatientId(created.id);
  });

  const upload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !patientId) return;

    const sequence = window.prompt('Sequence (T1, T2, FLAIR, T1C, DWI, ADC)', 'FLAIR');
    if (sequence === null) { event.target.value = ''; return; }
    const acquired = window.prompt('Acquisition date (YYYY-MM-DD, optional)', '');

    run('Uploading…', async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('sequence', sequence.trim() || 'unknown');
      if (acquired?.trim()) form.append('acquired_on', acquired.trim());

      const study = await api.uploadStudy(patientId, form);
      await refreshPatientData(patientId);

      setBusy('Analysing (~20s)…');
      const started = await api.startAnalysis(study.id);
      const done = await waitForAnalysis(started.id);
      await refreshPatientData(patientId);

      if (done.status === 'failed') throw new Error(done.error || 'Analysis failed.');
      await openAnalysis(done.id);
    }).finally(() => { if (fileRef.current) fileRef.current.value = ''; });
  };

  const analyseStudy = (studyId) => run('Analysing (~20s)…', async () => {
    const started = await api.startAnalysis(studyId);
    const done = await waitForAnalysis(started.id);
    await refreshPatientData(patientId);
    if (done.status === 'failed') throw new Error(done.error || 'Analysis failed.');
    await openAnalysis(done.id);
  });

  const openAnalysis = async (analysisId) => {
    const [full, sceneData] = await Promise.all([
      api.getAnalysis(analysisId),
      api.getScene(analysisId).catch(() => null),
    ]);
    setAnalysis(full);
    setScene(sceneData);
    setSelectedLesion(null);
    setTab('viewer');
  };

  const toggleCompare = (analysisId) => {
    setCompareSelection((prev) => {
      if (prev.includes(analysisId)) return prev.filter((id) => id !== analysisId);
      return [...prev, analysisId].slice(-2);
    });
    openAnalysis(analysisId).catch((e) => setError(e.message));
  };

  const compare = () => run('Registering and comparing (~25s)…', async () => {
    const ordered = [...compareSelection].sort((a, b) => {
      const dateOf = (id) => timeline.find((t) => t.id === id)?.acquired_on ?? '';
      return dateOf(a).localeCompare(dateOf(b));
    });

    const created = await api.createComparison({
      baseline_analysis_id: ordered[0],
      followup_analysis_id: ordered[1],
    });
    const sceneData = await api.getComparisonScene(created.id).catch(() => null);
    setComparison(created);
    setComparisonScene(sceneData);
    setTab('compare');
  });

  // --- derived ------------------------------------------------------------
  const burden = analysis?.burden;
  const patient = useMemo(
    () => patients.find((p) => p.id === patientId) ?? null,
    [patients, patientId],
  );

  const analysedStudies = useMemo(
    () => studies.filter((s) => s.latest_analysis_status === 'complete'),
    [studies],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button
            type="button"
            className="mark"
            aria-label="Back to the NeuroTB AI home page"
            onClick={onExitToHome}
          />
          <div>
            <h1>NeuroTB AI</h1>
            <p>Intracranial tuberculosis · decision support · research preview</p>
          </div>
        </div>

        <div className="topbar-right">
          {health && (
            <span className={`backend-chip ${health.checkpoint_loaded ? 'ok' : 'warn'}`}>
              {health.checkpoint_loaded ? 'Trained model' : 'Fallback detector — demo only'}
            </span>
          )}
        </div>
      </header>

      {!health?.checkpoint_loaded && (
        <div className="banner warn">
          No trained segmentation model is loaded. Findings come from a classical blob detector
          with no validated sensitivity or specificity, intended for demonstration and pipeline
          testing only. Nothing shown here may be used for patient care.
        </div>
      )}

      {error && (
        <div className="banner error">
          {error}
          <button type="button" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {busy && <div className="banner busy"><span className="spinner" />{busy}</div>}

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-head">
              <h2>Patients</h2>
              <button type="button" onClick={createPatient}>+ New</button>
            </div>

            <ul className="patient-list">
              {patients.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={p.id === patientId ? 'active' : ''}
                    onClick={() => setPatientId(p.id)}
                  >
                    <strong>{p.label || p.code}</strong>
                    <span className="mono small">{p.code}</span>
                    <span className="muted small">{p.study_count} stud{p.study_count === 1 ? 'y' : 'ies'}</span>
                  </button>
                </li>
              ))}
              {patients.length === 0 && <li className="muted small">No patients yet.</li>}
            </ul>
          </div>

          <div className="sidebar-section">
            <h2>Demo data</h2>
            <p className="muted small">
              Generates a synthetic phantom pair — no patient data involved.
            </p>
            <div className="demo-buttons">
              {['improving', 'worsening', 'mixed', 'stable'].map((response) => (
                <button key={response} type="button" onClick={() => seedDemo(response)} disabled={!!busy}>
                  {response}
                </button>
              ))}
            </div>
          </div>

          {patient && (
            <div className="sidebar-section">
              <div className="sidebar-head">
                <h2>Studies</h2>
                <label className="upload-button">
                  + Upload
                  <input ref={fileRef} type="file" accept=".nii,.nii.gz,.gz" onChange={upload} hidden />
                </label>
              </div>

              <ul className="study-list">
                {studies.map((study) => (
                  <li key={study.id} className={analysis?.study_id === study.id ? 'active' : ''}>
                    <div className="study-main">
                      <strong>{study.sequence}</strong>
                      <span className="muted small">{study.acquired_on ?? 'undated'}</span>
                      <span className="mono small">{study.shape} · {study.spacing_mm} mm</span>
                    </div>
                    {study.latest_analysis_status === 'complete' ? (
                      <button type="button" onClick={() => openAnalysis(study.latest_analysis_id)}>
                        Open
                      </button>
                    ) : (
                      <button type="button" onClick={() => analyseStudy(study.id)} disabled={!!busy}>
                        {study.latest_analysis_status === 'failed' ? 'Retry' : 'Analyse'}
                      </button>
                    )}
                  </li>
                ))}
                {studies.length === 0 && <li className="muted small">No studies uploaded.</li>}
              </ul>
            </div>
          )}
        </aside>

        <main className="content">
          {!analysis && (
            <div className="placeholder">
              <h2>No analysis selected</h2>
              <p>
                Upload a NIfTI brain MRI, or generate a synthetic demo patient from the sidebar,
                then open a completed analysis.
              </p>
            </div>
          )}

          {analysis && (
            <>
              <div className="stat-row">
                <StatCard label="Lesions" value={burden?.lesion_count ?? 0} />
                <StatCard label="Total volume" value={(burden?.total_volume_cm3 ?? 0).toFixed(2)} unit="cm³" />
                <StatCard label="Largest" value={(burden?.largest_volume_cm3 ?? 0).toFixed(2)} unit="cm³" />
                <StatCard
                  label="Lesion load"
                  value={(burden?.lesion_load_percent ?? 0).toFixed(3)}
                  unit="%"
                  sub={`of ${(burden?.brain_volume_cm3 ?? 0).toFixed(0)} cm³ brain`}
                />
                <StatCard
                  label="Backend"
                  value={analysis.method ?? '—'}
                  sub={`${analysis.duration_seconds ?? '—'}s`}
                />
              </div>

              <nav className="tabs">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={t.key === tab ? 'active' : ''}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>

              {tab === 'viewer' && (
                <div className="viewer-grid">
                  <div className="panel">
                    <div className="panel-head">
                      <h3>3D lesion map</h3>
                      <div className="viewer-controls">
                        <div className="segmented small-seg">
                          <button
                            type="button"
                            className={brainSurface === 'anatomy' ? 'active' : ''}
                            onClick={() => setBrainSurface('anatomy')}
                            title="Anatomical atlas fitted to this patient's brain size"
                          >
                            Anatomical
                          </button>
                          <button
                            type="button"
                            className={brainSurface === 'patient' ? 'active' : ''}
                            onClick={() => setBrainSurface('patient')}
                            title="Isosurface of this patient's own segmented brain"
                          >
                            Patient
                          </button>
                        </div>
                        <label className="slider">
                          Opacity
                          <input
                            type="range"
                            min="0.1"
                            max="5.5"
                            step="0.1"
                            value={brainOpacity}
                            onChange={(e) => setBrainOpacity(Number(e.target.value))}
                          />
                        </label>
                        {brainSurface === 'anatomy' && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setShowLayers((v) => !v)}
                          >
                            {showLayers ? 'Hide layers' : 'Layers'}
                          </button>
                        )}
                      </div>
                    </div>

                    {brainSurface === 'anatomy' && showLayers && (
                      <div className="anatomy-layers">
                        {CATEGORIES.map((c) => (
                          <label key={c.key}>
                            <input
                              type="checkbox"
                              checked={!!visibleCategories[c.key]}
                              onChange={() => setVisibleCategories((prev) => ({
                                ...prev, [c.key]: !prev[c.key],
                              }))}
                            />
                            <i
                              className="swatch"
                              style={{ background: `#${c.color.toString(16).padStart(6, '0')}` }}
                            />
                            {c.label}
                          </label>
                        ))}
                      </div>
                    )}

                    {brainSurface === 'anatomy' && (
                      <p className="muted small anatomy-note">
                        Specimen from <a href="https://github.com/itayinbarr/brainproject"
                        target="_blank" rel="noreferrer">The Brain Project</a> (Z-Anatomy /
                        BodyParts3D), 437 structures, scaled to this patient's brain bounding box.
                        The anatomy is normalised, not this patient's own — switch to{' '}
                        <strong>Patient</strong> for their true brain shape. Lesion geometry and
                        every measurement come from their scan in both views.
                      </p>
                    )}

                    <div className="viewer-frame">
                      {scene ? (
                        <BrainViewer
                          scene={scene}
                          selectedLesionId={selectedLesion}
                          onSelectLesion={setSelectedLesion}
                          brainSurface={brainSurface}
                          brainOpacity={brainOpacity}
                          visibleCategories={visibleCategories}
                        />
                      ) : (
                        <div className="panel empty">No 3D scene for this analysis.</div>
                      )}
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-head"><h3>MRI slices</h3></div>
                    <SliceViewer analysisId={analysis.id} slices={analysis.slices} />
                  </div>
                </div>
              )}

              {tab === 'lesions' && (
                <div className="panel">
                  <div className="panel-head"><h3>Lesion measurements</h3></div>
                  <LesionTable
                    lesions={analysis.lesions ?? []}
                    selectedId={selectedLesion}
                    onSelect={setSelectedLesion}
                  />
                </div>
              )}

              {tab === 'report' && (
                <div className="panel">
                  <ReportPanel analysis={analysis} />
                </div>
              )}

              {tab === 'compare' && (
                <div className="panel">
                  <div className="panel-head">
                    <h3>Treatment progress</h3>
                    <button
                      type="button"
                      className="primary"
                      disabled={compareSelection.length !== 2 || !!busy}
                      onClick={compare}
                    >
                      Compare selected ({compareSelection.length}/2)
                    </button>
                  </div>

                  <Timeline
                    entries={timeline}
                    selectedIds={compareSelection}
                    onSelect={toggleCompare}
                  />

                  {analysedStudies.length < 2 && (
                    <p className="muted small">
                      Two completed analyses of the same patient are needed for a comparison.
                    </p>
                  )}

                  {comparison && (
                    <ComparisonPanel comparison={comparison} scene={comparisonScene} />
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
