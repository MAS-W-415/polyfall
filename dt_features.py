"""Dellacherie-Thiery features and the published DT-10 / DT-20 weight sets.

Feature order:
    landing_height, eroded, row_trans, col_trans, holes, wells,
    hole_depth, rows_with_holes, diversity

Weights follow Chen et al. 2026 (Table 2), which in turn cites
Gabillon et al. 2013 / Scherrer et al. 2015.
"""

from __future__ import annotations

import numpy as np

from engine import HEIGHT, WIDTH

FEATURE_NAMES = (
    "landing_height",
    "eroded",
    "row_trans",
    "col_trans",
    "holes",
    "wells",
    "hole_depth",
    "rows_with_holes",
    "diversity",
)

DT10 = np.array([-2.18, 2.42, -2.17, -3.31, 0.95, -2.22, -0.81, -9.65, 1.27])
DT20 = np.array([-2.68, 1.38, -2.41, -6.32, 2.03, -2.71, -0.43, -9.48, 0.89])


def features(board_before, placement):
    """Compute the 9 DT features for a placement result (vectorized)."""
    rows = [r for r, _ in placement["cells"]]
    bottom, top = max(rows), min(rows)
    landing_height = float((HEIGHT - 1 - bottom) + (bottom - top) / 2.0)

    placed = board_before.copy()
    for r, c in placement["cells"]:
        placed[r, c] = 1
    full = np.all(placed > 0, axis=1)
    piece_cells_cleared = sum(1 for r in rows if full[r])
    eroded = float(placement["lines"] * piece_cells_cleared)

    after = placement["after"] > 0

    row_pad = np.pad(after, ((0, 0), (1, 1)), constant_values=True)
    row_trans = int(np.sum(row_pad[:, 1:] != row_pad[:, :-1]))
    col_pad = np.pad(after, ((1, 1), (0, 0)), constant_values=True)
    col_trans = int(np.sum(col_pad[1:] != col_pad[:-1]))

    above = np.zeros_like(after)
    above[1:] = np.cumsum(after, axis=0)[:-1] > 0
    hole_mask = (~after) & above
    holes = int(hole_mask.sum())
    rows_with_holes = int(hole_mask.any(axis=1).sum())

    run = np.zeros(WIDTH, dtype=np.int64)
    hole_depth = 0
    for r in range(HEIGHT):
        run = np.where(after[r], 0, run + 1)
        hole_depth += int(run[hole_mask[r]].sum())

    left = np.ones_like(after)
    left[:, 1:] = after[:, :-1]
    right = np.ones_like(after)
    right[:, :-1] = after[:, 1:]
    wells = int(np.sum((~after) & left & right))

    any_col = after.any(axis=0)
    heights = np.where(any_col, HEIGHT - after.argmax(axis=0), 0)
    diffs = np.clip(np.diff(heights), -2, 2)
    diversity = len({int(d) for d in diffs})

    return np.array(
        [landing_height, eroded, row_trans, col_trans, holes, wells,
         hole_depth, rows_with_holes, diversity],
        dtype=np.float64,
    )


def features_batch(board, placements_list):
    """Batched version of :func:`features` for many placements on one board.

    Returns an (K, 9) array. Equivalent to calling ``features`` in a loop but
    vectorized across placements, which is what the lookahead search needs.
    """
    k = len(placements_list)
    if k == 0:
        return np.zeros((0, 9), dtype=np.float64)

    after = np.stack([p["after"] for p in placements_list]).astype(np.int8)
    filled = after > 0

    missing = (board == 0).sum(axis=1)
    landing = np.empty(k, dtype=np.float64)
    eroded = np.empty(k, dtype=np.float64)
    for i, p in enumerate(placements_list):
        rows = [r for r, _ in p["cells"]]
        bottom, top = max(rows), min(rows)
        landing[i] = (HEIGHT - 1 - bottom) + (bottom - top) / 2.0
        counts = {}
        for r in rows:
            counts[r] = counts.get(r, 0) + 1
        cleared = sum(c for r, c in counts.items() if missing[r] == c)
        eroded[i] = p["lines"] * cleared

    return _feature_rows(filled, landing, eroded)


def features_batch_multi(boards, pls_lists):
    """Batched features for many boards, each with its own placements.

    Returns a list of (Ki, 9) arrays, one per input board.
    """
    lengths = [len(pls) for pls in pls_lists]
    if sum(lengths) == 0:
        return [np.zeros((0, 9), dtype=np.float64) for _ in pls_lists]

    flat = [p for pls in pls_lists for p in pls]
    after = np.stack([p["after"] for p in flat]).astype(np.int8)
    filled = after > 0

    landing = np.empty(len(flat), dtype=np.float64)
    eroded = np.empty(len(flat), dtype=np.float64)
    missing_cache = [(b == 0).sum(axis=1) for b in boards]
    pos = 0
    for bi, pls in enumerate(pls_lists):
        missing = missing_cache[bi]
        for p in pls:
            rows = [r for r, _ in p["cells"]]
            bottom, top = max(rows), min(rows)
            landing[pos] = (HEIGHT - 1 - bottom) + (bottom - top) / 2.0
            counts = {}
            for r in rows:
                counts[r] = counts.get(r, 0) + 1
            cleared = sum(c for r, c in counts.items() if missing[r] == c)
            eroded[pos] = p["lines"] * cleared
            pos += 1

    features = _feature_rows(filled, landing, eroded)
    out, start = [], 0
    for n in lengths:
        out.append(features[start:start + n])
        start += n
    return out


def _feature_rows(filled, landing, eroded):
    """Shared vectorized board features for a stack of boards."""
    k, height, width = filled.shape
    row_pad = np.ones((k, height, width + 2), dtype=bool)
    row_pad[:, :, 1:-1] = filled
    row_trans = (row_pad[:, :, 1:] != row_pad[:, :, :-1]).sum(axis=(1, 2))

    col_pad = np.ones((k, height + 2, width), dtype=bool)
    col_pad[:, 1:-1, :] = filled
    col_trans = (col_pad[:, 1:, :] != col_pad[:, :-1, :]).sum(axis=(1, 2))

    above = np.zeros_like(filled)
    above[:, 1:, :] = np.cumsum(filled, axis=1)[:, :-1, :] > 0
    hole_mask = (~filled) & above
    holes = hole_mask.sum(axis=(1, 2))
    rows_with_holes = hole_mask.any(axis=2).sum(axis=1)

    run = np.zeros((k, width), dtype=np.int64)
    hole_depth = np.zeros(k, dtype=np.int64)
    for r in range(height):
        run = np.where(filled[:, r, :], 0, run + 1)
        hole_depth += (run * hole_mask[:, r, :]).sum(axis=1)

    left = np.ones_like(filled)
    left[:, :, 1:] = filled[:, :, :-1]
    right = np.ones_like(filled)
    right[:, :, :-1] = filled[:, :, 1:]
    wells = ((~filled) & left & right).sum(axis=(1, 2))

    any_col = filled.any(axis=1)
    heights = np.where(any_col, height - filled.argmax(axis=1), 0)
    diffs = np.clip(np.diff(heights, axis=1), -2, 2)
    diversity = np.array([len(np.unique(row)) for row in diffs])

    return np.stack(
        [landing, eroded, row_trans, col_trans, holes, wells,
         hole_depth, rows_with_holes, diversity],
        axis=1,
    ).astype(np.float64)


def dt_score(board, placement, weights=DT20):
    return float(np.dot(weights, features(board, placement)))


def make_dt_score(weights=DT20):
    def score(board, placement):
        return dt_score(board, placement, weights)

    return score
