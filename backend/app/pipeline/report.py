"""Structured preliminary report generation.

The report is deliberately conservative in its language. An automated system that
has detected a focal lesion has evidence of a focal lesion -- it does not have
evidence of tuberculosis, which is a clinical and microbiological diagnosis. So
the wording throughout is "findings", "compatible with", "requires correlation",
and every report carries an explicit not-a-diagnosis banner.

Confidence is reported as two separate numbers because they mean different things:
  - detection_confidence: how sure the model is that the voxels it marked are lesion.
  - tb_pattern_score:     how well the *distribution* of findings matches the known
                          radiological pattern of CNS TB. This is a rule-based
                          heuristic over location, multiplicity, size and shape --
                          it is not a trained classifier and says so.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from . import atlas
from .quantify import Lesion, LesionBurden, region_breakdown

DISCLAIMER = (
    "AI-GENERATED PRELIMINARY ANALYSIS - NOT A DIAGNOSIS. This report is decision "
    "support produced by an automated system. It has not been reviewed by a "
    "physician and must not be used to guide patient care until a qualified "
    "radiologist or treating clinician has reviewed the source images and "
    "approved or corrected these findings. Imaging findings alone cannot establish "
    "a diagnosis of central nervous system tuberculosis; correlation with clinical "
    "presentation, CSF analysis, and microbiological confirmation is required."
)


@dataclass
class Report:
    generated_at: str
    disclaimer: str
    status: str                              # draft | reviewed | approved
    headline: str
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
    tb_score, tb_reasons = _tb_pattern_score(lesions, burden)
    detection_confidence = burden.mean_probability

    findings = _findings(lesions, burden, comparison)
    headline = _headline(lesions, burden, tb_score)
    impression = _impression(lesions, burden, tb_score, tb_reasons, comparison)

    return Report(
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        disclaimer=DISCLAIMER,
        status="draft",
        headline=headline,
        findings=findings,
        impression=impression,
        burden=burden.to_dict(),
        lesions=[l.to_dict() for l in lesions],
        regions=region_breakdown(lesions),
        confidence={
            "detection_confidence": round(detection_confidence, 3),
            "detection_confidence_label": _confidence_label(detection_confidence),
            "tb_pattern_score": round(tb_score, 3),
            "tb_pattern_label": _confidence_label(tb_score),
            "tb_pattern_reasons": tb_reasons,
            "calibrated": calibrated,
            "calibration_note": (
                "Probabilities are calibrated against a held-out validation set."
                if calibrated else
                "Probabilities are UNCALIBRATED and must not be read as the likelihood "
                "of disease. They rank voxels; they do not estimate risk."
            ),
        },
        technique={
            "sequences_analysed": sequences,
            "segmentation_method": segmentation_method,
            "anatomical_atlas": atlas.ATLAS_NAME,
            "model_provenance": provenance or {},
            **(preprocessing or {}),
        },
        comparison=comparison,
        alerts=(comparison or {}).get("alerts", []),
        limitations=_limitations(segmentation_method, sequences, calibrated, provenance),
    )


def _headline(lesions: list[Lesion], burden: LesionBurden, tb_score: float) -> str:
    if not lesions:
        return "No focal lesion detected by automated analysis."

    count = burden.lesion_count
    noun = "lesion" if count == 1 else "lesions"
    sites = ", ".join(burden.regions_involved[:3])
    more = f" and {len(burden.regions_involved) - 3} further site(s)" if len(burden.regions_involved) > 3 else ""
    qualifier = "with a distribution compatible with" if tb_score >= 0.5 else "of non-specific distribution for"
    return (
        f"{count} focal {noun} detected ({burden.total_volume_cm3:.2f} cm3 total) "
        f"involving the {sites}{more}, {qualifier} intracranial tuberculosis."
    )


def _findings(lesions: list[Lesion], burden: LesionBurden, comparison: dict | None) -> list[str]:
    if not lesions:
        return ["No focal signal abnormality meeting detection criteria was identified."]

    findings = [
        f"Number of discrete lesions: {burden.lesion_count}.",
        f"Total lesion volume: {burden.total_volume_cm3:.2f} cm3 "
        f"({burden.lesion_load_percent:.3f}% of segmented brain volume, "
        f"{burden.brain_volume_cm3:.0f} cm3).",
        f"Largest lesion: {burden.largest_volume_cm3:.2f} cm3, "
        f"maximum diameter {lesions[0].max_diameter_mm:.1f} mm, "
        f"in the {lesions[0].side} {lesions[0].region}.",
    ]

    for lesion in lesions[:8]:
        findings.append(
            f"Lesion {lesion.id}: {lesion.volume_cm3:.3f} cm3, "
            f"{lesion.dimensions_mm[0]:.0f} x {lesion.dimensions_mm[1]:.0f} x "
            f"{lesion.dimensions_mm[2]:.0f} mm, {lesion.side} {lesion.region}, "
            f"sphericity {lesion.sphericity:.2f}."
        )
    if len(lesions) > 8:
        findings.append(f"({len(lesions) - 8} additional smaller lesions tabulated in the lesion list.)")

    if burden.min_inter_lesion_distance_mm is not None and burden.min_inter_lesion_distance_mm < 15:
        findings.append(
            f"Closest lesion pair separated by {burden.min_inter_lesion_distance_mm:.1f} mm; "
            "clustered distribution."
        )

    if comparison:
        findings.append(f"Comparison with prior study: {comparison.get('summary', 'not available')}")

    return findings


def _impression(
    lesions: list[Lesion],
    burden: LesionBurden,
    tb_score: float,
    reasons: list[str],
    comparison: dict | None,
) -> str:
    if not lesions:
        base = (
            "Automated analysis identified no focal lesion. A negative automated result does "
            "not exclude intracranial tuberculosis: meningeal enhancement, small miliary "
            "lesions, and early basal exudate may fall below the detection threshold of this "
            "system and require direct review of contrast-enhanced sequences."
        )
    elif tb_score >= 0.6:
        base = (
            f"Multifocal intracranial lesions with several features described in intracranial "
            f"tuberculosis ({'; '.join(reasons[:3])}). The differential also includes "
            f"neurocysticercosis, pyogenic or fungal abscess, metastatic disease, and "
            f"demyelination, which cannot be distinguished on this automated analysis alone."
        )
    elif tb_score >= 0.35:
        base = (
            f"Focal intracranial lesion(s) of indeterminate aetiology. Some features are "
            f"consistent with tuberculosis ({'; '.join(reasons[:2]) or 'limited supporting features'}), "
            f"but the appearances are non-specific and a broad differential applies."
        )
    else:
        base = (
            "Focal intracranial lesion(s) detected. The distribution and morphology are not "
            "characteristic of intracranial tuberculosis; alternative aetiologies should be "
            "considered first."
        )

    if comparison:
        trend = comparison.get("trend", "indeterminate")
        trend_text = {
            "improving": "Interval comparison shows reduction in overall lesion burden, consistent with treatment response.",
            "worsening": "Interval comparison shows an increase in lesion burden. Urgent clinical review is advised.",
            "stable": "Interval comparison shows no significant change in lesion burden.",
            "mixed": "Interval comparison shows a mixed response, with both regressing and progressing lesions.",
        }.get(trend, "Interval comparison is indeterminate.")
        base = f"{base} {trend_text}"

    return f"{base} Radiologist review and clinical correlation required."


def _tb_pattern_score(lesions: list[Lesion], burden: LesionBurden) -> tuple[float, list[str]]:
    """Rule-based scoring of how TB-like the finding distribution is.

    Encodes textbook radiological features of CNS TB. This is explicitly a
    heuristic, not a learned classifier, so it is transparent and auditable --
    every point it awards is reported as a reason.
    """
    if not lesions:
        return 0.0, []

    score = 0.0
    reasons: list[str] = []

    typical = [l for l in lesions if l.tb_typical_site]
    if typical:
        weight = min(0.30, 0.15 + 0.05 * len(typical))
        score += weight
        sites = sorted({l.region for l in typical})
        reasons.append(f"involvement of sites with TB predilection ({', '.join(sites)})")

    if burden.lesion_count >= 2:
        score += 0.20
        reasons.append(f"multifocal disease ({burden.lesion_count} lesions)")

    # Tuberculomas are typically 5-25 mm; larger suggests abscess or neoplasm.
    diameters = [l.max_diameter_mm for l in lesions]
    in_range = sum(1 for d in diameters if 4.0 <= d <= 25.0)
    if in_range:
        fraction = in_range / len(diameters)
        score += 0.20 * fraction
        reasons.append(f"{in_range}/{len(diameters)} lesions in the typical tuberculoma size range (4-25 mm)")

    rounded = [l for l in lesions if l.sphericity >= 0.55]
    if rounded:
        score += 0.15 * (len(rounded) / len(lesions))
        reasons.append(f"{len(rounded)}/{len(lesions)} lesions with rounded morphology")

    if burden.min_inter_lesion_distance_mm is not None and burden.min_inter_lesion_distance_mm < 20:
        score += 0.10
        reasons.append("clustered lesion distribution")

    # A very heavy burden argues against discrete tuberculomas.
    if burden.lesion_load_percent > 3.0:
        score -= 0.15
        reasons.append("high total lesion load, less typical of discrete tuberculomas")

    return float(max(0.0, min(1.0, score))), reasons


def _confidence_label(value: float) -> str:
    if value >= 0.75:
        return "high"
    if value >= 0.5:
        return "moderate"
    if value >= 0.25:
        return "low"
    return "very low"


def _limitations(
    method: str, sequences: list[str], calibrated: bool, provenance: dict | None = None
) -> list[str]:
    limitations = [
        "Anatomical localization is geometric and approximate; it is not derived from a "
        "registered anatomical atlas and region labels may be imprecise near boundaries.",
        "Skull stripping, bias correction, and registration use lightweight implementations; "
        "segmentation accuracy degrades on scans with heavy motion or susceptibility artifact.",
        "The system detects focal signal abnormality. It does not assess meningeal enhancement, "
        "hydrocephalus, infarction, or midline shift, any of which may be the dominant finding.",
    ]

    if method == "classical":
        limitations.insert(0, (
            "Findings were produced by a classical blob detector, not a trained segmentation "
            "model. It cannot discriminate tuberculomas from other focal hyperintense lesions "
            "and has no validated sensitivity or specificity. Results are for demonstration "
            "and pipeline validation only."
        ))
    # A model trained on a different disease is the single most important thing
    # a reader of this report needs to know, so it goes first.
    if provenance and provenance.get("not_tuberculosis"):
        pathology = provenance.get("pathology") or provenance.get("trained_on") or "another pathology"
        limitations.insert(0, (
            f"The segmentation model was trained on {pathology} and has never been shown "
            f"a tuberculoma. It detects focal brain lesions; it cannot distinguish "
            f"tuberculosis from the disease it was trained on, nor from any other focal "
            f"lesion. Reported sensitivity and specificity figures for this model describe "
            f"that training pathology and do not transfer to tuberculosis."
        ))

    if not calibrated:
        limitations.append(
            "Confidence values are uncalibrated and should be interpreted as relative "
            "rankings only, not as probabilities of disease."
        )
    if len(sequences) <= 1:
        limitations.append(
            f"Analysis used a single sequence ({sequences[0] if sequences else 'unknown'}). "
            "Characterisation of intracranial tuberculosis normally requires T1, T2, FLAIR "
            "and post-contrast T1 together; ring enhancement in particular cannot be assessed "
            "without post-contrast imaging."
        )
    return limitations
