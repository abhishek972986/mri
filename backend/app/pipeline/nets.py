"""Segmentation network definitions.

PyTorch is an optional dependency: the API server runs without it and falls back
to the classical detector in `segmentation.py`. Import this module only from code
paths that have already checked `torch_available()`.

Two architectures are provided:

  UNet3D          - plain 3D U-Net, the workhorse for volumetric lesion segmentation.
  AttentionUNet3D - adds attention gates on the skip connections, which suppress
                    irrelevant background activations. This matters for TB, where
                    lesions are small and sparse relative to the whole brain.

Both are patch-based. On a 4 GB card (GTX 1650) use patch=(96, 96, 96) with
base_channels=16 and batch_size=1, or patch=(64, 64, 64) with base_channels=32.
"""

from __future__ import annotations


def torch_available() -> bool:
    try:
        import torch  # noqa: F401
        return True
    except ImportError:
        return False


if torch_available():
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class ConvBlock(nn.Module):
        """Two 3x3x3 convolutions with instance norm.

        InstanceNorm rather than BatchNorm because medical volumetric training
        runs at batch size 1-2, where batch statistics are worthless.
        """

        def __init__(self, in_ch: int, out_ch: int, dropout: float = 0.0):
            super().__init__()
            layers = [
                nn.Conv3d(in_ch, out_ch, 3, padding=1, bias=False),
                nn.InstanceNorm3d(out_ch, affine=True),
                nn.LeakyReLU(0.01, inplace=True),
            ]
            if dropout > 0:
                layers.append(nn.Dropout3d(dropout))
            layers += [
                nn.Conv3d(out_ch, out_ch, 3, padding=1, bias=False),
                nn.InstanceNorm3d(out_ch, affine=True),
                nn.LeakyReLU(0.01, inplace=True),
            ]
            self.block = nn.Sequential(*layers)

        def forward(self, x):
            return self.block(x)

    class AttentionGate(nn.Module):
        """Additive attention gate (Oktay et al., 2018).

        Gates the skip connection with the coarser decoder signal, so the decoder
        sees encoder features only where the deeper context says something is there.
        """

        def __init__(self, gate_ch: int, skip_ch: int, inter_ch: int):
            super().__init__()
            self.w_gate = nn.Conv3d(gate_ch, inter_ch, 1)
            self.w_skip = nn.Conv3d(skip_ch, inter_ch, 1)
            self.psi = nn.Conv3d(inter_ch, 1, 1)

        def forward(self, gate, skip):
            g = self.w_gate(gate)
            s = self.w_skip(skip)
            if g.shape[2:] != s.shape[2:]:
                g = F.interpolate(g, size=s.shape[2:], mode="trilinear", align_corners=False)
            attention = torch.sigmoid(self.psi(F.leaky_relu(g + s, 0.01)))
            return skip * attention

    class UNet3D(nn.Module):
        def __init__(
            self,
            in_channels: int = 1,
            out_channels: int = 1,
            base_channels: int = 16,
            depth: int = 4,
            dropout: float = 0.1,
            attention: bool = False,
        ):
            super().__init__()
            self.depth = depth
            self.attention = attention

            chans = [base_channels * (2 ** i) for i in range(depth + 1)]

            self.encoders = nn.ModuleList()
            prev = in_channels
            for i in range(depth):
                self.encoders.append(ConvBlock(prev, chans[i], dropout if i >= depth - 2 else 0.0))
                prev = chans[i]

            self.bottleneck = ConvBlock(prev, chans[depth], dropout)

            self.upsamples = nn.ModuleList()
            self.decoders = nn.ModuleList()
            self.gates = nn.ModuleList()
            for i in reversed(range(depth)):
                self.upsamples.append(nn.ConvTranspose3d(chans[i + 1], chans[i], 2, stride=2))
                self.decoders.append(ConvBlock(chans[i] * 2, chans[i]))
                self.gates.append(
                    AttentionGate(chans[i], chans[i], max(chans[i] // 2, 1)) if attention else nn.Identity()
                )

            self.head = nn.Conv3d(chans[0], out_channels, 1)
            self.pool = nn.MaxPool3d(2)

        def forward(self, x):
            skips = []
            for enc in self.encoders:
                x = enc(x)
                skips.append(x)
                x = self.pool(x)

            x = self.bottleneck(x)

            for i, (up, dec, gate) in enumerate(zip(self.upsamples, self.decoders, self.gates)):
                x = up(x)
                skip = skips[-(i + 1)]
                if x.shape[2:] != skip.shape[2:]:
                    x = F.interpolate(x, size=skip.shape[2:], mode="trilinear", align_corners=False)
                if self.attention:
                    skip = gate(x, skip)
                x = dec(torch.cat([x, skip], dim=1))

            return self.head(x)

    def AttentionUNet3D(**kwargs) -> UNet3D:
        kwargs["attention"] = True
        return UNet3D(**kwargs)

    class DiceBCELoss(nn.Module):
        """Soft Dice + BCE.

        Dice alone is unstable when a patch contains no lesion at all (common with
        sparse TB lesions); BCE keeps the gradient alive in those patches. The
        positive weight compensates for the extreme foreground/background imbalance.
        """

        def __init__(self, pos_weight: float = 10.0, dice_weight: float = 0.6, smooth: float = 1.0):
            super().__init__()
            self.dice_weight = dice_weight
            self.smooth = smooth
            self.register_buffer("pos_weight", torch.tensor(pos_weight))

        def forward(self, logits, target):
            bce = F.binary_cross_entropy_with_logits(logits, target, pos_weight=self.pos_weight)

            probs = torch.sigmoid(logits)
            dims = tuple(range(2, probs.ndim))
            intersection = (probs * target).sum(dims)
            denom = probs.sum(dims) + target.sum(dims)
            dice = 1.0 - ((2 * intersection + self.smooth) / (denom + self.smooth)).mean()

            return self.dice_weight * dice + (1 - self.dice_weight) * bce

else:  # pragma: no cover - exercised only in torch-free installs
    UNet3D = None
    AttentionUNet3D = None
    DiceBCELoss = None
