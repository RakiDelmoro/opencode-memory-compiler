"""Path constants and configuration for the OpenCode Memory Compiler."""

from pathlib import Path
from datetime import datetime, timezone

# ── Paths ──────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent
DAILY_DIR = ROOT_DIR / "daily"
KNOWLEDGE_DIR = ROOT_DIR / "articles"
DECISIONS_DIR = KNOWLEDGE_DIR / "decisions"
PATTERNS_DIR = KNOWLEDGE_DIR / "patterns"
GOTCHAS_DIR = KNOWLEDGE_DIR / "gotchas"
LESSONS_DIR = KNOWLEDGE_DIR / "lessons"
TOOLS_DIR = KNOWLEDGE_DIR / "tools"
ARCHITECTURE_DIR = KNOWLEDGE_DIR / "architecture"
REPORTS_DIR = ROOT_DIR / "reports"
SCRIPTS_DIR = ROOT_DIR / "scripts"
LOGS_DIR = ROOT_DIR / "logs"
DAILY_SUMMARY_DIR = ROOT_DIR / "daily"
RAW_DIR = ROOT_DIR / "raw"
TRANSCRIPT_DIR = RAW_DIR / "transcripts"

INDEX_FILE = ROOT_DIR / "index.md"
LOG_FILE = ROOT_DIR / "log.md"
STATE_FILE = SCRIPTS_DIR / "state.json"
FLUSH_STATE_FILE = SCRIPTS_DIR / "last-flush.json"
OPENCODE_SCHEMA = ROOT_DIR / "OPENCODE.md"

# ── OpenCode REST API ──────────────────────────────────────────────────
OPENCODE_API_BASE = "http://127.0.0.1:4096"

# ── Timezone ───────────────────────────────────────────────────────────
TIMEZONE = "UTC"


def now_iso() -> str:
    """Current time in ISO 8601 format."""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def today_iso() -> str:
    """Current date in ISO 8601 format."""
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
