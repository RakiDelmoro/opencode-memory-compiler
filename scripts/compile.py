#!/usr/bin/env python3
"""
Compile daily conversation logs into structured knowledge articles.
This is the "LLM compiler" - it reads daily logs (source code) and produces
organized knowledge articles (the executable).
"""

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path

# Add scripts directory to path to import sibling modules
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

PROJECT_ROOT = SCRIPTS_DIR.parent

from config import (
    DAILY_DIR, KNOWLEDGE_DIR, CONCEPTS_DIR, CONNECTIONS_DIR,
    INDEX_FILE, LOG_FILE, AGENTS_FILE, now_iso
)
from utils import (
    file_hash, list_raw_files, list_wiki_articles,
    load_state, save_state, read_wiki_index, append_to_log
)
from llm_backend import get_backend


class CompileError(Exception):
    """Base exception for compilation errors"""
    pass


class LogProcessingError(CompileError):
    """Failed to process a daily log"""
    pass


async def compile_daily_log(log_path: Path, state: dict) -> float:
    """
    Compile a single daily log into knowledge articles.
    Returns the API cost of the compilation.
    """
    # Check if already processed and unchanged
    log_stat = log_path.stat()
    current_hash = file_hash(log_path)
    log_rel = str(log_path.relative_to(PROJECT_ROOT))
    
    ingested = state.get("ingested", {})
    if log_rel in ingested:
        entry = ingested[log_rel]
        if entry.get("hash") == current_hash:
            print(f"  Skipped: {log_path.name} (unchanged)")
            return 0.0
    
    print(f"Compiling: {log_path.name}")
    
    # Read the log content
    log_content = log_path.read_text(encoding="utf-8")
    
    # Read schema
    schema = AGENTS_FILE.read_text(encoding="utf-8")
    
    # Read current index
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
    
    # Build prompt for the LLM compiler
    prompt = f"""You are a knowledge compiler. Your job is to read a daily conversation log
and extract knowledge into structured wiki articles.

## Schema (AGENTS.md)

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
2. **Create concept articles** in `knowledge/concepts/` - One .md file per concept
   - Use the exact article format from AGENTS.md (YAML frontmatter + sections)
   - Include `sources:` in frontmatter pointing to the daily log file
   - Use `[[concepts/slug]]` wikilinks to link to related concepts
   - Write in encyclopedia style - neutral, comprehensive
3. **Create connection articles** in `knowledge/connections/` if this log reveals non-obvious
   relationships between 2+ existing concepts
4. **Update existing articles** if this log adds new information to concepts already in the wiki
   - Read the existing article, add the new information, add the source to frontmatter
5. **Update knowledge/index.md** - Add new entries to the table
   - Each entry: `| [[path/slug]] | One-line summary | source-file | {timestamp[:10]} |`
6. **Append to knowledge/log.md** - Add a timestamped entry:
   ```
   ## [{timestamp}] compile | {log_path.name}
   - Source: daily/{log_path.name}
   - Articles created: [[concepts/x]], [[concepts/y]]
   - Articles updated: [[concepts/z]] (if any)
   ```

### File paths:
- Write concept articles to: {CONCEPTS_DIR}
- Write connection articles to: {CONNECTIONS_DIR}
- Update index at: {INDEX_FILE}
- Append log at: {LOG_FILE}

### Quality standards:
- Every article must have complete YAML frontmatter
- Every article must link to at least 2 other articles via [[wikilinks]]
- Key Points section should have 3-5 bullet points
- Details section should have 2+ paragraphs
- Related Concepts section should have 2+ entries
- Sources section should cite the daily log with specific claims extracted
"""

    cost = 0.0
    
    # Get LLM backend (from config or environment)
    from config import LLM_BACKEND
    backend = get_backend(LLM_BACKEND)
    
    print(f"  Using LLM backend: {LLM_BACKEND}")
    
    # Call the LLM - it will write files directly using tools
    # In the real implementation, the LLM would have file write/edit tools
    # For now, we'll have the backend generate the content and we'll write it
    response, cost = await backend.query_with_cost(
        prompt=prompt,
        system_prompt="You are a knowledge compiler. Write files directly as instructed.",
        max_turns=30,
        log_path=log_path  # Pass context to mock backend
    )
    
    print(f"  LLM response received, cost: ${cost:.4f}")
    
    # Update state
    ingested = state.get("ingested", {})
    ingested[log_rel] = {
        "hash": current_hash,
        "compiled_at": log_stat.st_mtime,
        "cost_usd": cost,
    }
    state["ingested"] = ingested
    state["total_cost"] = state.get("total_cost", 0) + cost
    save_state(state)
    
    print(f"  Completed: {log_path.name} (cost: ${cost:.2f})")
    
    return cost


async def compile_all_logs(force_all: bool = False) -> None:
    """Compile all daily logs that need processing"""
    state = load_state()
    total_cost = 0.0
    
    logs = list_raw_files()
    if not logs:
        print("No daily logs found to compile")
        return
    
    print(f"Found {len(logs)} daily log(s)")
    
    for log_path in logs:
        try:
            cost = await compile_daily_log(log_path, state)
            total_cost += cost
        except Exception as e:
            import traceback
            print(f"Failed to compile {log_path.name}: {e}")
            traceback.print_exc()
            if not force_all:
                print("Aborting due to error. Use --all to continue despite errors.")
                break
    
    print(f"\nTotal compilation cost: ${total_cost:.2f}")


def main() -> int:
    """Entry point for compile.py"""
    parser = argparse.ArgumentParser(description="Compile daily logs into knowledge articles")
    parser.add_argument("--all", action="store_true", help="Force recompile all logs")
    parser.add_argument("--file", type=Path, help="Compile a specific log file")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be compiled without doing it")
    parser.add_argument("--backend", choices=['mock', 'openai', 'anthropic', 'opencode'],
                       help="LLM backend to use (overrides config)")
    
    args = parser.parse_args()
    
    # Set backend if specified
    if args.backend:
        import os
        os.environ["LLM_BACKEND"] = args.backend
    
    if args.dry_run:
        logs = list_raw_files()
        for log in logs:
            print(f"Would compile: {log.name}")
        return 0
    
    if args.file:
        state = load_state()
        if not args.file.exists():
            print(f"Error: File not found: {args.file}")
            return 1
        try:
            cost = asyncio.run(compile_daily_log(args.file, state))
            print(f"Cost: ${cost:.2f}")
            return 0
        except Exception as e:
            print(f"Error: {e}")
            return 1
    
    # Compile all (new/changed by default)
    asyncio.run(compile_all_logs(force_all=args.all))
    return 0


if __name__ == "__main__":
    sys.exit(main())