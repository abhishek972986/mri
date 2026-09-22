"""Fetch a BraTS-2024 glioma subset (FLAIR + segmentation) from Hugging Face.

    python backend/train/download_brats.py --cases 300

Source: https://huggingface.co/datasets/Spirit-26/BraTS-2024-Complete
        (BraTS-GLI/train - adult glioma, public, ungated)
Upstream: the RSNA-ASNR-MICCAI BraTS challenge. Cite the BraTS papers if you
publish anything from this.

WHAT THIS DATA IS, AND IS NOT
-----------------------------
Adult diffuse glioma. Not tuberculosis. A model trained here learns what a focal
lesion looks like on FLAIR; it has never seen a tuberculoma. It is the
pretraining half of the transfer-learning path in the README, and every artifact
derived from it is tagged so a downstream report cannot quietly claim otherwise.

WHY PER-FILE RATHER THAN A BULK ARCHIVE
--------------------------------------
The Medical Segmentation Decathlon ships this task as a single 7 GB tar with all
four sequences. This pipeline is single-sequence, so roughly three quarters of
that download would be discarded. Pulling FLAIR and the mask per case is about
4.3 MB per case, so a 300-case training set costs ~1.3 GB instead of 7 GB, and a
slow link makes that difference hours.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "Spirit-26/BraTS-2024-Complete"
API = f"https://huggingface.co/api/datasets/{REPO}"
RESOLVE = f"https://huggingface.co/datasets/{REPO}/resolve/main"
PREFIX = "BraTS-GLI/train/"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cases", type=int, default=300, help="How many cases to fetch")
    parser.add_argument("--out", type=Path, default=Path("data/raw/brats2024_gli"))
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel downloads; more is not faster on a saturated link")
    parser.add_argument("--seed", type=int, default=0)
    return parser.parse_args()


def list_cases() -> list[str]:
    """Every GLI training case that has both a FLAIR volume and a mask."""
    with urllib.request.urlopen(API, timeout=120) as response:
        meta = json.load(response)

    files = {s["rfilename"] for s in meta.get("siblings", [])}
    cases = []
    for path in sorted(files):
        if not (path.startswith(PREFIX) and path.endswith("-t2f.nii.gz")):
            continue
        if path.replace("-t2f.nii.gz", "-seg.nii.gz") in files:
            cases.append(Path(path).parent.name)
    return cases


def fetch(remote: str, local: Path, retries: int = 4) -> bool:
    if local.exists() and local.stat().st_size > 1024:
        return True

    local.parent.mkdir(parents=True, exist_ok=True)
    partial = local.with_suffix(local.suffix + ".part")

    for attempt in range(retries):
        try:
            with urllib.request.urlopen(f"{RESOLVE}/{remote}", timeout=300) as response, \
                 partial.open("wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            partial.replace(local)      # rename only on success, so a killed run resumes cleanly
            return True
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            partial.unlink(missing_ok=True)
            if attempt == retries - 1:
                return False
            time.sleep(2 * (attempt + 1))
    return False


def fetch_case(case: str, out_dir: Path) -> tuple[str, bool]:
    base = f"{PREFIX}{case}/{case}"
    ok_image = fetch(f"{base}-t2f.nii.gz", out_dir / case / "flair.nii.gz")
    ok_label = fetch(f"{base}-seg.nii.gz", out_dir / case / "seg.nii.gz")
    return case, (ok_image and ok_label)


def main() -> int:
    args = parse_args()

    print(f"Listing cases in {REPO} ...")
    cases = list_cases()
    print(f"  {len(cases)} GLI training cases available")

    # Deterministic subset: the same --cases always yields the same set, so a
    # re-run resumes rather than starting a different download.
    import random
    random.Random(args.seed).shuffle(cases)
    selected = cases[: args.cases]

    args.out.mkdir(parents=True, exist_ok=True)
    print(f"Fetching {len(selected)} cases (FLAIR + mask) to {args.out}\n")

    started = time.perf_counter()
    done = 0
    failed: list[str] = []

    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = [pool.submit(fetch_case, case, args.out) for case in selected]
        for job in futures.as_completed(jobs):
            case, ok = job.result()
            done += 1
            if not ok:
                failed.append(case)

            if done % 10 == 0 or done == len(selected):
                elapsed = time.perf_counter() - started
                size = sum(f.stat().st_size for f in args.out.rglob("*.nii.gz"))
                rate = done / max(elapsed, 1e-6)
                print(f"  {done}/{len(selected)}  {size / 1e9:.2f} GB  "
                      f"{elapsed:.0f}s  eta {(len(selected) - done) / max(rate, 1e-6):.0f}s"
                      + (f"  ({len(failed)} failed)" if failed else ""))

    complete = [
        c for c in selected
        if (args.out / c / "flair.nii.gz").exists() and (args.out / c / "seg.nii.gz").exists()
    ]

    manifest = {
        "source": REPO,
        "url": f"https://huggingface.co/datasets/{REPO}",
        "upstream": "RSNA-ASNR-MICCAI BraTS 2024 (adult glioma, BraTS-GLI train split)",
        "pathology": "glioma",
        "not_tuberculosis": True,
        "modality": "T2-FLAIR (t2f)",
        "label_source": "BraTS expert segmentation (seg)",
        "requested": args.cases,
        "complete": len(complete),
        "cases": complete,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    size = sum(f.stat().st_size for f in args.out.rglob("*.nii.gz"))
    print(f"\n{len(complete)} complete cases, {size / 1e9:.2f} GB, "
          f"{time.perf_counter() - started:.0f}s")
    if failed:
        print(f"{len(failed)} failed; re-run to retry (existing files are kept): {failed[:8]}")
    print(f"Manifest: {args.out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
