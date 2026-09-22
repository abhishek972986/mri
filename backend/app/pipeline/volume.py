"""Volume container and NIfTI I/O.

Everything downstream of the loader speaks in `Volume`: a float32 array plus the
affine that maps voxel indices to scanner/world coordinates (RAS millimetres).
Keeping the affine attached is what lets us report lesion volumes in cm3 and
anatomical positions in mm rather than in voxels.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import nibabel as nib
import numpy as np


@dataclass
class Volume:
    data: np.ndarray
    affine: np.ndarray
    sequence: str = "unknown"

    @property
    def shape(self) -> tuple[int, ...]:
        return self.data.shape

    @property
    def spacing(self) -> np.ndarray:
        """Voxel size in mm along each axis, derived from the affine."""
        return np.linalg.norm(self.affine[:3, :3], axis=0)

    @property
    def voxel_volume_mm3(self) -> float:
        return float(np.prod(self.spacing))

    def with_data(self, data: np.ndarray) -> "Volume":
        return replace(self, data=data)

    def voxel_to_world(self, ijk: np.ndarray) -> np.ndarray:
        """Map voxel indices to world coordinates in mm. Always returns shape (N, 3)."""
        ijk = np.atleast_2d(np.asarray(ijk, dtype=np.float64))
        return ijk @ self.affine[:3, :3].T + self.affine[:3, 3]


def load_volume(path: str | Path, sequence: str = "unknown") -> Volume:
    """Load a NIfTI (.nii/.nii.gz) volume as float32.

    4D inputs (e.g. a DTI or multi-echo series) are collapsed to their first
    frame; a structural pipeline has nothing useful to do with the rest.
    """
    img = nib.load(str(path))
    data = np.asanyarray(img.dataobj, dtype=np.float32)
    while data.ndim > 3:
        data = data[..., 0]
    return Volume(data=data, affine=np.asarray(img.affine, dtype=np.float64), sequence=sequence)


def save_volume(vol: Volume, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    nib.save(nib.Nifti1Image(vol.data.astype(np.float32), vol.affine), str(path))
    return path


def save_mask(mask: np.ndarray, affine: np.ndarray, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    nib.save(nib.Nifti1Image(mask.astype(np.uint8), affine), str(path))
    return path
