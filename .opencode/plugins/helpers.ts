/**
 * Helper functions for the memory compiler plugin
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"

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
    return entries.filter(e => e.isFile()).map(e => e.name)
  } catch (err) {
    // Note: In a real implementation, we'd want to log this error
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
  if (!raw || !raw.trim()) return { ingested: {}, query_count: 0, last_lint: null, total_cost: 0 }
  try { return JSON.parse(raw) } catch { return { ingested: {}, query_count: 0, last_lint: null, total_cost: 0 } }
}

export async function saveState(absRoot: string, state: Record<string, any>): Promise<void> {
  await writeText(absRoot, STATE_FILE, JSON.stringify(state, null, 2))
}
