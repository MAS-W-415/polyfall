"""Hardest-piece sampler: pick among the k hardest placements/pieces.

``scores`` are "best achievable scores" per piece (higher = easier). The
difficulty sampler treats the lowest scores as hardest and samples among the
top-k with a temperature so the game is not always the exact same piece.
"""

from __future__ import annotations

import numpy as np


def sample_hardest(scores, k=3, temp=0.15, rng=None):
    """Return the index of a hard piece (or None if nothing is placeable).

    temp -> 0   : always the single hardest piece (argmin)
    temp ~ 1    : nearly uniform among the k hardest
    """
    scores = np.asarray(scores, dtype=np.float64)
    valid = np.flatnonzero(np.isfinite(scores))
    if valid.size == 0:
        return None
    k = max(1, min(int(k), valid.size))
    hardest = valid[np.argsort(scores[valid])][:k]
    values = scores[hardest]
    spread = float(values.max() - values.min())
    if spread <= 1e-12 or temp <= 1e-12:
        weights = np.zeros(k)
        weights[0] = 1.0
    else:
        logits = -(values - values.min()) / (spread * temp)
        logits -= logits.max()
        weights = np.exp(logits)
        weights /= weights.sum()
    if rng is None:
        return int(hardest[int(np.argmax(weights))])
    return int(rng.choice(hardest, p=weights))
