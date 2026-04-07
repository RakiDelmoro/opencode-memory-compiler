---
created: 2026-04-07
updated: 2026-04-07
category: patterns
tags: [quality, standards, maintenance]
source_sessions: [bootstrap]
---

# Wiki Quality Standards

## Summary
Rules that ensure the wiki remains a reliable, navigable knowledge base as it grows across sessions.

## Context
Without quality standards, the wiki degrades into a disorganized pile of notes. These rules prevent that.

## Standards

### Every Article Must

- Have at least one `[[Related]]` link to another article
- Reference its source session(s) in frontmatter and source section
- Cover exactly one concept (atomicity)
- Use the standard frontmatter format (created, updated, category, tags, source_sessions)
- Use `kebab-case.md` for filenames

### No

- Contradictions between articles — update the old article when new info conflicts
- Orphan articles — every article must be linked from at least one other page
- Index drift — every article must appear in `index.md`
- Walls of text — use bullet points, short paragraphs, clear headings

### When Updating Existing Articles

- Increment the `updated` date
- Append new information under a dated sub-heading if the context differs
- Note contradictions: "Previously stated X, but session {id} on YYYY-MM-DD showed Y"
- Update `Related` links if new connections are discovered

### When Creating New Articles

- Check `index.md` first to avoid duplicates
- Use the standard template from `OPENCODE.md`
- Add to `index.md` immediately after creation
- Link to at least one existing article in the `Related` section

## Rationale
These standards are modeled on Wikipedia's notability and verifiability policies, adapted for a personal knowledge base. The goal is that any article, read months later, is still comprehensible and connected to the rest of the wiki.

## Related
- [[Session Wiki Architecture]]
- [[Extraction Heuristics]]

## Source
Bootstrap document — created during initial system setup.
