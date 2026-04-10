---
title: "Plugin Architecture Refactoring"
aliases: [typescript-modularization, code-refactoring]
tags: [architecture, typescript, refactoring, opencode]
sources:
  - "daily/2026-04-10.md"
created: 2026-04-10
updated: 2026-04-10
word_count: 425
---

# Plugin Architecture Refactoring

Refactoring of the opencode-memory-compiler's `memory.ts` plugin from a dense 862-line monolithic file into a clean, modular 6-file architecture. Demonstrates responsibility-based module splitting with a thin entrypoint pattern.

## Key Points

- **Before**: Single 862-line file mixing utilities, session tracking, LLM operations, compilation, and tool definitions
- **After**: 6 focused modules totaling ~925 lines with clear separation of concerns
- **Entrypoint**: Reduced to 101 lines of pure orchestration code
- **Zero breaking changes**: All functionality preserved with same API surface

## File Structure

| File | Lines | Responsibility | Key Exports |
|------|-------|----------------|-------------|
| **memory.ts** | 101 | Entrypoint - orchestrates all modules | `hooks`, `onReady` |
| **helpers.ts** | 94 | Utility functions | `fileExists`, `safeReadFile`, `logActivity` |
| **sessionTracking.ts** | 89 | Session management | `trackSessionMessage`, `getSessionMessages` |
| **knowledgeExtraction.ts** | 170 | LLM operations | `extractKnowledge`, `summarizeMessages` |
| **compilation.ts** | 197 | Knowledge compilation | `compileDailyLog`, `createConceptArticle` |
| **tools.ts** | 274 | Plugin tools | `memoryQuery`, `memoryCompile`, `memoryLint`, etc. |

## The Pattern

### 1. Identify Responsibilities

In a large file, look for distinct responsibilities:
- **Utilities**: Pure functions (file ops, formatting)
- **State**: Stateful tracking (sessions, messages)
- **Business Logic**: Domain operations (LLM calls, compilation)
- **API Surface**: Tool definitions, event handlers

### 2. Extract by Responsibility

Move each responsibility to its own module:
```typescript
// helpers.ts - stateless utilities
export const fileExists = async (path: string) => { /* ... */ };

// sessionTracking.ts - stateful tracking
const sessions = new Map<string, Message[]>();
export const trackSessionMessage = (sessionId: string, msg: Message) => { /* ... */ };

// tools.ts - tool definitions only
export const memoryQuery = { /* tool definition */ };
```

### 3. Thin Entrypoint

The main file becomes pure orchestration:
```typescript
// memory.ts - only 101 lines
import { fileExists, logActivity } from './helpers';
import { trackSessionMessage } from './sessionTracking';
import { memoryQuery, memoryCompile, memoryLint } from './tools';

export const hooks = {
  'session.message': (event) => {
    trackSessionMessage(event.sessionId, event.message);
  }
};
```

## Why This Works

**Maintainability**: Finding code is instant - `knowledgeExtraction.ts` for LLM ops
**Testability**: Each module can be tested independently with mocked dependencies
**Clarity**: Dependencies are explicit through imports, not hidden in a large file
**Refactoring Safety**: Small modules are easier to reason about and modify

## Lessons Learned

1. **Large files grow exponentially harder to maintain** - Every new feature adds to the cognitive load
2. **Responsibility boundaries make modularization straightforward** - Clear splits emerge from examining what code does
3. **Explicit dependencies improve architecture visibility** - Import statements show relationships
4. **Preserve functionality during refactoring** - Zero breaking changes reduces risk
5. **Thin entrypoints are maintainable** - 100 lines of orchestration vs. 800+ lines of mixed code

## Related Concepts

- [[concepts/manual-memory-capture-system]] - The memory system that was refactored
- [[concepts/knowledge-compilation-process]] - How the plugin compiles daily logs to knowledge base

## Sources

- [[daily/2026-04-10.md]] - Session log documenting the refactoring process
