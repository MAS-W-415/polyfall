"""Entry point for Polyfall.

Reads .env (if present) and starts the local server:
    uv run python run.py            # then open http://127.0.0.1:8000
    uv run python run.py --no-browser
"""

from __future__ import annotations

import argparse

from paths import base_dir

ROOT = base_dir()


def load_env():
    env = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def main():
    env = load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(env.get("PORT", 8000)))
    parser.add_argument("--host", type=str, default=env.get("HOST", "127.0.0.1"))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--public", action="store_true",
                        help="player-facing mode: hide the observer page and dev fields")
    args = parser.parse_args()

    auto_open = env.get("AUTO_OPEN", "true").lower() == "true"
    public = args.public or env.get("PUBLIC", "0").lower() in ("1", "true", "yes")
    from server import run

    run(port=args.port, host=args.host,
        auto_open=auto_open and not args.no_browser, public=public)


if __name__ == "__main__":
    main()
