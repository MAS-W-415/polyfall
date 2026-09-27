"""Lookahead placement planner shared by assistant hints and benchmarks.

``plan`` evaluates every legal placement of the current piece and, for
depth >= 2, the best response for the upcoming queue pieces. Scorers are
pluggable (published DT weights, the trained numpy evaluator, ...) and expose
a batched ``multi`` call so all continuations are scored in a few vectorized
passes instead of hundreds of small ones.
"""

from __future__ import annotations

import numpy as np

from dt_features import DT20, features_batch_multi
from placement import placements as enumerate_placements

NEG_INF = -1e9


class BatchScorer:
    def __init__(self, compute_multi):
        self._compute_multi = compute_multi

    def __call__(self, board, pls):
        return self._compute_multi([board], [pls])[0]

    def multi(self, boards, pls_lists):
        return self._compute_multi(boards, pls_lists)


def dt_scorer(weights=DT20):
    def compute(boards, pls_lists):
        return [f @ weights for f in features_batch_multi(boards, pls_lists)]

    return BatchScorer(compute)


def evaluator_scorer(evaluator):
    def compute(boards, pls_lists):
        return [evaluator.forward(f)
                for f in features_batch_multi(boards, pls_lists)]

    return BatchScorer(compute)


def plan(board, piece_idx, scorer, next_pieces=(), depth=2, top_n=6,
         w_next=0.75):
    """Return (best_placement, score) for the current piece.

    depth 1: greedy on the immediate score.
    depth 2: blend of immediate score and the best continuation for the next
             queue piece.
    depth 3+: pruned continuation over several queue pieces.
    """
    pls = list(enumerate_placements(board, piece_idx))
    if not pls:
        return None, NEG_INF
    s1 = np.asarray(scorer(board, pls), dtype=np.float64)
    if depth <= 1 or not tuple(next_pieces):
        i = int(np.argmax(s1))
        return pls[i], float(s1[i])

    order = np.argsort(-s1)[:top_n]
    boards2 = [pls[i]["after"] for i in order]
    continuations = _continue_multi(
        boards2, tuple(next_pieces), scorer, depth, max(2, top_n // 2), w_next)
    best, best_s = None, NEG_INF
    for idx, i in enumerate(order):
        value = (1 - w_next) * s1[i] + w_next * continuations[idx]
        if value > best_s:
            best_s, best = value, pls[i]
    return best, float(best_s)


def _continue_multi(boards, next_pieces, scorer, depth, top_n, w_next):
    pls_lists = [list(enumerate_placements(b, next_pieces[0])) for b in boards]
    scores = scorer.multi(boards, pls_lists)
    if depth <= 2 or len(next_pieces) < 2:
        return [float(s.max()) if s.size else NEG_INF for s in scores]

    out = [NEG_INF] * len(boards)
    child_boards, child_pls, parent, parent_score = [], [], [], []
    for bi, (pls2, s2) in enumerate(zip(pls_lists, scores)):
        if s2.size == 0:
            continue
        order = np.argsort(-s2)[:top_n]
        for i in order:
            child_boards.append(pls2[i]["after"])
            child_pls.append(list(enumerate_placements(pls2[i]["after"],
                                                       next_pieces[1])))
            parent.append(bi)
            parent_score.append(float(s2[i]))
    if not child_boards:
        return out

    if depth <= 3 or len(next_pieces) < 3:
        child_scores = scorer.multi(child_boards, child_pls)
        values = [float(s.max()) if s.size else NEG_INF for s in child_scores]
    else:
        values = _continue_multi(child_boards, next_pieces[1:], scorer,
                                 depth - 1, max(2, top_n // 2), w_next)

    best = {}
    for bi, s2_value, child_value in zip(parent, parent_score, values):
        value = (1 - w_next) * s2_value + w_next * child_value
        if value > best.get(bi, NEG_INF):
            best[bi] = value
    for bi, value in best.items():
        out[bi] = value
    return out
