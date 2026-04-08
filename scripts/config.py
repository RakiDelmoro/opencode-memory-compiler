"""
Configuration constants for the Opencode Memory System
"""

import os
from pathlib import Path

# Project root (where this script is located)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Core directories
DAILY_DIR = PROJECT_ROOT / "daily"
KNOWLEDGE_DIR = PROJECT_ROOT / "knowledge"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
STATE_DIR = PROJECT_ROOT / "state"
REPORTS_DIR = PROJECT_ROOT / "reports"

# Knowledge subdirectories
CONCEPTS_DIR = KNOWLEDGE_DIR / "concepts"
CONNECTIONS_DIR = KNOWLEDGE_DIR / "connections"
QA_DIR = KNOWLEDGE_DIR / "qa"

# Key files
AGENTS_FILE = PROJECT_ROOT / "AGENTS.md"
INDEX_FILE = KNOWLEDGE_DIR / "index.md"
LOG_FILE = KNOWLEDGE_DIR / "log.md"

# State files (gitignored)
STATE_FILE = STATE_DIR / "state.json"
LAST_FLUSH_FILE = STATE_DIR / "last-flush.json"

# Compilation timing
COMPILE_AFTER_HOUR = 18  # Compile after 6 PM local time (24-hour format)

# Flush deduplication
FLUSH_DEDUP_SECONDS = 60  # Skip if same session flushed within this many seconds

# LLM Backend Configuration
# Options: 'mock', 'openai', 'anthropic', 'opencode'
# Can also be set via LLM_BACKEND environment variable
LLM_BACKEND = os.getenv("LLM_BACKEND", "mock")

# OpenAI specific
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4")

# Anthropic specific
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-opus-20240229")

# Ensure directories exist
for directory in [DAILY_DIR, KNOWLEDGE_DIR, CONCEPTS_DIR, CONNECTIONS_DIR, QA_DIR, STATE_DIR, REPORTS_DIR]:
    directory.mkdir(exist_ok=True)


def now_iso() -> str:
    """Get current timestamp in ISO 8601 format"""
    from datetime import datetime
    return datetime.now().isoformat()