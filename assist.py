"""Assistant hint levels (hint-only smartness ladder).

Each level selects a search depth/pruning preset and a scorer. Measured
strengths are filled in by ``train/bench.py`` results and shown to the player
(model names are never exposed).
"""

from __future__ import annotations

import numpy as np

import search
from dt_features import DT20
from paths import base_dir

TUNED_PATH = base_dir() / "tuned_weights.npz"


def tuned_weights():
    if TUNED_PATH.exists():
        return np.load(TUNED_PATH)["weights"].astype(np.float64)
    return DT20


LEVELS = {
    1: {"name": "基础", "depth": 3, "top_n": 5, "w_next": 0.75,
        "measured": "平均 1.92 万行 / 最差 2,499 行"},
    2: {"name": "进阶", "depth": 4, "top_n": 6, "w_next": 0.75,
        "measured": "平均 2.29 万行（8/8 满 5 万块）"},
    3: {"name": "大师", "depth": 4, "top_n": 8, "w_next": 0.75,
        "measured": "平均 4.58 万行（8/8 满 10 万块）"},
}

RESULTS = [
    {"name": "1-ply PPO（旧微操版）", "lines": "50-70", "note": "参考基线"},
    {"name": "2-ply 前瞻 DT-20", "lines": "682", "note": "8 局 × 5 万块上限"},
    {"name": "3-ply top10", "lines": "18,479", "note": "8 局 × 5 万块，5/8 满上限"},
    {"name": "L1 基础（3-ply top5）", "lines": "19,201", "note": "8 局 × 5 万块，6/8 满上限"},
    {"name": "L2 进阶（4-ply top6）", "lines": "22,882", "note": "8 局 × 5 万块，8/8 满上限"},
    {"name": "L3 大师（4-ply top8）", "lines": "45,767", "note": "8 局 × 10 万块，8/8 满上限"},
    {"name": "L3 百万级验证", "lines": "进行中", "note": "8 局 × 100 万块（后台）"},
]


def make_scorer(level: int):
    return search.dt_scorer(tuned_weights())


def hint(board, piece_idx, queue, level: int):
    """Return the recommended placement for the current piece."""
    cfg = LEVELS.get(int(level), LEVELS[1])
    return search.plan(
        board,
        piece_idx,
        make_scorer(level),
        next_pieces=tuple(queue),
        depth=cfg["depth"],
        top_n=cfg["top_n"],
        w_next=cfg["w_next"],
    )


def levels_payload():
    return [
        {"level": lv, "name": cfg["name"], "measured": cfg["measured"]}
        for lv, cfg in sorted(LEVELS.items())
    ]


def results_payload():
    return RESULTS
