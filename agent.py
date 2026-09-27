"""Runtime AI for the game server.

Uses the trained evaluator if ``weights.npz`` exists (pure numpy, no torch),
otherwise falls back to the published DT-20 weights.
"""

from __future__ import annotations

import numpy as np

from dt_features import DT20, features, make_dt_score
from paths import base_dir
from placement import hardest_piece, piece_scores
from pieces import N_PIECES

WEIGHTS_PATH = base_dir() / "weights.npz"


class NumpyEvaluator:
    """Small MLP: 9 DT features -> scalar score (mirrors train/ppo_afterstate)."""

    def __init__(self, path=WEIGHTS_PATH):
        data = np.load(path)
        self.w1, self.b1 = data["w1"], data["b1"]
        self.w2, self.b2 = data["w2"], data["b2"]
        self.w3, self.b3 = data["w3"], data["b3"]

    def forward(self, x):
        h = np.tanh(x @ self.w1.T + self.b1)
        h = np.tanh(h @ self.w2.T + self.b2)
        return (h @ self.w3.T + self.b3).squeeze(-1)


def load_score():
    """Return score(board, placement) -> float (higher is better)."""
    if WEIGHTS_PATH.exists():
        evaluator = NumpyEvaluator()

        def score(board, placement):
            return float(evaluator.forward(features(board, placement)))

        return score
    return make_dt_score(DT20)


def panel_scores(board, score=None):
    """Best placement score for each of the 26 piece types."""
    return piece_scores(board, score or load_score())


def panel_hardest(board, score=None):
    """HATETRIS rule: returns (hardest_index, scores)."""
    return hardest_piece(board, score or load_score(), placeable_only=True)


def panel_fast(board, weights=None):
    """Fast 26-piece best-placement scores using batched features."""
    from dt_features import DT20, features_batch
    from placement import placements

    w = DT20 if weights is None else weights
    scores = np.full(N_PIECES, -np.inf)
    for idx in range(N_PIECES):
        pls = list(placements(board, idx))
        if pls:
            scores[idx] = float((features_batch(board, pls) @ w).max())
    return scores


def hardest_fast(board, weights=None):
    scores = panel_fast(board, weights)
    valid = np.flatnonzero(np.isfinite(scores))
    if valid.size == 0:
        return None, scores
    return int(valid[np.argmin(scores[valid])]), scores
