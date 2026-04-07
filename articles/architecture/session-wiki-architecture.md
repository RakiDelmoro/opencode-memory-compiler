---
created: 2026-04-07
updated: 2026-04-07
category: architecture
tags: [wiki, knowledge-base, session-management, architecture]
source_sessions: [bootstrap]
---

# Session Wiki Architecture

## Summary
The OpenCode Session Wiki is a persistent, compounding knowledge base built from conversation transcripts. Instead of RAG, it uses a simple markdown index for retrieval. Knowledge is extracted at session end and auto-compact, compiled into daily logs, and organized into cross-referenced articles.

## Context
Karpathy's LLM Wiki pattern (April 2026) demonstrated that LLMs can incrementally build and maintain structured wikis from raw sources. This system adapts that pattern: instead of web articles, the raw sources are OpenCode conversation transcripts.

## Architecture

### Three Layers

1. **Raw sources** (`raw/transcripts/`) — Immutable JSONL transcripts from each session. The source of truth.
2. **The wiki** (`articles/`) — LLM-generated markdown files organized by category (decisions, patterns, gotchas, lessons, tools, architecture). The LLM owns this layer entirely.
3. **The schema** (`OPENCODE.md`) — Tells the agent how the wiki is structured, what conventions to follow, and what workflows to run.

### Extraction Pipeline

```
Session End / Auto-Compact
         │
         ▼
┌─────────────────────────┐
│  export-session.sh      │  ← Captures transcript from SQLite/CLI
│  → raw/transcripts/     │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  extract-session.sh     │  ← Spawns background extraction agent
│  → articles/            │  ← Creates/updates articles
│  → logs/YYYY-MM-DD.md   │  ← Appends daily log
│  → log.md               │  ← Appends master log
│  → index.md             │  ← Updates catalog
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  compile-daily.sh       │  ← (cron/manual) Synthesizes daily summary
│  → daily/YYYY-MM-DD.md  │
└─────────────────────────┘
```

### Retrieval

No vector database, no embeddings. Simple index-based retrieval:

1. Read `index.md` → find relevant articles
2. Read articles → synthesize answer with citations
3. Good answers get filed back as new articles

### Hook Integration

Two OpenCode hooks trigger extraction:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `experimental.session.compacting` | Before context compaction | Capture full context before detail is lost |
| `session_completed` (config) | Session ends | Final extraction pass |

## Rationale

- **No RAG**: At moderate scale (~100 sessions, ~hundreds of articles), a simple index file works well and avoids embedding infrastructure.
- **Markdown-only**: No lock-in, git-friendly, viewable in any editor.
- **Background extraction**: The hook returns immediately; extraction runs asynchronously so it never blocks the user.
- **Append-only logs**: Chronological history is never rewritten. `grep`-parseable format enables unix tool workflows.

## Related
- [[Extraction Heuristics]]
- [[Wiki Quality Standards]]
- [[Daily Compilation]]

## Source
Bootstrap document — created during initial system setup.
