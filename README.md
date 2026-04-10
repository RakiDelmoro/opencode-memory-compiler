# OpenCode Memory Compiler

> Give OpenCode a persistent memory. It remembers every conversation, compiles knowledge into a structured wiki, and recalls it at session start.

**Inspired by:**
- [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the persistent, compounding knowledge base pattern

---

## What It Does

| Feature | Description |
|---------|-------------|
| **Manual capture** | Sessions → daily log via `memory_capture` tool |
| **LLM extraction** | Pulls decisions, patterns, lessons from transcripts |
| **Wiki compilation** | Structured `knowledge/` articles, cross-linked, always current |
| **Memory injection** | At each new session start → AI reads its knowledge base |
| **Deep query** | `memory_query` → synthesized answer with citations |
| **Health checks** | `memory_lint` → finds broken links, orphan pages |

---

## How It Works

```
Your conversation
  (manual trigger: memory_capture)
        ↓
   daily/YYYY-MM-DD.md          (filtered, append-only)
        ↓                        (compiled after 6 PM or via tool)
        ↓
   LLM compiles daily log
        ↓
   knowledge/concepts/*.md       (structured wiki articles)
   knowledge/connections/*.md    (cross-cutting insights)
   knowledge/qa/*.md             (saved Q&A)
   knowledge/index.md            (master catalog)
        ↑                        (injected at session.start)
   memory injection
```

The LLM writes and maintains the wiki. **You never edit it manually.** It compounds over time.

---

## Quick Start

### 1. Copy the plugin

```bash
# Project-level (recommended)
cp -r .opencode/plugins /your-project/.opencode/

# Or global
cp -r .opencode/plugins ~/.config/opencode/
```

### 2. That's it

Next time you start OpenCode:
- Sessions are **tracked** but not automatically captured
- Knowledge is **injected** at the start of new sessions  
- Use `memory_capture` tool to manually save session to daily log
- Daily logs are **compiled** automatically after 6 PM or via `memory_compile`

Use tools from any session:
- `memory_query "How did we handle auth?"` — Ask the wiki
- `memory_compile` — Compile now (don't wait for 6 PM)
- `memory_lint` — Health-check the knowledge base
- `memory_status` — Show statistics
- `memory_capture` — Manually save session to daily log (with intelligent filtering)

---

## Directory Structure

```
.
├── .opencode/
│   └── plugins/
│       └── memory.ts           # The entire system
├── AGENTS.md                   # Schema — tells the LLM how to organize
├── daily/                      # Raw conversation logs (gitignored)
├── knowledge/
│   ├── index.md               # Master catalog
│   ├── log.md                 # Append-only build log
│   ├── concepts/              # Compiled wiki articles
│   ├── connections/           # Cross-cutting insights
│   └── qa/                    # Saved Q&A articles
└── state/                      # Compilation tracking (gitignored)
    └── state.json
```

---

## No External Dependencies

- **No Python** — everything is TypeScript/Bun
- **No separate API keys** — uses OpenCode's configured model
- **No MCP setup** — the plugin is self-contained
- **No background processes** — runs within OpenCode's event loop

---

## Tips

- Use `/agent memory_capture` to save valuable conversations to your knowledge base
- Point **Obsidian** at `knowledge/` for graph view and backlinks
- Commit `knowledge/` to git for version history
- Run `memory_compile` manually for immediate results
- The more you use it, the smarter it gets

---

## License

MIT