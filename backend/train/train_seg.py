"""Train the 3D lesion segmentation model.

    python backend/train/train_seg.py --data data/training --epochs 200
    python backend/train/train_seg.py --synthetic 120 --epochs 40     # smoke test

Expected layout for real data -- one directory per case, NIfTI throughout:

    data/training/
        case001/
            image.nii.gz        any structural sequence; FLAIR or post-contrast T1
            label.nii.gz        binary lesion mask, same grid as image
            brain.nii.gz        optional; computed by the pipeline if absent
        case002/
            ...

Patch sampling is deliberately biased toward lesions (`--fg-ratio`). Tuberculomas
occupy well under 0.1% of brain volume, so uniformly sampled patches are almost
all pure background and the network converges to predicting zero everywhere -- a
model with 99.9% voxel accuracy and no clinical value.

Hardware note: the defaults (96-cubed patches, base_channels=16, batch 1) fit in
roughly 3.2 GB and are sized for a 4 GB card. Raise --base-channels to 32 only if
you have 8 GB or more.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.pipeline import preprocess, synth  # noqa: E402
from app.pipeline.volume import Volume, load_volume  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, help="Directory of case folders")
    parser.add_argument("--synthetic", type=int, default=0,
                        help="Train on N generated phantoms instead of real data")
    parser.add_argument("--out", type=Path, default=BACKEND / "checkpoints" / "unet3d.pt")

    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--patches-per-epoch", type=int, default=120)
    parser.add_argument("--patch", type=int, nargs=3, default=(96, 96, 96))
    parser.add_argument("--fg-ratio", type=float, default=0.7,
                        help="Fraction of patches centred on a lesion voxel")

    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--base-channels", type=int, default=16)
    parser.add_argument("--depth", type=int, default=4)
    parser.add_argument("--attention", action="store_true",
                        help="Attention gates on skip connections; helps with small sparse lesions")
    parser.add_argument("--pos-weight", type=float, default=10.0)

    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--amp", action="store_true", help="Mixed precision; roughly halves memory")
    return parser.parse_args()


# --- data ------------------------------------------------------------------

class Case:
    """One training case, preprocessed once and held in memory."""

    def __init__(self, image: np.ndarray, label: np.ndarray, brain: np.ndarray, name: str):
        self.image = image.astype(np.float32)
        self.label = label.astype(np.float32)
        self.brain = brain.astype(bool)
        self.name = name
        self.fg_voxels = np.argwhere(label > 0.5)

    @property
    def has_lesion(self) -> bool:
        return self.fg_voxels.shape[0] > 0


def load_real_cases(root: Path) -> list[Case]:
    cases = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        image_path = _first_existing(folder, ["image.nii.gz", "image.nii", "flair.nii.gz", "t1c.nii.gz"])
        label_path = _first_existing(folder, ["label.nii.gz", "label.nii", "mask.nii.gz", "seg.nii.gz"])
        if image_path is None or label_path is None:
            print(f"  skipping {folder.name}: needs both image and label")
            continue

        volume = load_volume(image_path)
        label_volume = load_volume(label_path)
        if label_volume.data.shape != volume.data.shape:
            print(f"  skipping {folder.name}: label shape {label_volume.data.shape} != image {volume.data.shape}")
            continue

        processed, brain = preprocess.preprocess(volume)

        # The label must follow the image through resampling, or every voxel of
        # supervision is offset from the anatomy it describes.
        from app.pipeline.registration import resample_like
        label_on_grid = resample_like(
            Volume(label_volume.data, label_volume.affine), processed, order=0
        ).data > 0.5

        cases.append(Case(processed.data, label_on_grid, brain, folder.name))
        print(f"  {folder.name}: {processed.data.shape}, {int(label_on_grid.sum())} lesion voxels")

    return cases


def make_synthetic_cases(count: int, seed: int) -> list[Case]:
    cases = []
    for i in range(count):
        phantom = synth.make_phantom(n_lesions=random.randint(2, 7), seed=seed + i)
        processed, brain = preprocess.preprocess(phantom.volume)

        from scipy import ndimage
        zoom = [a / b for a, b in zip(processed.data.shape, phantom.lesion_mask.shape)]
        label = ndimage.zoom(phantom.lesion_mask.astype(np.float32), zoom, order=0) > 0.5

        cases.append(Case(processed.data, label, brain, f"synthetic{i:03d}"))
        if (i + 1) % 10 == 0:
            print(f"  generated {i + 1}/{count}")
    return cases


def _first_existing(folder: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = folder / name
        if candidate.exists():
            return candidate
    return None


def sample_patch(case: Case, patch: tuple[int, int, int], force_fg: bool, rng: random.Random):
    """Extract one patch, centred on a lesion voxel when `force_fg`."""
    shape = case.image.shape

    if force_fg and case.has_lesion:
        centre = case.fg_voxels[rng.randrange(case.fg_voxels.shape[0])]
        # Jitter so the lesion is not always dead-centre; a model trained on
        # perfectly centred lesions learns position, not appearance.
        centre = [
            int(c + rng.randint(-p // 4, p // 4)) for c, p in zip(centre, patch)
        ]
    else:
        centre = [rng.randrange(s) for s in shape]

    starts = [
        int(np.clip(c - p // 2, 0, max(s - p, 0)))
        for c, p, s in zip(centre, patch, shape)
    ]
    slicer = tuple(slice(s, s + p) for s, p in zip(starts, patch))

    image = np.zeros(patch, dtype=np.float32)
    label = np.zeros(patch, dtype=np.float32)
    chunk_image = case.image[slicer]
    chunk_label = case.label[slicer]
    region = tuple(slice(0, d) for d in chunk_image.shape)
    image[region] = chunk_image
    label[region] = chunk_label

    return augment(image, label, rng)


def augment(image: np.ndarray, label: np.ndarray, rng: random.Random):
    """Flips, 90-degree rotations, and intensity jitter.

    Only rigid, label-preserving transforms: an elastic warp would change the
    lesion volume, which is the quantity the whole system reports.
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
    return np.ascontiguousarray(image), np.ascontiguousarray(label)


# --- metrics ---------------------------------------------------------------

def dice_score(pred: np.ndarray, target: np.ndarray, eps: float = 1e-6) -> float:
    intersection = float((pred * target).sum())
    total = float(pred.sum() + target.sum())
    if total < eps:
        return 1.0                      # both empty: a correct negative
    return 2.0 * intersection / total


def main() -> int:
    args = parse_args()

    try:
        import torch
        from torch.utils.data import DataLoader, Dataset
    except ImportError:
        print(
            "PyTorch is not installed. Install the build matching your CUDA version:\n"
            "  pip install torch --index-url https://download.pytorch.org/whl/cu121\n"
            "The API runs without it, using the classical fallback detector."
        )
        return 1

    from app.pipeline.nets import DiceBCELoss, UNet3D

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    if args.synthetic:
        print(f"Generating {args.synthetic} synthetic cases?")
        cases = make_synthetic_cases(args.synthetic, args.seed)
        print(
            "\nWARNING: a model trained only on phantoms has learned phantom geometry, "
            "not tuberculoma appearance. Use it to validate the training loop, never "
            "to make a claim about accuracy.\n"
        )
    elif args.data:
        print(f"Loading cases from {args.data}?")
        cases = load_real_cases(args.data)
    else:
        print("Pass --data <dir> or --synthetic <n>.")
        return 1

    if len(cases) < 2:
        print(f"Need at least 2 cases, found {len(cases)}.")
        return 1

    random.shuffle(cases)
    n_val = max(1, int(len(cases) * args.val_split))
    val_cases, train_cases = cases[:n_val], cases[n_val:]
    print(f"{len(train_cases)} training / {len(val_cases)} validation cases")

    patch = tuple(args.patch)

    class PatchDataset(Dataset):
        def __init__(self, source, length, fg_ratio):
            self.source = source
            self.length = length
            self.fg_ratio = fg_ratio
            self.rng = random.Random(args.seed)

        def __len__(self):
            return self.length

        def __getitem__(self, index):
            case = self.source[self.rng.randrange(len(self.source))]
            force_fg = self.rng.random() < self.fg_ratio
            image, label = sample_patch(case, patch, force_fg, self.rng)
            return torch.from_numpy(image)[None], torch.from_numpy(label)[None]

    train_loader = DataLoader(
        PatchDataset(train_cases, args.patches_per_epoch, args.fg_ratio),
        batch_size=args.batch_size, num_workers=0,
    )
    val_loader = DataLoader(
        PatchDataset(val_cases, max(args.patches_per_epoch // 4, 8), 0.5),
        batch_size=args.batch_size, num_workers=0,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else ""))

    model = UNet3D(
        in_channels=1, out_channels=1,
        base_channels=args.base_channels, depth=args.depth, attention=args.attention,
    ).to(device)
    params = sum(p.numel() for p in model.parameters())
    print(f"Model: {'Attention ' if args.attention else ''}UNet3D, {params / 1e6:.2f}M parameters")

    criterion = DiceBCELoss(pos_weight=args.pos_weight).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    scaler = torch.amp.GradScaler("cuda", enabled=args.amp and device.type == "cuda")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    best_dice = -1.0
    history = []

    for epoch in range(1, args.epochs + 1):
        started = time.perf_counter()
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
        dices = []
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(device), labels.to(device)
                logits = model(images)
                val_loss += criterion(logits, labels).item()
                pred = (torch.sigmoid(logits) > 0.5).float()
                dices.append(dice_score(pred.cpu().numpy(), labels.cpu().numpy()))

        scheduler.step()
        train_loss /= max(len(train_loader), 1)
        val_loss /= max(len(val_loader), 1)
        val_dice = float(np.mean(dices)) if dices else 0.0
        history.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss, "val_dice": val_dice})

        marker = ""
        if val_dice > best_dice:
            best_dice = val_dice
            marker = "  <- best, saved"
            torch.save({
                "model": model.state_dict(),
                "config": {
                    "in_channels": 1,
                    "base_channels": args.base_channels,
                    "depth": args.depth,
                    "attention": args.attention,
                    "patch_size": list(patch),
                    # Never claim calibration from a training run. It requires a
                    # held-out set and a reliability curve, which this is not.
                    "calibrated": False,
                    "trained_on": "synthetic-phantoms" if args.synthetic else str(args.data),
                    "epochs": epoch,
                    "val_dice": round(val_dice, 4),
                },
            }, args.out)

        print(
            f"epoch {epoch:3d}/{args.epochs}  train {train_loss:.4f}  val {val_loss:.4f}  "
            f"dice {val_dice:.4f}  {time.perf_counter() - started:.1f}s{marker}"
        )

    args.out.with_suffix(".history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"\nBest validation Dice: {best_dice:.4f}")
    print(f"Checkpoint: {args.out}")
    print(f"\nTo use it:  set NEUROTB_MODEL_CHECKPOINT={args.out} and restart the API.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
