#!/usr/bin/env -S uv run
# /// script
# dependencies = []
# ///
"""
Notification hook — logs Claude Code notification events.

Logs to: .claude/logs/notifications.json (one JSON object per line)
Always exits 0.
"""

import json
import sys
import os
from datetime import datetime, timezone

LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "logs", "notifications.json")


def _append_log(entry: dict) -> None:
    log_dir = os.path.dirname(LOG_PATH)
    os.makedirs(log_dir, exist_ok=True)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def main() -> int:
    raw = sys.stdin.read()

    try:
        data = json.loads(raw)
    except Exception:
        _append_log({"timestamp": datetime.now(timezone.utc).isoformat(), "parse_error": True})
        return 0

    message = data.get("message", "")

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": message,
    }
    _append_log(entry)
    return 0


if __name__ == "__main__":
    sys.exit(main())
