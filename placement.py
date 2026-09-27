"""Placement enumeration and afterstate computation.

A "placement" is one legal (rotation, column) choice for a piece on a given
board. These helpers work directly on board arrays so training can run without
an engine object, and they mirror the engine's rules exactly.
"""

from __future__ import annotations

import numpy as np

from engine import HEIGHT, WIDTH
from pieces import N_PIECES, PIECES


def clear_lines(board):
    full = np.all(board > 0, axis=1)
    n = int(full.sum())
    if n:
        keep = board[~full]
        board = np.vstack([np.zeros((n, WIDTH), dtype=board.dtype), keep])
    return board, n


def collides(board, shape, x, y):
    for r, c in shape:
        rr, cc = y + r, x + c
        if rr < 0 or rr >= HEIGHT or cc < 0 or cc >= WIDTH:
            return True
        if board[rr, cc]:
            return True
    return False


def placements(board, piece_idx):
    """Yield every valid placement of a piece on the board.

    Each item is a dict with:
      rot   - rotation index
      x     - leftmost column
      y     - landing row (top-left of the piece bounding box)
      cells - absolute (row, col) cells of the placed piece (pre-clear)
      lines - number of lines cleared by the placement
      after - board after placing and clearing lines
    """
    for rot, shape in enumerate(PIECES[piece_idx].rotations):
        w = max(c for _, c in shape) + 1
        for x in range(0, WIDTH - w + 1):
            if collides(board, shape, x, 0):
                continue
            y = 0
            while not collides(board, shape, x, y + 1):
                y += 1
            cells = [(y + r, x + c) for r, c in shape]
            new_board = board.copy()
            for r, c in cells:
                new_board[r, c] = piece_idx + 1
            after, lines = clear_lines(new_board)
            yield {
                "rot": rot,
                "x": x,
                "y": y,
                "cells": cells,
                "lines": lines,
                "after": after,
            }


def best_placement(board, piece_idx, score):
    """Return (best_score, best_placement) using ``score(board, placement)``."""
    best = None
    best_s = -np.inf
    for p in placements(board, piece_idx):
        s = score(board, p)
        if s > best_s:
            best_s = s
            best = p
    return best_s, best


def piece_scores(board, score, piece_ids=None):
    """Best placement score for each piece type.

    Unplaceable pieces get ``-inf``. ``score(board, placement) -> float``
    decides how good a placement is (higher is better).
    """
    ids = range(N_PIECES) if piece_ids is None else piece_ids
    out = np.full(N_PIECES, -np.inf)
    for idx in ids:
        for p in placements(board, idx):
            s = score(board, p)
            if s > out[idx]:
                out[idx] = s
    return out


def hardest_piece(board, score, placeable_only=True):
    """HATETRIS rule: the hardest piece is the one whose *best* placement is worst.

    Returns (piece_index, per_piece_scores).
    """
    scores = piece_scores(board, score)
    usable = scores[np.isfinite(scores)]
    if usable.size == 0:
        return None, scores
    if placeable_only:
        candidates = np.where(np.isfinite(scores))[0]
    else:
        candidates = np.arange(N_PIECES)
    hardest = int(candidates[np.argmin(scores[candidates])])
    return hardest, scores
