"""Resolve bundled resource paths (works from source and PyInstaller one-file)."""

from __future__ import annotations

import sys
from pathlib import Path


def base_dir() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent
