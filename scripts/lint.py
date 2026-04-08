#!/usr/bin/env python3
"""
Perform health checks on the knowledge base.
Runs 7 checks to maintain wiki quality.
"""

import argparse
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Tuple, Set

# Add scripts directory to path to import sibling modules
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

PROJECT_ROOT = SCRIPTS_DIR.parent

from config import KNOWLEDGE_DIR, DAILY_DIR, INDEX_FILE, LOG_FILE, REPORTS_DIR, now_iso
from utils import list_wiki_articles, read_wiki_index


class LintReport:
    """Collects lint findings and generates report"""
    
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.suggestions = []
        self.stats = {
            "articles_checked": 0,
            "broken_links": 0,
            "orphan_pages": 0,
            "missing_backlinks": 0,
            "sparse_articles": 0,
            # "contradictions": 0,  # Only checked if LLM available
        }
    
    def add_error(self, message: str, details: str = ""):
        self.errors.append({"message": message, "details": details})
    
    def add_warning(self, message: str, details: str = ""):
        self.warnings.append({"message": message, "details": details})
    
    def add_suggestion(self, message: str, details: str = ""):
        self.suggestions.append({"message": message, "details": details})
    
    def generate_markdown(self) -> str:
        """Generate a markdown report"""
        lines = [
            f"# Knowledge Base Lint Report",
            f"**Generated:** {now_iso()}",
            f"",
            f"## Summary",
            f"- Articles checked: {self.stats['articles_checked']}",
            f"- Errors: {len(self.errors)}",
            f"- Warnings: {len(self.warnings)}",
            f"- Suggestions: {len(self.suggestions)}",
            f"",
            f"## Detailed Findings",
            f"",
        ]
        
        if self.errors:
            lines.append("### ❌ Errors")
            lines.append("")
            for i, err in enumerate(self.errors, 1):
                lines.append(f"{i}. **{err['message']}**")
                if err['details']:
                    lines.append(f"   {err['details']}")
                lines.append("")
        
        if self.warnings:
            lines.append("### ⚠️ Warnings")
            lines.append("")
            for i, warn in enumerate(self.warnings, 1):
                lines.append(f"{i}. **{warn['message']}**")
                if warn['details']:
                    lines.append(f"   {warn['details']}")
                lines.append("")
        
        if self.suggestions:
            lines.append("### 💡 Suggestions")
            lines.append("")
            for i, sug in enumerate(self.suggestions, 1):
                lines.append(f"{i}. **{sug['message']}**")
                if sug['details']:
                    lines.append(f"   {sug['details']}")
                lines.append("")
        
        lines.extend([
            "## Statistics",
            f"- Broken links: {self.stats['broken_links']}",
            f"- Orphan pages: {self.stats['orphan_pages']}",
            f"- Missing backlinks: {self.stats['missing_backlinks']}",
            f"- Sparse articles (<200 words): {self.stats['sparse_articles']}",
        ])
        
        return "\n".join(lines)


def find_wikilinks(content: str) -> Set[str]:
    """Extract all [[wikilinks]] from markdown content"""
    # Pattern: [[path/to/article]] (without .md extension)
    pattern = r'\[\[([^\]]+?)\]\]'
    return set(re.findall(pattern, content))


def count_inbound_links(all_articles: Dict[Path, str]) -> Dict[str, int]:
    """
    Count inbound links for each article.
    Returns mapping of article path (relative) to inbound link count.
    """
    inbound_counts = defaultdict(int)
    
    for article_path, content in all_articles.items():
        rel_path = str(article_path.relative_to(KNOWLEDGE_DIR))
        links = find_wikilinks(content)
        
        for link in links:
            # Normalize link to relative path
            link_path = link if link.endswith('.md') else f"{link}.md"
            inbound_counts[link_path] += 1
    
    return inbound_counts


def check_broken_links(all_articles: Dict[Path, str], report: LintReport) -> None:
    """Check for [[wikilinks]] that point to non-existent articles"""
    all_article_names = set()
    for path in all_articles.keys():
        rel = str(path.relative_to(KNOWLEDGE_DIR))
        all_article_names.add(rel)
        all_article_names.add(rel.replace('.md', ''))  # Without extension too
    
    broken_count = 0
    for article_path, content in all_articles.items():
        links = find_wikilinks(content)
        for link in links:
            link_with_md = link if link.endswith('.md') else f"{link}.md"
            if link_with_md not in all_article_names:
                report.add_warning(
                    f"Broken link in {article_path.name}",
                    f"Link [[{link}]] points to non-existent article"
                )
                broken_count += 1
    
    report.stats['broken_links'] = broken_count


def check_orphan_pages(all_articles: Dict[Path, str], inbound_counts: Dict[str, int], report: LintReport) -> None:
    """Check for articles with zero inbound links"""
    orphan_count = 0
    for article_path in all_articles.keys():
        rel_path = str(article_path.relative_to(KNOWLEDGE_DIR))
        inbound = inbound_counts.get(rel_path, 0)
        if inbound == 0:
            orphan_count += 1
            report.add_suggestion(
                f"Orphan page: {article_path.name}",
                f"No other articles link to this page. Consider adding links from related articles."
            )
    
    report.stats['orphan_pages'] = orphan_count


def check_missing_backlinks(all_articles: Dict[Path, str], inbound_counts: Dict[str, int], report: LintReport) -> None:
    """Check for A→B links where B doesn't link back to A (inexact check)"""
    missing_count = 0
    for article_path, content in all_articles.items():
        rel_from = str(article_path.relative_to(KNOWLEDGE_DIR))
        links = find_wikilinks(content)
        
        for link in links:
            link_with_md = link if link.endswith('.md') else f"{link}.md"
            # Check if this article (rel_from) is in the inbound count of the linked article
            # This is an approximation - true backlinks would require A→B AND B→A
            if inbound_counts.get(rel_from, 0) < len(links):
                missing_count += 1
                report.add_suggestion(
                    f"Missing backlink: {article_path.name} → {link}",
                    f"Consider adding a link back from {link} to {article_path.name}"
                )
    
    report.stats['missing_backlinks'] = missing_count // 2  # Approximate unique pairs


def check_sparse_articles(all_articles: Dict[Path, str], report: LintReport) -> None:
    """Check for articles under 200 words (likely incomplete)"""
    sparse_count = 0
    for article_path, content in all_articles.items():
        # Strip YAML frontmatter first
        if content.startswith('---'):
            end_idx = content.find('---', 3)
            if end_idx != -1:
                body = content[end_idx+3:].strip()
            else:
                body = content
        else:
            body = content
        
        word_count = len(body.split())
        if word_count < 200:
            sparse_count += 1
            report.add_suggestion(
                f"Sparse article: {article_path.name}",
                f"Only {word_count} words. Consider expanding with more detail."
            )
    
    report.stats['sparse_articles'] = sparse_count


def check_orphan_sources(report: LintReport) -> None:
    """Check for daily logs that haven't been compiled yet"""
    # This requires checking which daily logs have entries in state.json
    # For now, just report if daily/ has logs but knowledge/ is empty or very small
    
    daily_logs = list(DAILY_DIR.glob("*.md"))
    if daily_logs:
        concept_count = len(list(KNOWLEDGE_DIR.glob("concepts/*.md")))
        if concept_count == 0:
            report.add_warning(
                "Orphan sources detected",
                f"Found {len(daily_logs)} daily log(s) but no compiled concepts yet. Run compile.py."
            )
        elif len(daily_logs) > concept_count * 5:
            # More than 5 logs per concept suggests pending compilation
            report.add_warning(
                "High backlog of logs",
                f"{len(daily_logs)} daily logs but only {concept_count} concept articles. Consider running compile."
            )


def run_lint(structural_only: bool = False) -> LintReport:
    """Run all lint checks and return report"""
    report = LintReport()
    
    print("Loading knowledge base...")
    all_articles = {}
    for path in list_wiki_articles():
        try:
            all_articles[path] = path.read_text(encoding="utf-8")
        except Exception as e:
            report.add_error(f"Failed to read {path}", str(e))
    
    report.stats['articles_checked'] = len(all_articles)
    
    if not all_articles:
        report.add_warning("No articles found", "The knowledge base appears to be empty")
        return report
    
    print("Checking internal links...")
    inbound_counts = count_inbound_links(all_articles)
    
    print("Checking broken links...")
    check_broken_links(all_articles, report)
    
    print("Checking orphan pages...")
    check_orphan_pages(all_articles, inbound_counts, report)
    
    print("Checking missing backlinks...")
    check_missing_backlinks(all_articles, inbound_counts, report)
    
    print("Checking sparse articles...")
    check_sparse_articles(all_articles, report)
    
    print("Checking orphan sources...")
    check_orphan_sources(report)
    
    if not structural_only:
        print("Checking contradictions (LLM)...")
        # LLM-based contradiction check would go here
        report.add_suggestion(
            "Contradiction check",
            "LLM-based contradiction detection not available. Use external LLM or manual review."
        )
    
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Lint the knowledge base")
    parser.add_argument("--structural-only", action="store_true", 
                       help="Run only structural checks (skip expensive LLM checks)")
    parser.add_argument("--output", type=Path, help="Write report to file")
    
    args = parser.parse_args()
    
    print("Starting lint check...")
    report = run_lint(structural_only=args.structural_only)
    
    # Print summary
    print("\n" + "="*60)
    print("Lint Complete")
    print(f"  Articles: {report.stats['articles_checked']}")
    print(f"  Errors: {len(report.errors)}")
    print(f"  Warnings: {len(report.warnings)}")
    print(f"  Suggestions: {len(report.suggestions)}")
    print("="*60)
    
    # Generate report
    markdown = report.generate_markdown()
    print(markdown)
    
    # Write to file if requested
    if args.output:
        args.output.write_text(markdown, encoding="utf-8")
        print(f"\nReport saved to: {args.output}")
    elif REPORTS_DIR:
        # Auto-save to reports directory
        timestamp = datetime.now().strftime("%Y-%m-%d")
        report_file = REPORTS_DIR / f"lint-{timestamp}.md"
        report_file.parent.mkdir(exist_ok=True)
        report_file.write_text(markdown, encoding="utf-8")
        print(f"\nReport saved to: {report_file}")
    
    # Return non-zero if there are errors
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())