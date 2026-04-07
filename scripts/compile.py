"""
Compile daily conversation logs into structured knowledge articles.

This is the "LLM compiler" — reads daily logs (source code) and produces
organized knowledge articles (the executable).

Usage:
    uv run python compile.py                    # compile new/changed logs only
    uv run python compile.py --all              # force recompile everything
    uv run python compile.py --file logs/2026-04-07.md  # compile a specific log
    uv run python compile.py --dry-run          # show what would be compiled
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from config import (
    ARCHITECTURE_DIR,
    DECISIONS_DIR,
    GOTCHAS_DIR,
    KNOWLEDGE_DIR,
    LESSONS_DIR,
    LOGS_DIR,
    OPENCODE_SCHEMA,
    PATTERNS_DIR,
    ROOT_DIR,
    SCRIPTS_DIR,
    TOOLS_DIR,
    now_iso,
    today_iso,
)
from utils import (
    file_hash,
    list_raw_files,
    list_wiki_articles,
    load_state,
    read_wiki_index,
    save_state,
)


def compile_daily_log(log_path: Path, state: dict) -> float:
    """Compile a single daily log into knowledge articles.

    Uses `opencode run` to spawn an agent that reads the log and writes articles.
    Returns the estimated cost (we don't get exact cost from CLI).
    """
    log_content = log_path.read_text(encoding="utf-8")
    schema = OPENCODE_SCHEMA.read_text(encoding="utf-8") if OPENCODE_SCHEMA.exists() else ""
    wiki_index = read_wiki_index()

    # Read existing articles for context
    existing_articles_context = ""
    existing = {}
    for article_path in list_wiki_articles():
        rel = article_path.relative_to(KNOWLEDGE_DIR)
        existing[str(rel)] = article_path.read_text(encoding="utf-8")

    if existing:
        parts = []
        for rel_path, content in existing.items():
            parts.append(f"### {rel_path}\n```markdown\n{content}\n```")
        existing_articles_context = "\n\n".join(parts)

    timestamp = now_iso()

    prompt = f"""You are a knowledge compiler. Your job is to read a daily conversation log
and extract knowledge into structured wiki articles.

## Schema (OPENCODE.md)

{schema}

## Current Wiki Index

{wiki_index}

## Existing Wiki Articles

{existing_articles_context if existing_articles_context else "(No existing articles yet)"}

## Daily Log to Compile

**File:** {log_path.name}

{log_content}

## Your Task

Read the daily log above and compile it into wiki articles following the schema exactly.

### Rules:

1. **Extract key concepts** - Identify 3-7 distinct concepts worth their own article
2. **Create articles** in the appropriate subdirectory under `articles/`
   - `articles/decisions/` — Key decisions and their rationale
   - `articles/patterns/` — Recurring patterns and best practices
   - `articles/gotchas/` — Pitfalls, bugs, edge cases
   - `articles/lessons/` — Lessons learned, post-mortems
   - `articles/tools/` — Tool configurations, scripts, utilities
   - `articles/architecture/` — System design, structure, conventions
3. **Use the exact article format** from OPENCODE.md (YAML frontmatter + sections)
   - Include `source_sessions` in frontmatter pointing to the daily log
   - Use `[[wikilinks]]` to link to related articles
   - Write in encyclopedia style — neutral, comprehensive
4. **Update existing articles** if this log adds new information
   - Read the existing article, add new information, update the `updated` date
5. **Update index.md** — Add new entries organized by category
6. **Append to log.md** — Add a timestamped entry

### Quality standards:
- Every article must have complete YAML frontmatter
- Every article must link to at least 2 other articles via [[wikilinks]]
- Key Points section should have 3-5 bullet points
- Details section should have 2+ paragraphs
- Related Concepts section should have 2+ entries
- Sources section should cite the daily log with specific claims extracted
"""

    try:
        result = subprocess.run(
            [
                "opencode", "run",
                "--agent", "build",
                "--dir", str(ROOT_DIR),
                prompt,
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            print(f"  Warning: opencode run exited with code {result.returncode}")
            print(f"  stderr: {result.stderr[:500]}")
    except subprocess.TimeoutExpired:
        print("  Error: compilation timed out (10 min limit)")
        return 0.0
    except Exception as e:
        print(f"  Error: {e}")
        return 0.0

    # Estimate cost: ~$0.45-0.65 per daily log
    estimated_cost = 0.55

    # Update state
    rel_path = log_path.name
    state.setdefault("ingested", {})[rel_path] = {
        "hash": file_hash(log_path),
        "compiled_at": timestamp,
        "cost_usd": estimated_cost,
    }
    state["total_cost"] = state.get("total_cost", 0.0) + estimated_cost
    save_state(state)

    return estimated_cost


def main():
    parser = argparse.ArgumentParser(description="Compile daily logs into knowledge articles")
    parser.add_argument("--all", action="store_true", help="Force recompile all logs")
    parser.add_argument("--file", type=str, help="Compile a specific daily log file")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be compiled")
    args = parser.parse_args()

    state = load_state()

    # Determine which files to compile
    if args.file:
        target = Path(args.file)
        if not target.is_absolute():
            target = LOGS_DIR / target.name
        if not target.exists():
            target = ROOT_DIR / args.file
        if not target.exists():
            print(f"Error: {args.file} not found")
            sys.exit(1)
        to_compile = [target]
    else:
        all_logs = list_raw_files()
        if args.all:
            to_compile = all_logs
        else:
            to_compile = []
            for log_path in all_logs:
                rel = log_path.name
                prev = state.get("ingested", {}).get(rel, {})
                if not prev or prev.get("hash") != file_hash(log_path):
                    to_compile.append(log_path)

    if not to_compile:
        print("Nothing to compile — all daily logs are up to date.")
        return

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Files to compile ({len(to_compile)}):")
    for f in to_compile:
        print(f"  - {f.name}")

    if args.dry_run:
        return

    # Compile each file sequentially
    total_cost = 0.0
    for i, log_path in enumerate(to_compile, 1):
        print(f"\n[{i}/{len(to_compile)}] Compiling {log_path.name}...")
        cost = compile_daily_log(log_path, state)
        total_cost += cost
        print(f"  Done. (est. ${cost:.2f})")

    articles = list_wiki_articles()
    print(f"\nCompilation complete. Total est. cost: ${total_cost:.2f}")
    print(f"Knowledge base: {len(articles)} articles")


if __name__ == "__main__":
    main()
