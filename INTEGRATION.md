# Integration Guide: Making This System Operational

This guide explains how to connect Opencode to the memory compiler system using MCP (Model Context Protocol).

## Integration Overview

Two integration points need to be connected:

1. **MCP Server**: The bridge that exposes memory tools to Opencode
2. **Session Extraction**: Method to capture conversation transcripts

## Integration Approach: MCP Server

Instead of hooks, we use MCP (Model Context Protocol) - the standard way to extend Opencode with external tools.

### Architecture

```
┌─────────────────┐    MCP Tool Call     ┌─────────────────────┐
│   OpenCode TUI  │ ────────────────────> │   Memory MCP       │
│   (Go process)  │   memory_save_session │   Server (Python)  │
└─────────────────┘                      └─────────────────────┘
                                                      │
                                                      │ subprocess
                                                      ▼
                                            ┌─────────────────────┐
                                            │  Python Scripts     │
                                            │  (flush, compile,   │
                                            │   query, lint)      │
                                            └─────────────────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────────┐
                                            │  knowledge/         │
                                            │  daily/             │
                                            └─────────────────────┘
```

### What the MCP Server Provides

The `scripts/mcp_server.py` exposes these tools to Opencode:

| Tool | Description |
|------|-------------|
| `memory_save` | Save session messages to daily log |
| `memory_save_direct` | Directly save content to daily log |
| `memory_query` | Query the knowledge base |
| `memory_compile` | Trigger manual compilation |
| `memory_lint` | Run health checks |
| `memory_status` | Get system statistics |

And these resources:

| Resource | Description |
|----------|-------------|
| `memory://index` | Knowledge base index |
| `memory://status` | System status |

## Setup Instructions

### 1. Install MCP Dependency

```bash
pip install "mcp[cli]" --break-system-packages
```

Or if using uv:

```bash
uv add "mcp[cli]"
```

### 2. Configure Opencode

Add the MCP server to your `.opencode.json`:

```json
{
  "mcpServers": {
    "memory": {
      "type": "stdio",
      "command": "python",
      "args": ["scripts/mcp_server.py"]
    }
  }
}
```

The MCP server will be available in the current directory. For project-level config, add `.opencode.json` to your project root.

### 3. Test the Connection

Run the MCP server standalone to verify it works:

```bash
python scripts/mcp_server.py
```

You should see it start up in stdio mode. Press `Ctrl+C` to stop.

### 4. Use in Opencode

Once configured, the memory tools are available. Use them in your conversations:

```
You: Save this session to memory
→ OpenCode calls memory_save with session data

You: Query my knowledge about auth
→ OpenCode calls memory_query with the question

You: What's the memory system status?
→ OpenCode calls memory_status
```

## Session Extraction

### Option A: Pass Messages Directly

When calling `memory_save`, pass the session messages as JSON:

```python
# In OpenCode, when session ends:
messages = [
    {"role": "user", "content": "Help me with auth"},
    {"role": "assistant", "content": "I'll help with..."}
]
memory_save(session_id="abc123", messages_json=json.dumps(messages))
```

### Option B: Use memory_save_direct

For quick manual saves:

```
You: memory_save_direct content="Learned about Supabase RLS policies today"
```

### Option C: Database Access (Future)

Directly read from OpenCode's SQLite database:

```python
# MCP tool that reads from OpenCode DB
def memory_save_from_db(session_id: str) -> str:
    import sqlite3
    db_path = Path.home() / ".opencode" / "data" / "opencode.db"
    conn = sqlite3.connect(db_path)
    # Query messages table
    messages = conn.execute(
        "SELECT role, parts FROM messages WHERE session_id = ?", 
        (session_id,)
    ).fetchall()
    # Format and save...
```

## Testing Your Integration

### 1. Test MCP Server Directly

```bash
# Test status tool
python -c "from scripts.mcp_server import memory_status; print(memory_status())"

# Test query tool
python -c "from scripts.mcp_server import memory_query; print(memory_query('What is auth?'))"
```

### 2. Test Save and Compile

```bash
# Save content
python -c "from scripts.mcp_server import memory_save_direct; print(memory_save_direct('Test knowledge'))"

# Compile
python scripts/compile.py
```

### 3. Test Full Pipeline

1. Save content: `memory_save_direct`
2. Compile: `memory_compile`
3. Query: `memory_query`
4. Check status: `memory_status`

## Automation Options

### Option A: User-Triggered (Current)

Users explicitly call memory tools when they want to save/query.

### Option B: Custom Commands

Create `.opencode/commands/memory-save.md`:

```
MEMORY SAVE

Save the current session to memory.

RUN scripts/mcp_server.py memory_save_direct content="$CONTENT"
```

Then in OpenCode, press `Ctrl+K` and type `user:memory-save`.

### Option C: Periodic Trigger (Future)

Run a background service that periodically:
1. Checks OpenCode's database for new sessions
2. Calls `memory_save` for each new session
3. Triggers `memory_compile` after hours

## Cost Management

Track costs in `state/state.json`. Expected costs (with real LLM):

- Compile: $0.40-0.60 per daily log
- Query: $0.10-0.20 (no file-back), $0.20-0.35 (with file-back)
- Flush: $0.01-0.03 per session
- Lint: $0.10-0.20 (full), $0.00 (structural only)

## Switching to Real LLM Backend

The system currently uses mock backend. To use real LLMs:

### 1. Set Environment Variables

```bash
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 2. Update config.py

```python
# In scripts/config.py
LLM_BACKEND = os.getenv("LLM_BACKEND", "openai")  # or "anthropic"
```

### 3. Test

```bash
python scripts/query.py "What is auth?"
```

You should see real API costs in the output.

## What "Fully Operational" Looks Like

When integration is complete, a typical workflow:

1. **User works** in Opencode for an hour
2. **User says**: "Save session to memory"
3. **MCP calls** `memory_save_direct` with session content
4. **Background**: `flush.py` extracts key knowledge bullets
5. **After 6 PM**: `compile.py` runs automatically, creates knowledge articles
6. **User queries**: "How do I handle auth?"
7. **MCP calls** `memory_query`, returns answer with citations

All without any manual intervention beyond the initial setup.

## Troubleshooting

### MCP Server Not Found
- Check `.opencode.json` path is correct
- Try absolute path to `scripts/mcp_server.py`

### Tool Call Fails
- Run MCP server standalone to see errors
- Check `scripts/` directory exists and is readable

### Save Doesn't Work
- Check `daily/` directory is writable
- Verify date format in daily log

### Query Returns Nothing
- Run `memory_compile` first to create articles
- Check `knowledge/index.md` exists

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/mcp_server.py` | MCP server implementation |
| `scripts/compile.py` | Daily log → knowledge articles |
| `scripts/query.py` | Query knowledge base |
| `scripts/flush.py` | Extract knowledge from sessions |
| `scripts/lint.py` | Health checks |
| `scripts/llm_backend.py` | LLM backend (mock/openai/anthropic) |
| `scripts/config.py` | Configuration |
| `AGENTS.md` | Article schemas and formats |

## Need Help?

- See `AGENTS.md` for complete schema and conventions
- See `scripts/config.py` for all configurable constants
- Check `state/state.json` for runtime state and cost tracking

Good luck!