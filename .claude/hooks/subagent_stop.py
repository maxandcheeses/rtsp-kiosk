#!/usr/bin/env -S uv run
# /// script
# dependencies = []
# ///
"""
SubagentStop hook — shows a macOS notification when a subagent completes.

Always exits 0.
"""

import json
import sys
import os
import subprocess
from datetime import datetime, timezone


def main() -> int:
    raw = sys.stdin.read()

    try:
        data = json.loads(raw)
    except Exception:
        data = {}

    # Show macOS notification
    try:
        subprocess.run(
            [
                "osascript",
                "-e",
                'display notification "Subagent completed" with title "Claude Code" subtitle "Subagent done"',
            ],
            capture_output=True,
            timeout=5,
        )
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
