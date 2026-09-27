"""Piece definitions for the expanded 26-piece Tetris.

Rule set: edge-connected polyominoes of 3-5 cells that fit inside a 4x4 box.
Shapes are canonicalized up to rotation; reflections count as distinct pieces
(the same convention classic Tetris uses for S/Z and J/L).
"""

from __future__ import annotations

import colorsys
from dataclasses import dataclass

BOX = 4
CELL_COUNTS = (3, 4, 5)

_TETROMINOES = {
    "I": ((0, 0), (0, 1), (0, 2), (0, 3)),
    "O": ((0, 0), (0, 1), (1, 0), (1, 1)),
    "T": ((0, 1), (1, 0), (1, 1), (1, 2)),
    "S": ((0, 1), (0, 2), (1, 0), (1, 1)),
    "Z": ((0, 0), (0, 1), (1, 1), (1, 2)),
    "J": ((0, 0), (1, 0), (1, 1), (1, 2)),
    "L": ((0, 2), (1, 0), (1, 1), (1, 2)),
}

_PENTOMINOES = {
    "F": ((0, 1), (0, 2), (1, 0), (1, 1), (2, 1)),
    "I": ((0, 0), (0, 1), (0, 2), (0, 3), (0, 4)),
    "L": ((0, 0), (1, 0), (2, 0), (3, 0), (3, 1)),
    "N": ((0, 2), (0, 3), (1, 0), (1, 1), (1, 2)),
    "P": ((0, 0), (0, 1), (1, 0), (1, 1), (2, 0)),
    "T": ((0, 0), (0, 1), (0, 2), (1, 1), (2, 1)),
    "U": ((0, 0), (0, 2), (1, 0), (1, 1), (1, 2)),
    "V": ((0, 0), (1, 0), (2, 0), (2, 1), (2, 2)),
    "W": ((0, 0), (1, 0), (1, 1), (2, 1), (2, 2)),
    "X": ((0, 1), (1, 0), (1, 1), (1, 2), (2, 1)),
    "Y": ((0, 1), (1, 0), (1, 1), (2, 1), (3, 1)),
    "Z": ((0, 0), (0, 1), (1, 1), (2, 1), (2, 2)),
}

_CLASSIC_COLORS = {
    "I": (0, 240, 240),
    "O": (240, 240, 0),
    "T": (160, 0, 240),
    "S": (0, 240, 0),
    "Z": (240, 0, 0),
    "J": (0, 0, 240),
    "L": (240, 160, 0),
}


def _tight(cells):
    r0 = min(r for r, _ in cells)
    c0 = min(c for _, c in cells)
    return tuple(sorted((r - r0, c - c0) for r, c in cells))


def _rot90(cells):
    h = max(r for r, _ in cells) + 1
    return _tight([(c, h - 1 - r) for r, c in cells])


def _rotations(cells):
    out = []
    cur = _tight(cells)
    for _ in range(4):
        if cur not in out:
            out.append(cur)
        cur = _rot90(cur)
    return tuple(out)


def _dihedral(cells):
    out = []
    cur = _tight(cells)
    for _ in range(4):
        out.append(cur)
        cur = _rot90(cur)
    w = max(c for _, c in cur) + 1
    cur = _tight([(r, w - 1 - c) for r, c in cur])
    for _ in range(4):
        out.append(cur)
        cur = _rot90(cur)
    return out


def _canonical(cells):
    return min(_rotations(cells))


def _connected_subsets():
    idx = {(r, c): r * BOX + c for r in range(BOX) for c in range(BOX)}
    adj = {i: [] for i in idx.values()}
    for (r, c), i in idx.items():
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            j = idx.get((r + dr, c + dc))
            if j is not None:
                adj[i].append(j)

    for mask in range(1, 1 << (BOX * BOX)):
        start = (mask & -mask).bit_length() - 1
        seen = 1 << start
        stack = [start]
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if (mask >> v) & 1 and not (seen >> v) & 1:
                    seen |= 1 << v
                    stack.append(v)
        if seen != mask:
            continue
        yield tuple((i // BOX, i % BOX) for i in range(BOX * BOX) if (mask >> i) & 1)


def _match_free(cells, references):
    """Match a shape against reference shapes; returns (name, mirrored)."""
    for name, ref in references.items():
        if cells in _rotations(ref):
            return name, False
    for name, ref in references.items():
        if cells in _dihedral(ref):
            return name, True
    return None, False


def _name_for(cells):
    n = len(cells)
    canonical = _canonical(cells)
    if n == 3:
        if canonical in _rotations(((0, 0), (0, 1), (0, 2))):
            return "I3"
        return "L3"
    if n == 4:
        name, _ = _match_free(canonical, _TETROMINOES)
        if name is None:
            raise ValueError(f"unknown tetromino {canonical}")
        return name
    if n == 5:
        name, mirrored = _match_free(canonical, _PENTOMINOES)
        if name is None:
            raise ValueError(f"unknown pentomino {canonical}")
        return "5-" + name + ("'" if mirrored else "")
    raise ValueError(f"unsupported cell count {n}")


@dataclass(frozen=True)
class Piece:
    index: int
    name: str
    cells: tuple
    rotations: tuple
    color: tuple

    @property
    def height(self):
        return max(r for r, _ in self.cells) + 1

    @property
    def width(self):
        return max(c for _, c in self.cells) + 1


def _build_pieces():
    seen = {}
    for cells in _connected_subsets():
        n = len(cells)
        if n not in CELL_COUNTS:
            continue
        canonical = _canonical(cells)
        if canonical not in seen:
            seen[canonical] = n

    by_name = {}
    for canonical, n in seen.items():
        by_name[_name_for(canonical)] = canonical

    order = ["I3", "L3", "I", "O", "T", "S", "Z", "J", "L"]
    order += sorted(name for name in by_name if len(by_name[name]) == 5)
    missing = set(by_name) - set(order)
    if missing:
        raise ValueError(f"pieces missing from order: {missing}")
    extra = set(order) - set(by_name)
    if extra:
        raise ValueError(f"ordered pieces not generated: {extra}")

    pieces = []
    for i, name in enumerate(order):
        cells = by_name[name]
        if name in _CLASSIC_COLORS:
            color = _CLASSIC_COLORS[name]
        else:
            hue = (i * 0.61803398875) % 1.0
            r, g, b = colorsys.hsv_to_rgb(hue, 0.72, 0.95)
            color = (int(r * 255), int(g * 255), int(b * 255))
        pieces.append(Piece(index=i, name=name, cells=cells, rotations=_rotations(cells), color=color))
    return tuple(pieces)


PIECES = _build_pieces()
N_PIECES = len(PIECES)
NAME_TO_INDEX = {p.name: p.index for p in PIECES}
