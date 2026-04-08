# AGENTS.md - Opencode Memory System Schema

> **Status**: This is a complete blueprint requiring Opencode Agent SDK integration.
> See [INTEGRATION.md](../INTEGRATION.md) for details on making the system operational.
> 
> Adapted from [Andrej Karpathy's LLM Knowledge Base](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) architecture.
> Instead of ingesting external articles, this system compiles knowledge from your own Opencode conversations.

## The Compiler Analogy

```
daily/          = source code    (your conversations - the raw material)
LLM             = compiler       (extracts and organizes knowledge)
knowledge/      = executable     (structured, queryable knowledge base)
lint            = test suite     (health checks for consistency)
queries         = runtime        (using the knowledge)
```

You don't manually organize your knowledge. You have conversations, and the LLM handles the synthesis, cross-referencing, and maintenance.

---

## Architecture

### Layer 1: `daily/` - Conversation Logs (Immutable Source)

Daily logs capture what happened in your Opencode sessions. These are the "raw sources" - append-only, never edited after the fact.

```
daily/
├── 2026-04-01.md
├── 2026-04-02.md
├── ...
```

Each file follows this format:

```markdown
# Daily Log: YYYY-MM-DD

## Sessions

### Session (HH:MM) - Brief Title

**Context:** What the user was working on.

**Key Exchanges:**
- User asked about X, assistant explained Y
- Decided to use Z approach because...
- Discovered that W doesn't work when...

**Decisions Made:**
- Chose library X over Y because...
- Architecture: went with pattern Z

**Lessons Learned:**
- Always do X before Y to avoid...
- The gotcha with Z is that...

**Action Items:**
- [ ] Follow up on X
- [ ] Refactor Y when time permits
```

### Layer 2: `knowledge/` - Compiled Knowledge (LLM-Owned)

The LLM owns this directory entirely. Humans read it but rarely edit it directly.

```
knowledge/
├── index.md              # Master catalog - every article with one-line summary
├── log.md                # Append-only chronological build log
├── concepts/             # Atomic knowledge articles
├── connections/          # Cross-cutting insights linking 2+ concepts
└── qa/                   # Filed query answers (compounding knowledge)
```

### Layer 3: This File (AGENTS.md)

The schema that tells the LLM how to compile and maintain the knowledge base. This is the "compiler specification."

---

## Structural Files

### `knowledge/index.md` - Master Catalog

A table listing every knowledge article. This is the primary retrieval mechanism - the LLM reads this FIRST when answering any query, then selects relevant articles to read in full.

Format:

```markdown
# Knowledge Base Index

| Article | Summary | Compiled From | Updated |
|---------|---------|---------------|---------|
| [[concepts/supabase-auth]] | Row-level security patterns and JWT gotchas | daily/2026-04-02.md | 2026-04-02 |
| [[connections/auth-and-webhooks]] | Token verification patterns shared across Supabase auth and Stripe webhooks | daily/2026-04-02.md, daily/2026-04-04.md | 2026-04-04 |
```

### `knowledge/log.md` - Build Log

Append-only chronological record of every compile, query, and lint operation.

Format:

```markdown
# Build Log

## [2026-04-01T14:30:00] compile | Daily Log 2026-04-01
- Source: daily/2026-04-01.md
- Articles created: [[concepts/nextjs-project-structure]], [[concepts/tailwind-setup]]
- Articles updated: (none)

## [2026-04-02T09:00:00] query | "How do I handle auth redirects?"
- Consulted: [[concepts/supabase-auth]], [[concepts/nextjs-middleware]]
- Filed to: [[qa/auth-redirect-handling]]

## [2026-04-03T16:45:00] lint | Health Check Complete
- Fixed: 2 broken links
- Found: 1 orphan page candidate
- Checked: 0 contradictions
```

---

## Article Formats

### Concept Articles (`knowledge/concepts/`)

One article per atomic piece of knowledge. These are facts, patterns, decisions, preferences, and lessons extracted from your conversations.

```markdown
---
title: "Concept Name"
aliases: [alternate-name, abbreviation]
tags: [domain, topic]
sources:
  - "daily/2026-04-01.md"
  - "daily/2026-04-03.md"
created: 2026-04-01
updated: 2026-04-03
word_count: 342
---

# Concept Name

[2-4 sentence core explanation]

## Key Points

- [Bullet points, each self-contained]

## Details

[Deeper explanation, encyclopedia-style paragraphs]

## Related Concepts

- [[concepts/related-concept]] - How it connects

## Sources

- [[daily/2026-04-01.md]] - Initial discovery during project setup
- [[daily/2026-04-03.md]] - Updated after debugging session
```

### Connection Articles (`knowledge/connections/`)

Cross-cutting synthesis linking 2+ concepts. Created when a conversation reveals a non-obvious relationship.

```markdown
---
title: "Connection: X and Y"
connects:
  - "concepts/concept-x"
  - "concepts/concept-y"
sources:
  - "daily/2026-04-04.md"
created: 2026-04-04
updated: 2026-04-04
word_count: 287
---

# Connection: X and Y

## The Connection

[What links these concepts]

## Key Insight

[The non-obvious relationship discovered]

## Evidence

[Specific examples from conversations]

## Related Concepts

- [[concepts/concept-x]]
- [[concepts/concept-y]]
```

### Q&A Articles (`knowledge/qa/`)

Filed answers from queries. Every complex question answered by the system can be permanently stored, making future queries smarter.

```markdown
---
title: "Q: Original Question"
question: "The exact question asked"
consulted:
  - "concepts/article-1"
  - "concepts/article-2"
filed: 2026-04-05
word_count: 156
---

# Q: Original Question

## Answer

[The synthesized answer with [[wikilinks]] to sources]

## Sources Consulted

- [[concepts/article-1]] - Relevant because...
- [[concepts/article-2]] - Provided context on...

## Follow-Up Questions

- What about edge case X?
- How does this change if Y?
```

---

## Core Operations

### 1. Compile (daily/ -> knowledge/)

When processing a daily log:

1. Read the daily log file
2. Read `knowledge/index.md` to understand current knowledge state
3. Read existing articles that may need updating
4. For each piece of knowledge found in the log:
   - If an existing concept article covers this topic: UPDATE it with new information, add the daily log as a source
   - If it's a new topic: CREATE a new `concepts/` article
5. If the log reveals a non-obvious connection between 2+ existing concepts: CREATE a `connections/` article
6. UPDATE `knowledge/index.md` with new/modified entries
7. APPEND to `knowledge/log.md`

**Important guidelines:**
- A single daily log may touch 3-10 knowledge articles
- Prefer updating existing articles over creating near-duplicates
- Use Obsidian-style `[[wikilinks]]` with full relative paths from knowledge/
- Write in encyclopedia style - factual, concise, self-contained
- Every article must have YAML frontmatter
- Every article must link back to its source daily logs

### 2. Query (Ask the Knowledge Base)

1. Read `knowledge/index.md` (the master catalog)
2. Based on the question, identify 3-10 relevant articles from the index
3. Read those articles in full
4. Synthesize an answer with `[[wikilink]]` citations
5. If `--file-back` is specified: create a `knowledge/qa/` article and update index.md and log.md

**Why this works without RAG:** At personal knowledge base scale (50-500 articles), the LLM reading a structured index outperforms cosine similarity. The LLM understands what the question is really asking and selects pages accordingly. Embeddings find similar words; the LLM finds relevant concepts.

### 3. Lint (Health Checks)

Seven checks, run periodically:

1. **Broken links** - `[[wikilinks]]` pointing to non-existent articles
2. **Orphan pages** - Articles with zero inbound links from other articles
3. **Orphan sources** - Daily logs that haven't been compiled yet
4. **Stale articles** - Source daily log changed since article was last compiled
5. **Contradictions** - Conflicting claims across articles (requires LLM judgment)
6. **Missing backlinks** - A links to B but B doesn't link back to A
7. **Sparse articles** - Below 200 words, likely incomplete

Output: a markdown report with severity levels (error, warning, suggestion).

---

## Conventions

- **Wikilinks:** Use Obsidian-style `[[path/to/article]]` without `.md` extension
- **Writing style:** Encyclopedia-style, factual, third-person where appropriate
- **Dates:** ISO 8601 (YYYY-MM-DD for dates, full ISO for timestamps in log.md)
- **File naming:** lowercase, hyphens for spaces (e.g., `supabase-row-level-security.md`)
- **Frontmatter:** Every article must have YAML frontmatter with at minimum: title, sources, created, updated
- **Sources:** Always link back to the daily log(s) that contributed to an article

---

## Hook System (Automatic Capture)

Hooks are configured in `.opencode/settings.json` and fire automatically when you use Opencode in this project.

### `.opencode/settings.json` Format

```json
{
  "hooks": {
    "onSessionStart": [{ "hooks": [{ "type": "command", "command": ".opencode/hooks/session-start.sh", "timeout": 10 }] }],
    "onSessionEnd": [{ "hooks": [{ "type": "command", "command": ".opencode/hooks/session-end.sh", "timeout": 10 }] }],
    "onBeforeCompact": [{ "hooks": [{ "type": "command", "command": ".opencode/hooks/pre-compact.sh", "timeout": 10 }] }]
  }
}
```

### Hook Details

**`session-start.sh`** (onSessionStart)
- Pure local I/O, no API calls, runs in under 1 second
- Reads `knowledge/index.md` and the most recent daily log
- Outputs knowledge base context to stdout for Opencode to see at session start

**`session-end.sh`** (onSessionEnd)
- Reads Opencode session transcript (implementation-specific)
- Copies the session content to a temp file
- Spawns `flush.py` as a fully detached background process
- Recursion guard: exits immediately if `OPENCODE_INVOKED_BY` env var is set

**`pre-compact.sh`** (onBeforeCompact)
- Same architecture as session-end.sh
- Fires before Opencode auto-compacts the context window
- Critical for long sessions: captures context before summarization discards it

### Background Flush Process (`flush.py`)

Spawned by both hooks as a fully detached background process:
- **Windows:** Appropriate flags for process detachment
- **Mac/Linux:** `start_new_session=True`

This ensures flush.py survives after Opencode's hook process exits.

**What flush.py does:**
1. Sets `OPENCODE_INVOKED_BY=memory_flush` env var (prevents recursive hook firing)
2. Reads the pre-extracted session context from the temp file
3. Skips if context is empty or if same session was flushed within 60 seconds (deduplication)
4. Calls Opencode's agent equivalent (`query()` with appropriate parameters)
5. Opencode decides what's worth saving - returns structured bullet points or `FLUSH_OK`
6. Appends result to `daily/YYYY-MM-DD.md`
7. Cleans up temp context file
8. **End-of-day auto-compilation:** If it's past 6 PM local time and today's daily log has changed since its last compilation, spawns `compile.py` as another detached background process

---

## Script Details

### compile.py - The Compiler

Uses the Opencode Agent SDK's async streaming query mechanism:

- Builds a prompt with: AGENTS.md schema, current index, all existing articles, and the daily log
- Opencode reads the daily log, decides what concepts to extract, and writes files directly
- Auto-approves all file operations (equivalent to permission_mode="acceptEdits")
- Incremental: tracks SHA-256 hashes of daily logs in `state.json`, skips unchanged files
- Cost tracking included in state management

### query.py - Index-Guided Retrieval

Loads the entire knowledge base into context (index + all articles). No RAG.

At personal KB scale (50-500 articles), the LLM reading a structured index outperforms vector similarity. The LLM understands what the question is really asking and selects pages accordingly. Embeddings find similar words; the LLM finds relevant concepts.

### lint.py - Health Checks

Seven checks as described above, with detailed reporting.

---

## State Tracking

`state/state.json` tracks:
- `ingested` - map of daily log filenames to SHA-256 hashes, compilation timestamps, and costs
- `query_count` - total queries run
- `last_lint` - timestamp of most recent lint
- `total_cost` - cumulative API cost

`state/last-flush.json` tracks flush deduplication (session_id + timestamp).

Both are gitignored and regenerated automatically.

---

## Dependencies

`pyproject.toml` (at project root):
- Opencode Agent SDK or equivalent for LLM calls with tool use
- python-dotenv for environment variable management
- tzdata for timezone data
- Python 3.12+, managed by uv

No separate API key needed - uses Opencode's built-in credentials.

---

## Costs

| Operation | Cost Estimate |
|-----------|---------------|
| Compile one daily log | $0.40-0.60 |
| Query (no file-back) | ~$0.10-0.20 |
| Query (with file-back) | ~$0.20-0.35 |
| Full lint (with contradictions) | ~$0.10-0.20 |
| Structural lint only | $0.00 |
| Memory flush (per session) | ~$0.01-0.03 |

---

## Customization

### Additional Article Types

Add directories like `people/`, `projects/`, `tools/` to `knowledge/`. Define the article format in this file (AGENTS.md) and update the scripts to include them.

### Obsidian Integration

The knowledge base is pure markdown with `[[wikilinks]]` - works natively in Obsidian. Point a vault at `knowledge/` for graph view, backlinks, and search.

### Scaling Beyond Index-Guided Retrieval

At ~2,000+ articles / ~2M+ tokens, the index becomes too large for the context window. At that point, add hybrid RAG (keyword + semantic search) as a retrieval layer before the LLM. See Karpathy's recommendation of `qmd` by Tobi Lutke for search at scale.

---

## Getting Started

See README.md for quick start instructions or copy/paste this prompt into your Opencode session:

> "Please set up the automatic knowledge capture system by cloning https://github.com/[YOUR_USERNAME]/opencode-memory-compiler into this project and configuring the hooks."