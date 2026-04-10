---
title: "Memory Capture System"
aliases: [memory_capture_tool, intelligent_memory_capture, manual_memory_system]
tags: [memory, system, architecture, plugin]
sources:
  - "daily/2026-04-10.md"
created: 2026-04-10
updated: 2026-04-10
word_count: 487
---

# Memory Capture System

[Implementation of a manual memory capture system with intelligent processing that replaces automatic session logging in the OpenCode memory system.]

## Key Points

- Replaced automatic session capture with manual `memory_capture` tool
- Implements intelligent preprocessing (Option A) for message scoring and filtering
- Maintains three-layer architecture: daily/ (source), knowledge/ (compiled), AGENTS.md (compiler spec)
- Preserves memory injection for session context via `session.created` handler

## Details

### System Architecture

The memory system follows a compiler analogy:
- **daily/** = source code (conversation logs - immutable raw material)
- **LLM** = compiler (extracts and organizes knowledge via `client.session.prompt()`)
- **knowledge/** = executable (structured, queryable knowledge base)
- **lint** = test suite (health checks for consistency)
- **queries** = runtime (using the knowledge)

### Core Components

1. **Layer 1: `daily/` - Conversation Logs**
   - Immutable source material captured manually via `memory_capture` tool
   - Format: daily/YYYY-MM-DD.md

2. **Layer 2: `knowledge/` - Compiled Knowledge (LLM-Owned)**
   - `index.md`: Master catalog - every article with one-line summary
   - `log.md`: Append-only chronological build log
   - `concepts/`: Atomic knowledge articles
   - `connections/`: Cross-cutting insights linking 2+ concepts
   - `qa/`: Filed query answers (compounding knowledge)

3. **Layer 3: AGENTS.md**
   - Schema that tells the LLM how to compile and maintain the knowledge base

### Changes Implemented

#### 1. Disabled Automatic Capture
- **File:** `.opencode/plugins/memory.ts`
- **Actions:** 
  - Commented out `session.idle` event handler
  - Commented out `session.compacted` event handler
  - **Preserved:** `session.created` handler for memory injection

#### 2. Added Manual Capture Tool
- **Tool:** `memory_capture`
- **Features:**
  - Optional session ID parameter (uses current session if not provided)
  - Intelligent preprocessing toggle (enabled by default)
  - Returns clear success/failure messages with statistics
  - **Usage:** `/agent memory_capture` or `/agent memory_capture --intelligent false`

#### 3. Intelligent Processing (Option A - Pre-filtering)
- **Algorithm for Message Scoring:**
  - **Positive Indicators:**
    - Code Detection (+2): Triple backticks, indentation patterns, file extensions, coding keywords
    - Technical Content (+1.5): Framework names, technical terminology, error messages, config patterns
    - Decision Language (+1): Modal verbs (should/will), planning language, evaluation terms
    - Interaction Patterns (+1): Question marks, responsive language, help-seeking/offering
  - **Negative Indicators:**
    - Repetition Penalty (-1): Near-duplicate content
    - Greeting/Small Talk (-0.5): Pleasantries, thanks, acknowledgments
    - Very Short Messages (-1): Substantive-less exchanges
  - Only include messages scoring above threshold in daily log

### Knowledge Base Structure

Articles follow consistent format with:
- YAML frontmatter including title, aliases, tags, sources, created/updated timestamps, word_count
- Obsidian-style `[[wikilinks]]` for cross-referencing (e.g., `[[concepts/memory_capture]]`)
- Encyclopedia-style writing: factual, concise, self-contained
- Traceability: Every article links back to source daily logs

### Intelligent Capture Format

Daily logs store extracted knowledge in structured format:
```
## Session (HH:MM) - [Title]

**Decisions Made:**
- [Extracted decisions]

**Patterns Identified:**
- [Coding patterns, debugging approaches]

**Lessons Learned:**
- [Gotchas discovered, best practices]

**Action Items:**
- [ ] [Follow-up tasks]
```

### Core Operations

1. **Compile (daily/ → knowledge/)**
   - Read daily log, index.md, and existing articles
   - Create/update concepts/connections/qa articles
   - Update index.md and log.md

2. **Query (Ask the Knowledge Base)**
   - Read index.md to identify relevant articles
   - Synthesize answer with wikilink citations
   - Optionally file to qa/ with `--file-back`

3. **Lint (Health Checks)**
   - Check for broken links, orphan pages, sparse articles
   - Generate markdown report with severity levels

### Benefits

- Reduces cognitive load with short, descriptive tool names
- Improves knowledge base quality through intelligent filtering
- Maintains traceability and provenance of knowledge
- Enables efficient retrieval via index-guided lookup
- Supports self-documentation of the memory system itself