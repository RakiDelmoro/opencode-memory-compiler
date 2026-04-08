#!/usr/bin/env python3
"""
Background process: Extract knowledge from an Opencode session and append to daily log.
Spawned by hooks as a fully detached background process.
"""

import argparse
import asyncio
import os
import sys
import time
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

# Add scripts directory to path to import sibling modules
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

PROJECT_ROOT = SCRIPTS_DIR.parent

from config import DAILY_DIR, STATE_DIR, LAST_FLUSH_FILE, FLUSH_DEDUP_SECONDS, COMPILE_AFTER_HOUR
from utils import (
    load_state,
    save_state,
    read_last_flush,
    save_last_flush,
)
from llm_backend import get_backend


class FlushError(Exception):
    """Base exception for flush operations"""
    pass


class SessionExtractionError(FlushError):
    """Failed to extract session content"""
    pass


class KnowledgeExtractionError(FlushError):
    """Failed to extract knowledge from session"""
    pass


def now_iso() -> str:
    """Get current timestamp in ISO 8601 format"""
    return datetime.now().isoformat()


def should_skip_flush(session_id: str) -> tuple[bool, str]:
    """
    Check if this flush should be skipped due to deduplication.
    Returns (skip, reason)
    """
    if not LAST_FLUSH_FILE.exists():
        return False, "No previous flush record"
    
    last_flush = read_last_flush()
    if last_flush.get("session_id") != session_id:
        return False, "Different session"
    
    # Check time since last flush
    last_time_str = last_flush.get("timestamp")
    if last_time_str:
        try:
            last_time = datetime.fromisoformat(last_time_str)
            elapsed = (datetime.now() - last_time).total_seconds()
            if elapsed < FLUSH_DEDUP_SECONDS:
                return True, f"Flushed {elapsed:.0f}s ago (dedup window: {FLUSH_DEDUP_SECONDS}s)"
        except Exception:
            pass  # If timestamp parse fails, allow flush
    
    return False, "OK to flush"


async def extract_knowledge_with_agent(session_content: str) -> Tuple[str, float]:
    """
    Use LLM to extract key knowledge from session.
    Returns (formatted knowledge bullets to append to daily log, cost).
    """
    from config import LLM_BACKEND
    backend = get_backend(LLM_BACKEND)
    
    prompt = f"""Extract structured knowledge from this conversation.

Conversation:
{session_content}

Extract and format as:

## Knowledge Extraction (auto-generated)

**Key Decisions:**
- [List decisions made during this session]

**Patterns Identified:**
- [List coding patterns, approaches, or techniques]

**Lessons Learned:**
- [List important lessons, gotchas, or insights]

**Action Items:**
- [ ] [List follow-up tasks or todos]

Be concise. If nothing significant was decided or learned, write "No significant knowledge extracted."
""".strip()
    
    try:
        extracted_text, cost = await backend.query_with_cost(
            prompt=prompt,
            system_prompt="You are a knowledge extraction assistant that identifies decisions, patterns, lessons, and action items from conversations.",
            max_turns=2
        )
        return extracted_text, cost
    except Exception as e:
        print(f"Warning: Knowledge extraction failed: {e}")
        return "No significant knowledge extracted.", 0.0


def append_to_daily_log(log_path: Path, session_content: str, knowledge_bullets: str) -> None:
    """Append session and extracted knowledge to the daily log"""
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(f"\n\n## Session {datetime.now().strftime('%H:%M')}\n\n")
        f.write(session_content)
        if knowledge_bullets and knowledge_bullets.strip():
            f.write("\n\n" + knowledge_bullets + "\n")


def maybe_trigger_auto_compile(log_path: Path) -> None:
    """
    Check if it's past 6 PM local time and trigger auto-compilation
    if today's daily log has changed since last compilation.
    """
    from config import COMPILE_AFTER_HOUR, STATE_FILE
    from utils import load_state, file_hash
    
    now = datetime.now()
    if now.hour >= COMPILE_AFTER_HOUR:
        # Check if this log has already been compiled today
        state = load_state()
        log_stat = log_path.stat()
        log_mtime = log_stat.st_mtime
        log_filename = str(log_path.relative_to(PROJECT_ROOT))
        
        if log_filename in state.get("ingested", {}):
            last_compiled = state["ingested"][log_filename].get("compiled_at", 0)
            if last_compiled and last_compiled >= log_mtime:
                # Already compiled since last modification
                return
        
        # Trigger compilation as background process
        print(f"Auto-compilation triggered for {log_path.name}")
        try:
            # Use subprocess to run compile.py in background
            subprocess.Popen(
                [sys.executable, str(PROJECT_ROOT / "scripts" / "compile.py")],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True
            )
        except Exception as e:
            print(f"Warning: Could not spawn compile: {e}")


async def main_async(session_content: str, session_id: str = None, session_log_path: Path = None) -> int:
    """
    Main async logic for flushing a session.
    
    Args:
        session_content: The conversation transcript as text
        session_id: Unique identifier for deduplication
        session_log_path: Path where session was/will be saved
    """
    try:
        # Generate session ID if not provided
        session_id = session_id or f"session-{int(time.time())}"
        
        # Deduplication check
        skip, reason = should_skip_flush(session_id)
        if skip:
            print(f"Flush skipped: {reason}")
            return 0
        
        # Ensure we have session content
        if not session_content or not session_content.strip():
            print("Session content empty or whitespace only")
            return 0
        
        # Extract knowledge using agent
        print("Extracting knowledge from session...")
        knowledge_bullets, extract_cost = await extract_knowledge_with_agent(session_content)
        print(f"  Extraction cost: ${extract_cost:.4f}")
        
        # Determine daily log path
        if session_log_path is None:
            daily_log_path = DAILY_DIR / datetime.now().strftime("%Y-%m-%d.md")
        else:
            daily_log_path = session_log_path
        
        # Append to daily log
        append_to_daily_log(daily_log_path, session_content, knowledge_bullets)
        print(f"Appended to daily log: {daily_log_path}")
        
        # Update flush tracking
        flush_data = {
            "session_id": session_id,
            "timestamp": now_iso(),
            "log_file": str(daily_log_path.relative_to(PROJECT_ROOT)),
        }
        save_last_flush(flush_data)
        
        # Maybe trigger auto-compile
        maybe_trigger_auto_compile(daily_log_path)
        
        # Track total cost
        state = load_state()
        state["total_cost"] = state.get("total_cost", 0) + extract_cost
        save_state(state)
        
        print("Flush completed successfully")
        return 0
        
    except Exception as e:
        print(f"Error during flush: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


def main() -> int:
    """Entry point for flush.py"""
    parser = argparse.ArgumentParser(description="Flush session memory to daily log")
    parser.add_argument("session_log", type=Path, nargs="?", 
                       help="Path to session log file (optional)")
    parser.add_argument("--session-id", help="Unique session identifier for deduplication")
    parser.add_argument("--content", help="Session content directly (instead of file)")
    
    args = parser.parse_args()
    
    # Get session content
    session_content = None
    session_log_path = None
    
    if args.content:
        session_content = args.content
    elif args.session_log:
        if args.session_log.exists():
            session_content = args.session_log.read_text(encoding='utf-8')
            session_log_path = args.session_log
        else:
            print(f"Error: Session log not found: {args.session_log}")
            return 1
    
    # If no content provided, try to read from stdin (hook might pipe it)
    if session_content is None:
        try:
            if not sys.stdin.isatty():
                session_content = sys.stdin.read()
        except Exception:
            pass
    
    if not session_content or not session_content.strip():
        print("No session content provided")
        return 0  # Not an error - just nothing to do
    
    # Run async main
    return asyncio.run(main_async(session_content, args.session_id, session_log_path))


if __name__ == "__main__":
    sys.exit(main())