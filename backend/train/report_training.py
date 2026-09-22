"""Summarise a training run: curves, best epoch, and an overfitting verdict.

    python backend/train/report_training.py

Reads the history written by `train_brats.py` and answers the only question the
curves are really being consulted for: did this run learn, and did it start
memorising?

The verdict is deliberately mechanical rather than a judgement call:

  overfitting      validation loss trending up while training loss trends down
  underfitting     both still falling clearly at the end - stopped too early
  plateaued        neither moving; more epochs at this learning rate will not help
  healthy          training loss down, validation loss down or flat

Trends are measured by comparing the mean of the last third of the run against
the mean of the middle third, which is far less jumpy than comparing the final
epoch against the first. Single-epoch validation loss on 37 patches is noisy
enough that a first-versus-last comparison flips sign on nothing.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parent.parent

# A trend smaller than this is treated as flat. Validation loss on a small patch
# sample wanders by a couple of percent between epochs for no reason.
FLAT = 0.01


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--history", type=Path,
                        default=BACKEND / "checkpoints" / "unet3d_brats.history.json")
    parser.add_argument("--full", action="store_true", help="Print every epoch, not a sample")
    return parser.parse_args()


def trend(values: list[float]) -> float:
    """Relative change from the middle third to the final third of the run."""
    if len(values) < 6:
        return 0.0
    third = len(values) // 3
    middle = float(np.mean(values[third:2 * third]))
    last = float(np.mean(values[2 * third:]))
    if abs(middle) < 1e-9:
        return 0.0
    return (last - middle) / abs(middle)


def sparkline(values: list[float]) -> str:
    """Low-to-high ramp, in ASCII.

    Deliberately not Unicode block characters: the Windows console runs cp1252
    by default and raises UnicodeEncodeError on them, which would take out the
    whole report over a decoration.
    """
    ramp = "._-=+*#@"
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        return ramp[0] * len(values)
    return "".join(ramp[int((v - lo) / (hi - lo) * (len(ramp) - 1))] for v in values)


def main() -> int:
    args = parse_args()

    if not args.history.exists():
        print(f"No history at {args.history}")
        return 1

    history = json.loads(args.history.read_text(encoding="utf-8"))
    if not history:
        print("History is empty.")
        return 1

    train = [r["train_loss"] for r in history]
    val = [r["val_loss"] for r in history]
    dice = [r["val_patch_dice"] for r in history]
    recall = [r.get("val_recall", 0.0) for r in history]
    precision = [r.get("val_precision", 0.0) for r in history]

    print(f"Run: {len(history)} epochs\n")
    print(f"{'epoch':>6}  {'train_loss':>11}  {'val_loss':>10}  {'val_dice':>9}  "
          f"{'recall':>8}  {'precision':>10}")
    print(f"{'-' * 6}  {'-' * 11}  {'-' * 10}  {'-' * 9}  {'-' * 8}  {'-' * 10}")

    # Print every epoch if asked, otherwise a readable sample plus the tail.
    if args.full or len(history) <= 24:
        shown = history
    else:
        step = max(len(history) // 16, 1)
        indices = sorted({*range(0, len(history), step), *range(len(history) - 5, len(history))})
        shown = [history[i] for i in indices if 0 <= i < len(history)]

    best_dice_epoch = max(history, key=lambda r: r["val_patch_dice"])["epoch"]
    best_loss_epoch = min(history, key=lambda r: r["val_loss"])["epoch"]

    for r in shown:
        marks = ""
        if r["epoch"] == best_dice_epoch:
            marks += "  <- best dice"
        if r["epoch"] == best_loss_epoch:
            marks += "  <- lowest val loss"
        print(f"{r['epoch']:>6}  {r['train_loss']:>11.4f}  {r['val_loss']:>10.4f}  "
              f"{r['val_patch_dice']:>9.4f}  {r.get('val_recall', 0):>8.4f}  "
              f"{r.get('val_precision', 0):>10.4f}{marks}")

    print(f"\n  train loss  {sparkline(train)}  {train[0]:.4f} -> {train[-1]:.4f}")
    print(f"  val loss    {sparkline(val)}  {val[0]:.4f} -> {val[-1]:.4f}")
    print(f"  val dice    {sparkline(dice)}  {dice[0]:.4f} -> {dice[-1]:.4f}")

    train_trend = trend(train)
    val_trend = trend(val)
    dice_trend = trend(dice)

    print(f"\n  Trends (final third vs middle third):")
    print(f"    train loss  {train_trend * 100:+6.1f}%")
    print(f"    val loss    {val_trend * 100:+6.1f}%")
    print(f"    val dice    {dice_trend * 100:+6.1f}%")

    if len(history) < 6:
        verdict = "TOO EARLY - fewer than 6 epochs, no trend to read"
        advice = "Let the run finish before drawing any conclusion from the curves."
    elif train_trend < -FLAT and val_trend > FLAT:
        verdict = "OVERFITTING - training loss falling while validation loss rises"
        advice = ("Use the best-Dice checkpoint, not the last one. More data, stronger "
                  "augmentation or an earlier stop would all help.")
    elif train_trend < -FLAT and val_trend < -FLAT:
        verdict = "UNDERFIT / still improving - both losses still falling at the end"
        advice = "The run was stopped early. More epochs should still gain."
    elif abs(train_trend) <= FLAT and abs(val_trend) <= FLAT:
        verdict = "PLATEAUED - neither loss is moving"
        advice = "More epochs at this learning rate will not help; change the schedule or capacity."
    elif val_trend <= FLAT and dice_trend >= -FLAT:
        verdict = "HEALTHY - training loss down, validation stable or improving"
        advice = "No sign of memorisation. The best checkpoint is a fair one to report."
    else:
        verdict = "MIXED - no clean signal"
        advice = "Read the curves directly rather than trusting a one-line verdict."

    print(f"\n  Verdict: {verdict}")
    print(f"  {advice}")

    best = max(history, key=lambda r: r["val_patch_dice"])
    print(f"\n  Best epoch {best['epoch']}: "
          f"val patch Dice {best['val_patch_dice']:.4f}, "
          f"recall {best.get('val_recall', 0):.4f}, "
          f"precision {best.get('val_precision', 0):.4f}")

    full = [r for r in history if "full_volume" in r]
    if full:
        print(f"\n  Whole-volume validation checkpoints "
              f"(the honest view - includes all healthy tissue):")
        print(f"    {'epoch':>6}  {'dice':>7}  {'lesion sens':>12}  {'fp/case':>8}  {'precision':>10}")
        for r in full:
            f = r["full_volume"]
            print(f"    {r['epoch']:>6}  {f['dice']:>7.4f}  {f['lesion_sensitivity']:>12.4f}  "
                  f"{f['false_components_per_case']:>8.2f}  {f['precision']:>10.4f}")

    print("\n  Patch-level Dice is optimistic - patches are foreground-biased. "
          "Run evaluate.py --tune for the held-out numbers.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
