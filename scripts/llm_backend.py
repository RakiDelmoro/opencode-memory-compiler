"""
LLM Backend Adapter Layer

This module provides a unified interface for LLM calls, with multiple backend support:
- 'mock': Fully functional simulation that creates real files (default)
- 'openai': OpenAI API (requires OPENAI_API_KEY)
- 'anthropic': Anthropic Claude API (requires ANTHROPIC_API_KEY)
- 'opencode': Opencode Agent SDK (future integration)

Switching backends is as simple as changing LLM_BACKEND in config.py
"""

import os
import sys
import json
from abc import ABC, abstractmethod
from typing import AsyncGenerator, Tuple, Optional, List
from pathlib import Path
from datetime import datetime
import re

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from config import (
    PROJECT_ROOT, CONCEPTS_DIR, CONNECTIONS_DIR, INDEX_FILE, LOG_FILE,
    DAILY_DIR, QA_DIR
)


class LLMBackend(ABC):
    """Abstract base class for LLM backends"""
    
    @abstractmethod
    async def query_stream(self, prompt: str, system_prompt: str = None,
                          max_turns: int = 10, **kwargs) -> AsyncGenerator[str, None]:
        """Stream response from LLM"""
        pass
    
    @abstractmethod
    async def query_with_cost(self, prompt: str, system_prompt: str = None,
                             max_turns: int = 10, **kwargs) -> Tuple[str, float]:
        """Get complete response and cost"""
        pass


class MockBackend(LLMBackend):
    """
    Mock backend that actually implements the LLM's logic in Python.
    This makes the system fully operational without any external API.
    """
    
    async def query_stream(self, prompt: str, system_prompt: str = None,
                          max_turns: int = 10, **kwargs) -> AsyncGenerator[str, None]:
        """Yield a mock response based on prompt content"""
        response = await self._generate_response(prompt, **kwargs)
        yield response
    
    async def query_with_cost(self, prompt: str, system_prompt: str = None,
                             max_turns: int = 10, **kwargs) -> Tuple[str, float]:
        """Return mock response and zero cost (it's free!)"""
        response = await self._generate_response(prompt, **kwargs)
        return response, 0.0  # Mock is free
    
    async def _generate_response(self, prompt: str, **kwargs) -> str:
        """Generate appropriate response based on task"""
        prompt_lower = prompt.lower()
        
        if "knowledge compiler" in prompt_lower or "compile" in prompt_lower:
            return await self._compile_response(**kwargs)
        elif "knowledge extraction" in prompt_lower or "extract" in prompt_lower:
            return await self._extract_response(**kwargs)
        elif "answer questions from a personal knowledge base" in prompt_lower:
            return await self._query_response(prompt, **kwargs)
        else:
            return "Mock response: LLM would generate appropriate content here."
    
    async def _compile_response(self, **kwargs) -> str:
        """Actually perform compilation by creating files"""
        # Import config values inside function to ensure they're available
        from config import CONCEPTS_DIR, INDEX_FILE, LOG_FILE, DAILY_DIR, PROJECT_ROOT
        
        log_path = kwargs.get('log_path', DAILY_DIR / 'example-2026-04-08.md')
        if isinstance(log_path, Path):
            log_path = log_path.name
        
        # Extract date from log filename
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', log_path)
        date = date_match.group(1) if date_match else datetime.now().strftime('%Y-%m-%d')
        
        # Read the daily log to understand content
        log_file = DAILY_DIR / log_path
        if log_file.exists():
            log_content = log_file.read_text()
            # Simple keyword extraction for concept names
            concepts = self._extract_concepts_from_log(log_content)
        else:
            concepts = [("mock-concept", "Mock Concept", "A concept extracted from the conversation")]
        
        created_articles = []
        updated_articles = []
        
        # Create concept articles
        for slug, title, summary in concepts:
            concept_file = CONCEPTS_DIR / f"{slug}.md"
            if concept_file.exists():
                # Update existing
                existing = concept_file.read_text()
                # Simple update: add new source to frontmatter
                updated = self._update_existing_concept(existing, log_path, date)
                concept_file.write_text(updated)
                updated_articles.append(slug)
            else:
                # Create new
                content = self._create_concept_article(slug, title, summary, log_path, date)
                concept_file.write_text(content)
                created_articles.append(slug)
        
        # Update index.md
        self._update_index(created_articles, log_path, date)
        
        # Update log.md
        self._update_log(date, log_path, created_articles, updated_articles)
        
        # Return summary
        created_list = ", ".join(f"[[concepts/{a}]]" for a in created_articles)
        updated_list = ", ".join(f"[[concepts/{a}]]" for a in updated_articles) if updated_articles else "(none)"
        
        return f"""I've compiled the daily log into knowledge articles.

**Created:** {created_list if created_articles else '(no new articles)'}
**Updated:** {updated_list}

The articles have been written to knowledge/concepts/ and cross-referenced.
Index and build log updated accordingly.
"""
    
    def _extract_concepts_from_log(self, log_content: str) -> List[tuple]:
        """Extract concept ideas from log content (simplified keyword matching)"""
        concepts = []
        
        # Look for specific topics
        if 'supabase' in log_content.lower() and 'auth' in log_content.lower():
            concepts.append(('supabase-auth', 'Supabase Authentication',
                           'Authentication setup with Next.js and Supabase'))
        if 'middleware' in log_content.lower():
            concepts.append(('nextjs-middleware', 'Next.js Middleware',
                           'Route protection using Next.js middleware'))
        if 'connection' in log_content.lower() and 'pool' in log_content.lower():
            concepts.append(('database-connection-pooling', 'Database Connection Pooling',
                           'Managing database connections efficiently'))
        if 'error' in log_content.lower() or 'exception' in log_content.lower():
            concepts.append(('error-handling', 'Error Handling',
                           'Strategies for robust error management'))
        
        # Default if nothing recognized
        if not concepts:
            concepts.append(('general-concept', 'General Topic',
                           'A concept extracted from the conversation'))
        
        return concepts
    
    def _create_concept_article(self, slug: str, title: str, summary: str,
                               log_path: str, date: str) -> str:
        """Create a new concept article"""
        return f"""---
title: "{title}"
aliases: ["{slug}"]
tags: ["auto-generated", "concept"]
sources:
  - "daily/{log_path}"
created: {date}
updated: {date}
word_count: 200
---

# {title}

[2-4 sentence core explanation of {title}]

## Key Points

- This concept was extracted from the daily log
- It represents important knowledge worth preserving
- Future conversations can reference this page

## Details

This section contains detailed information about {title}. The actual content would
be generated by the LLM based on what was discussed in the source conversation.

For now, this is a placeholder that demonstrates the file structure and format.

## Related Concepts

- [[concepts/related-concept]] - This would link to other relevant pages

## Sources

- [[daily/{log_path}]] - Source conversation where this concept was discussed
"""
    
    def _update_existing_concept(self, existing: str, log_path: str, date: str) -> str:
        """Update an existing concept article with new source"""
        # Simple update: add to sources in frontmatter
        lines = existing.split('\n')
        new_lines = []
        in_sources = False
        sources_added = False
        
        for line in lines:
            if line.strip().startswith('sources:'):
                in_sources = True
                new_lines.append(line)
                # Add the new source
                new_lines.append(f'  - "daily/{log_path}"')
                sources_added = True
            elif in_sources and line.strip().startswith('-'):
                # Already in sources list, keep adding
                new_lines.append(line)
            elif in_sources and line and not line.strip().startswith(' '):
                # Exited sources section without adding
                if not sources_added:
                    new_lines.append(f'  - "daily/{log_path}"')
                in_sources = False
                new_lines.append(line)
            else:
                new_lines.append(line)
        
        # Update the updated date
        result = '\n'.join(new_lines)
        result = re.sub(r'updated: \d{4}-\d{2}-\d{2}', f'updated: {date}', result)
        
        return result
    
    def _update_index(self, created_articles: List[str], log_path: str, date: str):
        """Update the index.md file with new entries"""
        from config import CONCEPTS_DIR, INDEX_FILE
        
        if not INDEX_FILE.exists():
            INDEX_FILE.write_text("# Knowledge Base Index\n\n| Article | Summary | Compiled From | Updated |\n|---------|---------|---------------|---------|\n")
        
        index_content = INDEX_FILE.read_text()
        
        for slug in created_articles:
            # Read the article to get summary
            article_file = CONCEPTS_DIR / f"{slug}.md"
            if article_file.exists():
                content = article_file.read_text()
                # Extract first sentence after title for summary
                title_match = re.search(r'# (.+)\n\n(.+?)(\n\n|$)', content)
                summary = title_match.group(2).strip() if title_match else f"Concept: {slug}"
                summary = summary[:80] + ("..." if len(summary) > 80 else "")
            else:
                summary = f"Concept: {slug}"
            
            entry = f"| [[concepts/{slug}]] | {summary} | daily/{log_path} | {date} |\n"
            index_content = index_content.rstrip() + "\n" + entry
        
        INDEX_FILE.write_text(index_content)
    
    def _update_log(self, date: str, log_path: str, created: List[str], updated: List[str]):
        """Update the build log"""
        from config import LOG_FILE
        timestamp = datetime.now().isoformat()
        created_list = ", ".join(f"[[concepts/{a}]]" for a in created) if created else "(none)"
        updated_list = ", ".join(f"[[concepts/{a}]]" for a in updated) if updated else "(none)"
        
        entry = f"""\n## [{timestamp}] compile | {log_path}
- Source: daily/{log_path}
- Articles created: {created_list}
- Articles updated: {updated_list}
"""
        
        if LOG_FILE.exists():
            LOG_FILE.write_text(LOG_FILE.read_text() + entry)
        else:
            LOG_FILE.write_text("# Build Log\n" + entry)
    
    async def _extract_response(self, **kwargs) -> str:
        """Extract knowledge from a conversation"""
        session_content = kwargs.get('session_content', '')
        
        # Simple pattern matching to simulate extraction
        decisions = []
        patterns = []
        lessons = []
        action_items = []
        
        lines = session_content.split('\n')
        for line in lines:
            line_lower = line.lower()
            if 'decided' in line_lower or 'choose' in line_lower:
                decisions.append(line.strip())
            if 'pattern' in line_lower or 'approach' in line_lower:
                patterns.append(line.strip())
            if 'lesson' in line_lower or 'gotcha' in line_lower or 'learn' in line_lower:
                lessons.append(line.strip())
            if 'action item' in line_lower or 'todo' in line_lower or 'follow-up' in line_lower:
                action_items.append(line.strip())
        
        # Defaults if nothing found
        if not decisions:
            decisions = ["Auto-detected decision from conversation context"]
        if not patterns:
            patterns = ["General coding patterns identified"]
        if not lessons:
            lessons = ["Knowledge extracted from conversation"]
        if not action_items:
            action_items = ["[ ] Review extracted knowledge"]
        
        return f"""## Knowledge Extraction (auto-generated)

**Key Decisions:**
{chr(10).join(f'- {d}' for d in decisions[:5])}

**Patterns Identified:**
{chr(10).join(f'- {p}' for p in patterns[:5])}

**Lessons Learned:**
{chr(10).join(f'- {l}' for l in lessons[:5])}

**Action Items:**
{chr(10).join(f'- {a}' for a in action_items[:5])}

*Extracted by memory system at {datetime.now().isoformat()}*"""
    
    async def _query_response(self, prompt: str, **kwargs) -> str:
        """Answer a query from the knowledge base"""
        # Read the index to see what we know
        available_articles = list_wiki_articles() if 'list_wiki_articles' in globals() else []
        
        if not available_articles:
            return "The knowledge base is currently empty. Compile some daily logs first to build knowledge."
        
        # Count how many articles we have
        num_concepts = len(list(CONCEPTS_DIR.glob("*.md")))
        num_connections = len(list(CONNECTIONS_DIR.glob("*.md")))
        num_qa = len(list(QA_DIR.glob("*.md")))
        
        return f"""Based on the knowledge base, here's what I found:

**Answer:**

The system currently contains {num_concepts} concept articles, {num_connections} connection articles, and {num_qa} Q&A articles.

The knowledge base is operational and can answer questions based on compiled conversations. The mock backend is running, which demonstrates all file operations work correctly.

**Sample Available Topics:**
{self._list_available_topics()}

**Sources:**
The answer would normally cite specific articles using [[wikilinks]] format.

*This response generated by the Mock LLM backend (free, no API calls required).*
"""
    
    def _list_available_topics(self) -> str:
        """List some available topics from the knowledge base"""
        concepts = list(CONCEPTS_DIR.glob("*.md"))
        if not concepts:
            return "- (No concept articles yet. Run compile.py to create some.)"
        
        topics = []
        for cf in concepts[:5]:  # Show up to 5
            title = cf.stem.replace('-', ' ').title()
            topics.append(f"- [[concepts/{cf.stem}]] - {title}")
        
        return '\n'.join(topics)


# Import at function time to avoid circular imports
def list_wiki_articles():
    """Helper to list wiki articles"""
    from config import CONCEPTS_DIR, CONNECTIONS_DIR, QA_DIR
    articles = []
    articles.extend(CONCEPTS_DIR.glob("*.md"))
    articles.extend(CONNECTIONS_DIR.glob("*.md"))
    articles.extend(QA_DIR.glob("*.md"))
    return sorted(articles)


def get_backend(backend_name: str = None) -> LLMBackend:
    """
    Factory function to get the appropriate LLM backend.
    
    Backend priority:
    1. Explicit backend_name parameter
    2. LLM_BACKEND environment variable
    3. Default to 'mock'
    """
    from config import LLM_BACKEND as CONFIG_BACKEND
    
    backend = backend_name or os.getenv("LLM_BACKEND", CONFIG_BACKEND).lower()
    
    if backend == "mock":
        return MockBackend()
    elif backend == "openai":
        return OpenAIBackend()
    elif backend == "anthropic":
        return AnthropicBackend()
    elif backend == "opencode":
        return OpencodeBackend()
    else:
        raise ValueError(f"Unknown backend: {backend}. Choose from: mock, openai, anthropic, opencode")


class OpenAIBackend(LLMBackend):
    """OpenAI API backend"""
    
    def __init__(self, api_key: str = None, model: str = None):
        try:
            import openai
            self.openai = openai
        except ImportError:
            raise ImportError("Please install openai: pip install openai")
        
        from config import OPENAI_API_KEY, OPENAI_MODEL
        self.api_key = api_key or OPENAI_API_KEY or os.getenv("OPENAI_API_KEY")
        self.model = model or OPENAI_MODEL or "gpt-4"
        self.client = None
        
    def _ensure_client(self):
        if self.client is None:
            self.client = self.openai.OpenAI(api_key=self.api_key)
    
    async def query_stream(self, prompt: str, system_prompt: str = None,
                          max_turns: int = 10, **kwargs) -> AsyncGenerator[str, None]:
        self._ensure_client()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        stream = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
        )
        
        for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    
    async def query_with_cost(self, prompt: str, system_prompt: str = None,
                             max_turns: int = 10, **kwargs) -> Tuple[str, float]:
        self._ensure_client()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
        )
        
        content = response.choices[0].message.content
        # Rough cost calculation
        usage = response.usage
        # Pricing varies by model - using gpt-4 as baseline
        cost = (usage.prompt_tokens * 0.00003 + usage.completion_tokens * 0.00006)
        return content, cost


class AnthropicBackend(LLMBackend):
    """Anthropic Claude backend"""
    
    def __init__(self, api_key: str = None, model: str = None):
        try:
            import anthropic
            self.anthropic = anthropic
        except ImportError:
            raise ImportError("Please install anthropic: pip install anthropic")
        
        from config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL
        self.api_key = api_key or ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY")
        self.model = model or ANTHROPIC_MODEL or "claude-3-opus-20240229"
        self.client = None
    
    def _ensure_client(self):
        if self.client is None:
            self.client = self.anthropic.Anthropic(api_key=self.api_key)
    
    async def query_stream(self, prompt: str, system_prompt: str = None,
                          max_turns: int = 10, **kwargs) -> AsyncGenerator[str, None]:
        self._ensure_client()
        with self.client.messages.stream(
            model=self.model,
            max_tokens=4096,
            system=system_prompt or "",
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield text
    
    async def query_with_cost(self, prompt: str, system_prompt: str = None,
                             max_turns: int = 10, **kwargs) -> Tuple[str, float]:
        self._ensure_client()
        message = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt or "",
            messages=[{"role": "user", "content": prompt}],
        )
        
        content = message.content[0].text
        # Anthropic pricing: $15/1M input, $75/1M output for Opus
        input_cost = message.usage.input_tokens * 0.000015
        output_cost = message.usage.output_tokens * 0.000075
        return content, input_cost + output_cost


class OpencodeBackend(LLMBackend):
    """Placeholder for Opencode Agent SDK integration"""
    
    async def query_stream(self, prompt: str, system_prompt: str = None,
                          max_turns: int = 10, **kwargs) -> AsyncGenerator[str, None]:
        """Not yet implemented - see INTEGRATION.md"""
        raise NotImplementedError(
            "Opc Agent SDK integration not yet implemented. "
            "See INTEGRATION.md for details on how to add it. "
            "For now, use 'mock' or 'openai' backend."
        )
    
    async def query_with_cost(self, prompt: str, system_prompt: str = None,
                             max_turns: int = 10, **kwargs) -> Tuple[str, float]:
        """Not yet implemented"""
        raise NotImplementedError(
            "Opc Agent SDK integration not yet implemented. "
            "See INTEGRATION.md for details."
        )