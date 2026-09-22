# Roadmap

What is missing, in the order it matters. Items are grouped by what they block.

---

## Blocking any use on real patient data

These are not enhancements. Without them the system must not touch identifiable
data, regardless of how well the pipeline performs.

### DICOM ingest with de-identification

Currently NIfTI only, because accepting DICOM means owning de-identification and
that is a bigger commitment than an extension check.

A DICOM series carries patient name, date of birth, hospital number, accession
number, institution, referring physician, and — critically — burned-in pixel
annotations on some modalities and reformats. Stripping the header is the easy
half.

- Convert with `dcm2niix`, or `pydicom` + a de-identification profile
- Apply DICOM PS3.15 Annex E (Basic Application Level Confidentiality)
- Detect burned-in annotation (`BurnedInAnnotation`, and OCR as a backstop)
- Keep the pseudonym mapping outside the imaging store, under separate access
  control

### Authentication, authorization, audit

There is none. Every endpoint is open, and `Review.reviewer` is a free-text field
that anyone can set to anything — which means the review trail is currently
attestation, not authentication.

- OIDC against the institution's identity provider
- Per-patient access control, not per-endpoint
- Append-only audit log: who viewed which study, when, from where
- Sign reviews against an authenticated identity

### Encryption and retention

- Encryption at rest for `data/`
- TLS termination in front of the API
- A retention policy with actual deletion, and evidence that deletion happened
- `delete_patient` currently removes rows and files; it does not overwrite, and
  it has no audit record

### Regulatory position

Clinical decision support software of this kind is a regulated medical device in
most jurisdictions (EU MDR Class IIa or higher; FDA 510(k) or De Novo; UKCA).
Nothing here has been through design controls, risk management (ISO 14971),
a software lifecycle process (IEC 62304), or clinical evaluation. Research and
education use only, under an IRB or equivalent, with no clinical decision made
on its output.

---

## Blocking a defensible accuracy claim

### A trained model, and the data to train it

The single largest gap. See the README's data-strategy note. Concretely:

1. Pretrain on a large brain-lesion corpus — BraTS, or MSSEG-2 for MS lesions —
   to learn general lesion appearance
2. Fine-tune on locally annotated TB cases, ideally from a high-burden centre
3. Hold out a test set by *site*, not by case: a model that has seen a scanner in
   training will flatter itself on that scanner

### Calibration

Probabilities are currently uncalibrated, and every report says so. Making them
mean something needs a held-out validation set and a reliability curve, then
temperature scaling or isotonic regression, with the calibration curve stored in
the checkpoint so `calibrated: true` is earned rather than asserted.

### Evaluation that reflects clinical use

Voxel Dice is the wrong headline metric for sparse small lesions. Report instead:

- Per-lesion detection sensitivity, stratified by lesion size
- False positives per scan (the number that determines whether a radiologist
  keeps the tool switched on)
- Volume agreement: Bland-Altman against manual segmentation
- Inter-rater variability on the same cases, as the ceiling any model is
  measured against

### Prospective reader study

Does the tool change what a radiologist concludes, and in which direction? A tool
that improves detection while increasing false positives may still be net
harmful. This is the question that matters and it cannot be answered offline.

---

## Clinical completeness

The system detects focal signal abnormality. In CNS TB that is often not the
dominant finding.

- **Meningeal enhancement.** Basal meningeal enhancement is the commonest finding
  in tuberculous meningitis and is entirely outside the current scope. It needs
  post-contrast T1 and a fundamentally different segmentation target — a thin
  sheet, not a blob.
- **Hydrocephalus.** Ventricular volume and Evans index. Mechanically easy and
  clinically important; a natural next addition.
- **Infarction.** TB vasculitis causes basal ganglia infarcts. Needs DWI/ADC.
- **Midline shift and mass effect.** Measurable from the septum pellucidum
  displacement relative to the falx.
- **Multi-sequence fusion.** Stack T1, T2, FLAIR and T1C as input channels after
  inter-sequence registration. Ring enhancement — the most characteristic feature
  of a tuberculoma — cannot be assessed from a single sequence at all.

---

## Engineering

### Job queue

Analyses run in FastAPI `BackgroundTasks`, which means they die with the process
and cannot be retried, cancelled, or distributed. Celery + Redis, or arq, with
task state in the database rather than in memory.

### Nonlinear registration

Rigid is right for same-subject longitudinal comparison. Atlas-based anatomical
labelling needs deformable registration (ANTs SyN, or SimpleITK's B-spline).

### Reviewer segmentation editing

Reviewers can currently reject a whole lesion. They cannot redraw a boundary. A
brush-based editor over the slice viewer, writing corrected masks back as a new
NIfTI alongside the original, is what would make the stored corrections usable as
training labels.

### Report export

PDF or DICOM-SR, so a report can leave the system and enter the record.

### Frontend

- Virtualise the lesion table for studies with many lesions
- Code-split the Three.js bundle (currently 642 kB, 174 kB gzipped)
- Keyboard navigation for slice scrubbing — radiologists scroll with arrow keys
- Window/level controls on the slice viewer

### Performance

Analysis is ~18 s per volume, dominated by greyscale morphology in the classical
detector. A trained model on GPU would be faster. The registration working grid
(64³) is already tuned; going lower starts to cost accuracy.
