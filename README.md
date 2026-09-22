# NeuroTB AI

Decision support for intracranial tuberculosis imaging: lesion detection and
segmentation from brain MRI, 3D quantification and visualisation, longitudinal
treatment-response comparison, and structured preliminary reporting for
clinician review.

> **Not a medical device. Not a diagnosis.** Every report this system produces is
> marked as requiring review by a qualified clinician, and there is no code path
> that finalises a report without a recorded human reviewer. Imaging findings
> alone cannot establish a diagnosis of CNS tuberculosis.

---

## Read this before anything else

**There is no public labeled neuro-TB MRI dataset, so no model here has ever
seen a tuberculoma.**

The trained model shipped with this project learned on **BraTS 2024 adult
glioma**. It is a genuine focal-lesion segmenter with real held-out metrics, and
those metrics describe *glioma*. They do not transfer to tuberculosis, and every
report the system generates says so in its limitations.

Without a checkpoint the system falls back to a *classical blob detector*:
multi-scale blob detection with ring-filling and local-contrast scoring. On
synthetic phantoms it finds about 84% of lesions with roughly 1.8 false positives
per scan — a number that describes phantoms, not patients.

Everything *around* the model — preprocessing, registration, quantification,
change analysis, 3D rendering, reporting, review workflow — is real and works on
real NIfTI volumes today. The model is the piece you supply. See
[Training a real model](#training-a-real-model).

---

## Quick start

```powershell
.\run.ps1
```

Then open <http://127.0.0.1:5173> and click one of the **Demo data** buttons in
the sidebar. That generates a synthetic patient with a baseline and a follow-up
scan, runs both through the pipeline (~40 s total), and leaves you on a completed
analysis with the comparison ready to run.

Manually:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend

cd frontend; npm install; npm run dev
```

API docs at <http://127.0.0.1:8000/docs>.

### Using your own data

Upload a **NIfTI** (`.nii` / `.nii.gz`) brain MRI. Convert DICOM first:

```bash
dcm2niix -z y -o output_dir dicom_dir
```

FLAIR or post-contrast T1 give the classical detector the most to work with.

---

## What it does

| Stage | Implementation | Production alternative |
|---|---|---|
| Resampling | 1 mm isotropic, affine-aware | — |
| Bias correction | Homomorphic, mask-normalized blur | N4ITK (SimpleITK) |
| Brain extraction | BET-style threshold + erode/select/dilate | HD-BET, FSL BET |
| Segmentation | 3D U-Net trained on BraTS glioma, classical fallback | Fine-tune on TB cases |
| Quantification | Connected components, volume, Feret ⌀, sphericity | — |
| Localization | Geometric zones from the affine | MNI registration + Harvard-Oxford |
| Registration | Multi-resolution Powell on NMI | SimpleITK (auto-detected if installed) |
| Change analysis | Overlap + proximity lesion matching | — |
| 3D | Marching cubes → Three.js buffers | — |
| Anatomical reference | Z-Anatomy atlas (437 structures), affine-fitted | Nonlinear MNI normalisation |

Measured on this machine (GTX 1650, 192×228×192 @ 1 mm): analysis ~18 s per
volume, comparison ~22 s including registration.

### The 3D view

Two brain surfaces, toggled in the viewer header, answering different questions:

**Anatomical** (default) — the [Z-Anatomy](https://www.z-anatomy.com/) atlas: a
real human brain of 437 named structures across 12 categories (cortex,
cerebellum, brainstem, deep grey, diencephalon, ventricles, white matter, tracts,
arteries, veins, cranial nerves, meninges), each toggleable under **Layers**.
Defaults to a translucent cortical shell with cerebellum and brainstem, because
those are the structures TB favours and the rest would obscure the finding.

**Patient** — the isosurface of the patient's own segmented brain. Genuinely
theirs, but a smooth hull with no internal structure.

Lesion geometry is identical in both views: it always comes from the patient's
scan in their own millimetre frame. Only the surrounding reference changes.

The atlas is a whole-body model in metres whose brain sits at head height, so it
is centred and rescaled at load. Its anatomical axes (+X left, +Y superior,
+Z anterior) were derived empirically from the model's own geometry — comparing
centroids of left- against right-sided structures, cortex against brainstem, and
deep grey against cerebellum — rather than assumed, and the resulting transform
is checked against the patient's brain bounding box.

The fit is a 6-parameter affine (translation plus per-axis scale). That makes the
atlas a plausible anatomical *reference* at this patient's brain size, **not a
model of their anatomy** — the viewer says so beneath the controls. Anatomical
region labels in reports still come from the geometric zoning in
`pipeline/atlas.py`, computed on the patient's own scan; the atlas is used for
display only and does not feed any measurement.

### Longitudinal comparison

Two analysed studies of the same patient are rigidly registered, then their
lesions are matched across time by spatial overlap first and centroid proximity
second. Each lesion is classified `new` / `resolved` / `increased` / `decreased`
/ `stable`, with a ±20% tolerance band so segmentation noise is not reported as
treatment response.

The follow-up's *existing* segmentation is warped into baseline space rather than
re-segmented there, so the measured change reflects the patient and not the
interpolation.

Mixed responses are explicitly flagged as possible **paradoxical reactions** —
a recognised phenomenon in treated CNS TB where lesions transiently enlarge
despite effective therapy — rather than as treatment failure.

---

## Training a real model

There is still **no public labeled neuro-TB MRI segmentation dataset** — not on
Kaggle, not on TCIA, not anywhere. Kaggle's brain MRI sets are either tumour
*classification* (Br35H, "Brain Tumor MRI Dataset": 2D JPEGs, no masks) or
glioma segmentation (LGG). None are tuberculosis.

So the model shipped here is trained on **BraTS 2024 adult glioma** and is
honest about it. It is a real, validated **focal brain lesion segmenter** — the
pretraining half of the transfer-learning path. Fine-tuning on TB cases you
source locally is the half that remains.

```powershell
# 1. Fetch FLAIR + expert mask per case (~4.3 MB/case, no Kaggle account needed)
.\.venv\Scripts\python.exe backend\train\download_brats.py --cases 300

# 2. Integrity-check every case before preprocessing
.\.venv\Scripts\python.exe backend\train\verify_data.py

# 3. Crop, z-score and cache as npz; write the case-level splits
.\.venv\Scripts\python.exe backend\train\prepare_brats.py

# 4. Train (sized for a 4 GB card)
.\.venv\Scripts\python.exe backend\train\train_brats.py --epochs 60 --amp

# 5. Held-out metrics: Dice, IoU, lesion sensitivity, FP/case, HD95, size bands
.\.venv\Scripts\python.exe backend\train\evaluate.py --sweep

# 6. Visual validation: FLAIR / truth / prediction / overlay + 3D meshes
.\.venv\Scripts\python.exe backend\train\visualize_predictions.py --cases 6
```

Then point the API at the checkpoint and restart:

```powershell
$env:NEUROTB_MODEL_CHECKPOINT = "backend\checkpoints\unet3d_brats.pt"
```

`/api/health` reports which backend is live, and the dashboard shows a warning
banner whenever it is the fallback.

**Why per-file rather than the Decathlon tar.** The Medical Segmentation
Decathlon ships this task as one 7 GB archive containing all four sequences.
This pipeline is single-sequence, so three quarters of that download would be
thrown away. Pulling FLAIR and the mask per case from the Hugging Face mirror
costs ~1.3 GB for 300 cases instead of 7 GB.

**Splitting.** By case, from a fixed seed. The test list is written to disk
*before the first gradient step* and stored inside the checkpoint, so evaluation
cannot drift onto training data. Patch-level splits leak badly here — patches
from one patient's tumour are highly correlated, and splitting on them produces
Dice in the high 0.9s and a model worth nothing on a new patient.

**What training watches.** Train loss, validation loss, validation Dice, recall
and precision every epoch; and every `--full-val-every` epochs a whole-volume
pass giving per-lesion sensitivity and false positives per case. That split
matters: a foreground-biased patch sampler never asks the model to leave a whole
brain of healthy tissue alone, so patch metrics systematically understate false
positives. Rising validation loss against falling training loss is flagged, and
`--early-stop N` halts on it.

**Integrity checks.** `verify_data.py` decompresses every gzip stream (truncated
downloads are the real failure mode on a slow link and are invisible to a header
read), confirms image and mask share an affine, checks spacing and label values,
and verifies the mask lies inside the brain — which catches image/mask
misalignment that a shape check passes straight over.

**Foreground sampling.** `--fg-ratio 0.7` centres most patches on a lesion
voxel. Lesions occupy a couple of percent of brain volume at most; uniform
sampling converges to predicting zero everywhere, which scores 99% voxel
accuracy and finds nothing.

**Using your own TB data.** Put it in the same per-case layout
(`flair.nii.gz` + `seg.nii.gz`) and fine-tune from the glioma checkpoint at a
lower learning rate. `backend/train/train_seg.py` takes the generic
`case/image.nii.gz` + `case/label.nii.gz` folder layout.

## Design decisions worth knowing

**Confidence is reported as two separate numbers.** `detection_confidence` is the
model's own probability over the voxels it marked. `tb_pattern_score` is a
transparent rule-based score over lesion location, multiplicity, size and shape —
every point it awards is reported as a reason. Conflating them would let a
confident segmentation of an obviously non-TB lesion read as diagnostic
confidence.

**Uncalibrated probabilities are labelled as such.** Until a checkpoint carries a
validated reliability curve, every report states that the numbers rank voxels and
do not estimate risk.

**Detection is restricted to ≥5 mm inside the brain surface.** Partial-volume
voxels at the boundary drag the local background estimate down, which makes the
entire cortical ribbon read as focally bright. The cost — missing juxtacortical
lesions, and the corticomedullary junction is a site TB favours — is stated in
every report's limitations.

**The schema has nowhere to put PHI.** No name, date of birth, or hospital number
field exists on `Patient`; there is a generated pseudonymous code and a
clinician-controlled label. A test asserts those fields stay absent.

**Reviews are append-only.** A clinician's corrections are stored alongside the
original AI output rather than replacing it, so who changed what, and when, stays
reconstructable — a medico-legal requirement, and the only honest basis for
reusing corrections as training labels.

---

## Attribution

The 3D brain model is **not** original to this project.

`frontend/public/models/brain.glb` comes from
[itayinbarr/brainproject](https://github.com/itayinbarr/brainproject), which
derives it from **Z-Anatomy**, built on **BodyParts3D** © DBCLS. It is licensed
**CC BY-SA 4.0**, which carries two obligations on anyone redistributing this
project:

- **Attribution** must be kept. It is rendered in the viewer footer as well as in
  [NOTICE.md](NOTICE.md), and must not be removed.
- **ShareAlike**: the model and any adaptation of it stay CC BY-SA 4.0. This
  binds the asset and its derivatives, not the rest of this source tree. If you
  re-mesh, decimate or otherwise modify `brain.glb`, the result is still
  CC BY-SA 4.0.

`brain.glb` is used unmodified — transformed only at runtime. See
[NOTICE.md](NOTICE.md) for the full third-party list.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -c backend\pytest.ini --rootdir backend
.\.venv\Scripts\python.exe -m pytest backend\tests -c backend\pytest.ini --rootdir backend -m "not slow"
```

38 tests. They run on synthetic phantoms where ground truth is exact, and they
test plumbing and physics — volumes in cm³, alignment, change direction — not
clinical accuracy. Several pin measured numbers (the registration tolerance, the
threshold operating point) so a regression in those shows up as a failure.

---

## Layout

```
backend/app/pipeline/     pure array functions; no DB, no filesystem
              volume.py   Volume container + NIfTI I/O
          preprocess.py   resample, bias correct, skull strip, normalize
        segmentation.py   U-Net inference + classical fallback
                nets.py   3D U-Net / Attention U-Net (torch optional)
            quantify.py   per-lesion measurements
               atlas.py   approximate anatomical zones
        registration.py   rigid registration, carries masks and images
             compare.py   lesion matching and change classification
                mesh.py   marching cubes → Three.js buffers
              slices.py   PNG slice rendering (no Pillow)
              report.py   structured report generation
               synth.py   phantom generator
backend/app/services/     orchestration, storage
backend/app/routers/      HTTP endpoints
backend/train/            training entry point
frontend/src/             React dashboard + Three.js viewer
      lib/anatomicalBrain.js  Z-Anatomy atlas loading, grouping and patient fit
frontend/public/models/   brain.glb atlas (CC BY-SA 4.0 — see NOTICE.md)
```

The `pipeline/` modules know nothing about the database or the filesystem, so the
science is testable without a running server.

---

## Limitations

- Detects focal signal abnormality only. Does not assess meningeal enhancement,
  hydrocephalus, infarction, or midline shift — any of which may be the dominant
  finding in CNS TB, and the first of which is often *the* finding.
- Single-sequence analysis. Characterising intracranial TB normally needs T1, T2,
  FLAIR and post-contrast T1 together; ring enhancement cannot be assessed
  without post-contrast imaging.
- Anatomical labels are geometric, not atlas-derived, and are imprecise near
  zone boundaries.
- Rigid registration only. Adequate for same-subject longitudinal comparison;
  not for cross-subject or atlas alignment.
- The anatomical brain in the 3D view is a normalised atlas scaled to the
  patient's brain size, not their own anatomy. It is a visual reference; no
  measurement or region label is derived from it.
- No authentication, no audit log, no DICOM support, no de-identification
  pipeline. See `docs/ROADMAP.md`.
