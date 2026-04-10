---
title: "Manual Memory Capture Tool"
aliases: ["memory_capture", "manual capture"]
tags: [memory-system, tool, cli]
sources:
  - "daily/2026-04-10.md"
created: 2026-04-10
updated: 2026-04-10
word_count: 0
---

# Manual Memory Capture Tool

A CLI tool that replaces automatic session capture with intelligent knowledge extraction, allowing users to manually trigger the processing of conversation content into structured knowledge articles.

## Key Points

- Replaces automatic `session.idle` and `session.compacted` event handlers with user-triggered `/agent memory_capture` command
- Implements intelligent preprocessing that scores and filters messages before storage
- Preserves `session.created` handler for memory injection to provide knowledge base context to new sessions
- Uses shortened name `memory_capture` to align with existing memory system naming conventions (memory_query, memory_compile)
- Returns clear success/failure messages with processing statistics
- Supports optional session ID parameter and intelligent processing toggle

## Details

The manual memory capture tool was developed to address the limitations of automatic session capture while maintaining the knowledge compilation pipeline. Key implementation decisions include:

### Event Handler Changes
- **Disabled**: Automatic capture triggered by `session.compacted` and `session.idle` events
- **Preserved**: Session creation memory injection (provides knowledge base context to new sessions)
- **Result**: No more automatic saving to `daily/` folder; user controls when conversation content is processed

### Tool Features
- **Command**: `/agent memory_capture` or `/agent memory_capture --intelligent false`
- **Parameters**: 
  - Optional session ID (uses current session if not provided)
  - Intelligent preprocessing toggle (enabled by default)
- **Output**: Clear success/failure messages with statistics on messages processed and knowledge extracted

### Intelligent Processing (Option A)
When intelligent preprocessing is enabled, messages are scored before storage:
- **Positive Indicators**:
  - Code detection (+2): Backticks, indentation, file extensions
  - Technical content (+1.5): Framework names, APIs, databases, technical keywords
  - Decision language (+1): "should", "will", "decide", "choose", etc.
  - Interaction (+1): Questions, detailed explanations, problem-solving content
- **Negative Indicators**:
  - Very short messages (<10 characters): -1 point
  - Greetings/acknowledgments: -0.5 points (e.g., "hi", "thanks", "ok", "lol")
- Messages exceeding a dynamically calculated threshold are selected for storage in daily logs

### Knowledge Preservation
Despite changing from automatic to manual capture:
- All existing knowledge extraction and compilation logic is maintained
- Daily logs still feed into the knowledge base compilation process
- Knowledge base structure (`knowledge/concepts/`, `knowledge/connections/`, `knowledge/qa/`) remains unchanged
- Compilation, linting, and query tools work identically
- Session creation memory injection continues to provide context to new sessions

## Related Concepts

- [[concepts/manual-memory-capture-system]] - Overall system architecture and intelligent processing details
- [[concepts/memory-system-architecture]] - Three-layer architecture of the memory system
- [[concepts/compile-process]] - Daily log to knowledge base compilation workflow
- [[concepts/knowledge-index]] - Structure and usage of knowledge base index

## Sources

- [[daily/2026-04-10.md]] - Discussion and decisions regarding manual memory capture tool implementation and naming

3. **Implement Intelligent Capture** with two approaches:
   - **Option A: Pre-filtering** - Score messages before transcript creation
   - **Option B: Knowledge-First Format** - Store only extracted knowledge in structured format

### Intelligent Capture Formats

**Pre-filtering approach** scores messages for:
- Code presence (backticks, indentation)
- Technical keywords (framework names, functions)
- Decision language ("should", "will", "decided")
- Question-answer patterns
- Message length filtering

**Knowledge-first format** stores only:
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