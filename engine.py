"""Lightweight 26-piece Tetris engine.

Shared by training, the AI evaluator and the local web server, so the rules
are identical everywhere. Board cells store ``piece_index + 1`` (0 = empty),
which doubles as a colour index for the UI.
"""

from __future__ import annotations

import numpy as np

from pieces import N_PIECES, PIECES

HEIGHT = 20
WIDTH = 10
QUEUE_SIZE = 3

LINE_SCORE = (0, 10, 40, 90, 160)  # 10 * n^2


class TetrisEngine:
    def __init__(self, seed=None):
        self.rng = np.random.default_rng(seed)
        self.on_lock = None  # optional callback(engine) run before spawning
        self.reset()

    # ------------------------------------------------------------------ setup
    def reset(self, seed=None):
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self.board = np.zeros((HEIGHT, WIDTH), dtype=np.int16)
        self.bag = []
        self.queue = [self._bag_draw() for _ in range(QUEUE_SIZE)]
        self.held = None
        self.can_hold = True
        self.lines = 0
        self.pieces = 0
        self.score = 0
        self.game_over = False
        self.piece_idx = None
        self.rot = 0
        self.x = 0
        self.y = 0
        self.piece_seq = 0
        self.clear_seq = 0
        self.last_clear = {"rows": [], "seq": 0}
        self._spawn()

    def _bag_draw(self):
        if not self.bag:
            self.bag = [int(v) for v in self.rng.permutation(N_PIECES)]
        return self.bag.pop()

    def set_next_piece(self, piece_idx):
        """Replace the next piece in the queue (used for hardest-piece mode)."""
        self.queue[0] = int(piece_idx)

    # ------------------------------------------------------------- geometry
    def _cells(self, piece_idx=None, rot=None):
        idx = self.piece_idx if piece_idx is None else piece_idx
        r = self.rot if rot is None else rot
        return PIECES[idx].rotations[r]

    def cells_at(self, piece_idx, rot, x, y):
        return [(y + r, x + c) for r, c in PIECES[piece_idx].rotations[rot]]

    def active_cells(self):
        if self.piece_idx is None:
            return []
        return self.cells_at(self.piece_idx, self.rot, self.x, self.y)

    def collides(self, piece_idx, rot, x, y):
        for r, c in PIECES[piece_idx].rotations[rot]:
            rr, cc = y + r, x + c
            if rr < 0 or rr >= HEIGHT or cc < 0 or cc >= WIDTH:
                return True
            if self.board[rr, cc]:
                return True
        return False

    def drop_row(self, piece_idx, rot, x):
        """Landing y for a piece dropped at column x, or None if it cannot spawn."""
        if self.collides(piece_idx, rot, x, 0):
            return None
        y = 0
        while not self.collides(piece_idx, rot, x, y + 1):
            y += 1
        return y

    def ghost_cells(self):
        if self.piece_idx is None or self.game_over:
            return []
        y = self.y
        while not self.collides(self.piece_idx, self.rot, self.x, y + 1):
            y += 1
        return [(y + r, self.x + c) for r, c in self._cells()]

    # ----------------------------------------------------------------- spawn
    def _spawn_piece(self, piece_idx):
        self.piece_idx = int(piece_idx)
        self.rot = 0
        self.piece_seq += 1
        width = max(c for _, c in self._cells()) + 1
        self.x = (WIDTH - width) // 2
        self.y = 0
        if self.collides(self.piece_idx, self.rot, self.x, self.y):
            self.game_over = True

    def _spawn(self):
        self._spawn_piece(self.queue.pop(0))
        self.queue.append(self._bag_draw())

    # --------------------------------------------------------------- actions
    def move(self, dx):
        if self.game_over or self.piece_idx is None:
            return False
        if not self.collides(self.piece_idx, self.rot, self.x + dx, self.y):
            self.x += dx
            return True
        return False

    def rotate(self, clockwise=True):
        if self.game_over or self.piece_idx is None:
            return False
        n = len(PIECES[self.piece_idx].rotations)
        new_rot = (self.rot + (1 if clockwise else -1)) % n
        for kick in (0, -1, 1, -2, 2):
            if not self.collides(self.piece_idx, new_rot, self.x + kick, self.y):
                self.rot = new_rot
                self.x += kick
                return True
        return False

    def soft_drop(self):
        """Move down one row; locks and returns False when blocked."""
        if self.game_over or self.piece_idx is None:
            return False
        if not self.collides(self.piece_idx, self.rot, self.x, self.y + 1):
            self.y += 1
            return True
        self._lock()
        return False

    tick = soft_drop

    def hard_drop(self):
        if self.game_over or self.piece_idx is None:
            return
        while not self.collides(self.piece_idx, self.rot, self.x, self.y + 1):
            self.y += 1
        self._lock()

    def apply_placement(self, rot, x):
        """Place the active piece at (rot, x) and lock it (used by AI)."""
        assert self.piece_idx is not None
        self.rot = rot % len(PIECES[self.piece_idx].rotations)
        self.x = x
        self.y = self.drop_row(self.piece_idx, self.rot, self.x)
        if self.y is None:  # unreachable in practice: placements are validated
            raise ValueError("invalid placement")
        self.hard_drop()

    def hold(self):
        if self.game_over or not self.can_hold or self.piece_idx is None:
            return False
        current = self.piece_idx
        if self.held is None:
            self.held = current
            self._spawn()
        else:
            self.held, swap = current, self.held
            self._spawn_piece(swap)
        self.can_hold = False
        return True

    # ------------------------------------------------------------ lock/clear
    def _clear_lines(self):
        full = np.all(self.board > 0, axis=1)
        rows = np.flatnonzero(full)
        n = int(rows.size)
        if n:
            keep = self.board[~full]
            self.board = np.vstack(
                [np.zeros((n, WIDTH), dtype=np.int16), keep]
            )
            self.clear_seq += 1
        self.last_clear = {"rows": [int(r) for r in rows], "seq": self.clear_seq}
        return n

    def _lock(self):
        idx = self.piece_idx
        for r, c in self.active_cells():
            self.board[r, c] = idx + 1
        n = self._clear_lines()
        self.lines += n
        self.score += LINE_SCORE[n]
        self.pieces += 1
        self.can_hold = True
        self.piece_idx = None
        if self.on_lock is not None:
            self.on_lock(self)
        self._spawn()

    # ----------------------------------------------------------------- state
    def state(self):
        return {
            "board": self.board.tolist(),
            "active": {
                "piece": self.piece_idx,
                "rot": self.rot,
                "cells": self.active_cells(),
            },
            "ghost": self.ghost_cells(),
            "queue": list(self.queue),
            "held": self.held,
            "can_hold": self.can_hold,
            "lines": self.lines,
            "pieces": self.pieces,
            "score": self.score,
            "game_over": self.game_over,
        }
