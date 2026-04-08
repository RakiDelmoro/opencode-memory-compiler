"""
MCP Server for Opencode Memory System

Provides tools for:
- memory_save: Save current session to memory
- memory_query: Query the knowledge base  
- memory_compile: Trigger manual compilation
- memory_status: Show memory system statistics
"""

import subprocess
import json
import os
from pathlib import Path
from datetime import datetime

from mcp.server.fastmcp import FastMCP

# Initialize MCP server
mcp = FastMCP("Opencode Memory")

# Get project root (parent of scripts directory)
PROJECT_ROOT = Path(__file__).parent.parent
DAILY_DIR = PROJECT_ROOT / "daily"
KNOWLEDGE_DIR = PROJECT_ROOT / "knowledge"
STATE_DIR = PROJECT_ROOT / "state"


def run_script(script_name: str, args: list[str] = None, capture: bool = True) -> str:
    """Run a Python script and return output."""
    script_path = PROJECT_ROOT / "scripts" / script_name
    cmd = ["python", str(script_path)]
    if args:
        cmd.extend(args)
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=capture,
            text=True,
            timeout=60,
            cwd=str(PROJECT_ROOT)
        )
        return result.stdout if result.returncode == 0 else f"Error: {result.stderr}"
    except subprocess.TimeoutExpired:
        return "Error: Script timed out after 60 seconds"
    except Exception as e:
        return f"Error: {str(e)}"


def format_session_for_daily_log(messages: list[dict]) -> str:
    """Format session messages into daily log format."""
    if not messages:
        return "No messages in session"
    
    # Extract key information
    user_messages = [m for m in messages if m.get("role") == "user"]
    assistant_messages = [m for m in messages if m.get("role") == "assistant"]
    
    # Get last user message as context
    context = "General conversation"
    if user_messages:
        last_user = user_messages[-1].get("content", "")
        if last_user:
            context = last_user[:200] + ("..." if len(last_user) > 200 else "")
    
    # Build key exchanges from assistant responses
    exchanges = []
    for msg in assistant_messages[:5]:  # Limit to first 5
        content = msg.get("content", "")
        if content:
            exchanges.append(f"- Assistant responded: {content[:150]}...")
    
    log_entry = f"""**Context:** {context}

**Key Exchanges:**
{chr(10).join(exchanges) if exchanges else '- No significant exchanges'}

**Decisions Made:**
- (To be extracted by flush.py during compilation)

**Lessons Learned:**
- (To be extracted by flush.py during compilation)
"""
    return log_entry


@mcp.tool()
def memory_save(session_id: str, messages_json: str = "{}") -> str:
    """
    Save session messages to daily log and trigger knowledge extraction.
    
    Args:
        session_id: The OpenCode session ID to save
        messages_json: JSON string of messages (optional - if empty, reads from DB)
    """
    # Parse messages if provided
    try:
        messages = json.loads(messages_json) if messages_json != "{}" else []
    except json.JSONDecodeError:
        return "Error: Invalid JSON in messages_json"
    
    # If messages provided, append directly to daily log
    if messages:
        today = datetime.now().strftime("%Y-%m-%d")
        daily_file = DAILY_DIR / f"{today}.md"
        
        # Ensure directory exists
        DAILY_DIR.mkdir(exist_ok=True)
        
        # Build session entry
        timestamp = datetime.now().strftime("%H:%M")
        session_entry = f"""
### Session ({timestamp}) - {session_id[:8]}...

{format_session_for_daily_log(messages)}
"""
        
        # Append to daily log
        if daily_file.exists():
            with open(daily_file, "a") as f:
                f.write(session_entry)
        else:
            with open(daily_file, "w") as f:
                f.write(f"# Daily Log: {today}\n\n## Sessions\n")
                f.write(session_entry)
        
        # Run flush to extract knowledge
        result = run_script("flush.py", ["--session-id", session_id])
        return f"Session saved to daily log. Flush result: {result}"
    
    return "Error: No messages provided. Pass messages_json or use session_id with database access."


@mcp.tool()
def memory_save_direct(content: str, title: str = "Manual Entry") -> str:
    """
    Directly save content to today's daily log.
    
    Args:
        content: The content to save
        title: Title for this entry
    """
    today = datetime.now().strftime("%Y-%m-%d")
    daily_file = DAILY_DIR / f"{today}.md"
    
    DAILY_DIR.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%H:%M")
    session_entry = f"""
### Session ({timestamp}) - {title}

**Context:** Manual entry via MCP

**Key Exchanges:**
- {content[:200]}...

**Decisions Made:**
- (Manual entry)

**Lessons Learned:**
- (Manual entry)
"""
    
    if daily_file.exists():
        with open(daily_file, "a") as f:
            f.write(session_entry)
    else:
        with open(daily_file, "w") as f:
            f.write(f"# Daily Log: {today}\n\n## Sessions\n")
            f.write(session_entry)
    
    return f"Content saved to daily log for {today}"


@mcp.tool()
def memory_query(query: str, file_back: bool = False) -> str:
    """
    Query the knowledge base for an answer.
    
    Args:
        query: The search question
        file_back: Whether to save the Q&A for future reference
    """
    args = [query]
    if file_back:
        args.append("--file-back")
    
    return run_script("query.py", args)


@mcp.tool()
def memory_compile() -> str:
    """
    Trigger manual compilation of today's daily log into knowledge articles.
    """
    return run_script("compile.py")


@mcp.tool()
def memory_lint() -> str:
    """
    Run health checks on the knowledge base.
    """
    return run_script("lint.py")


@mcp.tool()
def memory_status() -> str:
    """
    Get memory system statistics.
    """
    # Count files
    daily_count = len(list(DAILY_DIR.glob("*.md"))) if DAILY_DIR.exists() else 0
    concepts_count = len(list((KNOWLEDGE_DIR / "concepts").glob("*.md"))) if (KNOWLEDGE_DIR / "concepts").exists() else 0
    qa_count = len(list((KNOWLEDGE_DIR / "qa").glob("*.md"))) if (KNOWLEDGE_DIR / "qa").exists() else 0
    
    # Read state
    state_file = STATE_DIR / "state.json"
    query_count = 0
    total_cost = 0.0
    if state_file.exists():
        try:
            with open(state_file) as f:
                state = json.load(f)
                query_count = state.get("query_count", 0)
                total_cost = state.get("total_cost", 0.0)
        except:
            pass
    
    return f"""# Memory System Status

- **Daily Logs:** {daily_count} files
- **Knowledge Articles:** {concepts_count} concepts
- **Q&A Saved:** {qa_count} entries
- **Total Queries:** {query_count}
- **Total Cost:** ${total_cost:.4f}

Daily: {DAILY_DIR}
Knowledge: {KNOWLEDGE_DIR}
State: {STATE_DIR}
"""


@mcp.resource("memory://index")
def get_index() -> str:
    """Get the knowledge base index."""
    index_file = KNOWLEDGE_DIR / "index.md"
    if index_file.exists():
        with open(index_file) as f:
            return f.read()
    return "Index not found. Run compile first."


@mcp.resource("memory://status")
def get_status_resource() -> str:
    """Get memory status as resource."""
    return memory_status()


if __name__ == "__main__":
    import sys
    
    # Support both stdio and streamable-http transport
    # OpenCode uses stdio by default for MCP servers
    transport = "stdio"
    if len(sys.argv) > 1 and sys.argv[1] == "--http":
        transport = "streamable-http"
    
    mcp.run(transport=transport)