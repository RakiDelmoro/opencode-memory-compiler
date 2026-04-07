"""
Memory flush — extracts important knowledge from a conversation transcript.

Can be called standalone or by the extraction plugin. Uses the OpenCode REST
API to run an extraction agent session that reads the transcript and writes
knowledge articles.

Usage:
    uv run python flush.py <session_id>
    uv run python flush.py --file <transcript.json>
    uv run python flush.py --text "conversation text here"
"""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from config import (
    DAILY_SUMMARY_DIR,
    KNOWLEDGE_DIR,
    LOGS_DIR,
    OPENCODE_API_BASE,
    ROOT_DIR,
    SCRIPTS_DIR,
    STATE_FILE,
    TRANSCRIPT_DIR,
    now_iso,
    today_iso,
)
from utils import (
    append_to_master_log,
    ensure_daily_log,
    file_hash,
    load_flush_state,
    load_state,
    save_flush_state,
    save_state,
)

logging.basicConfig(
    filename=str(SCRIPTS_DIR / "flush.log"),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M",
)

COMPILE_AFTER_HOUR = 18  # 6 PM local time


def extract_transcript_from_session(session_id: str) -> str:
    """Export a session transcript via `opencode export`."""
    try:
        result = subprocess.run(
            ["opencode", "export", session_id],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            return result.stdout
    except Exception as e:
        logging.error("Failed to export session %s: %s", session_id, e)
    return ""


def extract_transcript_from_file(file_path: Path) -> str:
    """Read a transcript file (JSON or JSONL)."""
    if not file_path.exists():
        logging.error("Transcript file not found: %s", file_path)
        return ""

    content = file_path.read_text(encoding="utf-8")

    # Try JSONL format
    if file_path.suffix == ".jsonl":
        turns = []
        for line in content.strip().split("\n"):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                msg = entry.get("message", entry)
                role = msg.get("role", "")
                if role in ("user", "assistant"):
                    parts_data = msg.get("parts", [])
                    text_parts = []
                    if isinstance(parts_data, list):
                        for p in parts_data:
                            if isinstance(p, dict) and p.get("type") == "text":
                                text_parts.append(p.get("text", ""))
                            elif isinstance(p, str):
                                text_parts.append(p)
                    elif isinstance(parts_data, str):
                        text_parts.append(parts_data)

                    content_text = "\n".join(text_parts).strip()
                    if content_text:
                        label = "User" if role == "user" else "Assistant"
                        turns.append(f"**{label}:** {content_text}")
                elif isinstance(msg.get("content"), str) and role in ("user", "assistant"):
                    label = "User" if role == "user" else "Assistant"
                    turns.append(f"**{label}:** {msg['content'].strip()}")
            except json.JSONDecodeError:
                continue
        return "\n\n".join(turns)

    # Plain JSON or markdown — return as-is
    return content


def append_to_daily_log(content: str, session_id: str, source: str = "manual") -> None:
    """Append extracted content to today's daily log."""
    today = today_iso()
    log_path = ensure_daily_log(today)
    timestamp = datetime.now(timezone.utc).astimezone().strftime("%H:%M")

    entry = f"\n## [{timestamp}] extract | Session {session_id} ({source})\n\n{content}\n"

    with open(log_path, "a", encoding="utf-8") as f:
        f.write(entry)

    logging.info("Appended to daily log %s for session %s", today, session_id)


def maybe_trigger_compilation() -> None:
    """If past compile hour and today's log hasn't been compiled, trigger compile.py."""
    now = datetime.now(timezone.utc).astimezone()
    if now.hour < COMPILE_AFTER_HOUR:
        return

    today_log = f"{today_iso()}.md"
    state = load_state()
    ingested = state.get("ingested", {})

    if today_log in ingested:
        log_path = LOGS_DIR / today_log
        if log_path.exists():
            current_hash = file_hash(log_path)
            if ingested[today_log].get("hash") == current_hash:
                return

    compile_script = SCRIPTS_DIR / "compile.py"
    if not compile_script.exists():
        return

    logging.info("End-of-day compilation triggered (after %d:00)", COMPILE_AFTER_HOUR)

    kwargs: dict = {}
    if sys.platform == "win32":
        import subprocess as _sp
        kwargs["creationflags"] = _sp.CREATE_NEW_PROCESS_GROUP | _sp.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True

    try:
        log_handle = open(str(SCRIPTS_DIR / "compile.log"), "a")
        cmd = ["uv", "run", "--directory", str(ROOT_DIR), "python", str(compile_script)]
        subprocess.Popen(cmd, stdout=log_handle, stderr=subprocess.STDOUT, cwd=str(ROOT_DIR), **kwargs)
    except Exception as e:
        logging.error("Failed to spawn compile.py: %s", e)


def run_extraction_via_cli(transcript_text: str, session_id: str) -> str:
    """Use `opencode run` to extract knowledge from transcript text."""
    prompt = f"""You are a knowledge extraction agent. Read the conversation below and extract key knowledge.

Follow the schema in OPENCODE.md strictly. Create or update articles, append to the daily log, update the index.

If nothing is worth saving, respond with exactly: FLUSH_OK

## Conversation

{transcript_text}"""

    try:
        result = subprocess.run(
            [
                "opencode", "run",
                "--agent", "build",
                "--dir", str(ROOT_DIR),
                "--format", "json",
                prompt,
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        return result.stdout
    except subprocess.TimeoutExpired:
        logging.error("Extraction timed out for session %s", session_id)
        return "FLUSH_ERROR: timeout"
    except Exception as e:
        logging.error("Extraction failed for session %s: %s", session_id, e)
        return f"FLUSH_ERROR: {e}"


def main():
    parser = argparse.ArgumentParser(description="Extract knowledge from a conversation transcript")
    parser.add_argument("session_id", nargs="?", help="Session ID to extract from")
    parser.add_argument("--file", type=str, help="Path to transcript file")
    parser.add_argument("--text", type=str, help="Inline conversation text")
    parser.add_argument("--source", type=str, default="manual", help="Source label (session-end, pre-compact, manual)")
    args = parser.parse_args()

    session_id = args.session_id or "manual"
    source = args.source

    # Deduplication: skip if same session was flushed within 60 seconds
    flush_state = load_flush_state()
    if (
        flush_state.get("session_id") == session_id
        and time.time() - flush_state.get("timestamp", 0) < 60
    ):
        logging.info("Skipping duplicate flush for session %s", session_id)
        print(f"Skipping duplicate flush for session {session_id}")
        return

    # Get transcript text
    transcript_text = ""
    if args.text:
        transcript_text = args.text
    elif args.file:
        transcript_text = extract_transcript_from_file(Path(args.file))
    elif args.session_id:
        transcript_text = extract_transcript_from_session(args.session_id)

    if not transcript_text.strip():
        logging.warning("No transcript content for session %s", session_id)
        print("No transcript content to extract from")
        return

    logging.info("Flushing session %s: %d chars", session_id, len(transcript_text))

    # Run extraction
    result = run_extraction_via_cli(transcript_text, session_id)

    if "FLUSH_OK" in result:
        logging.info("Result: FLUSH_OK for session %s", session_id)
        append_to_daily_log("Nothing worth saving from this session.", session_id, source)
    elif "FLUSH_ERROR" in result:
        logging.error("Result: %s for session %s", result, session_id)
        append_to_daily_log(f"Extraction error: {result}", session_id, source)
    else:
        logging.info("Extraction complete for session %s", session_id)
        append_to_daily_log(f"Extraction completed. Result: {result[:500]}...", session_id, source)

    # Update dedup state
    save_flush_state({"session_id": session_id, "timestamp": time.time()})

    # Update master log
    timestamp = now_iso()
    append_to_master_log(f"## [{timestamp}] extract | Session {session_id} — {source}")

    # End-of-day auto-compilation
    maybe_trigger_compilation()

    logging.info("Flush complete for session %s", session_id)
    print(f"Flush complete for session {session_id}")


if __name__ == "__main__":
    main()
