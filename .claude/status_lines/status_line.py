#!/usr/bin/env -S uv run
# /// script
# dependencies = []
# ///
"""
Status line script for Claude Code.

Reads JSON from stdin (session context), outputs a single coloured line:
  [branch-name] | last-prompt-preview

ANSI codes: branch in cyan, prompt preview in dim white.
Writes a log entry to .claude/logs/status_line.json.
"""

import json
import sys
import os
import subprocess
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(__file__)
LOG_PATH = os.path.join(SCRIPT_DIR, "..", "logs", "status_line.json")
LAST_PROMPT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "last_prompt.txt")

CYAN = "\033[36m"
DIM = "\033[2m"
RESET = "\033[0m"
PROMPT_MAX = 60


def _append_log(entry: dict) -> None:
    log_dir = os.path.dirname(LOG_PATH)
    os.makedirs(log_dir, exist_ok=True)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def _git_branch() -> str:
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return result.stdout.strip() or "detached"
    except Exception:
        return "unknown"


def _last_prompt() -> str:
    try:
        with open(LAST_PROMPT_PATH, "r") as f:
            text = f.read().strip()
        if len(text) > PROMPT_MAX:
            return text[:PROMPT_MAX] + "..."
        return text
    except Exception:
        return ""


def main() -> int:
    raw = sys.stdin.read()

    # Parse stdin — ignore errors
    try:
        _ = json.loads(raw)
    except Exception:
        pass

    branch = _git_branch()
    prompt_preview = _last_prompt()

    if prompt_preview:
        line = f"{CYAN}[{branch}]{RESET} | {DIM}{prompt_preview}{RESET}"
    else:
        line = f"{CYAN}[{branch}]{RESET}"

    print(line)

    _append_log({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "branch": branch,
        "prompt_preview": prompt_preview,
    })

    return 0


if __name__ == "__main__":
    sys.exit(main())
