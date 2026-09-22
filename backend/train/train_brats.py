"""Train the 3D lesion segmentation model on the cached BraTS FLAIR data.

    python backend/train/download_brats.py --cases 300
    python backend/train/verify_data.py
    python backend/train/prepare_brats.py
    python backend/train/train_brats.py --epochs 60 --amp

    BraTS 2024 -> FLAIR -> preprocess -> patches -> 3D U-Net -> lesion mask

WHAT IS MONITORED, AND WHY NOT JUST DICE
----------------------------------------
Per epoch: train loss, validation loss, validation Dice, and validation
recall and precision.

Periodically (`--full-val-every`): whole-volume inference on a few validation
cases, giving per-lesion sensitivity and false components per case. Patch-level
numbers cannot produce those honestly, because a foreground-biased patch sampler
never asks the model to leave a whole brain of healthy tissue alone - so
patch metrics systematically understate false positives.

Overfitting is watched explicitly: when validation loss rises while training
loss keeps falling, the run says so, and `--early-stop` will halt on it.

SPLITTING
---------
By CASE, from a fixed seed. The test list is written into the checkpoint and
never touched during training. This matters more than it sounds: patches from
one patient's lesion are highly correlated, so a patch-level split lets the
model memorise a lesion in training and be scored on it in validation. That
mistake reliably yields Dice in the high 0.9s and a model worth nothing on a
new patient.

MEMORY
------
Sized for a 4 GB card: 96-cubed patches, base_channels 16, batch 1, AMP. Cases
are read from the npz cache one patch at a time rather than held in RAM.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache", type=Path, default=Path("data/cache/brats_flair"))
    parser.add_argument("--out", type=Path, default=BACKEND / "checkpoints" / "unet3d_brats.pt")

    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--patches-per-epoch", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--patch", type=int, nargs=3, default=(96, 96, 96))
    parser.add_argument("--fg-ratio", type=float, default=0.7)

    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--base-channels", type=int, default=16)
    parser.add_argument("--depth", type=int, default=4)
    parser.add_argument("--attention", action="store_true")
    parser.add_argument("--pos-weight", type=float, default=6.0)

    parser.add_argument("--val-frac", type=float, default=0.15)
    parser.add_argument("--test-frac", type=float, default=0.15)
    parser.add_argument("--max-cases", type=int, default=0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--amp", action="store_true")

    parser.add_argument("--full-val-every", type=int, default=10,
                        help="Whole-volume validation every N epochs (0 to disable)")
    parser.add_argument("--full-val-cases", type=int, default=6)
    parser.add_argument("--early-stop", type=int, default=0,
                        help="Stop after N epochs of rising validation loss (0 to disable)")
    parser.add_argument("--time-budget-min", type=float, default=0.0,
                        help="Stop cleanly after this long, keeping the best checkpoint")
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


# --- data ------------------------------------------------------------------

def load_splits(cache: Path, val_frac: float, test_frac: float, seed: int, max_cases: int):
    manifest = json.loads((cache / "index.json").read_text(encoding="utf-8"))
    cases = list(manifest["cases"])

    random.Random(seed).shuffle(cases)

    n = len(cases)
    n_test = max(1, int(n * test_frac))
    n_val = max(1, int(n * val_frac))

    test = cases[:n_test]
    val = cases[n_test:n_test + n_val]
    train = cases[n_test + n_val:]
    if max_cases:
        train = train[:max_cases]

    return manifest, train, val, test


class CaseCache:
    """Memory-mapped reader over the .npy cache.

    Arrays are mapped, not read: extracting a 96-cubed patch touches about
    1.8 MB rather than decoding a whole 17 MB volume. With a compressed cache the
    decompression cost exceeded the convolutions it was feeding, and the GPU sat
    idle waiting on data.

    Open maps and foreground coordinates are cached per case; argwhere over a
    multi-million-voxel label on every patch would otherwise dominate an epoch.
    """

    def __init__(self, cache_dir: Path, entries: list[dict]):
        self.dir = cache_dir
        self.entries = entries
        self._maps: dict[str, tuple] = {}
        self._fg: dict[str, np.ndarray] = {}

    def __len__(self) -> int:
        return len(self.entries)

    def maps(self, entry: dict):
        """(image, label, brain) as read-only memory maps."""
        key = entry["file"]
        if key not in self._maps:
            self._maps[key] = tuple(
                np.load(self.dir / f"{key}_{name}.npy", mmap_mode="r")
                for name in ("image", "label", "brain")
            )
        return self._maps[key]

    def load(self, entry: dict):
        """Whole volumes as real arrays. Used by full-volume validation only."""
        image, label, brain = self.maps(entry)
        return np.asarray(image, dtype=np.float32), np.asarray(label), np.asarray(brain)

    def foreground(self, entry: dict) -> np.ndarray:
        key = entry["file"]
        if key not in self._fg:
            _, label, _ = self.maps(entry)
            coords = np.argwhere(np.asarray(label) > 0)
            if coords.shape[0] > 4000:
                coords = coords[:: coords.shape[0] // 4000]
            self._fg[key] = coords
        return self._fg[key]


def sample_patch(cache: CaseCache, entry: dict, patch, force_fg: bool,
                 rng: random.Random, nprng: np.random.Generator):
    """Extract one training patch.

    Background patches are re-drawn a few times if they land entirely outside
    the brain: a patch of pure air teaches the model nothing, and with a cropped
    volume a meaningful share of uniform samples are exactly that.
    """
    image, label, brain = cache.maps(entry)
    shape = image.shape

    centre = None
    if force_fg:
        fg = cache.foreground(entry)
        if fg.shape[0]:
            picked = fg[rng.randrange(fg.shape[0])]
            # Jitter, so the model does not learn "the lesion is in the middle",
            # which is true of the sampler and not of a scan.
            centre = [int(c + rng.randint(-p // 4, p // 4)) for c, p in zip(picked, patch)]

    if centre is None:
        for _ in range(8):
            candidate = [rng.randrange(s) for s in shape]
            if brain[tuple(candidate)]:
                centre = candidate
                break
        else:
            centre = [s // 2 for s in shape]

    starts = [int(np.clip(c - p // 2, 0, max(s - p, 0))) for c, p, s in zip(centre, patch, shape)]
    slicer = tuple(slice(s, s + p) for s, p in zip(starts, patch))

    # Slicing a memory map reads only the pages that patch touches.
    img = np.zeros(patch, dtype=np.float32)
    lbl = np.zeros(patch, dtype=np.float32)
    chunk_i = np.asarray(image[slicer], dtype=np.float32)
    chunk_l = np.asarray(label[slicer], dtype=np.float32)
    region = tuple(slice(0, d) for d in chunk_i.shape)
    img[region] = chunk_i
    lbl[region] = chunk_l

    return augment(img, lbl, rng, nprng)


def augment(image: np.ndarray, label: np.ndarray,
            rng: random.Random, nprng: np.random.Generator):
    """Label-preserving transforms only.

    An elastic warp would change lesion volume, which is the quantity this whole
    system reports, so only flips, right-angle rotations and intensity jitter.

    Two generators, deliberately: `rng` (stdlib) makes the discrete choices and
    `nprng` (numpy) draws the noise array. They are seeded together, so runs stay
    reproducible; stdlib Random has no array-valued normal() and drawing element
    by element would be far slower than the convolution it perturbs.
    """
    for axis in range(3):
        if rng.random() < 0.5:
            image = np.flip(image, axis)
            label = np.flip(label, axis)

    if rng.random() < 0.5:
        k = rng.randint(1, 3)
        axes = rng.choice([(0, 1), (0, 2), (1, 2)])
        image = np.rot90(image, k, axes)
        label = np.rot90(label, k, axes)

    image = image * rng.uniform(0.9, 1.1) + rng.uniform(-0.1, 0.1)
    if rng.random() < 0.2:
        image = image + nprng.normal(0, 0.05, size=image.shape).astype(np.float32)

    return np.ascontiguousarray(image), np.ascontiguousarray(label)


# --- metrics ---------------------------------------------------------------

def confusion(pred: np.ndarray, target: np.ndarray) -> tuple[float, float, float]:
    tp = float((pred * target).sum())
    fp = float((pred * (1 - target)).sum())
    fn = float(((1 - pred) * target).sum())
    return tp, fp, fn


def dice_from(tp: float, fp: float, fn: float) -> float:
    denom = 2 * tp + fp + fn
    return 1.0 if denom == 0 else 2 * tp / denom


def full_volume_metrics(prob: np.ndarray, truth: np.ndarray, brain: np.ndarray,
                        threshold: float, min_voxels: int) -> dict:
    """Whole-volume Dice, per-lesion sensitivity and false components.

    This is the honest view: it includes all the healthy tissue a patch sampler
    never shows the model.
    """
    pred = (prob >= threshold) & brain
    if pred.any():
        labels, count = ndimage.label(pred, structure=np.ones((3, 3, 3)))
        if count:
            sizes = np.bincount(labels.ravel())
            keep = np.zeros(sizes.shape, dtype=bool)
            keep[1:] = sizes[1:] >= min_voxels
            pred = keep[labels]

    tp, fp, fn = confusion(pred.astype(np.float32), truth.astype(np.float32))

    truth_labels, truth_count = ndimage.label(truth, structure=np.ones((3, 3, 3)))
    detected = sum(
        1 for i in range(1, truth_count + 1)
        if np.logical_and(truth_labels == i, pred).any()
    )

    pred_labels, pred_count = ndimage.label(pred, structure=np.ones((3, 3, 3)))
    false_components = sum(
        1 for i in range(1, pred_count + 1)
        if not np.logical_and(pred_labels == i, truth).any()
    )

    return {
        "dice": dice_from(tp, fp, fn),
        "recall": tp / (tp + fn) if (tp + fn) else 1.0,
        "precision": tp / (tp + fp) if (tp + fp) else 1.0,
        "true_lesions": truth_count,
        "detected_lesions": detected,
        "false_components": false_components,
    }


def main() -> int:
    args = parse_args()

    try:
        import torch
        from torch.utils.data import DataLoader, Dataset
    except ImportError:
        print("PyTorch is not installed.")
        print("  pip install torch --index-url https://download.pytorch.org/whl/cu126")
        return 1

    from app.pipeline.nets import DiceBCELoss, UNet3D
    from app.pipeline.segmentation import _gaussian_window, _tile_starts

    if not (args.cache / "index.json").exists():
        print(f"No cache at {args.cache}. Run prepare_brats.py first.")
        return 1

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    manifest, train_cases, val_cases, test_cases = load_splits(
        args.cache, args.val_frac, args.test_frac, args.seed, args.max_cases,
    )

    print(f"Dataset  : {manifest.get('upstream', manifest.get('source'))}")
    print(f"Pathology: {manifest.get('pathology')}  (NOT tuberculosis)")
    print(f"Modality : {manifest.get('modality')}")
    print(f"Split    : {len(train_cases)} train / {len(val_cases)} val / "
          f"{len(test_cases)} test  - by case, seed {args.seed}\n")

    # The test ids are written to disk immediately, not only at the end, so the
    # held-out set is fixed before a single gradient step is taken.
    args.out.parent.mkdir(parents=True, exist_ok=True)
    split_path = args.out.with_suffix(".splits.json")
    split_path.write_text(json.dumps({
        "seed": args.seed,
        "train": [c["case"] for c in train_cases],
        "val": [c["case"] for c in val_cases],
        "test": [c["case"] for c in test_cases],
    }, indent=2), encoding="utf-8")
    print(f"Splits written to {split_path}\n")

    train_cache = CaseCache(args.cache, train_cases)
    val_cache = CaseCache(args.cache, val_cases)
    patch = tuple(args.patch)

    class PatchDataset(Dataset):
        def __init__(self, cache: CaseCache, length: int, fg_ratio: float, seed: int):
            self.cache, self.length, self.fg_ratio = cache, length, fg_ratio
            self.rng = random.Random(seed)
            self.nprng = np.random.default_rng(seed)

        def __len__(self):
            return self.length

        def __getitem__(self, index):
            entry = self.cache.entries[self.rng.randrange(len(self.cache))]
            image, label = sample_patch(
                self.cache, entry, patch, self.rng.random() < self.fg_ratio,
                self.rng, self.nprng,
            )
            return torch.from_numpy(image)[None], torch.from_numpy(label)[None]

    train_loader = DataLoader(
        PatchDataset(train_cache, args.patches_per_epoch, args.fg_ratio, args.seed),
        batch_size=args.batch_size, num_workers=0,
    )
    val_loader = DataLoader(
        PatchDataset(val_cache, max(args.patches_per_epoch // 4, 24), 0.5, args.seed + 1),
        batch_size=args.batch_size, num_workers=0,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        prop = torch.cuda.get_device_properties(0)
        print(f"Device   : {prop.name}, {prop.total_memory / 1024**3:.1f} GB")
    else:
        print("Device   : CPU - this will be very slow")

    model = UNet3D(
        in_channels=1, out_channels=1,
        base_channels=args.base_channels, depth=args.depth, attention=args.attention,
    ).to(device)
    print(f"Model    : {'Attention ' if args.attention else ''}UNet3D, "
          f"{sum(p.numel() for p in model.parameters()) / 1e6:.2f}M params, patch {patch}\n")

    criterion = DiceBCELoss(pos_weight=args.pos_weight).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    scaler = torch.amp.GradScaler("cuda", enabled=args.amp and device.type == "cuda")

    start_epoch = 1
    best_dice = -1.0
    best_val_loss = float("inf")
    rising = 0
    history = []

    if args.resume and args.out.exists():
        state = torch.load(args.out, map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        start_epoch = int(state["config"].get("epochs", 0)) + 1
        best_dice = float(state["config"].get("val_patch_dice", -1.0))
        print(f"Resumed from {args.out} at epoch {start_epoch}\n")

    def run_full_validation(limit: int) -> dict:
        """Sliding-window inference over whole validation volumes.

        Uses the same windowing the API uses, so these numbers describe the
        deployed inference path rather than a friendlier evaluation-only one.
        """
        model.eval()
        window = _gaussian_window(patch)
        strides = [max(int(p * 0.5), 1) for p in patch]
        results = []

        for entry in val_cache.entries[:limit]:
            image, truth, brain = val_cache.load(entry)
            accum = np.zeros(image.shape, dtype=np.float32)
            weights = np.zeros(image.shape, dtype=np.float32)
            starts = [_tile_starts(d, p, s) for d, p, s in zip(image.shape, patch, strides)]

            with torch.no_grad():
                for x in starts[0]:
                    for y in starts[1]:
                        for z in starts[2]:
                            sl = (slice(x, x + patch[0]), slice(y, y + patch[1]), slice(z, z + patch[2]))
                            chunk = image[sl]
                            padded = np.zeros(patch, dtype=np.float32)
                            padded[:chunk.shape[0], :chunk.shape[1], :chunk.shape[2]] = chunk
                            tensor = torch.from_numpy(padded)[None, None].to(device)
                            with torch.amp.autocast("cuda", enabled=scaler.is_enabled()):
                                pred = torch.sigmoid(model(tensor).float())[0, 0].cpu().numpy()
                            region = tuple(slice(0, d) for d in chunk.shape)
                            accum[sl] += (pred * window)[region]
                            weights[sl] += window[region]

            prob = np.divide(accum, weights, out=np.zeros_like(accum), where=weights > 0)
            results.append(full_volume_metrics(prob, truth.astype(bool), brain.astype(bool), 0.5, 30))

        return {
            "dice": float(np.mean([r["dice"] for r in results])),
            "recall": float(np.mean([r["recall"] for r in results])),
            "precision": float(np.mean([r["precision"] for r in results])),
            "lesion_sensitivity": (
                sum(r["detected_lesions"] for r in results) / max(sum(r["true_lesions"] for r in results), 1)
            ),
            "false_components_per_case": sum(r["false_components"] for r in results) / max(len(results), 1),
            "cases": len(results),
        }

    print(f"{'epoch':>6}  {'train':>7}  {'val':>7}  {'dice':>6}  {'rec':>6}  {'prec':>6}  {'sec':>5}")
    print("-" * 56)

    started = time.perf_counter()
    stop_reason = "completed"

    for epoch in range(start_epoch, args.epochs + 1):
        epoch_start = time.perf_counter()
        model.train()
        train_loss = 0.0

        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)

            with torch.amp.autocast("cuda", enabled=scaler.is_enabled()):
                loss = criterion(model(images), labels)

            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(optimizer)
            scaler.update()
            train_loss += loss.item()

        model.eval()
        val_loss = 0.0
        tp_sum = fp_sum = fn_sum = 0.0
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(device), labels.to(device)
                with torch.amp.autocast("cuda", enabled=scaler.is_enabled()):
                    logits = model(images)
                    val_loss += criterion(logits, labels).item()
                pred = (torch.sigmoid(logits.float()) > 0.5).float()
                tp, fp, fn = confusion(pred.cpu().numpy(), labels.cpu().numpy())
                tp_sum += tp; fp_sum += fp; fn_sum += fn

        scheduler.step()
        train_loss /= max(len(train_loader), 1)
        val_loss /= max(len(val_loader), 1)
        val_dice = dice_from(tp_sum, fp_sum, fn_sum)
        val_recall = tp_sum / (tp_sum + fn_sum) if (tp_sum + fn_sum) else 1.0
        val_precision = tp_sum / (tp_sum + fp_sum) if (tp_sum + fp_sum) else 1.0

        record = {
            "epoch": epoch,
            "train_loss": round(train_loss, 5),
            "val_loss": round(val_loss, 5),
            "val_patch_dice": round(val_dice, 5),
            "val_recall": round(val_recall, 5),
            "val_precision": round(val_precision, 5),
            "lr": round(scheduler.get_last_lr()[0], 7),
        }

        # Overfitting watch: validation loss rising while training loss falls.
        if val_loss < best_val_loss - 1e-4:
            best_val_loss = val_loss
            rising = 0
        else:
            rising += 1

        elapsed = time.perf_counter() - epoch_start
        line = (f"{epoch:>6}  {train_loss:>7.4f}  {val_loss:>7.4f}  {val_dice:>6.4f}  "
                f"{val_recall:>6.4f}  {val_precision:>6.4f}  {elapsed:>4.0f}s")

        if val_dice > best_dice:
            best_dice = val_dice
            line += "  <- best"
            torch.save({
                "model": model.state_dict(),
                "config": {
                    "in_channels": 1,
                    "base_channels": args.base_channels,
                    "depth": args.depth,
                    "attention": args.attention,
                    "patch_size": list(patch),
                    # Calibration needs a held-out reliability curve; a training
                    # run never gets to claim it.
                    "calibrated": False,
                    "trained_on": "brats2024-glioma",
                    "pathology": "adult diffuse glioma (BraTS 2024, FLAIR)",
                    "not_tuberculosis": True,
                    "epochs": epoch,
                    "val_patch_dice": round(val_dice, 4),
                    "val_recall": round(val_recall, 4),
                    "test_cases": [c["case"] for c in test_cases],
                    "val_cases": [c["case"] for c in val_cases],
                    "train_case_count": len(train_cases),
                },
            }, args.out)

        if rising >= 3:
            line += f"  [val loss up {rising}x]"
        print(line)

        if args.full_val_every and (epoch % args.full_val_every == 0 or epoch == args.epochs):
            full = run_full_validation(args.full_val_cases)
            record["full_volume"] = {k: round(v, 4) if isinstance(v, float) else v
                                     for k, v in full.items()}
            print(f"        full-volume ({full['cases']} cases): dice {full['dice']:.4f}  "
                  f"lesion-sens {full['lesion_sensitivity']:.4f}  "
                  f"fp/case {full['false_components_per_case']:.2f}  "
                  f"prec {full['precision']:.4f}")

        history.append(record)
        args.out.with_suffix(".history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")

        if args.early_stop and rising >= args.early_stop:
            stop_reason = f"early stop: validation loss rose for {rising} consecutive epochs"
            print(f"\n{stop_reason}")
            break

        if args.time_budget_min and (time.perf_counter() - started) / 60 >= args.time_budget_min:
            stop_reason = f"time budget of {args.time_budget_min:.0f} min reached at epoch {epoch}"
            print(f"\n{stop_reason}")
            break

    total_min = (time.perf_counter() - started) / 60
    print(f"\n{stop_reason}. {total_min:.1f} min total.")
    print(f"Best patch-level validation Dice: {best_dice:.4f}")
    print(f"Checkpoint: {args.out}")
    print("\nPatch-level Dice is optimistic: patches are foreground-biased, so the model")
    print("is never asked to leave a whole brain of healthy tissue alone. Run")
    print("evaluate.py for held-out, whole-volume numbers.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
