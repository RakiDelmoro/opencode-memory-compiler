"""Shared utilities for the OpenCode Memory Compiler."""

import hashlib
import json
import re
from pathlib import Path

from config import (
    ARCHITECTURE_DIR,
    DECISIONS_DIR,
    FLUSH_STATE_FILE,
    GOTCHAS_DIR,
    INDEX_FILE,
    KNOWLEDGE_DIR,
    LESSONS_DIR,
    LOG_FILE,
    LOGS_DIR,
    PATTERNS_DIR,
    STATE_FILE,
    TOOLS_DIR,
)


# ── State management ──────────────────────────────────────────────────

def load_state() -> dict:
    """Load persistent state from state.json."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "ingested": {},
        "query_count": 0,
        "last_lint": None,
        "total_cost": 0.0,
    }


def save_state(state: dict) -> None:
    """Save state to state.json."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def load_flush_state() -> dict:
    """Load flush deduplication state."""
    if FLUSH_STATE_FILE.exists():
        try:
            return json.loads(FLUSH_STATE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_flush_state(state: dict) -> None:
    """Save flush deduplication state."""
    FLUSH_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    FLUSH_STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


# ── File hashing ──────────────────────────────────────────────────────

def file_hash(path: Path) -> str:
    """SHA-256 hash of a file (first 16 hex chars)."""
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


# ── Slug / naming ─────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Convert text to a filename-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


# ── Wikilink helpers ──────────────────────────────────────────────────

def extract_wikilinks(content: str) -> list[str]:
    """Extract all [[wikilinks]] from markdown content."""
    return re.findall(r"\[\[([^\]]+)\]\]", content)


def wiki_article_exists(link: str) -> bool:
    """Check if a wikilinked article exists on disk."""
    path = KNOWLEDGE_DIR / f"{link}.md"
    return path.exists()


# ── Wiki content helpers ──────────────────────────────────────────────

def read_wiki_index() -> str:
    """Read the knowledge base index file."""
    if INDEX_FILE.exists():
        return INDEX_FILE.read_text(encoding="utf-8")
    return "# Wiki Index\n\n_No articles yet._"


def read_all_wiki_content() -> str:
    """Read index + all wiki articles into a single string for context."""
    parts = [f"## INDEX\n\n{read_wiki_index()}"]

    for subdir in [DECISIONS_DIR, PATTERNS_DIR, GOTCHAS_DIR, LESSONS_DIR, TOOLS_DIR, ARCHITECTURE_DIR]:
        if not subdir.exists():
            continue
        for md_file in sorted(subdir.glob("*.md")):
            rel = md_file.relative_to(KNOWLEDGE_DIR)
            content = md_file.read_text(encoding="utf-8")
            parts.append(f"## {rel}\n\n{content}")

    return "\n\n---\n\n".join(parts)


def list_wiki_articles() -> list[Path]:
    """List all wiki article files."""
    articles = []
    for subdir in [DECISIONS_DIR, PATTERNS_DIR, GOTCHAS_DIR, LESSONS_DIR, TOOLS_DIR, ARCHITECTURE_DIR]:
        if subdir.exists():
            articles.extend(sorted(subdir.glob("*.md")))
    return articles


def list_raw_files() -> list[Path]:
    """List all daily log files."""
    if not LOGS_DIR.exists():
        return []
    return sorted(LOGS_DIR.glob("*.md"))


# ── Index helpers ─────────────────────────────────────────────────────

def count_inbound_links(target: str, exclude_file: Path | None = None) -> int:
    """Count how many wiki articles link to a given target."""
    count = 0
    for article in list_wiki_articles():
        if article == exclude_file:
            continue
        content = article.read_text(encoding="utf-8")
        if f"[[{target}]]" in content:
            count += 1
    return count


def get_article_word_count(path: Path) -> int:
    """Count words in an article, excluding YAML frontmatter."""
    content = path.read_text(encoding="utf-8")
    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            content = content[end + 3:]
    return len(content.split())


def build_index_entry(rel_path: str, summary: str, sources: str, updated: str) -> str:
    """Build a single index table row."""
    link = rel_path.replace(".md", "")
    return f"| [[{link}]] | {summary} | {sources} | {updated} |"


# ── Daily log helpers ─────────────────────────────────────────────────

def ensure_daily_log(date_str: str) -> Path:
    """Ensure a daily log file exists and return its path."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / f"{date_str}.md"
    if not log_path.exists():
        log_path.write_text(
            f"# Daily Log — {date_str}\n\n",
            encoding="utf-8",
        )
    return log_path


def append_to_master_log(entry: str) -> None:
    """Append a line to the master chronological log."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not LOG_FILE.exists():
        LOG_FILE.write_text("# Master Log\n\n", encoding="utf-8")
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n{entry}\n")
