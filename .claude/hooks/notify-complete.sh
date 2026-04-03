#!/bin/bash
# Fires on Claude Code Stop event.
# Reads the transcript to find the last assistant text message,
# shows a macOS notification, and speaks the summary aloud.

INPUT=$(cat)

TRANSCRIPT_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('transcript_path', ''))
except:
    print('')
" 2>/dev/null)

SUMMARY=""

if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  SUMMARY=$(tail -30 "$TRANSCRIPT_PATH" | python3 -c "
import sys, json, re
last = ''
summary_line = ''
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
        if d.get('role') == 'assistant':
            content = d.get('content', '')
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'text':
                        text = block.get('text', '').strip()
                        if text:
                            last = text
                            # Check for Summary: prefix
                            m = re.search(r'Summary:\s*(.+)', text)
                            if m:
                                summary_line = m.group(1).strip()
                            break
            elif isinstance(content, str) and content.strip():
                last = content.strip()
                m = re.search(r'Summary:\s*(.+)', last)
                if m:
                    summary_line = m.group(1).strip()
    except:
        pass
# Prefer explicit Summary: line, fall back to last message
result = summary_line if summary_line else last
print(result[:200])
" 2>/dev/null)
fi

if [ -z "$SUMMARY" ]; then
  SUMMARY="Task complete"
fi

# Strip markdown for cleaner speech (remove **, __, #, backticks)
SPOKEN=$(echo "$SUMMARY" | sed 's/\*\*//g; s/__//g; s/##*//g; s/`//g' | tr -s ' ')

# macOS notification (escape double quotes for AppleScript)
NOTIF_TEXT=$(echo "$SPOKEN" | head -c 100 | sed 's/"/\\"/g')
osascript -e "display notification \"$NOTIF_TEXT\" with title \"Claude Code\" subtitle \"Agent complete\"" 2>/dev/null

# Speak it
say "$SPOKEN"
