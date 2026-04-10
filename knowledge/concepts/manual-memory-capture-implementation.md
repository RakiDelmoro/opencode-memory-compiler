---
title: "Manual Memory Capture Implementation"
aliases: [memory_capture_tool, intelligent_capture]
tags: [memory, tool, implementation, plugin]
sources:
  - "daily/2026-04-10.md"
created: 2026-04-10
updated: 2026-04-10
word_count: 324
---

# Manual Memory Capture Implementation

[Implementation details for replacing automatic session capture with a manual `memory_capture` tool that implements intelligent knowledge extraction.]

## Key Points

- Replaced automatic session logging with manual knowledge extraction tool
- Implemented intelligent preprocessing (Option A pre-filtering) for message scoring
- Maintained memory injection for session context via `session.created` handler
- Updated knowledge base to reflect tool rename and implementation details

## Details

### Changes Made

1. **Disabled Automatic Capture** in `.opencode/plugins/memory.ts`:
   - Commented out `session.idle` event handler 
   - Commented out `session.compacted` event handler
   - Preserved `session.created` handler for memory injection

2. **Added Manual Capture Tool** in `.opencode/plugins/memory.ts`:
   ```javascript
   memory_capture: tool({
       description: "Manually capture session knowledge with intelligent filtering",
       args: {
           sessionId: tool.schema.string({ 
               description: "Optional session ID (uses current session if not provided)" 
           }),
           intelligent: tool.schema.boolean({
               description: "Apply intelligent preprocessing (recommended: true)",
               default: true
           })
       },
       async execute(args: { sessionId?: string; intelligent?: boolean }): Promise<string> {
           // Implementation: retrieve messages → preprocess → extract knowledge → save to daily/
       }
   })
   ```

3. **Implemented Intelligent Preprocessing (Option A)**:
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

### Knowledge Base Updates
- Created `knowledge/concepts/memory_capture.md` (renamed from manual-memory-capture-tool.md)
- Updated `knowledge/index.md` to reference the renamed tool
- Created `knowledge/concepts/manual-memory-capture-implementation.md` documenting the implementation
- Updated `knowledge/concepts/manual-memory-capture-tool.md` with aliases to maintain backward compatibility
- Added `knowledge/concepts/memory_capture_tool_rename.md` documenting the rename decision

### Intelligent Capture Format
Daily logs now store extracted knowledge in structured format:
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