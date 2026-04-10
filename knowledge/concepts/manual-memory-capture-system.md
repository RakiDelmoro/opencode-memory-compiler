---
title: "Manual Memory Capture System with Intelligent Processing"
aliases: ["memory capture", "manual capture", "intelligent knowledge extraction"]
tags: [memory-system, knowledge-base, tool]
sources:
  - "daily/2026-04-10.md"
created: 2026-04-10
updated: 2026-04-10
word_count: 0
---

# Manual Memory Capture System with Intelligent Processing

A manually triggered knowledge extraction system that replaces automatic session capture with intelligent preprocessing to filter and structure valuable information from OpenCode conversations into the knowledge base.

## Key Points

- Replaces automatic session capture with user-triggered `/agent memory_capture` command
- Implements message scoring system (+2 for code, +1.5 for technical content, +1 for decisions/interaction, -1 for very short messages, -0.5 for greetings) to filter valuable content
- Uses LLM via `client.session.prompt()` to extract structured knowledge articles from filtered conversation content
- Maintains three-layer architecture: `daily/` (source logs), `knowledge/` (LLM-owned compiled knowledge), `AGENTS.md` (compiler specification)
- Preserves session creation memory injection to provide knowledge base context to new sessions
- Follows Obsidian-style `[[wikilinks]]` for knowledge connections and cross-referencing
- Organizes knowledge into concepts (atomic knowledge), connections (cross-cutting insights), and Q&A (filed answers)

## Details

The manual memory capture system was implemented to address the limitations of automatic session capture, which stored excessive raw data without intelligent processing. The system consists of several key components:

### Architecture Layers

1. **Layer 1 - Daily Logs (`daily/`)**: Immutable source conversation logs captured manually via the `memory_capture` tool
2. **Layer 2 - Knowledge Base (`knowledge/`)**: LLM-owned directory containing structured, queryable knowledge articles organized into:
   - `concepts/`: Atomic knowledge articles (facts, patterns, decisions, preferences, lessons)
   - `connections/`: Cross-cutting insights linking 2+ concepts
   - `qa/`: Filed query answers that compound knowledge over time
3. **Layer 3 - Compiler Specification (`AGENTS.md`)**: Schema defining how the LLM compiles and maintains the knowledge base

### Intelligent Processing Pipeline

When a user invokes `/agent memory_capture`:
1. The system optionally takes a session ID parameter (defaults to current session)
2. Messages are preprocessed and scored for importance using the following criteria:
   - **Positive Indicators**:
     - Code detection (+2): Presence of backticks, indentation, file extensions
     - Technical content (+1.5): Framework names, APIs, databases, technical keywords
     - Decision language (+1): Words like "should", "will", "decide", "choose"
     - Interaction (+1): Questions, detailed explanations, problem-solving content
   - **Negative Indicators**:
     - Very short messages (<10 characters): -1 point
     - Greetings/acknowledgments: -0.5 points (e.g., "hi", "thanks", "ok")
3. Messages exceeding a threshold are selected for storage in the daily log
4. Selected content is processed through the standard knowledge base compilation pipeline:
   - Read daily log file
   - Read `knowledge/index.md` to understand current knowledge state
   - Update existing concept articles or create new ones
   - Create connection articles for non-obvious relationships between concepts
   - Update `knowledge/index.md` with new/modified entries
   - Append activity to `knowledge/log.md`

### Knowledge Article Structure

All knowledge articles follow a standardized format with YAML frontmatter requiring:
- `title`: Descriptive name of the concept/tool/connection
- `aliases`: Alternate names or abbreviations
- `tags`: Categorization for organization and discovery
- `sources`: List of source daily log files that contributed to the article
- `created`: Initial creation date (ISO 8601 format)
- `updated`: Last modification date (ISO 8601 format)
- `word_count`: Approximate word count of the article body

Article bodies use Obsidian-style `[[wikilinks]]` for cross-referencing and follow an encyclopedia writing style with sections for:
- Core explanation (2-4 sentences)
- Key Points (bullet-pointed, self-contained facts)
- Details (deeper explanation)
- Related Concepts (links to connected knowledge)
- Sources (traceability to original conversations)

## Related Concepts

- [[concepts/memory-system-architecture]] - Overall three-layer architecture of the memory system
- [[concepts/compile-process]] - Detailed explanation of the daily log to knowledge base compilation workflow
- [[concepts/knowledge-index]] - Structure and usage of the knowledge base index as primary retrieval mechanism
- [[concepts/linting-rules]] - Health checks for broken links, orphan pages, and sparse articles

## Sources

- [[daily/2026-04-10.md]] - Discussion and decisions regarding manual memory capture tool implementation