#!/usr/bin/env python3
"""
Memory Save Script - Saves session data to daily log.

Called by the Opencode plugin (memory-capture.ts) to record sessions.
Reads session JSON from stdin and appends to daily log.

Usage:
    echo '{"session_json": ...}' | python memory_save.py
    python memory_save.py --file session.json
"""

import argparse
import json
import sys
import subprocess
from datetime import datetime
from pathlib import Path

# Add scripts directory to path to import sibling modules
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

PROJECT_ROOT = SCRIPTS_DIR.parent
DAILY_DIR = PROJECT_ROOT / "daily"
COMPILE_SCRIPT = SCRIPTS_DIR / "compile.py"

COMPILE_AFTER_HOUR = 18  # 6 PM


def load_session_from_stdin():
    """Load session JSON from stdin."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)


def load_session_from_file(filepath: Path):
    """Load session JSON from a file."""
    try:
        return json.loads(filepath.read_text())
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error: Could not read session file: {e}", file=sys.stderr)
        sys.exit(1)


def format_session_entry(session: dict) -> str:
    """Format session data as a daily log entry."""
    timestamp = datetime.now().strftime("%H:%M")
    session_id = session.get("id", "unknown")[:8]
    phase = session.get("phase", "session")
    
    messages = session.get("messages", [])
    
    # Extract context (first user message)
    context = "No context"
    if messages:
        first_user = next((m for m in messages if m.get("role") == "user"), None)
        if first_user:
            content = first_user.get("content", "")
            context = content[:200] + ("..." if len(content) > 200 else "")
    
    # Extract key exchanges (user + assistant pairs)
    exchanges = []
    for i in range(0, len(messages) - 1, 2):
        if i + 1 < len(messages):
            user_msg = messages[i]
            assistant_msg = messages[i + 1]
            if user_msg.get("role") == "user" and assistant_msg.get("role") == "assistant":
                user_content = user_msg.get("content", "")[:100]
                assistant_content = assistant_msg.get("content", "")[:150]
                exchanges.append(f"- Q: {user_content}... A: {assistant_content}...")
    
    # Tools used
    tools_used = session.get("toolsUsed", [])
    tools_str = ", ".join(tools_used) if tools_used else "None"
    
    # File changes
    file_changes = session.get("fileChanges", [])
    if file_changes:
        changes_str = ", ".join([f"{c.get('file', 'unknown')} ({c.get('operation', 'modified')})" for c in file_changes])
    else:
        changes_str = "None"
    
    entry = f"""
### Session ({timestamp}) - {session_id} ({phase})

**Context:** {context}

**Key Exchanges:**
{chr(10).join(exchanges) if exchanges else '- No significant exchanges'}

**Decisions Made:**
- (To be extracted during compile)

**Lessons Learned:**
- (To be extracted during compile)

**Tools Used:** {tools_str}

**File Changes:** {changes_str}
"""
    return entry


def save_to_daily_log(entry: str) -> Path:
    """Append entry to today's daily log."""
    today = datetime.now().strftime("%Y-%m-%d")
    daily_file = DAILY_DIR / f"{today}.md"
    
    DAILY_DIR.mkdir(exist_ok=True)
    
    if daily_file.exists():
        with open(daily_file, "a", encoding="utf-8") as f:
            f.write(entry)
    else:
        with open(daily_file, "w", encoding="utf-8") as f:
            f.write(f"# Daily Log: {today}\n\n## Sessions\n")
            f.write(entry)
    
    return daily_file


def maybe_trigger_compile():
    """Trigger compile if it's after 6 PM."""
    now = datetime.now()
    if now.hour >= COMPILE_AFTER_HOUR:
        print(f"Auto-compile triggered (after {COMPILE_AFTER_HOUR}:00)")
        try:
            subprocess.Popen(
                [sys.executable, str(COMPILE_SCRIPT)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True
            )
        except Exception as e:
            print(f"Warning: Could not trigger compile: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Save session to daily log")
    parser.add_argument("--file", type=Path, help="Path to session JSON file")
    args = parser.parse_args()
    
    # Load session data
    if args.file:
        session = load_session_from_file(args.file)
    else:
        session = load_session_from_stdin()
    
    # Format and save
    entry = format_session_entry(session)
    daily_file = save_to_daily_log(entry)
    print(f"Session saved to: {daily_file}")
    
    # Maybe trigger compile
    maybe_trigger_compile()


if __name__ == "__main__":
    main()