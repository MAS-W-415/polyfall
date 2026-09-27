# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec: build the single-file Polyfall executable."""

import os

datas = [("ui", "ui"), (".env", ".")]
if os.path.exists("weights.npz"):
    datas.append(("weights.npz", "."))

a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["torch", "torchvision", "torchaudio", "tkinter", "matplotlib"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="polyfall",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
