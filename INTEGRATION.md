# Integration Guide: Making This System Operational

This guide explains how to install and use the OpenCode Memory Compiler plugin.

## Integration Overview

One integration point:

1. **Plugin**: `.opencode/plugins/memory.ts` — self-contained TypeScript plugin that hooks into OpenCode events and provides tools via the SDK

No MCP server, no Python scripts, no shell scripts, no background processes.

### Architecture

```
┌─────────────────────────────────────────┐
│  OpenCode Plugin (memory.ts)            │
│  ┌─────────────────────────────────┐    │
│  │ Events:                         │    │
│  │   session.idle     → capture    │    │
│  │   session.created  → inject     │    │
│  │                                 │    │
│  │ Tools:                          │    │
│  │   memory_query   → Q&A          │    │
│  │   memory_compile → compile      │    │
│  │   memory_lint    → health check │    │
│  │   memory_status  → statistics   │    │
│  └─────────────────────────────────┘    │
│                                         │
│  LLM calls via client.session.prompt()  │
│  File I/O via Bun $ shell API           │
│  No external API keys or Python needed  │
└─────────────────────────────────────────┘
```

## Setup Instructions

### 1. Copy the plugin

```bash
# For a specific project
cp -r .opencode/plugins /your-project/.opencode/

# Or globally
cp -r .opencode/plugins ~/.config/opencode/
```

### 2. Restart OpenCode

That's it. The plugin loads automatically on next start.

## How the Events Work

| Event | Trigger | What happens |
|-------|---------|-------------|
| `session.idle` | Session ends | Fetches messages → formats transcript → extracts knowledge via LLM → appends to daily log |
| `session.created` | New session starts | Reads `knowledge/index.md` → injects context into session (noReply: true) |

The plugin also auto-compiles daily logs after 6 PM local time, or when manually triggered.

## Usage

Once the plugin is installed, these tools are available in any OpenCode session:

### `memory_query`

Answer questions about your past decisions, patterns, and lessons.

```
You: memory_query "How did we handle auth last time?"
```

### `memory_compile`

Manually compile any uncompiled daily logs into knowledge articles (don't wait until 6 PM).

```
You: memory_compile
```

### `memory_lint`

Health-check the knowledge base for broken links, orphan pages, and sparse articles.

```
You: memory_lint
```

### `memory_status`

View system statistics.

```
You: memory_status
```

## Typical Workflow

1. **Work** in OpenCode normally for an hour
2. **Session ends** → automatically captured to daily log
3. **Next day, start new session** → memory injected automatically, OpenCode knows what happened
4. **Query**: "memory_query 'What did we decide about auth?'" → cited answer from knowledge base
5. **After 6 PM** (or manually): daily logs compiled into wiki articles

## Costs

| Operation | Cost |
|-----------|------|
| Session capture (extract) | ~$0.01-0.03 |
| Compile one daily log | $0.40-0.60 |
| Query (no file-back) | ~$0.10-0.20 |
| Lint (structural) | $0.00 |

Costs vary based on your configured model.

## Testing Your Integration

1. Start an OpenCode session
2. Do some work (ask questions, explore code, etc.)
3. End the session
4. Check that `daily/` has a new log file for today's date
5. Run `memory_compile` to create knowledge articles
6. Run `memory_status` to see the counts
7. Start a new session — verify memory was injected

## Troubleshooting

### Nothing captured after session
- Ensure the plugin file is in `.opencode/plugins/` or `~/.config/opencode/plugins/`
- Check that OpenCode loaded the plugin on startup
- Verify the session had at least 2 messages (very short sessions are skipped)

### Query returns nothing
- Run `memory_compile` first to create articles from daily logs
- Check `knowledge/index.md` exists and has entries

### Compile takes too long
- The LLM is processing the daily log — this is expected for longer sessions
- The plugin uses your configured model; a faster model will compile quicker

### Memory not injected at session start
- There may be no knowledge base yet — compile some daily logs first
- Check `knowledge/index.md` exists and has content

## File Structure

```
.
├── .opencode/
│   └── plugins/
│       └── memory.ts             # The entire system
├── AGENTS.md                     # Knowledge base schema
├── daily/                        # Raw conversation logs (gitignored)
├── knowledge/
│   ├── index.md                 # Master catalog
│   ├── log.md                   # Append-only build log
│   ├── concepts/                # Compiled wiki articles
│   ├── connections/             # Cross-cutting insights
│   └── qa/                      # Saved Q&A articles
└── state/
    └── state.json               # Compilation state (gitignored)
```

## Need Help?

- See the [README](README.md) for quick start instructions
- See `AGENTS.md` for complete article schema and conventions
- The plugin code is well-commented for those who want to customize behavior