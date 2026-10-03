"""PDF rendering of a preliminary analysis report (reportlab).

Everything printed here comes from rows and files the pipeline already wrote:
the stored report dict, lesion measurements, rendered slice PNGs, a 3D snapshot
if the doctor saved one, the latest comparison, and the review trail. Nothing
is computed or estimated at render time, and a value the pipeline did not
produce is left out rather than filled in.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#0D1424")
MUTED = colors.HexColor("#5B6B85")
BLUE = colors.HexColor("#1677E8")
LINE = colors.HexColor("#E2EAF6")
SOFT = colors.HexColor("#F4F8FE")
WARN_BG = colors.HexColor("#FFF7E8")
WARN_LINE = colors.HexColor("#F2C66D")

_styles = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=_styles["Heading1"], fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=NAVY, spaceAfter=2)
H2 = ParagraphStyle("h2", parent=_styles["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=10, spaceAfter=5)
BODY = ParagraphStyle("body", parent=_styles["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13, textColor=NAVY, alignment=TA_LEFT)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=7.8, leading=10.5, textColor=MUTED)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.4, leading=11)
CELL_B = ParagraphStyle("cellb", parent=CELL, fontName="Helvetica-Bold")


# The pipeline's trend keys classify change in segmented volume, not the
# patient's clinical course; same labels as the web app (clinic/format.js).
TREND_LABELS = {
    "improving": "Segmented volume decreased",
    "worsening": "Segmented volume increased",
    "stable": "Stable within 20%",
    "mixed": "Mixed change",
    "indeterminate": "Indeterminate",
}


def _p(text, style=BODY) -> Paragraph:
    safe = (str(text) if text is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(safe, style)


def _fmt_date(value) -> str:
    if value is None:
        return "Not recorded"
    if isinstance(value, datetime):
        value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return value.strftime("%d %b %Y, %H:%M UTC")
    try:
        return value.strftime("%d %b %Y")
    except AttributeError:
        return str(value)


def _num(value, places=2, unit="") -> str | None:
    if value is None:
        return None
    try:
        text = f"{float(value):.{places}f}"
    except (TypeError, ValueError):
        return None
    return f"{text} {unit}".strip()


def _kv_table(rows: list[tuple[str, str | None]], col=(42 * mm, 132 * mm)) -> Table:
    data = [[_p(k, CELL_B), _p(v, CELL)] for k, v in rows if v not in (None, "")]
    table = Table(data, colWidths=col, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
    ]))
    return table


def _grid(header: list[str], rows: list[list[str]], widths) -> Table:
    data = [[_p(h, CELL_B) for h in header]] + [[_p(c, CELL) for c in row] for row in rows]
    table = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), SOFT),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    return table


def _notice(text: str) -> Table:
    table = Table([[_p(text, SMALL)]], colWidths=[174 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WARN_BG),
        ("BOX", (0, 0), (-1, -1), 0.6, WARN_LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def _pick_slices(manifest: dict | None, slices_dir: Path) -> list[tuple[str, Path]]:
    """One overlay per plane, at the slice with the most segmented area."""
    picks = []
    for plane in ("axial", "coronal", "sagittal"):
        entries = (manifest or {}).get(plane) or []
        if not entries:
            continue
        best = max(entries, key=lambda e: (e.get("lesion_area_mm2") or 0))
        path = slices_dir / best["overlay"]
        if path.is_file():
            picks.append((f"{plane.capitalize()} · slice {best['index']}", path))
    return picks


def build_report_pdf(
    *, analysis, study, patient, patient_name: str, patient_age: int | None,
    doctor, comparison, reviews, slices_dir: Path,
) -> bytes:
    from ..pipeline.report import normalize_report, public_lesions

    report = normalize_report(analysis.report) or {}
    burden = report.get("burden") or analysis.burden or {}
    lesions = report.get("lesions") or public_lesions(analysis.lesions)
    confidence = report.get("confidence") or {}
    technique = report.get("technique") or {}

    buffer = io.BytesIO()
    generated = datetime.now(timezone.utc)

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 10 * mm, "NeuroVision AI · AI-assisted preliminary report · Not a diagnosis · Requires clinician review")
        canvas.drawRightString(192 * mm, 10 * mm, f"{patient.code} · page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
        title=f"MRI analysis report — {patient_name}", author="NeuroVision AI",
    )

    story: list = []
    story.append(_p("NeuroVision AI", ParagraphStyle("brand", parent=SMALL, textColor=BLUE, fontName="Helvetica-Bold", fontSize=9)))
    story.append(_p("Brain MRI — AI-assisted analysis report", H1))
    story.append(_p(
        f"Generated {_fmt_date(generated)} for {doctor.full_name}"
        + (f", {doctor.hospital}" if doctor.hospital else ""),
        SMALL,
    ))
    story.append(Spacer(1, 6))
    story.append(_notice(report.get("disclaimer") or
                         "AI-generated preliminary analysis. Decision support only; not a diagnosis. Review by a qualified clinician is required."))
    # Review state comes only from stored reviews, never from report text --
    # the same line the web report shows.
    story.append(Spacer(1, 3))
    if reviews:
        last = reviews[-1]
        story.append(_p(
            f"Clinician review: {last.status.value.capitalize()} by {last.reviewer} on "
            f"{_fmt_date(last.created_at)}. See Clinical review.",
            CELL_B,
        ))
    else:
        story.append(_p("Clinician review: not yet reviewed - these AI-generated findings are preliminary.", CELL_B))

    story.append(_p("Patient", H2))
    story.append(_kv_table([
        ("Name", patient_name),
        ("Patient ID", patient.code),
        ("Date of birth", _fmt_date(patient.date_of_birth) if patient.date_of_birth else None),
        ("Age", f"{patient_age} years" if patient_age is not None else None),
        ("Sex", (patient.sex or "").capitalize() or None),
    ]))

    story.append(_p("Scan", H2))
    story.append(_kv_table([
        ("Scan ID", study.code),
        ("Scan date", _fmt_date(study.acquired_on) if study.acquired_on else "Not recorded"),
        ("Sequence", study.sequence),
        ("Uploaded", _fmt_date(study.uploaded_at)),
        ("Analysis completed", _fmt_date(analysis.completed_at)),
        ("Volume", f"{study.shape} voxels at {study.spacing_mm} mm" if study.shape else None),
        ("Segmentation method", technique.get("segmentation_method") or analysis.method),
        ("Model trained on", (technique.get("model_provenance") or {}).get("pathology")
            or (technique.get("model_provenance") or {}).get("trained_on")
            or ("No trained model (classical detector)" if technique.get("segmentation_method") == "classical" else "Not available")),
        ("Threshold applied", _num(technique.get("segmentation_threshold"), 2)),
        ("Processing time", _num(analysis.duration_seconds, 1, "s")),
    ]))

    story.append(_p("AI analysis summary", H2))
    if report.get("headline"):
        story.append(_p(report["headline"], CELL_B))
        story.append(Spacer(1, 3))
    if report.get("impression"):
        story.append(_p(report["impression"]))
    findings = report.get("findings") or []
    if findings:
        story.append(Spacer(1, 4))
        for finding in findings:
            story.append(_p(f"•  {finding}"))

    burden_rows = [
        ("Lesions detected", str(burden["lesion_count"]) if burden.get("lesion_count") is not None else None),
        ("Total lesion volume", _num(burden.get("total_volume_cm3"), 2, "cm³")),
        ("Largest lesion", _num(burden.get("largest_volume_cm3"), 2, "cm³")),
        ("Lesion load", _num(burden.get("lesion_load_percent"), 3, "% of brain volume")),
        ("Brain volume", _num(burden.get("brain_volume_cm3"), 0, "cm³")),
        ("Regions involved", ", ".join(burden.get("regions_involved") or []) or None),
    ]
    if any(v for _, v in burden_rows):
        story.append(_p("Measurements", H2))
        story.append(_kv_table(burden_rows))

    if lesions:
        story.append(_p("Detected regions", H2))
        rows = []
        for lesion in lesions:
            dims = lesion.get("dimensions_mm")
            rows.append([
                str(lesion.get("id", "")),
                f"{lesion.get('side', '')} {lesion.get('region', '')}".strip() or "—",
                _num(lesion.get("volume_cm3"), 3) or "—",
                _num(lesion.get("max_diameter_mm"), 1) or "—",
                " × ".join(f"{d:.0f}" for d in dims) if dims else "—",
                _num(lesion.get("sphericity"), 2) or "—",
                _num(lesion.get("mean_probability"), 2) or "—",
            ])
        story.append(_grid(
            ["#", "Location (approximate)", "Volume cm³", "Max diam. mm", "Extent mm", "Sphericity", "Mean prob."],
            rows, [8 * mm, 50 * mm, 22 * mm, 21 * mm, 28 * mm, 21 * mm, 22 * mm],
        ))

    if confidence:
        story.append(_p("Model output", H2))
        story.append(_kv_table([
            ("Detection confidence",
             (f"{confidence['detection_confidence']:.2f} ({confidence.get('detection_confidence_label', '')})"
              if confidence.get("detection_confidence") is not None else None)),
            ("Calibration", confidence.get("calibration_note")),
        ]))

    picks = _pick_slices(analysis.slices, slices_dir)
    if picks:
        cells = []
        for caption, path in picks:
            cells.append([Image(str(path), width=54 * mm, height=54 * mm, kind="proportional"), _p(caption, SMALL)])
        table = Table([[c[0] for c in cells], [c[1] for c in cells]], colWidths=[58 * mm] * len(cells), hAlign="LEFT")
        table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
        story.append(KeepTogether([
            _p("Segmentation", H2),
            _p("Preprocessed MRI with the AI segmentation contour, at the slice of greatest segmented area in each plane.", SMALL),
            Spacer(1, 4),
            table,
        ]))

    if analysis.snapshot_path and Path(analysis.snapshot_path).is_file():
        story.append(KeepTogether([
            _p("3D visualization", H2),
            Image(analysis.snapshot_path, width=120 * mm, height=80 * mm, kind="proportional"),
            _p("Snapshot saved by the reviewing doctor from the interactive 3D view. The surrounding "
               "brain may be a normalised anatomical atlas, not this patient's anatomy.", SMALL),
        ]))

    if comparison and comparison.result:
        result = comparison.result
        story.append(_p("Comparison with previous scan", H2))
        story.append(_kv_table([
            ("Change classification", TREND_LABELS.get(result.get("trend"), (result.get("trend") or "").capitalize() or None)),
            ("Summary", result.get("summary")),
        ]))
        metrics = result.get("metrics") or []
        if metrics:
            story.append(Spacer(1, 4))
            story.append(_grid(
                ["Measure", "Previous", "Current", "Change"],
                [[m.get("label", ""),
                  f"{m.get('baseline')} {m.get('unit', '')}".strip(),
                  f"{m.get('followup')} {m.get('unit', '')}".strip(),
                  (f"{m.get('change')} ({m['change_percent']:+.1f}%)" if m.get("change_percent") is not None else str(m.get("change")))]
                 for m in metrics],
                [60 * mm, 36 * mm, 36 * mm, 40 * mm],
            ))
    else:
        story.append(_p("Comparison with previous scan", H2))
        story.append(_p("No comparison has been run with this scan as the follow-up.", SMALL))

    story.append(_p("Clinical review", H2))
    if reviews:
        for review in reviews:
            line = f"{_fmt_date(review.created_at)} — {review.status.value.capitalize()} by {review.reviewer}"
            story.append(_p(line, CELL_B))
            if review.edited_impression:
                story.append(_p(f"Revised impression: {review.edited_impression}"))
            if review.comments:
                story.append(_p(f"Notes: {review.comments}"))
            story.append(Spacer(1, 3))
    else:
        story.append(_p("Not yet reviewed by a clinician. These findings are preliminary.", SMALL))
    if patient.clinical_notes:
        story.append(Spacer(1, 3))
        story.append(_p(f"Patient clinical notes: {patient.clinical_notes}", SMALL))

    limitations = report.get("limitations") or []
    if limitations:
        story.append(_p("Limitations", H2))
        for item in limitations:
            story.append(_p(f"•  {item}", SMALL))

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buffer.getvalue()
