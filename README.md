# NeuroVision AI

AI-assisted brain MRI analysis for clinician review: focal lesion segmentation,
3D quantification and visualisation, longitudinal comparison between scans, and
structured preliminary reporting, in a doctor-facing clinical application.

> **Not a medical device. Not a diagnosis.** Nothing here is cleared or approved
> by any regulator. Every report is marked preliminary until a qualified
> clinician records a review, and there is no code path that finalises a report
> without one. The system shows *where* signal is abnormal; it does not
> determine *what* a region is.

---

## Read this before anything else

**The shipped model is a glioma-trained lesion segmenter, and nothing more.**

`backend/checkpoints/unet3d_brats.pt` is a 3D U-Net trained on **210 adult
diffuse glioma cases from BraTS 2024 (FLAIR)**. Its checkpoint records a
validation patch Dice of 0.80 and recall of 0.79, and an operating threshold of
0.7 tuned on 45 validation cases. Those figures describe glioma segmentation on
BraTS data. It has not been validated on other pathologies, scanners or
protocols, and it does not identify tumour type, grade, or any other cause.
`/api/health` reports the loaded model's provenance, and every report states
its training scope first among its limitations.

This project began as **NeuroTB**, a tuberculosis decision-support prototype.
No public labelled neuro-TB MRI dataset exists, so no model here has ever seen
a tuberculoma, and the TB-specific parts of the original report (a rule-based
"TB pattern score" and TB-worded impressions) have been removed. Reports stored
by the older version are re-worded when served, from their own stored
measurements; the data itself is untouched. Environment variables keep their
historical `NEUROTB_` prefix.

Without a checkpoint the system falls back to a *classical blob detector*:
multi-scale blob detection with ring-filling and local-contrast scoring. On
synthetic phantoms it finds about 84% of lesions with roughly 1.8 false positives
per scan — a number that describes phantoms, not patients. Reports say which
backend produced them.

Everything *around* the model — preprocessing, registration, quantification,
change analysis, 3D rendering, reporting, review workflow — works on real NIfTI
volumes. See [Training a real model](#training-a-real-model).

---

## Quick start

```powershell
.\run.ps1
```

Then open <http://127.0.0.1:5173>. The public site is at `/`; the clinical
application is at `/app` and requires a doctor account. On a fresh install the
sign-in page offers to create the first account (it also takes ownership of any
patient records that predate accounts). Further accounts are created by an
administrator:

```powershell
.\.venv\Scripts\python.exe backend\manage.py create-doctor --email you@hospital.org --name "Asha Rao"
.\.venv\Scripts\python.exe backend\manage.py reset-password --email you@hospital.org
```

There is no emailed password reset — no mail transport is configured — so
"Forgot password?" tells the doctor to ask an administrator to run the second
command. Both commands accept `--password-stdin` for scripted setup; the
password is never taken as a command-line argument.

### The clinical workflow

Login → dashboard → patients → add patient → patient profile → upload MRI
(`/app/patients/:id/new-scan`) → **Analyze MRI** → live processing screen (the
worker reports each pipeline stage as it starts) → results
(`/app/scans/:scanId`: summary, slice viewer, segmentation, 3D, measurements,
review; the slice viewer steps through every slice of the preprocessed volume,
rendered on demand with the segmentation overlay, raw mask or probability map) →
3D viewer (`…/visualization`: rotate, pan, pinch/zoom, reset, layers,
fullscreen, snapshot into the report) → report (`…/report`, printable, PDF via
`/api/analyses/:id/report.pdf`) → comparison with an earlier scan → patient
timeline and progress chart. Every scan belongs to one patient, every patient to
one doctor, and the API enforces that on every request.

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
| Segmentation | 3D U-Net trained on BraTS glioma, classical fallback | Fine-tune on labelled cases of the target pathology |
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
Defaults to a translucent cortical shell with cerebellum and brainstem, so the
segmented regions stay visible through the anatomy.

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
change. The overall classification describes change in *segmented volume*
between the two scans, and the app labels it that way ("Segmented volume
decreased", "Mixed change"); it is not a statement about the patient's clinical
course.

The follow-up's *existing* segmentation is warped into baseline space rather than
re-segmented there, so the measured change reflects the patient and not the
interpolation.

Opposite changes within one study pair (some regions new or larger, others
smaller or gone) raise a "mixed change" alert, because the net volume alone
would hide them.

---

## Training a real model

The shipped model is trained on **BraTS 2024 adult glioma**, a public dataset
with expert voxel labels. (The project's original target, CNS tuberculosis, has
no public labelled MRI dataset at all.) To segment a different pathology,
fine-tune from this checkpoint on labelled cases of that pathology, then
re-validate: the glioma figures do not carry over.

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

**Using your own labelled data.** Put it in the same per-case layout
(`flair.nii.gz` + `seg.nii.gz`) and fine-tune from the glioma checkpoint at a
lower learning rate. `backend/train/train_seg.py` takes the generic
`case/image.nii.gz` + `case/label.nii.gz` folder layout.

## Design decisions worth knowing

**Reports never name a disease.** The model segments; it does not classify. So
report text is limited to what the segmentation and measurements support —
"regions of abnormal signal", their size and approximate location — with no
differential diagnosis. `detection_confidence` is the model's mean probability
over the voxels it marked: a statement about the segmentation, not about what
the finding is.

**Each backend runs at its own operating point.** A trained checkpoint uses the
threshold tuned on its validation set (0.7 for the shipped model); the classical
detector uses 0.6. The threshold actually applied is recorded in every report.
`NEUROTB_SEGMENTATION_THRESHOLD` overrides both, deliberately.

**Uncalibrated probabilities are labelled as such.** Until a checkpoint carries a
validated reliability curve, every report states that the numbers rank voxels and
do not estimate risk.

**The classical detector ignores the outer 5 mm of the brain.** Partial-volume
voxels at the boundary drag its local background estimate down, which makes the
entire cortical ribbon read as focally bright. The cost is missed juxtacortical
lesions. (The trained model has no such restriction.)

**Patient records hold identifiable data, so everything is behind accounts.**
The doctor-facing application stores names, dates of birth and contact details
(an earlier version of this project deliberately stored none). In exchange:
every patient belongs to one doctor and every route checks that ownership,
answering 404 rather than 403 so ids cannot be probed; sessions are HttpOnly
cookies whose tokens are stored only as hashes; passwords are scrypt-hashed;
state-changing requests need an `X-Requested-With` header (CSRF); MRI files,
photos and derived images are served only through authenticated endpoints, never
from a public folder. Tests pin each of these. The `data/` folder and database
now contain PHI — protect them (disk encryption, backups, access) accordingly.

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

They run on synthetic phantoms where ground truth is exact, and they
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
backend/app/services/     orchestration, storage, auth, PDF reports
backend/app/routers/      HTTP endpoints (auth, patients/scans, analyses)
backend/manage.py         doctor account administration
backend/train/            training entry point
frontend/src/landing/     public website
frontend/src/clinic/      authenticated clinical app (routes under /app)
frontend/src/components/  BrainViewer (Three.js), landing hero
      lib/anatomicalBrain.js  Z-Anatomy atlas loading, grouping and patient fit
frontend/public/models/   brain.glb atlas (CC BY-SA 4.0 — see NOTICE.md)
```

The `pipeline/` modules know nothing about the database or the filesystem, so the
science is testable without a running server.

---

## Limitations

- Segments focal signal abnormality only. Does not assess contrast enhancement,
  mass effect, midline shift, hydrocephalus, haemorrhage or infarction, and does
  not determine what a segmented region is.
- The model is trained and validated on adult diffuse glioma (BraTS 2024,
  FLAIR) only; its behaviour on other conditions, scanners and protocols is
  unknown.
- Single-sequence analysis. Characterising a brain lesion normally needs the
  full multi-sequence examination, including post-contrast T1.
- Anatomical labels are geometric, not atlas-derived, and are imprecise near
  zone boundaries.
- Rigid registration only. Adequate for same-subject longitudinal comparison;
  not for cross-subject or atlas alignment.
- The anatomical brain in the 3D view is a normalised atlas scaled to the
  patient's brain size, not their own anatomy. It is a visual reference; no
  measurement or region label is derived from it.
- No audit log of record access, no DICOM support, no emailed password reset,
  no multi-doctor sharing of a patient. See `docs/ROADMAP.md`.
- Analyses run in the API process (FastAPI background tasks). A restart while an
  analysis is running leaves it marked running; re-run it from the scan page.
  Production would use a job queue.
