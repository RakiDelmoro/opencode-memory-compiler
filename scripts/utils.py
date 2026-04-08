"""
Utility functions for the Opencode Memory System
"""

import hashlib
import json
import os
from pathlib import Path
from typing import List, Dict, Any
from config import (
    STATE_FILE, LAST_FLUSH_FILE, DAILY_DIR, KNOWLEDGE_DIR,
    INDEX_FILE, LOG_FILE, CONCEPTS_DIR, CONNECTIONS_DIR, QA_DIR
)


def file_hash(filepath: Path) -> str:
    """Calculate SHA-256 hash of a file"""
    hash_sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_sha256.update(chunk)
    return hash_sha256.hexdigest()


def load_state() -> Dict[str, Any]:
    """Load state from JSON file"""
    if STATE_FILE.exists():
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    return {
        "ingested": {},
        "query_count": 0,
        "last_lint": None,
        "total_cost": 0.0
    }


def save_state(state: Dict[str, Any]) -> None:
    """Save state to JSON file"""
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def list_raw_files() -> List[Path]:
    """List all daily log files"""
    return sorted(DAILY_DIR.glob("*.md"))


def list_wiki_articles() -> List[Path]:
    """List all knowledge base articles"""
    articles = []
    articles.extend(CONCEPTS_DIR.glob("*.md"))
    articles.extend(CONNECTIONS_DIR.glob("*.md"))
    articles.extend(QA_DIR.glob("*.md"))
    return sorted(articles)


def read_wiki_index() -> str:
    """Read the wiki index file"""
    if INDEX_FILE.exists():
        return INDEX_FILE.read_text(encoding="utf-8")
    return "# Knowledge Base Index\n\n| Article | Summary | Compiled From | Updated |\n|---------|---------|---------------|---------|"


def append_to_log(log_file: Path, entry: str) -> None:
    """Append an entry to a log file"""
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(entry + "\n")


def read_last_flush() -> Dict[str, Any]:
    """Read last flush information"""
    if LAST_FLUSH_FILE.exists():
        with open(LAST_FLUSH_FILE, 'r') as f:
            return json.load(f)
    return {}


def save_last_flush(data: Dict[str, Any]) -> None:
    """Save last flush information"""
    with open(LAST_FLUSH_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def is_recently_flushed(session_id: str) -> bool:
    """Check if session was recently flushed (deduplication)"""
    import time
    last_flush = read_last_flush()
    if not LAST_FLUSH_FILE.exists():
        return False
    last_mtime = os.path.getmtime(LAST_FLUSH_FILE)
    current_time = time.time()
    return (
        last_flush.get("session_id") == session_id and
        (current_time - last_mtime) < 60  # 60 seconds
    )