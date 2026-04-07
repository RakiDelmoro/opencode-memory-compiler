---
created: 2026-04-07
updated: 2026-04-07
category: patterns
tags: [extraction, heuristics, signal-detection]
source_sessions: [bootstrap]
---

# Extraction Heuristics

## Summary
Rules for identifying high-signal moments in conversation transcripts — what to extract and what to ignore when building the wiki.

## Context
Not every line of conversation is worth preserving. The extraction agent must distinguish between signal (decisions, patterns, gotchas) and noise (greetings, routine Q&A, rejected attempts).

## Heuristics

### Strong Signals (Always Extract)

- **User-approved decisions**: "yes, do that", "good idea", "let's go with X"
- **User corrections**: "no, do it this way instead", "actually, try X" — these are gold because they capture expert judgment
- **Debugging sessions > 3 exchanges**: Extended debugging almost always yields gotchas or lessons
- **Architecture discussions**: File structure, module boundaries, data flow decisions
- **Tool configurations**: Setup, customization, or fixes for tools and scripts
- **Non-obvious errors and their fixes**: Especially errors that required investigation to resolve

### Medium Signals (Extract If Context Supports)

- **Approved code patterns**: Solutions the user refined or approved after discussion
- **Tradeoff discussions**: When alternatives were compared and one was chosen
- **Performance optimizations**: Changes made for speed, memory, or efficiency
- **Security considerations**: Any security-related decisions or warnings

### Ignore

- Routine greetings and pleasantries
- Simple factual questions with straightforward answers
- Code tried and immediately rejected without discussion
- Repetitive back-and-forth that doesn't yield a decision
- Tool output that is purely informational (e.g., `ls` output, `git status`)

## Rationale
These heuristics balance recall (don't miss important knowledge) with precision (don't clutter the wiki with noise). User corrections are weighted highest because they represent explicit expert judgment overriding the agent's default behavior.

## Related
- [[Session Wiki Architecture]]
- [[Wiki Quality Standards]]

## Source
Bootstrap document — created during initial system setup.
