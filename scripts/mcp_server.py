"""
MCP Server for Opencode Memory System

Provides tools for:
- memory_save: Save current session to memory
- memory_query: Query the knowledge base (returns raw content for Opencode LLM)
- memory_compile: Trigger manual compilation
- memory_status: Show memory system statistics
"""

import subprocess
import json
import os
import re
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
CONCEPTS_DIR = KNOWLEDGE_DIR / "concepts"
QA_DIR = KNOWLEDGE_DIR / "qa"
INDEX_FILE = KNOWLEDGE_DIR / "index.md"


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


def read_index() -> dict:
    """Read the knowledge base index and return a mapping of article paths to summaries."""
    articles = {}
    if not INDEX_FILE.exists():
        return articles
    
    content = INDEX_FILE.read_text()
    # Parse markdown table: | [[path]] | Summary | Source | Date |
    pattern = r'\|\s*\[\[([^\]]+)\]\]\s*\|\s*([^|]+)\s*\|'
    for match in re.finditer(pattern, content):
        article_path = match.group(1).strip()
        summary = match.group(2).strip()
        articles[article_path] = summary
    
    return articles


def search_knowledge_base(query: str) -> list[dict]:
    """
    Search the knowledge base for articles relevant to the query.
    Returns list of article dicts with title, summary, and content.
    """
    query_lower = query.lower()
    results = []
    
    # Read index
    index_articles = read_index()
    
    # Search concepts
    if CONCEPTS_DIR.exists():
        for article_file in CONCEPTS_DIR.glob("*.md"):
            content = article_file.read_text()
            title = extract_title(content)
            summary = index_articles.get(f"concepts/{article_file.name}", "")
            
            # Simple relevance scoring
            relevance = 0
            content_lower = content.lower()
            
            # Check if query terms appear in title, summary, or content
            query_words = query_lower.split()
            for word in query_words:
                if word in title.lower():
                    relevance += 3
                if word in summary.lower():
                    relevance += 2
                if word in content_lower:
                    relevance += 1
            
            # Also check index mapping
            for article_path, article_summary in index_articles.items():
                if article_file.name in article_path:
                    if any(word in article_summary.lower() for word in query_words):
                        relevance += 2
            
            if relevance > 0:
                # Extract key sections (first few paragraphs)
                body = extract_body(content)
                results.append({
                    "path": f"concepts/{article_file.name}",
                    "title": title,
                    "summary": summary,
                    "content": body[:1000],  # Limit content size
                    "relevance": relevance
                })
    
    # Search Q&A
    if QA_DIR.exists():
        for qa_file in QA_DIR.glob("*.md"):
            content = qa_file.read_text()
            title = extract_title(content)
            
            if any(word in content.lower() for word in query_lower.split()):
                body = extract_body(content)
                results.append({
                    "path": f"qa/{qa_file.name}",
                    "title": title,
                    "summary": f"Q&A: {title[:60]}",
                    "content": body[:1000],
                    "relevance": 1
                })
    
    # Sort by relevance
    results.sort(key=lambda x: x["relevance"], reverse=True)
    return results[:10]  # Return top 10


def extract_title(content: str) -> str:
    """Extract title from markdown content."""
    lines = content.split('\n')
    for line in lines:
        if line.startswith('# '):
            return line[2:].strip()
    return "Untitled"


def extract_body(content: str) -> str:
    """Extract body content, skipping YAML frontmatter."""
    if content.startswith('---'):
        end_idx = content.find('---', 3)
        if end_idx != -1:
            return content[end_idx+3:].strip()
    return content


def format_for_llm(articles: list[dict]) -> str:
    """Format search results for Opencode's LLM to read and synthesize."""
    if not articles:
        return "No relevant articles found in the knowledge base."
    
    formatted = "## Knowledge Base Articles\n\n"
    formatted += "The following articles from your knowledge base may be relevant to answer this question:\n\n"
    
    for i, article in enumerate(articles, 1):
        formatted += f"### {i}. {article['title']}\n"
        formatted += f"**Path:** {article['path']}\n"
        formatted += f"**Summary:** {article['summary']}\n\n"
        formatted += f"**Content:**\n{article['content']}\n\n"
        formatted += "---\n\n"
    
    formatted += "\n## Task\n"
    formatted += "Read the articles above and provide a comprehensive answer to the user's question. "
    formatted += "Cite sources using the article paths provided.\n"
    
    return formatted


@mcp.tool()
def memory_save(session_id: str, messages_json: str = "{}") -> str:
    """
    Save session messages to daily log and trigger knowledge extraction.
    """
    try:
        messages = json.loads(messages_json) if messages_json != "{}" else []
    except json.JSONDecodeError:
        return "Error: Invalid JSON in messages_json"
    
    if messages:
        today = datetime.now().strftime("%Y-%m-%d")
        daily_file = DAILY_DIR / f"{today}.md"
        DAILY_DIR.mkdir(exist_ok=True)
        
        timestamp = datetime.now().strftime("%H:%M")
        session_entry = f"""
### Session ({timestamp}) - {session_id[:8]}...

**Context:** Session messages via MCP

**Key Exchanges:**
- Messages: {len(messages)} total

**Decisions Made:**
- (To be extracted during compile)

**Lessons Learned:**
- (To be extracted during compile)
"""
        
        if daily_file.exists():
            with open(daily_file, "a") as f:
                f.write(session_entry)
        else:
            with open(daily_file, "w") as f:
                f.write(f"# Daily Log: {today}\n\n## Sessions\n")
                f.write(session_entry)
        
        return f"Session saved to daily log for {today}. Run memory_compile to extract knowledge."
    
    return "Error: No messages provided."


@mcp.tool()
def memory_save_direct(content: str, title: str = "Manual Entry") -> str:
    """
    Directly save content to today's daily log.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    daily_file = DAILY_DIR / f"{today}.md"
    DAILY_DIR.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%H:%M")
    session_entry = f"""
### Session ({timestamp}) - {title}

**Context:** Manual entry via MCP

**Key Exchanges:**
- {content[:200]}

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
    
    return f"Content saved to daily log for {today}. Run memory_compile to extract knowledge into articles."


@mcp.tool()
def memory_query(query: str) -> str:
    """
    Query the knowledge base - returns raw articles for Opencode's LLM to synthesize.
    
    This returns the actual knowledge base content (no LLM call).
    Opencode's configured LLM will read this content and synthesize the answer.
    """
    # Check if knowledge base exists
    if not INDEX_FILE.exists():
        return "No knowledge base found. Run memory_compile first to create articles."
    
    # Search knowledge base
    articles = search_knowledge_base(query)
    
    # Format for Opencode's LLM
    return format_for_llm(articles)


@mcp.tool()
def memory_compile() -> str:
    """
    Trigger manual compilation of daily logs into knowledge articles.
    Uses the mock backend (free) or configured LLM backend.
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
    daily_count = len(list(DAILY_DIR.glob("*.md"))) if DAILY_DIR.exists() else 0
    concepts_count = len(list(CONCEPTS_DIR.glob("*.md"))) if CONCEPTS_DIR.exists() else 0
    qa_count = len(list(QA_DIR.glob("*.md"))) if QA_DIR.exists() else 0
    
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

Knowledge base location: {KNOWLEDGE_DIR}
Daily logs location: {DAILY_DIR}
"""


@mcp.resource("memory://index")
def get_index() -> str:
    """Get the knowledge base index."""
    if INDEX_FILE.exists():
        return INDEX_FILE.read_text()
    return "Index not found. Run compile first."


@mcp.resource("memory://status")
def get_status_resource() -> str:
    """Get memory status as resource."""
    return memory_status()


if __name__ == "__main__":
    import sys
    transport = "stdio"
    if len(sys.argv) > 1 and sys.argv[1] == "--http":
        transport = "streamable-http"
    mcp.run(transport=transport)