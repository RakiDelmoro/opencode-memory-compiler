# OpenCode Memory Compiler — Schema

> Adapted from [Andrej Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) architecture.
> Instead of ingesting external articles, this system compiles knowledge from your own OpenCode conversations.

## The Compiler Analogy

```
logs/           = source code    (your conversations - the raw material)
LLM             = compiler       (extracts and organizes knowledge)
articles/       = executable     (structured, queryable knowledge base)
lint            = test suite     (health checks for consistency)
queries         = runtime        (using the knowledge)
```

You don't manually organize your knowledge. You have conversations, and the LLM handles the synthesis, cross-referencing, and maintenance.

---

## Architecture

### Layer 1: `logs/` — Daily Conversation Logs (Immutable Source)

Daily logs capture what happened in your OpenCode sessions. Append-only, never edited after the fact.

```
logs/
├── 2026-04-07.md
├── 2026-04-08.md
```

Each file follows this format:

```markdown
# Daily Log — YYYY-MM-DD

## [HH:MM] extract | Session {session-id} (source)

- **Duration**: X minutes
- **Messages**: N user, M assistant
- **Decisions**: 3 extracted
- **Patterns**: 1 extracted
- **Gotchas**: 2 extracted
- **Articles updated**: [[Article A]], [[Article B]]

### Decisions
1. ...

### Patterns
1. ...

### Gotchas
1. ...

### Lessons Learned
1. ...
```

### Layer 2: `articles/` — Compiled Knowledge (LLM-Owned)

The LLM owns this directory entirely. Humans read it but rarely edit it directly.

```
articles/
├── decisions/              # Key decisions + rationale
├── patterns/               # Recurring patterns & best practices
├── gotchas/                # Pitfalls, bugs, edge cases
├── lessons/                # Lessons learned, post-mortems
├── tools/                  # Tool configs, scripts, utilities
└── architecture/           # System design, structure, conventions
```

### Layer 3: This File (OPENCODE.md)

The schema that tells the LLM how to compile and maintain the knowledge base. This is the "compiler specification."

---

## Structural Files

### `index.md` — Master Catalog

A catalog of every knowledge article, organized by category. This is the primary retrieval mechanism — the LLM reads this FIRST when answering any query, then selects relevant articles to read in full.

```markdown
# Wiki Index

## Decisions
- [[Decision Title]] — One-line summary. (YYYY-MM-DD)

## Patterns
- [[Pattern Title]] — One-line summary. (YYYY-MM-DD)

## Gotchas
- [[Gotcha Title]] — One-line summary. (YYYY-MM-DD)

## Lessons
- [[Lesson Title]] — One-line summary. (YYYY-MM-DD)

## Tools
- [[Tool Title]] — One-line summary. (YYYY-MM-DD)

## Architecture
- [[Architecture Title]] — One-line summary. (YYYY-MM-DD)
```

### `log.md` — Master Activity Log

Append-only chronological record of every extract, compile, and lint operation.

```
## [YYYY-MM-DD HH:MM] extract | Session {id} — {brief description}
## [YYYY-MM-DD HH:MM] compile | Daily log for YYYY-MM-DD
## [YYYY-MM-DD HH:MM] query | {question asked}
## [YYYY-MM-DD HH:MM] lint | Wiki health check — {summary}
```

---

## Article Formats

Every article in `articles/` follows this template:

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
category: decisions|patterns|gotchas|lessons|tools|architecture
tags: [tag1, tag2]
source_sessions: [session-id-1, session-id-2]
---

# Title

## Summary
One-paragraph overview.

## Context
What led to this. Background.

## Decision / Pattern / Lesson
The core content.

## Rationale
Why this choice. Alternatives considered.

## Related
- [[Related Article]]
- [[Another Article]]

## Source
Extracted from session on YYYY-MM-DD (session-id)
```

---

## Core Operations

### 1. Extract (Session End / Auto-Compact)

Triggered automatically by the TypeScript plugin (`extraction-plugin.ts`) when:
- A session ends (`session.idle` event)
- Context auto-compacts (`experimental.session.compacting` event)

The plugin:
1. Fetches all messages from the session via the SDK
2. Extracts user/assistant text turns (filters tool calls, system messages)
3. Creates a new extraction agent session with the transcript
4. The extraction agent reads the transcript and writes knowledge articles

Alternatively, run manually:
```bash
uv run python scripts/flush.py <session-id>
uv run python scripts/flush.py --file transcript.jsonl
uv run python scripts/flush.py --text "conversation text"
```

### 2. Compile (logs/ → articles/)

When processing a daily log:

1. Read the daily log file
2. Read `index.md` to understand current knowledge state
3. Read existing articles that may need updating
4. For each piece of knowledge found in the log:
   - If an existing article covers this topic: UPDATE it with new information
   - If it's a new topic: CREATE a new article in the appropriate subdirectory
5. UPDATE `index.md` with new/modified entries
6. APPEND to `log.md`

**CLI:**
```bash
uv run python scripts/compile.py              # compile new/changed only
uv run python scripts/compile.py --all        # force recompile everything
uv run python scripts/compile.py --file logs/2026-04-07.md
uv run python scripts/compile.py --dry-run
```

### 3. Query (Ask the Knowledge Base)

1. Read `index.md` (the master catalog)
2. Based on the question, identify 3-10 relevant articles from the index
3. Read those articles in full
4. Synthesize an answer with `[[wikilink]]` citations
5. If the answer is valuable and reusable, create a new article — file the exploration back into the wiki

**Why this works without RAG:** At personal knowledge base scale (50-500 articles), the LLM reading a structured index outperforms cosine similarity. The LLM understands what the question is really asking and selects pages accordingly. Embeddings find similar words; the LLM finds relevant concepts.

### 4. Lint (Health Checks)

Seven checks, run periodically:

| Check | Type | Catches |
|-------|------|---------|
| Broken links | Structural | `[[wikilinks]]` pointing to non-existent articles |
| Orphan pages | Structural | Articles with zero inbound links |
| Orphan sources | Structural | Daily logs that haven't been compiled yet |
| Stale articles | Structural | Source daily log changed since article was last compiled |
| Missing backlinks | Structural | A links to B but B doesn't link back to A |
| Sparse articles | Structural | Below 200 words, likely incomplete |
| Contradictions | LLM | Conflicting claims across articles |

**CLI:**
```bash
uv run python scripts/lint.py                    # all checks
uv run python scripts/lint.py --structural-only  # skip LLM check (free)
```

Reports saved to `reports/lint-YYYY-MM-DD.md`.

---

## Conventions

- **Wikilinks:** Use `[[path/to/article]]` without `.md` extension, relative to `articles/`
- **Writing style:** Encyclopedia-style, factual, third-person where appropriate
- **Dates:** ISO 8601 (YYYY-MM-DD for dates, full ISO for timestamps in log.md)
- **File naming:** lowercase, hyphens for spaces (e.g., `use-sqlite-for-session-storage.md`)
- **Frontmatter:** Every article must have YAML frontmatter with at minimum: created, updated, category, tags, source_sessions
- **Sources:** Always link back to the daily log(s) that contributed to an article

---

## Extraction Heuristics

When processing a transcript, prioritize:

1. **User-approved decisions** over agent suggestions. If the user said "yes, do that" or "good idea", it's a strong signal.
2. **Debugging sessions** that took more than 3 exchanges — these almost always contain gotchas or lessons.
3. **Architecture discussions** — file structure choices, module boundaries, data flow decisions.
4. **Tool configurations** — anything the user asked to set up, customize, or fix.
5. **Code patterns** the user explicitly approved or refined.
6. **Errors and their fixes** — especially non-obvious ones.
7. **User corrections** — when the user said "no, do it this way instead" — these are gold.

Ignore:
- Routine greetings and pleasantries
- Simple factual questions with straightforward answers
- Code that was tried and immediately rejected without discussion
- Repetitive back-and-forth that doesn't yield a decision

---

## Quality Bar

- Every article must have at least one `Related` link.
- Every article must reference its source session(s).
- No contradictions between articles — if new info contradicts old, update the old article and note the change.
- Articles should be atomic — one concept per file. If an article covers multiple unrelated things, split it.
- Keep articles concise. Use bullet points. Avoid walls of text.

---

## Full Project Structure

```
opencode-memory-compiler/
├── OPENCODE.md                          # This file — schema + full technical reference
├── README.md                            # Concise overview + quick start
├── index.md                             # Master catalog — THE retrieval mechanism
├── log.md                               # Append-only activity log
├── extraction-plugin.ts                 # TypeScript plugin for automatic hooks
├── pyproject.toml                       # Python dependencies
├── .gitignore                           # Excludes runtime state, temp files
├── logs/                                # "Source code" — conversation logs (immutable)
├── articles/                            # "Executable" — compiled knowledge (LLM-owned)
│   ├── decisions/                       #   Key decisions + rationale
│   ├── patterns/                        #   Recurring patterns & best practices
│   ├── gotchas/                         #   Pitfalls, bugs, edge cases
│   ├── lessons/                         #   Lessons learned, post-mortems
│   ├── tools/                           #   Tool configs, scripts, utilities
│   └── architecture/                    #   System design, structure, conventions
├── daily/                               # Compiled daily summaries
├── raw/transcripts/                     # Raw session transcripts (JSONL)
├── scripts/
│   ├── config.py                        #   Path constants
│   ├── utils.py                         #   Shared helpers (wikilinks, state, hashing)
│   ├── flush.py                         #   Extract memories from conversations
│   ├── compile.py                       #   Compile daily logs → knowledge articles
│   └── lint.py                          #   7 health checks
└── reports/                             # Lint reports (gitignored)
```

---

## Hook System (Automatic Capture)

### TypeScript Plugin (`extraction-plugin.ts`)

Registered in `opencode.json`:
```json
{
  "plugin": ["./extraction-plugin.ts"]
}
```

The plugin listens for two events:

| Event | Trigger | Purpose |
|-------|---------|---------|
| `session.idle` | Session ends | Capture full conversation for extraction |
| `experimental.session.compacting` | Before auto-compact | Capture context before it's summarized away |

**How it works:**
1. Event fires → plugin receives session ID
2. Plugin fetches all messages via `client.session.messages()`
3. Extracts user/assistant text turns (last 30, max 15,000 chars)
4. Creates a new extraction agent session via `client.session.create()`
5. Sends prompt instructing the agent to read the transcript and write articles
6. Deduplication: tracks processed session IDs to avoid double-extraction

**Minimum turn thresholds:**
- Session end: 1+ turns (capture everything)
- Pre-compact: 5+ turns (only capture substantial conversations)

---

## Script Details

### flush.py — Knowledge Extraction

Extracts important knowledge from a conversation transcript and appends to the daily log.

**CLI:**
```bash
uv run python scripts/flush.py <session-id>
uv run python scripts/flush.py --file transcript.jsonl
uv run python scripts/flush.py --text "conversation text"
uv run python scripts/flush.py --session-id abc123 --source session-end
```

**What it does:**
1. Gets transcript (via `opencode export`, file, or inline text)
2. Parses JSONL or markdown into user/assistant turns
3. Spawns `opencode run` with an extraction prompt
4. Appends result to `logs/YYYY-MM-DD.md`
5. Updates `log.md` with an extract entry
6. Deduplication: skips if same session flushed within 60 seconds
7. **End-of-day auto-compilation:** If past 6 PM and today's log hasn't been compiled, spawns `compile.py`

### compile.py — The Compiler

Uses `opencode run` to spawn an agent that reads daily logs and writes structured articles.

**What it does:**
1. Builds a prompt with: OPENCODE.md schema, current index, all existing articles, daily log
2. Spawns `opencode run --agent build` with the compilation prompt
3. Agent writes articles directly to disk
4. Tracks SHA-256 hashes in `state.json` to skip unchanged logs
5. Updates `state.json` with compilation timestamp and estimated cost

**Incremental compilation:**
- `state.json` tracks: `{ "ingested": { "2026-04-07.md": { "hash": "abc123", "compiled_at": "...", "cost_usd": 0.55 } } }`
- Only recompiles logs whose hash has changed
- `--all` flag forces full recompile

**Cost:** ~$0.45-0.65 per daily log (depends on model and log size)

### lint.py — Health Checks

Seven checks ranked by severity:

| Severity | Check | Cost |
|----------|-------|------|
| Error | Broken links | Free |
| Warning | Orphan pages | Free |
| Warning | Orphan sources | Free |
| Warning | Stale articles | Free |
| Suggestion | Missing backlinks | Free |
| Suggestion | Sparse articles | Free |
| Warning | Contradictions | ~$0.15-0.25 |

---

## State Tracking

**`scripts/state.json`** tracks:
- `ingested` — map of daily log filenames to SHA-256 hashes, compilation timestamps, and costs
- `query_count` — total queries run
- `last_lint` — timestamp of most recent lint
- `total_cost` — cumulative API cost

**`scripts/last-flush.json`** tracks flush deduplication (session_id + timestamp).

Both are gitignored and regenerated automatically.

---

## Dependencies

`pyproject.toml`:
- `requests>=2.31.0` — REST API calls to OpenCode
- `python-dotenv>=1.0.0` — Environment variable management
- Python 3.12+, managed by [uv](https://docs.astral.sh/uv/)

No API key needed — uses OpenCode's built-in credentials.

---

## Costs

| Operation | Cost |
|-----------|------|
| Compile one daily log | ~$0.45-0.65 |
| Full lint (with contradictions) | ~$0.15-0.25 |
| Structural lint only | $0.00 |
| Memory flush (per session) | ~$0.02-0.05 |

---

## Customization

### Additional Article Types

Add directories like `people/`, `projects/` to `articles/`. Define the article format in this file (OPENCODE.md) and update `scripts/utils.py`'s `list_wiki_articles()` to include them.

### Obsidian Integration

The knowledge base is pure markdown with `[[wikilinks]]` — works natively in Obsidian. Point a vault at `articles/` for graph view, backlinks, and search.

### Scaling Beyond Index-Guided Retrieval

At ~2,000+ articles / ~2M+ tokens, the index becomes too large for the context window. At that point, add hybrid RAG (keyword + semantic search) as a retrieval layer before the LLM. See Karpathy's recommendation of [qmd](https://github.com/tobi/qmd) by Tobi Lutke for search at scale.

---

## Bootstrapping

If this is the first session, the wiki is empty. The first extraction will create the initial articles. Subsequent sessions will build on them. The wiki compounds over time.
