---
title: "Memory Capture Tool"
aliases: [memory_capture, manual-memory-capture-tool]
tags: [memory, tool, plugin]
sources:
  - "conversation: 2026-04-10"
  - "daily/2026-04-10.md"
created: 2026-04-10
updated: 2026-04-10
word_count: 248
---

# Memory Capture Tool

[Proposed replacement for automatic session capture with a manual `memory_capture` tool that implements intelligent knowledge extraction rather than storing full conversation transcripts.]

## Key Points

- Replaces automatic session logging with manual knowledge extraction
- Implements intelligent filtering to capture only valuable insights
- Maintains memory injection for session context via `session.created` handler
- Uses Option A (pre-filtering approach) for intelligent capture

## Details

### Changes Required

1. **Disable Automatic Capture** in `.opencode/plugins/memory.ts`:
   - Comment out `session.idle` event handler (line ~554)
   - Comment out `session.compacted` event handler (line ~548)
   - Keep `session.created` handler for memory injection

2. **Add Manual Capture Tool** in `.opencode/plugins/memory.ts`:
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
   }),
   ```

3. **Implement Intelligent Preprocessing (Option A)**:
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

### Intelligent Capture Format

Stores extracted knowledge in structured format:
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