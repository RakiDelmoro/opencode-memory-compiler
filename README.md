# LLM Memory System for Opencode

Transform your Opencode conversations into a persistent, queryable knowledge base.

## For Users: Quick Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-repo/opencode-memory-compiler.git
cd opencode-memory-compiler
```

### 2. Install Dependencies

```bash
# Requires Python 3.12+
pip install -e .
pip install "mcp[cli]" --break-system-packages
# or: uv sync
```

### 3. Connect to Opencode (Optional)

Add to your `.opencode.json` (project root or home directory):

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

**Important:** Run Opencode from the memory system directory so the relative path works.

Now memory tools are available in Opencode:
- `memory_query "your question"` - Query the knowledge base
- `memory_save_direct "content" "title"` - Save directly to daily log
- `memory_compile` - Trigger compilation
- `memory_status` - Show statistics
- `memory_lint` - Run health checks

### 4. Use Without MCP

Just run scripts directly from terminal:

```bash
# Compile daily logs into knowledge articles
python scripts/compile.py

# Ask questions about your knowledge
python scripts/query.py "How do I handle authentication?"

# Save important answers back to wiki
python scripts/query.py "What is Supabase?" --file-back

# Check wiki health
python scripts/lint.py

# Manually add content to daily log
python scripts/flush.py --content "Today I learned about..."
```

## Switching to Real LLM

The mock backend is free and works out of the box. For real AI:

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."
python scripts/compile.py --backend openai

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
python scripts/compile.py --backend anthropic
```

Or set `LLM_BACKEND=openai` in `scripts/config.py`.

## How It Works

```
daily/          = Your conversations (raw)
knowledge/      = Compiled wiki (searchable)
       ┌──────► compile.py
       │              │
       │         (LLM extracts)
       │              ▼
       │       knowledge/
       │       ├── concepts/  (articles)
       │       ├── qa/        (saved answers)
       │       └── index.md   (catalog)
       │
       └──────► query.py
                   │
              (search wiki)
                   ▼
              Answer + citations
```

## Project Structure

```
.
├── scripts/           # Core system
│   ├── mcp_server.py  # Opencode integration
│   ├── compile.py     # Log → articles
│   ├── query.py       # Search wiki
│   ├── lint.py        # Health checks
│   ├── flush.py       # Add content
│   ├── llm_backend.py # LLM adapters
│   └── config.py      # Settings
├── daily/             # Your conversations
├── knowledge/         # Compiled wiki
├── AGENTS.md          # Article schema
└── pyproject.toml
```

## Testing

```bash
# Run all tests
python scripts/compile.py
python scripts/query.py "test"
python scripts/lint.py
```

## Documentation

- `AGENTS.md` - Article formats and conventions
- `INTEGRATION.md` - Detailed setup guide

## License

MIT