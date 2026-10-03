"""Structured preliminary report generation.

What the report may claim is bounded by what produced the findings. The
segmentation model in use (see the checkpoint's provenance) was trained on
adult diffuse glioma FLAIR scans (BraTS 2024). It marks regions of abnormal
signal and the pipeline measures them. It does not determine what a region is
-- tumour type, grade, infection, demyelination -- so no text here names a
disease or offers a differential diagnosis. The wording is "segmented",
"regions of abnormal signal", "requires review", and every report carries an
explicit not-a-diagnosis banner.

History: this pipeline began as NeuroTB, a tuberculosis decision-support
prototype, and reports up to text version 1 carried a rule-based "TB pattern
score" and TB-specific impressions. A glioma-trained segmenter cannot support
those, so version 2 removed them. `normalize_report` rebuilds the text of any
stored version-1 report from its own stored measurements, so older analyses
are never shown with the old claims.

Confidence is the model's mean probability over the voxels it marked. It ranks
voxels; unless the checkpoint is calibrated it is not a probability of disease.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from . import atlas
from .quantify import Lesion, LesionBurden, region_breakdown

REPORT_TEXT_VERSION = 2

# Per-lesion fields from text version 1 that encoded a tuberculosis
# interpretation ("site with TB predilection"). Stripped wherever stored
# lesions are served.
LEGACY_LESION_KEYS = ("tb_typical_site",)

DISCLAIMER = (
    "AI-GENERATED PRELIMINARY ANALYSIS - NOT A DIAGNOSIS. This report is decision "
    "support produced by an automated segmentation system. It must not be used to "
    "guide patient care until a qualified radiologist or treating clinician has "
    "reviewed the source images and approved or corrected these findings. Automated "
    "segmentation identifies regions of abnormal signal; it does not establish their "
    "cause, and no diagnosis can be made from it alone."
)


@dataclass
class Report:
    generated_at: str
    disclaimer: str
    status: str                              # draft | reviewed | approved
    headline: str
    text_version: int = REPORT_TEXT_VERSION
    findings: list[str] = field(default_factory=list)
    impression: str = ""
    burden: dict = field(default_factory=dict)
    lesions: list[dict] = field(default_factory=list)
    regions: list[dict] = field(default_factory=list)
    confidence: dict = field(default_factory=dict)
    technique: dict = field(default_factory=dict)
    comparison: dict | None = None
    alerts: list[dict] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def build_report(
    lesions: list[Lesion],
    burden: LesionBurden,
    segmentation_method: str,
    sequences: list[str],
    calibrated: bool = False,
    comparison: dict | None = None,
    preprocessing: dict | None = None,
    provenance: dict | None = None,
) -> Report:
    lesion_rows = [l.to_dict() for l in lesions]
    burden_row = burden.to_dict()
    text = compose_text(
        lesion_rows, burden_row, segmentation_method, sequences, calibrated, provenance, comparison
    )

    return Report(
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        disclaimer=DISCLAIMER,
        status="draft",
        burden=burden_row,
        lesions=lesion_rows,
        regions=region_breakdown(lesions),
        technique={
            "sequences_analysed": sequences,
            "segmentation_method": segmentation_method,
            "anatomical_atlas": atlas.ATLAS_NAME,
            "model_provenance": provenance or {},
            **(preprocessing or {}),
        },
        comparison=comparison,
        alerts=(comparison or {}).get("alerts", []),
        **text,
    )


def compose_text(
    lesions: list[dict],
    burden: dict,
    method: str | None,
    sequences: list[str],
    calibrated: bool,
    provenance: dict | None,
    comparison: dict | None = None,
) -> dict:
    """Every human-readable field of a report, from measurements alone."""
    ordered = sorted(lesions, key=lambda l: l.get("volume_cm3") or 0, reverse=True)
    detection_confidence = float(burden.get("mean_probability") or 0.0)
    return {
        "text_version": REPORT_TEXT_VERSION,
        "headline": _headline(ordered, burden),
        "findings": _findings(ordered, burden, comparison),
        "impression": _impression(ordered, burden, method, provenance, comparison),
        "confidence": {
            "detection_confidence": round(detection_confidence, 3),
            "detection_confidence_label": _confidence_label(detection_confidence),
            "calibrated": calibrated,
            "calibration_note": (
                "Probabilities are calibrated against a held-out validation set."
                if calibrated else
                "Probabilities are UNCALIBRATED and must not be read as the likelihood "
                "of disease. They rank voxels; they do not estimate risk."
            ),
        },
        "limitations": _limitations(method, sequences, calibrated, provenance),
    }


def public_lesions(lesions: list | None) -> list:
    """Stored lesion rows without the legacy interpretation fields."""
    return [
        {k: v for k, v in lesion.items() if k not in LEGACY_LESION_KEYS} if isinstance(lesion, dict) else lesion
        for lesion in (lesions or [])
    ]


def normalize_report(report: dict | None) -> dict | None:
    """Return a stored report with current wording.

    Reports written before text version 2 contain tuberculosis-specific text
    that the current model cannot support. Their measurements are unaffected,
    so the text is regenerated from the stored lesions and burden; nothing is
    written back to the database.
    """
    if not report:
        return report
    if (report.get("text_version") or 1) >= REPORT_TEXT_VERSION:
        return {**report, "lesions": public_lesions(report.get("lesions"))}

    technique = report.get("technique") or {}
    confidence = report.get("confidence") or {}
    text = compose_text(
        report.get("lesions") or [],
        report.get("burden") or {},
        technique.get("segmentation_method"),
        technique.get("sequences_analysed") or [],
        bool(confidence.get("calibrated", False)),
        technique.get("model_provenance") or {},
        report.get("comparison"),
    )
    return {
        **report,
        **text,
        "disclaimer": DISCLAIMER,
        "lesions": public_lesions(report.get("lesions")),
        "technique": {**technique, "segmentation_notes": _current_notes(technique.get("segmentation_notes"))},
        "text_regenerated_from": report.get("text_version") or 1,
    }


def normalize_technique(technique: dict | None) -> dict | None:
    """A stored technique block (the analysis row keeps its own copy) with current notes."""
    if not technique:
        return technique
    return {**technique, "segmentation_notes": _current_notes(technique.get("segmentation_notes"))}


def _current_notes(notes: list | None) -> list:
    """Version-1 technique notes with disease-specific wording replaced."""
    from .segmentation import CLASSICAL_NOTE

    current = []
    for note in notes or []:
        if isinstance(note, str) and "tubercul" in note.lower():
            if note.startswith("Classical blob detector"):
                current.append(CLASSICAL_NOTE)
            # Otherwise it was the U-Net's "never seen a tuberculoma" note, which
            # the model-scope limitation now states in neutral terms: drop it.
            continue
        current.append(note)
    return current


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return singular if count == 1 else (plural or f"{singular}s")


def _where(lesion: dict) -> str:
    return f"{lesion.get('side', '')} {lesion.get('region', '')}".strip() or "an unlabelled location"


def _headline(lesions: list[dict], burden: dict) -> str:
    if not lesions:
        return "The segmentation model marked no region above its detection threshold."

    count = burden.get("lesion_count", len(lesions))
    regions = burden.get("regions_involved") or []
    sites = ", ".join(regions[:3])
    more = f" and {len(regions) - 3} further site(s)" if len(regions) > 3 else ""
    return (
        f"AI segmentation marked {count} focal {_plural(count, 'region')} of abnormal signal "
        f"({burden.get('total_volume_cm3', 0):.2f} cm3 total) involving the {sites}{more}."
    )


def _findings(lesions: list[dict], burden: dict, comparison: dict | None) -> list[str]:
    if not lesions:
        return ["No region of abnormal signal met the segmentation threshold."]

    largest = lesions[0]
    findings = [
        f"Number of discrete segmented regions: {burden.get('lesion_count', len(lesions))}.",
        f"Total segmented volume: {burden.get('total_volume_cm3', 0):.2f} cm3 "
        f"({burden.get('lesion_load_percent', 0):.3f}% of segmented brain volume, "
        f"{burden.get('brain_volume_cm3', 0):.0f} cm3).",
        f"Largest region: {largest.get('volume_cm3', 0):.2f} cm3, "
        f"maximum diameter {largest.get('max_diameter_mm', 0):.1f} mm, in the {_where(largest)}.",
    ]

    for lesion in lesions[:8]:
        dims = lesion.get("dimensions_mm") or [0, 0, 0]
        findings.append(
            f"Region {lesion.get('id')}: {lesion.get('volume_cm3', 0):.3f} cm3, "
            f"{dims[0]:.0f} x {dims[1]:.0f} x {dims[2]:.0f} mm, {_where(lesion)}, "
            f"sphericity {lesion.get('sphericity', 0):.2f}."
        )
    if len(lesions) > 8:
        findings.append(f"({len(lesions) - 8} additional smaller regions tabulated in the region list.)")

    closest = burden.get("min_inter_lesion_distance_mm")
    if closest is not None and closest < 15:
        findings.append(f"Closest pair of regions separated by {closest:.1f} mm.")

    if comparison:
        findings.append(f"Comparison with prior study: {comparison.get('summary', 'not available')}")

    return findings


def _model_scope(method: str | None, provenance: dict | None) -> str:
    pathology = (provenance or {}).get("pathology") or (provenance or {}).get("trained_on")
    if pathology:
        return f"a segmentation model trained on {pathology}"
    if method == "classical":
        return "a classical blob detector (no trained model)"
    return "an automated segmentation model"


def _impression(
    lesions: list[dict],
    burden: dict,
    method: str | None,
    provenance: dict | None,
    comparison: dict | None,
) -> str:
    scope = _model_scope(method, provenance)
    if not lesions:
        base = (
            f"Automated segmentation by {scope} marked no region above its threshold. A negative "
            "automated result does not exclude pathology: abnormalities that are small, low in "
            "contrast, outside the model's training scope, or visible only on other sequences "
            "may not be segmented."
        )
    else:
        count = burden.get("lesion_count", len(lesions))
        largest = lesions[0]
        base = (
            f"Automated segmentation by {scope} marked {count} focal "
            f"{_plural(count, 'region')} of abnormal signal totalling "
            f"{burden.get('total_volume_cm3', 0):.2f} cm3; the largest measures "
            f"{largest.get('volume_cm3', 0):.2f} cm3 in the {_where(largest)}. The segmentation "
            "delineates signal abnormality only. It does not determine the nature, grade or "
            "cause of a finding and does not distinguish tumour from other focal pathology."
        )

    if comparison:
        trend = comparison.get("trend", "indeterminate")
        trend_text = {
            "improving": "Compared with the prior study, the total segmented volume has decreased.",
            "worsening": "Compared with the prior study, the total segmented volume has increased.",
            "stable": "Total segmented volume is unchanged within the 20% measurement tolerance.",
            "mixed": "Some segmented regions are new or larger while others are smaller or no longer segmented.",
        }.get(trend, "The change in segmented volume since the prior study is indeterminate.")
        base = f"{base} {trend_text}"

    return f"{base} Radiologist review of the source images and clinical correlation are required."


def _confidence_label(value: float) -> str:
    if value >= 0.75:
        return "high"
    if value >= 0.5:
        return "moderate"
    if value >= 0.25:
        return "low"
    return "very low"


def _limitations(
    method: str | None, sequences: list[str], calibrated: bool, provenance: dict | None = None
) -> list[str]:
    limitations = [
        "Anatomical localization is geometric and approximate; it is not derived from a "
        "registered anatomical atlas and region labels may be imprecise near boundaries.",
        "Skull stripping, bias correction, and registration use lightweight implementations; "
        "segmentation accuracy degrades on scans with heavy motion or susceptibility artifact.",
        "The system segments focal signal abnormality. It does not assess contrast enhancement, "
        "mass effect, midline shift, hydrocephalus, haemorrhage or infarction.",
    ]

    if method == "classical":
        limitations.insert(0, (
            "Findings were produced by a classical blob detector, not a trained segmentation "
            "model. It flags focal bright regions of plausible size, has no validated sensitivity "
            "or specificity, and its results are for demonstration and pipeline validation only."
        ))

    # What the model was trained on is the single most important thing a reader
    # of this report needs to know, so it goes first.
    pathology = (provenance or {}).get("pathology") or (provenance or {}).get("trained_on")
    if pathology:
        limitations.insert(0, (
            f"The segmentation model was trained and validated only on {pathology}. Its "
            "measured performance describes that dataset; it has not been validated on other "
            "pathologies, scanners or acquisition protocols, and it does not identify what a "
            "segmented region is."
        ))

    if not calibrated:
        limitations.append(
            "Confidence values are uncalibrated and should be interpreted as relative "
            "rankings only, not as probabilities of disease."
        )
    if len(sequences) <= 1:
        limitations.append(
            f"Analysis used a single sequence ({sequences[0] if sequences else 'unknown'}). "
            "Characterising a brain lesion normally requires the full multi-sequence "
            "examination, including post-contrast T1; enhancement cannot be assessed from "
            "this analysis."
        )
    return limitations
