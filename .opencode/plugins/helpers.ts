/**
 * Helper functions for the memory compiler plugin
 */

import * as fs from "fs/promises"
import * as path from "path"

// ─── Paths (workspace-relative) ───────────────────────────────────
export const DAILY_DIR = "daily"
export const KNOWLEDGE_DIR = "knowledge"
export const CONCEPTS_SUB = "concepts"
export const CONNECTIONS_SUB = "connections"
export const QA_SUB = "qa"
export const INDEX_FILE = `${KNOWLEDGE_DIR}/index.md`
export const LOG_FILE = `${KNOWLEDGE_DIR}/log.md`
export const STATE_DIR = "state"
export const STATE_FILE = `${STATE_DIR}/state.json`
export const AGENTS_FILE = "AGENTS.md"
export const COMPILE_AFTER_HOUR = 18 // 6 PM local
export const SEARCH_INDEX_FILE = `${KNOWLEDGE_DIR}/.searchIndex.json`

// ─── Helpers ───────────────────────────────────────────────────
export async function debugLog(absRoot: string, msg: string): Promise<void> {
  const logFile = path.join(absRoot, STATE_DIR, "debug.log")
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    await fs.mkdir(path.join(absRoot, STATE_DIR), { recursive: true })
    let existing = ""
    try { existing = await fs.readFile(logFile, "utf-8") } catch {}
    const trimmed = existing.length > 100000 ? existing.slice(existing.length - 100000) : existing
    await fs.writeFile(logFile, line + trimmed, "utf-8")
  } catch {
    // debug log failure is non-fatal
  }
}

export async function ensureDirs(absRoot: string): Promise<void> {
  await fs.mkdir(path.join(absRoot, DAILY_DIR), { recursive: true })
  await fs.mkdir(path.join(absRoot, KNOWLEDGE_DIR, CONCEPTS_SUB), { recursive: true })
  await fs.mkdir(path.join(absRoot, KNOWLEDGE_DIR, CONNECTIONS_SUB), { recursive: true })
  await fs.mkdir(path.join(absRoot, KNOWLEDGE_DIR, QA_SUB), { recursive: true })
  await fs.mkdir(path.join(absRoot, STATE_DIR), { recursive: true })
}

export async function readText(absRoot: string, relPath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(absRoot, relPath), "utf-8")
  } catch {
    return ""
  }
}

export async function writeText(absRoot: string, relPath: string, content: string): Promise<void> {
  const abs = path.join(absRoot, relPath)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, "utf-8")
}

export async function listDirSafe(absRoot: string, relDir: string): Promise<string[]> {
  try {
    const abs = path.join(absRoot, relDir)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    return entries.filter((e: any) => e.isFile()).map((e: any) => e.name)
   } catch (err: any) {
     // Note: In a real implementation, we'd want to log this error properly
     // but we're keeping the same behavior as the original
     return []
   }
}

export function hashStr(content: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i)
    h1 = 31 * h1 + c * 307
    h2 = 31 * h2 + c * 307
  }
  return (
    Math.abs(h1).toString(16).padStart(8, "0") +
    Math.abs(h2).toString(16).padStart(8, "0") +
    Math.abs(h1 << 1).toString(16).padStart(8, "0") +
    Math.abs(h1 >>> 1).toString(16).padStart(8, "0")
  )
}

export async function loadState(absRoot: string): Promise<Record<string, any>> {
  const raw = await readText(absRoot, STATE_FILE)
  if (!raw || !raw.trim()) return { ingested: {}, query_count: 0, last_lint: null, total_cost: 0, sessions: {} }
  try { return JSON.parse(raw) } catch { return { ingested: {}, query_count: 0, last_lint: null, total_cost: 0, sessions: {} } }
}

export async function saveState(absRoot: string, state: Record<string, any>): Promise<void> {
  await writeText(absRoot, STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── Session State Persistence ─────────────────────────────────────
export interface SessionState {
  sessionId: string
  trackedEvents: number
  capturedUpTo: number
  compiledUpTo?: Record<string, number>  // optional for backwards compatibility
  lastCapture: string
  firstEventTime?: number
}

export async function loadSessionState(absRoot: string, sessionId: string): Promise<SessionState | null> {
  const state = await loadState(absRoot)
  const sess = state.sessions?.[sessionId]
  if (!sess) return null
  return {
    sessionId: sess.sessionId,
    trackedEvents: sess.trackedEvents,
    capturedUpTo: sess.capturedUpTo,
    compiledUpTo: sess.compiledUpTo,
    lastCapture: sess.lastCapture,
    firstEventTime: sess.firstEventTime
  } as SessionState
}

export async function saveSessionState(absRoot: string, sessionState: SessionState): Promise<void> {
  const state = await loadState(absRoot)
  if (!state.sessions) state.sessions = {}
  state.sessions[sessionState.sessionId] = {
    sessionId: sessionState.sessionId,
    trackedEvents: sessionState.trackedEvents,
    capturedUpTo: sessionState.capturedUpTo,
    compiledUpTo: sessionState.compiledUpTo,
    lastCapture: sessionState.lastCapture,
    firstEventTime: sessionState.firstEventTime
  }
  await saveState(absRoot, state)
}

// ─── Extract Priority Content from Daily Log ─────────────────────────
export function extractPriorityContent(logContent: string): string[] {
  const priorityLines: string[] = []
  const lines = logContent.split("\n")
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Check for flag markers anywhere in line
    if (/\[(DECISION|LESSON|PATTERN|TODO)\]/.test(line)) {
      // Find the start of this message (role header or metadata)
      let start = i
      while (start > 0) {
        const l = lines[start]
        if (l.match(/^###\s+Session\(/) || l.match(/^<!--\s*capture:/)) break
        if (l.match(/^\*\*(USER|ASSISTANT):\*\*/)) break
        start--
      }
      
      // Find end of this message (separator or next session)
      let end = i + 1
      while (end < lines.length) {
        const l = lines[end]
        if (l.match(/^###\s+Session\(/) || l.match(/^<!--\s*capture:/)) break
        if (l.trim() === "---" && end > i) break
        end++
      }
      
      // Extract message block (include flag lines)
      const block = lines.slice(start, end)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("<!--"))
        .join("\n")
        .replace(/\[(DECISION|LESSON|PATTERN|TODO)\]/g, "**[FLAG:$1]**")
        .trim()
      
      if (block && !priorityLines.includes(block)) {
        priorityLines.push(block)
      }
    }
  }
  
  return priorityLines
}

// ─── Extract Session Blocks from Daily Log ─────────────────────────────
export function extractSessionBlocks(logContent: string): Array<{
  metadata: string
  content: string
  orderMin: number
  orderMax: number
}> {
  const blocks: Array<{
    metadata: string
    content: string
    orderMin: number
    orderMax: number
  }> = []
  
  const lines = logContent.split("\n")
  let currentBlock: { metadata: string; contentLines: string[]; orderMin?: number; orderMax?: number } | null = null
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Detect start of a session block (only by session header)
    // Matches: "### Session (..." allowing optional whitespace before '('
    if (line.match(/^###\s+Session\s*\(/)) {
      // Save previous block if exists
      if (currentBlock) {
        blocks.push({
          metadata: currentBlock.metadata,
          content: currentBlock.contentLines.join("\n").trim(),
          orderMin: currentBlock.orderMin ?? 0,
          orderMax: currentBlock.orderMax ?? 0
        })
      }
      
      // Start new block
      currentBlock = {
        metadata: line,
        contentLines: [],
        orderMin: undefined,
        orderMax: undefined
      }
    } else if (currentBlock) {
      // Check if this line contains order metadata
      if (line.match(/<!--\s*capture:/)) {
        const orderMatch = line.match(/order:(\d+)-(\d+)/)
        if (orderMatch) {
          currentBlock.orderMin = parseInt(orderMatch[1], 10)
          currentBlock.orderMax = parseInt(orderMatch[2], 10)
        }
      }
      currentBlock.contentLines.push(line)
    }
  }
  
  // Save final block
  if (currentBlock) {
    blocks.push({
      metadata: currentBlock.metadata,
      content: currentBlock.contentLines.join("\n").trim(),
      orderMin: currentBlock.orderMin ?? 0,
      orderMax: currentBlock.orderMax ?? 0
    })
  }
  
   return blocks
 }

// ─── Search Index for Efficient Queries ─────────────────────────────────────
export interface SearchIndexEntry {
  path: string
  summary: string
  tokens: string[]
  title?: string
  updated: number
  wikilinks: string[]  // outgoing links
  backlinks: string[]  // incoming links
}

export function tokenize(text: string): string[] {
  // Lowercase, split on non-word chars, remove stopwords, dedupe
  const stopwords = new Set(["the","and","or","a","an","in","on","at","to","for","of","with","by","is","are","was","were","be","been","have","has","had","do","does","did","will","would","should","can","could","may","might","must","i","you","we","they","it","he","she","his","her","their","my","our","this","that","these","those","what","which","who","when","where","why","how","but","if","then","else","not","no","yes","from","as","into","out","up","down","over","under","again","further","then","once","here","there","when","where","why","how","all","some","most","many","few","more","less","least","each","every","other","such","only","own","same","so","than","too","very","just","now"])
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2 && !stopwords.has(t) && !/^\d+$/.test(t))
}

export function extractSummary(content: string): string {
  // Get first meaningful paragraph (non-empty, non-frontmatter)
  const lines = content.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length > 20 && !trimmed.startsWith("---") && !trimmed.startsWith("#") && !trimmed.startsWith("<!--")) {
      return trimmed.slice(0, 300)
    }
  }
  // Fallback: first non-empty line
  for (const line of lines) {
    if (line.trim().length > 0) return line.trim().slice(0, 300)
  }
  return content.slice(0, 300)
}

export async function buildSearchIndex(absRoot: string): Promise<void> {
  const index: SearchIndexEntry[] = []
  
  // Scan all article directories
  for (const sub of [CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB]) {
    const dir = `${KNOWLEDGE_DIR}/${sub}`
    const files = await listDirSafe(absRoot, dir)
    for (const file of files.filter(f => f.endsWith(".md"))) {
      const fullPath = `${dir}/${file}`
      const content = await readText(absRoot, fullPath)
      if (!content.trim()) continue
      
      // Extract title from frontmatter or first H1
      const titleMatch = content.match(/^title:\s*"(.+?)"/m) || content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1] : file.replace(".md", "")
      
      // Extract summary
      const summary = extractSummary(content)
      
      // Tokenize title + summary (weight title twice)
      const tokens = new Set<string>()
      for (const t of tokenize(title)) tokens.add(t)
      for (const t of tokenize(title)) tokens.add(t)  // double weight
      for (const t of tokenize(summary)) tokens.add(t)
      
      // Extract wikilinks (outgoing) — store as full paths relative to project root (knowledge/...)
      const wikilinks: string[] = []
      const linkRe = /\[\[([^\]]+)\]\]/g
      let match: RegExpExecArray | null
      while ((match = linkRe.exec(content)) !== null) {
        let target = match[1]
        // Remove .md extension if present
        if (target.endsWith(".md")) target = target.slice(0, -3)
        // Build full path: if target includes '/', it's already subdir; else use same sub as current article
        let fullPath: string
        if (target.includes("/")) {
          fullPath = `knowledge/${target}.md`
        } else {
          fullPath = `knowledge/${sub}/${target}.md`
        }
        wikilinks.push(fullPath)
      }
      
      // Get file modification time for freshness
      try {
        const stat = await fs.stat(path.join(absRoot, fullPath))
        index.push({ path: fullPath, summary, tokens: Array.from(tokens), title, updated: stat.mtime.getTime(), wikilinks, backlinks: [] })
      } catch {
        index.push({ path: fullPath, summary, tokens: Array.from(tokens), title, updated: 0, wikilinks, backlinks: [] })
      }
    }
  }
  
  // Compute backlinks by inverting the graph
  for (let i = 0; i < index.length; i++) {
    const entry = index[i]
    for (const target of entry.wikilinks) {
      // Find target entry by path
      const targetIdx = index.findIndex(e => e.path === target)
      if (targetIdx !== -1) {
        index[targetIdx].backlinks.push(entry.path)
      }
    }
  }
  
  await writeText(absRoot, SEARCH_INDEX_FILE, JSON.stringify(index, null, 0))
}

export async function readSearchIndex(absRoot: string): Promise<SearchIndexEntry[]> {
  const raw = await readText(absRoot, SEARCH_INDEX_FILE)
  if (!raw.trim()) return []
  try {
    return JSON.parse(raw) as SearchIndexEntry[]
  } catch {
    return []
  }
}

export function scoreQueryMatch(entry: SearchIndexEntry, queryTokens: string[]): number {
  let score = 0
  const tokenSet = new Set(entry.tokens)
  for (const qt of queryTokens) {
    if (tokenSet.has(qt)) score++
  }
  // Boost exact title match
  if (entry.title && queryTokens.some(qt => entry.title!.toLowerCase().includes(qt))) score += 2
  return score
}

// ─── Health Check Helpers ─────────────────────────────────────────────
export function parseFrontmatter(content: string): Record<string, any> | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/m)
  if (!fmMatch) return null
  const fm: Record<string, any> = {}
  fmMatch[1].split("\n").forEach(line => {
    const [key, ...rest] = line.split(":")
    if (key && rest.length) {
      const value = rest.join(":").trim().replace(/^"|"$/g, "")
      // Try to parse JSON-like arrays/objects
      try {
        // Simple: if value starts with [ or { try JSON.parse
        if (value.startsWith("[") || value.startsWith("{")) {
          fm[key.trim()] = JSON.parse(value)
        } else {
          fm[key.trim()] = value
        }
      } catch {
        fm[key.trim()] = value
      }
    }
  })
  return fm
}

export async function loadIndexArticles(absRoot: string): Promise<Set<string>> {
  const indexContent = await readText(absRoot, INDEX_FILE)
  const articles = new Set<string>()
  if (!indexContent) return articles
  
  const lines = indexContent.split("\n")
  for (const line of lines) {
    const match = line.match(/\[\[([^\]]+)\]\]/)
    if (match) {
      // Convert wikilink to full path: [[concepts/foo]] → knowledge/concepts/foo.md
      const path = `knowledge/${match[1]}.md`
      articles.add(path)
    }
  }
  return articles
}

export function detectCycles(searchIndex: SearchIndexEntry[], maxDepth: number = 10): Array<{cycle: string[]}> {
  const graph = new Map<string, string[]>()
  for (const entry of searchIndex) {
    graph.set(entry.path, entry.wikilinks || [])
  }
  
  const cycles: Array<{cycle: string[]}> = []
  const visited = new Set<string>()
  const stack: string[] = []
  const inStack = new Set<string>()
  
  function dfs(node: string, path: string[]) {
    if (path.length > maxDepth) return
    if (inStack.has(node)) {
      // Found cycle: path from node's first occurrence to current
      const cycleStart = path.indexOf(node)
      cycles.push({ cycle: path.slice(cycleStart).concat(node) })
      return
    }
    if (visited.has(node)) return
    
    visited.add(node)
    inStack.add(node)
    stack.push(node)
    
    const neighbors = graph.get(node) || []
    for (const neighbor of neighbors) {
      if (graph.has(neighbor)) {
        dfs(neighbor, [...path, node])
      }
    }
    
    inStack.delete(node)
    stack.pop()
  }
  
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, [])
    }
  }
  
  return cycles
}

export async function dirSize(absRoot: string, relDir: string): Promise<number> {
  // Returns total size in bytes
  let total = 0
  try {
    const files = await listDirSafe(absRoot, relDir)
    for (const file of files) {
      try {
        const stat = await fs.stat(path.join(absRoot, relDir, file))
        total += stat.size
      } catch {}
    }
  } catch {}
  return total
}

export async function getFileMtime(absRoot: string, relPath: string): Promise<number> {
  try {
    const stat = await fs.stat(path.join(absRoot, relPath))
    return stat.mtime.getTime()
  } catch {
    return 0
  }
}


