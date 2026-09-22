"""Longitudinal change analysis.

Given two analysed studies, this answers the question the treating clinician
actually has: is this patient getting better?

The work is in matching. A lesion is not identified by its index -- lesion 3 in
March is not lesion 3 in June. After registration, lesions are matched across
time points by spatial overlap first (the reliable signal) and by centroid
proximity second (which catches a shrinking lesion whose masks no longer touch).
Matching is greedy on a combined score, which is adequate for the handful of
lesions a real case has and is far easier to audit than a Hungarian assignment.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from scipy import ndimage

from .quantify import Lesion, LesionBurden

# A lesion must change by more than this to be called changed rather than stable.
# Manual and automated segmentation of small lesions carries roughly this much
# variability, so smaller swings are noise, not treatment response.
STABLE_VOLUME_TOLERANCE = 0.20

MATCH_DISTANCE_MM = 12.0
MATCH_MIN_SCORE = 0.10


@dataclass
class LesionChange:
    status: str                              # new | resolved | increased | decreased | stable
    baseline_id: int | None
    followup_id: int | None
    region: str
    side: str
    baseline_volume_cm3: float
    followup_volume_cm3: float
    volume_change_cm3: float
    volume_change_percent: float | None
    baseline_diameter_mm: float
    followup_diameter_mm: float
    centroid_shift_mm: float | None
    dice: float | None
    match_score: float | None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ComparisonResult:
    trend: str                               # improving | worsening | stable | mixed | indeterminate
    summary: str
    baseline_burden: dict
    followup_burden: dict
    metrics: list[dict] = field(default_factory=list)
    lesion_changes: list[dict] = field(default_factory=list)
    alerts: list[dict] = field(default_factory=list)
    registration: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def compare_studies(
    baseline_lesions: list[Lesion],
    baseline_burden: LesionBurden,
    followup_lesions: list[Lesion],
    followup_burden: LesionBurden,
    baseline_mask: np.ndarray | None = None,
    followup_mask: np.ndarray | None = None,
    registration_info: dict | None = None,
    segmentation_method: str | None = None,
) -> ComparisonResult:
    """Compare two analysed time points. Masks must already be on a common grid."""
    changes = _match_lesions(baseline_lesions, followup_lesions, baseline_mask, followup_mask)
    metrics = _build_metrics(baseline_burden, followup_burden)
    trend, summary = _classify_trend(baseline_burden, followup_burden, changes)
    alerts = _build_alerts(
        changes, baseline_burden, followup_burden, registration_info, segmentation_method
    )

    return ComparisonResult(
        trend=trend,
        summary=summary,
        baseline_burden=baseline_burden.to_dict(),
        followup_burden=followup_burden.to_dict(),
        metrics=metrics,
        lesion_changes=[c.to_dict() for c in changes],
        alerts=alerts,
        registration=registration_info or {},
    )


def _match_lesions(
    baseline: list[Lesion],
    followup: list[Lesion],
    baseline_mask: np.ndarray | None,
    followup_mask: np.ndarray | None,
) -> list[LesionChange]:
    if not baseline and not followup:
        return []

    can_overlap = (
        baseline_mask is not None
        and followup_mask is not None
        and baseline_mask.shape == followup_mask.shape
    )
    base_labels = _labels_for(baseline_mask, baseline) if can_overlap else None
    follow_labels = _labels_for(followup_mask, followup) if can_overlap else None

    # Score every candidate pair, then take matches greedily from the top.
    scored: list[tuple[float, int, int, float | None, float]] = []
    for i, b in enumerate(baseline):
        for j, f in enumerate(followup):
            distance = float(np.linalg.norm(
                np.array(b.centroid_world_mm) - np.array(f.centroid_world_mm)
            ))
            if distance > MATCH_DISTANCE_MM * 2:
                continue

            dice = None
            if base_labels is not None and follow_labels is not None:
                dice = _dice(base_labels == b.id, follow_labels == f.id)

            proximity = max(0.0, 1.0 - distance / MATCH_DISTANCE_MM)
            score = max(dice or 0.0, proximity * 0.8)
            if score >= MATCH_MIN_SCORE:
                scored.append((score, i, j, dice, distance))

    scored.sort(reverse=True, key=lambda t: t[0])
    used_b: set[int] = set()
    used_f: set[int] = set()
    changes: list[LesionChange] = []

    for score, i, j, dice, distance in scored:
        if i in used_b or j in used_f:
            continue
        used_b.add(i)
        used_f.add(j)
        changes.append(_paired_change(baseline[i], followup[j], dice, distance, score))

    for i, b in enumerate(baseline):
        if i not in used_b:
            changes.append(_unpaired_change(b, resolved=True))
    for j, f in enumerate(followup):
        if j not in used_f:
            changes.append(_unpaired_change(f, resolved=False))

    priority = {"new": 0, "increased": 1, "stable": 2, "decreased": 3, "resolved": 4}
    changes.sort(key=lambda c: (priority.get(c.status, 9), -max(c.followup_volume_cm3, c.baseline_volume_cm3)))
    return changes


def _paired_change(
    b: Lesion, f: Lesion, dice: float | None, distance: float, score: float
) -> LesionChange:
    delta = f.volume_cm3 - b.volume_cm3
    percent = (delta / b.volume_cm3 * 100.0) if b.volume_cm3 > 0 else None

    if percent is None:
        status = "stable"
    elif percent > STABLE_VOLUME_TOLERANCE * 100:
        status = "increased"
    elif percent < -STABLE_VOLUME_TOLERANCE * 100:
        status = "decreased"
    else:
        status = "stable"

    return LesionChange(
        status=status,
        baseline_id=b.id,
        followup_id=f.id,
        region=f.region,
        side=f.side,
        baseline_volume_cm3=b.volume_cm3,
        followup_volume_cm3=f.volume_cm3,
        volume_change_cm3=round(delta, 4),
        volume_change_percent=round(percent, 1) if percent is not None else None,
        baseline_diameter_mm=b.max_diameter_mm,
        followup_diameter_mm=f.max_diameter_mm,
        centroid_shift_mm=round(distance, 2),
        dice=round(dice, 3) if dice is not None else None,
        match_score=round(score, 3),
    )


def _unpaired_change(lesion: Lesion, resolved: bool) -> LesionChange:
    return LesionChange(
        status="resolved" if resolved else "new",
        baseline_id=lesion.id if resolved else None,
        followup_id=None if resolved else lesion.id,
        region=lesion.region,
        side=lesion.side,
        baseline_volume_cm3=lesion.volume_cm3 if resolved else 0.0,
        followup_volume_cm3=0.0 if resolved else lesion.volume_cm3,
        volume_change_cm3=round(-lesion.volume_cm3 if resolved else lesion.volume_cm3, 4),
        volume_change_percent=-100.0 if resolved else None,
        baseline_diameter_mm=lesion.max_diameter_mm if resolved else 0.0,
        followup_diameter_mm=0.0 if resolved else lesion.max_diameter_mm,
        centroid_shift_mm=None,
        dice=None,
        match_score=None,
    )


def _build_metrics(baseline: LesionBurden, followup: LesionBurden) -> list[dict]:
    rows = [
        ("Lesion count", baseline.lesion_count, followup.lesion_count, "", 0),
        ("Total lesion volume", baseline.total_volume_cm3, followup.total_volume_cm3, "cm3", 2),
        ("Largest lesion", baseline.largest_volume_cm3, followup.largest_volume_cm3, "cm3", 2),
        ("Mean lesion volume", baseline.mean_volume_cm3, followup.mean_volume_cm3, "cm3", 3),
        ("Lesion load", baseline.lesion_load_percent, followup.lesion_load_percent, "%", 3),
    ]

    metrics = []
    for label, before, after, unit, places in rows:
        delta = after - before
        percent = (delta / before * 100.0) if before else None
        metrics.append({
            "label": label,
            "unit": unit,
            "baseline": round(before, places) if places else before,
            "followup": round(after, places) if places else after,
            "change": round(delta, places) if places else delta,
            "change_percent": round(percent, 1) if percent is not None else None,
            "direction": "up" if delta > 0 else "down" if delta < 0 else "flat",
        })
    return metrics


def _classify_trend(
    baseline: LesionBurden, followup: LesionBurden, changes: list[LesionChange]
) -> tuple[str, str]:
    counts = {status: sum(1 for c in changes if c.status == status)
              for status in ("new", "increased", "decreased", "resolved", "stable")}

    if baseline.lesion_count == 0 and followup.lesion_count == 0:
        return "stable", "No lesions detected at either time point."

    if baseline.total_volume_cm3 > 0:
        volume_delta = (followup.total_volume_cm3 - baseline.total_volume_cm3) / baseline.total_volume_cm3
    else:
        volume_delta = 1.0 if followup.total_volume_cm3 > 0 else 0.0

    worsening = counts["new"] + counts["increased"]
    improving = counts["resolved"] + counts["decreased"]

    if volume_delta < -STABLE_VOLUME_TOLERANCE and worsening == 0:
        trend = "improving"
    elif volume_delta > STABLE_VOLUME_TOLERANCE or counts["new"] > 0:
        trend = "worsening" if improving == 0 else "mixed"
    elif abs(volume_delta) <= STABLE_VOLUME_TOLERANCE and worsening == 0:
        trend = "stable"
    else:
        trend = "mixed"

    summary = (
        f"Total lesion volume {baseline.total_volume_cm3:.2f} -> {followup.total_volume_cm3:.2f} cm3 "
        f"({volume_delta * 100:+.1f}%), lesion count {baseline.lesion_count} -> {followup.lesion_count}. "
        f"{counts['new']} new, {counts['increased']} enlarging, {counts['decreased']} regressing, "
        f"{counts['resolved']} resolved, {counts['stable']} stable."
    )
    return trend, summary


def _build_alerts(
    changes: list[LesionChange],
    baseline: LesionBurden,
    followup: LesionBurden,
    registration_info: dict | None,
    segmentation_method: str | None = None,
) -> list[dict]:
    """Flags for clinician attention. Never diagnoses -- these prompt review."""
    alerts: list[dict] = []

    # A detector whose false positives do not reproduce between two scans will
    # generate "new lesion" and "resolved" calls out of pure noise. Saying so up
    # front matters more than any individual flag below: without it, an unstable
    # detector reads as a deteriorating patient.
    if segmentation_method == "classical":
        unstable = sum(1 for c in changes if c.status in ("new", "resolved"))
        if unstable:
            alerts.append({
                "severity": "medium",
                "type": "low_reproducibility",
                "message": (
                    f"Findings came from the classical fallback detector, whose false positives "
                    f"do not reproduce reliably between scans. {unstable} of the interval changes "
                    f"below are appearances or disappearances, some of which are likely detector "
                    f"noise rather than real change. Interpret new-lesion and resolved-lesion "
                    f"calls with particular caution until a trained model is in use."
                ),
            })

    for change in changes:
        if change.status == "new":
            alerts.append({
                "severity": "high",
                "type": "new_lesion",
                "message": (
                    f"New lesion in the {change.side} {change.region} "
                    f"({change.followup_volume_cm3:.2f} cm3) not present on the prior study."
                ),
            })
        elif change.status == "increased" and (change.volume_change_percent or 0) > 50:
            alerts.append({
                "severity": "high",
                "type": "enlarging_lesion",
                "message": (
                    f"Lesion in the {change.side} {change.region} enlarged by "
                    f"{change.volume_change_percent:.0f}% "
                    f"({change.baseline_volume_cm3:.2f} -> {change.followup_volume_cm3:.2f} cm3)."
                ),
            })

    if baseline.lesion_count > 0 and followup.lesion_count == 0:
        alerts.append({
            "severity": "info",
            "type": "complete_resolution",
            "message": "No lesions detected on the current study; all previously detected lesions have resolved.",
        })

    # Paradoxical reaction: a recognised phenomenon in treated CNS TB, where
    # lesions transiently enlarge despite effective therapy. Worth naming so it
    # is not read as treatment failure.
    if any(c.status in ("new", "increased") for c in changes) and \
       any(c.status in ("decreased", "resolved") for c in changes):
        alerts.append({
            "severity": "medium",
            "type": "mixed_response",
            "message": (
                "Mixed response: some lesions regressing while others are new or enlarging. "
                "In treated CNS tuberculosis this can represent a paradoxical reaction rather "
                "than treatment failure. Clinical correlation required."
            ),
        })

    if registration_info:
        for warning in registration_info.get("warnings", []) or []:
            alerts.append({"severity": "medium", "type": "registration", "message": warning})

    return alerts


def _labels_for(mask: np.ndarray | None, lesions: list[Lesion]) -> np.ndarray | None:
    """Rebuild the labelled array so component ids match the reported lesion ids."""
    if mask is None:
        return None
    labels, _ = ndimage.label(mask, structure=np.ones((3, 3, 3)))
    return labels


def _dice(a: np.ndarray, b: np.ndarray) -> float:
    total = a.sum() + b.sum()
    if total == 0:
        return 0.0
    return float(2.0 * np.logical_and(a, b).sum() / total)
