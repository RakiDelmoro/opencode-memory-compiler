#!/usr/bin/env python3
"""
Query the knowledge base using index-guided retrieval.
No RAG needed - the LLM reads the structured index and selected articles directly.
"""

import argparse
import re
import sys
from pathlib import Path
from datetime import datetime
from typing import Tuple  # Added for type hints

# Add scripts directory to path to import sibling modules
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

PROJECT_ROOT = SCRIPTS_DIR.parent

from config import KNOWLEDGE_DIR, INDEX_FILE, QA_DIR, AGENTS_FILE, LOG_FILE, now_iso
from utils import load_state, save_state, read_wiki_index, list_wiki_articles, append_to_log
from llm_backend import get_backend


class QueryError(Exception):
    """Base exception for query operations"""
    pass


def read_all_articles() -> dict:
    """Read all wiki articles into a dictionary"""
    articles = {}
    for article_path in list_wiki_articles():
        try:
            rel = article_path.relative_to(KNOWLEDGE_DIR)
            articles[str(rel)] = article_path.read_text(encoding="utf-8")
        except Exception as e:
            print(f"Warning: Could not read {article_path}: {e}")
    return articles


async def synthesize_answer(question: str, index_content: str, articles: dict) -> Tuple[str, float]:
    """
    Use LLM to synthesize an answer from relevant articles.
    Returns (answer text with [[wikilink]] citations, cost).
    """
    from config import LLM_BACKEND
    backend = get_backend(LLM_BACKEND)
    
    # Build a summary of available articles for context
    article_summary = "\n".join([f"- {path}" for path in sorted(articles.keys())])
    
    prompt = f"""You are a helpful assistant answering questions from a personal knowledge base.

## Available Knowledge Articles

{index_content}

Full articles available for reference:
{article_summary}

## Question

{question}

## Instructions

1. Select 3-10 most relevant articles from the index
2. Read those articles in full  
3. Synthesize a comprehensive answer
4. Include citations using [[wikilink]] format (e.g., [[concepts/python-decorators]])
5. Be factual and reference specific sources
6. If the knowledge base doesn't contain relevant information, state that clearly

## Answer Format

Provide a clear, structured answer with inline citations.

Begin your answer:
"""
    
    system_prompt = "You are a knowledgeable assistant that answers questions using only the provided knowledge base. Cite sources using [[wikilink]] format."
    
    answer, cost = await backend.query_with_cost(
        prompt=prompt,
        system_prompt=system_prompt,
        max_turns=10
    )
    
    return answer, cost


def create_qa_article(question: str, answer: str, consulted_articles: list) -> Path:
    """Create a Q&A article from a query and its answer"""
    from config import QA_DIR, PROJECT_ROOT
    timestamp = datetime.now().strftime("%Y-%m-%d")
    
    # Create safe filename from question
    safe_question = re.sub(r'[^\w\s-]', '', question.lower())
    safe_question = re.sub(r'[-\s]+', '-', safe_question).strip('-')
    safe_question = safe_question[:50] if len(safe_question) > 50 else safe_question
    qa_filename = f"qa-{safe_question}-{int(datetime.now().timestamp())}.md"
    qa_path = QA_DIR / qa_filename
    
    frontmatter = f"""---
title: "Q: {question[:80]}"
question: "{question}"
consulted:
{chr(10).join(f'  - "{article}"' for article in consulted_articles[:10])}
filed: {timestamp}
---
"""
    
    content = f"""# Q: {question}

## Answer

{answer}

## Sources Consulted

{chr(10).join(f'- [[{article}]] - Relevant information' for article in consulted_articles[:10])}

## Follow-Up Questions

- What about edge cases?
- How does this change in different contexts?
- Are there any limitations to this approach?
"""
    
    qa_path.write_text(frontmatter + "\n" + content, encoding="utf-8")
    return qa_path


def update_index_with_qa(qa_path: Path, question: str, timestamp: str):
    """Add the new Q&A to the index"""
    rel_path = f"qa/{qa_path.name}"
    summary = f"Q&A: {question[:60]}{'...' if len(question) > 60 else ''}"
    
    entry = f"| [[{rel_path}]] | {summary} | query-{timestamp} | {timestamp[:10]} |\n"
    
    if INDEX_FILE.exists():
        content = INDEX_FILE.read_text()
        # Add before the last empty line or at end
        if content.strip():
            content = content.rstrip() + "\n" + entry
        else:
            content = "# Knowledge Base Index\n\n| Article | Summary | Compiled From | Updated |\n|---------|---------|---------------|---------|\n" + entry
        INDEX_FILE.write_text(content)
    else:
        INDEX_FILE.write_text("# Knowledge Base Index\n\n| Article | Summary | Compiled From | Updated |\n|---------|---------|---------------|---------|\n" + entry)


def update_log_with_query(question: str, consulted: list, qa_path: Path = None):
    """Append query to build log"""
    timestamp = datetime.now().isoformat()
    
    entry = f"""
## [{timestamp}] query | "{question[:50]}{'...' if len(question) > 50 else ''}"
- Consulted: {len(consulted)} articles
"""
    if qa_path:
        entry += f"- Filed to: [[qa/{qa_path.name}]]\n"
    else:
        entry += "- Filed to: (none)\n"
    
    append_to_log(LOG_FILE, entry)


async def main_async(question: str, file_back: bool) -> int:
    """Main async logic for querying"""
    try:
        # Load state
        state = load_state()
        state["query_count"] = state.get("query_count", 0) + 1
        
        # Read index and articles
        print("Loading knowledge base...")
        index_content = read_wiki_index()
        articles = read_all_articles()
        
        if not articles:
            print("Warning: Knowledge base is empty. Compile some daily logs first.")
            return 1
        
        print(f"Loaded {len(articles)} articles")
        
        # Synthesize answer
        print(f"Answering: {question}")
        answer, cost = await synthesize_answer(question, index_content, articles)
        
        # Display answer
        print("\n" + "="*60)
        print(answer)
        print("="*60 + "\n")
        
        # File back if requested
        qa_path = None
        if file_back:
            print("Filing answer back to knowledge base...")
            # Determine which articles were consulted (simplified: use all available)
            consulted = list(articles.keys())[:10]  # Would be actual consulted ones from LLM
            qa_path = create_qa_article(question, answer, consulted)
            print(f"Created Q&A article: {qa_path.relative_to(PROJECT_ROOT)}")
            
            # Update index
            timestamp = datetime.now().strftime("%Y-%m-%d")
            update_index_with_qa(qa_path, question, timestamp)
            
            # Log the query
            update_log_with_query(question, consulted, qa_path)
            
            state["total_cost"] = state.get("total_cost", 0) + cost
        else:
            state["total_cost"] = state.get("total_cost", 0) + cost
        
        save_state(state)
        print(f"Query complete. Cost: ${cost:.2f}, Total: ${state['total_cost']:.2f}")
        
        return 0
        
    except Exception as e:
        print(f"Query error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Query the knowledge base")
    parser.add_argument("question", help="The question to ask")
    parser.add_argument("--file-back", action="store_true", help="Save the answer back to knowledge base")
    parser.add_argument("--backend", choices=['mock', 'openai', 'anthropic', 'opencode'],
                       help="LLM backend to use (overrides config)")
    
    args = parser.parse_args()
    
    # Set backend if specified
    if args.backend:
        import os
        os.environ["LLM_BACKEND"] = args.backend
    
    if not args.question.strip():
        print("Error: Question cannot be empty")
        return 1
    
    return asyncio.run(main_async(args.question, args.file_back))


if __name__ == "__main__":
    import asyncio
    sys.exit(main())