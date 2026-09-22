# Pipeline reference

What each stage does, why it is implemented the way it is, and what to replace it
with when you move past a prototype. Read alongside the module docstrings.

---

## 1. Loading — `pipeline/volume.py`

Everything downstream speaks in `Volume`: a float32 array plus the 4×4 affine
mapping voxel indices to world millimetres.

The affine is not optional bookkeeping. It is what makes a lesion volume come out
in cm³ rather than "voxels", what makes a distance come out in mm, and what lets
`atlas.py` tell left from right on a scan stored in LAS order. Any function that
drops the affine and returns a bare array has thrown away the units.

4D inputs are collapsed to their first frame.

## 2. Resampling to 1 mm isotropic — `preprocess.resample_to_spacing`

Clinical brain MRI is frequently anisotropic (0.5 × 0.5 × 5 mm is common for
axial FLAIR). Without resampling, a "volume" is a count of voxels of
scan-dependent size, and two studies of the same patient acquired on different
protocols are not comparable.

The affine is rebuilt so physical extent is preserved — `test_resampling_
preserves_physical_size` pins this, because a drift here silently rescales every
measurement the system reports.

## 3. Bias field correction — `preprocess.correct_bias_field`

Surface coils produce a smooth multiplicative intensity drift across the volume.
Left uncorrected, any intensity threshold means something different at the vertex
than at the skull base.

Homomorphic approximation: estimate the bias as a heavily blurred log-intensity
image, subtract, exponentiate.

**The blur must be a normalized convolution** — blurred signal divided by blurred
mask — so the estimate is formed only from voxels containing tissue. A plain
Gaussian averages in the zeros outside the head, drives the estimated bias down
near the boundary, and leaves a bright halo around the brain after division. That
halo is focal, bright and roughly lesion-sized: precisely what a lesion detector
fires on. This was a real bug during development and
`test_bias_correction_does_not_create_an_edge_halo` exists to keep it fixed.

*Production:* N4ITK via SimpleITK (`sitk.N4BiasFieldCorrectionImageFilter`).

## 4. Brain extraction — `preprocess.skull_strip`

BET-style threshold at 10% into the robust (2nd–98th percentile) intensity range
separates head from air. That still includes skull and scalp, which connect to
the brain only through thin bridges, so the brain is isolated by eroding until
those bridges break, keeping the largest component, and dilating back —
morphological opening by reconstruction.

**Do not use Otsu here.** On a brain volume the dominant intensity split is grey
matter against white matter, not head against air. Otsu carves out a hollow shell
which hole-filling then floods, and the "brain mask" ends up 2.4× too large. Also
a real bug during development.

*Production:* HD-BET (deep learning, robust to pathology) or FSL BET.

## 5. Intensity normalization — `preprocess.normalize_intensity`

Z-score within the brain mask, clipped to ±5σ. MRI intensities have no absolute
units, so this is what puts every scan on a common scale.

It is also what makes `CONTRAST_SD` in the detector meaningful: after z-scoring,
"1.6 standard deviations above local background" is a fixed, interpretable
criterion rather than a percentile that drifts with each scan.

## 6. Segmentation — `pipeline/segmentation.py`

### Trained backend

Sliding-window inference with 50% overlap, Gaussian-weighted patch blending
(patch-edge predictions are unreliable — the network has no context past the
border), and test-time augmentation over the three axis flips.

No hand-written shape prior is applied to model output. The model learned shape
from data; imposing a prior on top would silently discard the atypical lesions it
was trained to find.

### Classical fallback

Four steps, each addressing a specific failure of the previous:

1. **Erode the brain mask by 5 mm.** The outermost shell of any brain mask is
   partial-volume — part brain, part CSF or inner skull table — and darker than
   real brain. Left in, it drags the local background down along the whole
   surface and the entire cortical ribbon reads as focally bright.
2. **Greyscale closing at lesion scales.** Ring-enhancing tuberculomas have a
   bright rim around a dark caseating centre. A plain blob detector sees a hollow
   shell and scores the lesion *centre* as background. Closing fills any dark
   region enclosed by a brighter one.
3. **Local contrast against a mask-normalized Gaussian background** (σ ≈ 12 mm).
   Not a morphological opening: an opening is min-based, so ventricles and the
   brain edge drag it to zero and it subtracts nothing at all.
4. **Scale-normalized Laplacian of Gaussian** across 2–10 mm radii, for shape
   rather than brightness.

The final score is the geometric mean of contrast and blob response, so a lesion
must be both focally bright *and* blob-shaped rather than letting either signal
carry alone.

Components are then rejected on volume (<30 mm³), extent (>40 mm) and compactness
(fill fraction <0.22), which removes the sheet- and shell-shaped false positives
that thresholding any contrast map produces along tissue boundaries.

**Operating point.** Measured across five phantoms:

| threshold | per-lesion recall | false components/scan | voxel Dice |
|---|---|---|---|
| 0.5 | 88% | 3.6 | 0.526 |
| **0.6** | **84%** | **1.8** | **0.583** |
| 0.7 | 72% | 0.8 | 0.594 |
| 0.8 | 60% | 0.0 | 0.517 |

0.6 is the default. Re-derive this on real data before making any clinical claim.

## 7. Quantification — `pipeline/quantify.py`

26-connectivity (lesions touching at a corner are one lesion). Per lesion:
volume in mm³ and cm³, centroid in voxel and world coordinates, bounding box,
maximum Feret diameter, per-axis extent, sphericity, and mean/max probability.

Feret diameter uses convex-hull vertices for components over 2000 voxels, since
exhaustive pairwise distance is O(n²) and lesions reach 10⁵ voxels.

Sphericity is the equivalent-sphere surface area over the actual surface area.
Tuberculomas tend to be round; a low value suggests a confluent or infiltrative
process, which is worth surfacing.

## 8. Anatomical localization — `pipeline/atlas.py`

The brain's bounding box is divided into anatomical zones using normalized
left-right / posterior-anterior / inferior-superior coordinates derived from the
affine via `nib.aff2axcodes`, so a scan stored LAS is not silently mirrored.

Zone order matters: infratentorial and deep structures are tested before the
cortical lobes, since a cerebellar lesion also sits in the posterior part of the
bounding box.

The zone set is chosen so the sites TB favours — basal cisterns, cerebellum,
brainstem, deep grey nuclei — are distinguishable. Every label is marked
approximate, and `label_lesion` is the single seam to replace.

*Production:* register to MNI152, read labels from Harvard-Oxford or AAL.

## 9. Registration — `pipeline/registration.py`

Multi-resolution Powell optimization of normalized mutual information. NMI
tolerates the intensity differences between sessions and sequences that a
sum-of-squares metric cannot.

Solved on a 64³ working grid, then applied at full resolution. A rigid transform
has six parameters; recovering them does not need full resolution, and optimizing
on the full grid costs orders of magnitude more per metric evaluation for no
measurable gain — 60 s → 8 s with post-registration brain Dice moving only
0.998 → 0.994.

**Masks and images are carried through `register_rigid`, not warped by the
caller.** The two backends express their transform in different coordinate
systems — voxel-space pull matrix for numpy, physical-space Euler transform for
SimpleITK — and a caller applying the wrong one would silently displace every
lesion with no error raised.
`test_registration_warps_masks_and_images_consistently` guards this.

*Production:* SimpleITK is used automatically when installed.

## 10. Change analysis — `pipeline/compare.py`

Lesions are matched greedily on a combined score: spatial Dice first (the
reliable signal), centroid proximity second (which catches a shrinking lesion
whose masks no longer touch). Greedy rather than Hungarian because real cases
have a handful of lesions and greedy is far easier to audit.

A ±20% volume band counts as stable. Manual and automated segmentation of small
lesions carries roughly that much variability, so smaller swings are noise rather
than treatment response.

## 11. Meshing — `pipeline/mesh.py`

Marching cubes on a Gaussian-blurred mask (raw binary produces hard voxel
staircasing that reads as noise on screen), emitted as flat JSON buffers that map
straight onto `THREE.BufferGeometry`.

Meshes are in world millimetres, centred on the brain centroid, so the viewer
needs to know nothing about affines. The brain hull is decimated (`step_size=3`);
lesions are full resolution.

## 12. Slice rendering — `pipeline/slices.py`

Three planes, each with three layers: plain greyscale, segmentation contour, and
probability heatmap.

The overlay draws the *boundary*, not a filled blob — a filled overlay hides the
very pixels a reader needs to judge the contour. Slice selection prefers slices
containing lesion, because opening on an empty slice makes a correct
segmentation look like a missed one.

PNGs are encoded with `zlib` + `struct` directly; Pillow is not a dependency and
what is needed here is a fraction of what it does.

## 13. Reporting — `pipeline/report.py`

Deliberately conservative language throughout. A system that detected a focal
lesion has evidence of a focal lesion — not of tuberculosis, which is a clinical
and microbiological diagnosis.

A negative result is never phrased as exclusion: small miliary lesions, early
basal exudate and meningeal enhancement can all fall below detection threshold.
`test_report_on_a_negative_study_does_not_claim_exclusion` pins this.

The differential (neurocysticercosis, pyogenic or fungal abscess, metastasis,
demyelination) is named explicitly whenever lesions are found.
