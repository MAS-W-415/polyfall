"""Local web server: 26-piece Tetris with a difficulty slider and AI hints.

The game loop runs in a background thread; the browser only renders state and
sends commands. Hints are computed asynchronously (instant 1-ply fallback plus
a precise lookahead), and gravity waits for the precise hint so the player
never misses it.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

import assist
from agent import hardest_fast
from difficulty import sample_hardest
from engine import TetrisEngine
from paths import base_dir
from pieces import N_PIECES, PIECES
from search import plan as search_plan

ROOT = base_dir()
UI_DIR = ROOT / "ui"

TICK = 1 / 30
GRAVITY_PERIOD = 0.55
DAS_DELAY = 0.16
DAS_PERIOD = 0.05
AI_APS_DEFAULT = 10.0
HINT_TIMEOUT = 1.5


class Game:
    def __init__(self, public=False):
        self.public = public
        self.lock = threading.Lock()
        self.rng = np.random.default_rng()

        self.player = "human"
        self.paused = True  # the start screen unpauses on "开始游戏"
        self.ai_aps = AI_APS_DEFAULT
        self.ai_level = 3
        self.speed_mode = "progressive"  # or "fixed"
        self.sampling_log = deque(maxlen=20)

        self.difficulty = 0.0
        self.sampler_k = 3
        self.sampler_temp = 0.15

        self.assist_enabled = False
        self.assist_level = 1
        self._hint_target = None
        self._hint_precise = False
        self._hint_jobs = deque()
        self._hint_cv = threading.Condition()

        self._scores = np.full(N_PIECES, np.nan)
        self._hardest = None

        self.engine = TetrisEngine(seed=int(self.rng.integers(1, 2**31)))
        self.engine.on_lock = self._on_lock
        self._seen_seq = self.engine.piece_seq

        self._ai_timer = 0.0
        self._ai_pending = None
        self._gravity_timer = 0.0
        self._gravity_wait = 0.0
        self._held: dict[str, float] = {}

        threading.Thread(target=self._hint_worker, daemon=True).start()
        self._refresh_panel()
        self._begin_piece()

    # ------------------------------------------------------------- scoring
    def _refresh_panel(self, board=None):
        board = self.engine.board if board is None else board
        self._hardest, self._scores = hardest_fast(board)

    def _on_lock(self, engine):
        self._hardest, self._scores = hardest_fast(engine.board)
        if self.difficulty > 0 and self._hardest is not None:
            roll = float(self.rng.random())
            injected = roll < self.difficulty
            pick = None
            if injected:
                pick = sample_hardest(self._scores, k=self.sampler_k,
                                      temp=self.sampler_temp, rng=self.rng)
                if pick is not None:
                    engine.set_next_piece(pick)
            self.sampling_log.appendleft({
                "piece": engine.piece_idx,
                "roll": round(roll, 3),
                "injected": injected,
                "picked": pick,
            })

    # --------------------------------------------------------------- hints
    def _hint_payload(self, piece, placement, precise):
        return {
            "piece": piece,
            "rot": placement["rot"],
            "x": placement["x"],
            "cells": [[int(r), int(c)] for r, c in placement["cells"]],
            "precise": precise,
        }

    def _begin_piece(self):
        engine = self.engine
        self._hint_target = None
        self._hint_precise = False
        self._gravity_timer = 0.0
        self._gravity_wait = 0.0
        if not self.assist_enabled or engine.piece_idx is None:
            return
        board = engine.board.copy()
        piece = engine.piece_idx
        queue = tuple(engine.queue)
        placement, _ = search_plan(
            board, piece, assist.make_scorer(self.assist_level),
            next_pieces=queue, depth=1)
        if placement is not None:
            self._hint_target = self._hint_payload(piece, placement, precise=False)
        with self._hint_cv:
            self._hint_jobs.append((engine.piece_seq, board, piece, queue,
                                    self.assist_level))
            self._hint_cv.notify()

    def _hint_worker(self):
        while True:
            with self._hint_cv:
                while not self._hint_jobs:
                    self._hint_cv.wait()
                seq, board, piece, queue, level = self._hint_jobs.popleft()
            try:
                placement, _ = assist.hint(board, piece, queue, level)
            except Exception:
                continue
            if placement is None:
                continue
            with self.lock:
                if seq == self.engine.piece_seq and self.assist_enabled:
                    self._hint_target = self._hint_payload(piece, placement, precise=True)
                    self._hint_precise = True

    # ------------------------------------------------------------ commands
    def level(self):
        if self.speed_mode == "fixed":
            return 1
        return min(10, 1 + self.engine.lines // 10)

    def gravity(self):
        if self.speed_mode == "fixed":
            return GRAVITY_PERIOD
        return max(0.20, GRAVITY_PERIOD - 0.04 * (self.level() - 1))

    def handle(self, cmd):
        with self.lock:
            action = cmd.get("cmd")
            if self.public and action in ("player", "sampler", "speed"):
                return
            if action == "restart":
                self._restart()
            elif action == "pause":
                value = cmd.get("value")
                self.paused = bool(value) if value is not None else not self.paused
            elif action == "speed_mode":
                self.speed_mode = str(cmd.get("value", "progressive"))
            elif action == "player":
                self.player = str(cmd.get("value", "human"))
                self._ai_pending = None
            elif action == "assist":
                self.assist_enabled = bool(cmd.get("enabled", False))
                if "level" in cmd:
                    self.assist_level = int(cmd["level"])
                self._hint_target = None
                self._hint_precise = False
                if self.assist_enabled:
                    self._begin_piece()
            elif action == "difficulty":
                value = float(cmd.get("value", 0.0))
                self.difficulty = min(1.0, max(0.0, value))
            elif action == "sampler":
                if "k" in cmd:
                    self.sampler_k = max(1, int(cmd["k"]))
                if "temp" in cmd:
                    self.sampler_temp = max(0.0, float(cmd["temp"]))
            elif action == "speed":
                self.ai_aps = float(cmd.get("value", AI_APS_DEFAULT))
            elif action in ("left", "right", "down"):
                self._held[action] = time.time() + DAS_DELAY
                self._apply_move(action)
            elif action == "release":
                self._held.pop(str(cmd.get("key", "")), None)
            elif action == "rotate":
                self.engine.rotate(bool(cmd.get("cw", True)))
            elif action == "hard_drop":
                self.engine.hard_drop()
            elif action == "hold":
                self.engine.hold()

    def _restart(self):
        self.engine = TetrisEngine(seed=int(self.rng.integers(1, 2**31)))
        self.engine.on_lock = self._on_lock
        self._ai_pending = None
        self.paused = False
        self._held.clear()
        self._refresh_panel()
        self._seen_seq = -1

    def _apply_move(self, key):
        if key == "left":
            self.engine.move(-1)
        elif key == "right":
            self.engine.move(1)
        elif key == "down":
            self.engine.soft_drop()

    # ---------------------------------------------------------------- loop
    def step(self, dt):
        with self.lock:
            engine = self.engine
            if engine.piece_seq != self._seen_seq:
                self._seen_seq = engine.piece_seq
                self._begin_piece()
            if self.paused or engine.game_over or engine.piece_idx is None:
                return
            if self.player == "human":
                self._human_step(dt)
            else:
                self._ai_step(dt)

    def _human_step(self, dt):
        now = time.time()
        for key, next_time in list(self._held.items()):
            moves = 0
            while now >= next_time and moves < 2:
                self._apply_move(key)
                next_time = max(next_time + DAS_PERIOD, now - DAS_PERIOD)
                moves += 1
            self._held[key] = next_time
        if self.assist_enabled and not self._hint_precise:
            self._gravity_wait += dt
            if self._gravity_wait < HINT_TIMEOUT:
                return
        self._gravity_timer += dt
        if self._gravity_timer >= self.gravity():
            self._gravity_timer = 0.0
            self.engine.soft_drop()

    def _ai_step(self, dt):
        pending = self._ai_pending
        if pending is not None and self.engine.piece_seq != pending["seq"]:
            pending = self._ai_pending = None
        if pending is None:
            placement, _ = assist.hint(self.engine.board, self.engine.piece_idx,
                                       tuple(self.engine.queue), self.ai_level)
            if placement is None:
                return
            self._ai_pending = {
                "seq": self.engine.piece_seq,
                "piece": self.engine.piece_idx,
                "rot": placement["rot"],
                "x": placement["x"],
            }
            self._ai_timer = 0.0
            return
        self._ai_timer += dt
        interval = 1.0 / max(1.0, self.ai_aps)
        while self._ai_timer >= interval and self._ai_pending is not None:
            self._ai_timer -= interval
            self._execute_ai_action()

    def _execute_ai_action(self):
        pending = self._ai_pending
        engine = self.engine
        if engine.piece_seq != pending["seq"]:
            self._ai_pending = None
            return
        if engine.rot != pending["rot"]:
            n = len(PIECES[engine.piece_idx].rotations)
            diff = (pending["rot"] - engine.rot) % n
            engine.rotate(clockwise=diff <= n // 2)
        elif engine.x != pending["x"]:
            if not engine.move(1 if pending["x"] > engine.x else -1):
                engine.hard_drop()
                self._ai_pending = None
        else:
            engine.hard_drop()
            self._ai_pending = None

    # ------------------------------------------------------------ snapshot
    def snapshot(self):
        with self.lock:
            state = self.engine.state()
            state.update({
                "paused": self.paused,
                "assist": {
                    "enabled": self.assist_enabled,
                    "level": self.assist_level,
                    "precise": self._hint_precise,
                    "target": self._hint_target,
                },
                "difficulty": self.difficulty,
                "preview_hidden": self.difficulty > 0,
                "level": self.level(),
                "gravity": round(self.gravity(), 3),
                "speed_mode": self.speed_mode,
                "last_clear": self.engine.last_clear,
                "names": [p.name for p in PIECES],
                "palette": [list(p.color) for p in PIECES],
                "shapes": [[list(cell) for cell in p.cells] for p in PIECES],
            })
            levels = assist.levels_payload()
            if self.public:
                state["levels"] = [{"level": lv["level"], "name": lv["name"]}
                                   for lv in levels]
                return state
            state.update({
                "scores": [
                    None if not np.isfinite(s) else round(float(s), 3)
                    for s in self._scores
                ],
                "hardest": self._hardest,
                "player": self.player,
                "ai_aps": self.ai_aps,
                "sampler": {"k": self.sampler_k, "temp": self.sampler_temp},
                "sampling_log": list(self.sampling_log),
                "levels": levels,
                "results": assist.results_payload(),
            })
            return state


class Handler(BaseHTTPRequestHandler):
    game: Game = None

    def log_message(self, *args):
        pass

    def _send(self, code, body: bytes, content_type: str):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, payload):
        self._send(200, json.dumps(payload).encode(), "application/json")

    def _send_file(self, path: Path, content_type: str):
        if not path.exists():
            self._send(404, b"not found", "text/plain")
            return
        self._send(200, path.read_bytes(), content_type)

    def do_GET(self):
        route = urlparse(self.path).path
        static = {
            "/": ("game.html", "text/html; charset=utf-8"),
            "/game.js": ("game.js", "text/javascript; charset=utf-8"),
            "/observer.js": ("observer.js", "text/javascript; charset=utf-8"),
            "/theme.js": ("theme.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/themes.css": ("themes.css", "text/css; charset=utf-8"),
        }
        if route == "/state":
            self._send_json(self.game.snapshot())
        elif route == "/observer":
            if self.game.public:
                self._send(404, b"not found", "text/plain")
            else:
                self._send_file(UI_DIR / "observer.html", "text/html; charset=utf-8")
        elif route in static:
            name, ctype = static[route]
            self._send_file(UI_DIR / name, ctype)
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        route = urlparse(self.path).path
        if route != "/control":
            self._send(404, b"not found", "text/plain")
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            cmd = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, b"bad json", "text/plain")
            return
        self.game.handle(cmd)
        self._send_json({"ok": True})


def run(port=8000, host="127.0.0.1", auto_open=True, public=False):
    game = Game(public=public)
    Handler.game = game

    def loop():
        last = time.time()
        while True:
            now = time.time()
            try:
                game.step(now - last)
            except Exception as exc:
                import traceback
                traceback.print_exc()
                print(f"game loop error: {exc}")
            last = now
            time.sleep(TICK)

    threading.Thread(target=loop, daemon=True).start()
    server = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    if public:
        print(f"Polyfall running at {url}  (Ctrl+C to stop)")
    else:
        print(f"Polyfall running at {url}  (observer: {url}observer)")
    if auto_open:
        threading.Timer(0.5, lambda: __import__("webbrowser").open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
