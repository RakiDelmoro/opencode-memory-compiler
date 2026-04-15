# AGENTS.md — Memory Compiler Schema

## Article Formats

### Concept (`knowledge/concepts/slug.md`)
```markdown
---
title: ""
aliases: []
tags: []
sources: ["daily/YYYY-MM-DD.md"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
word_count: 0
---

# Title

[Core explanation — 2-4 sentences]

## Key Points
- [Self-contained bullets]

## Details
[Encyclopedia-style paragraphs]

## Related Concepts
- [[concepts/related]]

## Sources
- [[daily/YYYY-MM-DD.md]]
```

### Connection (`knowledge/connections/slug.md`)
```markdown
---
title: "Connection: X and Y"
connects: ["concepts/x", "concepts/y"]
sources: ["daily/YYYY-MM-DD.md"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
word_count: 0
---

# Connection: X and Y

## The Connection
[What links these]

## Key Insight
[Non-obvious relationship]

## Evidence
[Specific examples]

## Related Concepts
- [[concepts/x]]
- [[concepts/y]]
```

### Q&A (`knowledge/qa/slug.md`)
```markdown
---
title: "Q: Question"
question: ""
consulted: ["concepts/a", "concepts/b"]
filed: YYYY-MM-DD
word_count: 0
---

# Q: Question

## Answer
[Answer with [[wikilinks]]

## Sources Consulted
- [[concepts/a]] — reason
- [[concepts/b]] — reason
```

---

## Compilation

**Input:** `daily/*.md` logs (append-only, immutable). Each session block includes an LLM-extracted knowledge summary (decisions/patterns/lessons/action-items) appended by `memory_capture`.

**Process:**
1. Parse daily log into session blocks (`### Session(...)`)
2. Each block has `<!-- capture:..., order:min-max -->` metadata
3. Filter blocks: only `orderMax > compiledUpTo[log]` (per-session tracking)
4. Send filtered blocks + `knowledge/index.md` + existing articles to LLM
5. LLM outputs `---NEWFILE: path---` blocks for new/updated articles
6. Write files, update `knowledge/index.md` table, append to `knowledge/log.md`

**Note:** `memory_capture` always runs knowledge extraction (LLM) and appends a structured summary to the daily log. `memory_compile` does **not** auto-trigger after capture — you must run it manually.

**Output files:**
- `knowledge/index.md` — master table of all articles
- `knowledge/log.md` — chronological build log
- `knowledge/concepts/`, `connections/`, `qa/` — article files

---

## State

`state/state.json`:
```json
{
  "ingested": { "log.md": { "hash": "", "compiled_at": 0 }},
  "sessions": {
    "sid": {
      "capturedUpTo": 0,
      "compiledUpTo": { "log.md": 0 }
    }
  }
}
```

---

## Tools

| Tool | Args | Description |
|------|------|-------------|
| `memory_capture` | (none) | Capture current session to daily log. Always applies intelligent preprocessing and extracts knowledge via LLM. Does **not** auto-compile. |
| `memory_compile` | `--log`, `--since`, `--force` | Compile daily logs into knowledge articles. Supports per-session incremental compilation (only new blocks). Must be run manually after capture. |
| `memory_query` | `--question`, `--limit` | Query knowledge base using **graph-aware search**: token match + wikilink expansion. Returns summary + link context. |
| `memory_lint` | (none) | Health check: broken links, orphan pages, sparse articles |
| `memory_status` | (none) | Show statistics |
| `memory_reindex` | (none) | Rebuild search index from scratch (after manual article edits) |

---

## Conventions

- Wikilinks: `[[concepts/slug]]` (no `.md`)
- Dates: ISO 8601 (`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SSZ`)
- File names: lowercase, hyphen-separated
- Frontmatter required: `title`, `sources`, `created`, `updated` (+ type-specific fields)
- Always link sources back to `daily/*.md`

---

## Notes

- Index injection: On `session.created`, `knowledge/index.md` is auto-injected as system context.
- LLM determines which existing articles to update vs. create new.
- Maximum 10 articles queried per `memory_query` (index-guided selection).
