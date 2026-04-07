# OpenCode Memory Compiler

Your OpenCode conversations compile themselves into a searchable knowledge base.

Adapted from [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) architecture, but instead of clipping web articles, the raw data is your own conversations with OpenCode. When a session ends (or auto-compacts mid-session), a TypeScript plugin captures the conversation transcript and spawns an extraction agent that extracts the important stuff — decisions, lessons learned, patterns, gotchas — and appends it to a daily log. You then compile those daily logs into structured, cross-referenced knowledge articles organized by concept. Retrieval uses a simple index file instead of RAG — no vector database, no embeddings, just markdown.

## Quick Start

Tell your AI coding agent:

> "Clone https://github.com/RakiDelmoro/opencode-memory-compiler into this project.
> Set up the OpenCode hooks so my conversations automatically get captured into
> daily logs, compiled into a knowledge base, and retrieved in future sessions.
> Read OPENCODE.md for the full technical reference on how everything works."

The agent will:

1. Clone the repo and run `uv sync` to install dependencies
2. Register `extraction-plugin.ts` in your `opencode.json` config
3. The hooks activate automatically next time you open OpenCode

From there, your conversations start accumulating. After 6 PM local time,
the next session triggers automatic compilation of that day's logs into
knowledge articles. You can also run `uv run python scripts/compile.py`
manually at any time.

## Technical Reference

See **[OPENCODE.md](OPENCODE.md)** for the full technical reference: article formats, hook architecture, script internals, costs, and customization options.
