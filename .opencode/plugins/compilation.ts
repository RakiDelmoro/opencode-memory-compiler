/**
 * Compilation functionality for the memory compiler plugin
 * Handles converting daily logs to knowledge base articles
 */

import { debugLog, readText, writeText, listDirSafe, hashStr, loadState, saveState } from "./helpers"
import { extractKnowledge, callLLM } from "./knowledgeExtraction"

// ─── Parse LLM responses containing file-write blocks ─────────────────────
export function parseFileBlocks(response: string): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = []
  const re = /---NEWFILE:\s*(.+?)---\n([\s\S]*?)(?=---NEWFILE:|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(response)) !== null) {
    const trimmed = m[2].trim()
    if (trimmed) {
      blocks.push({ path: m[1].trim(), content: trimmed })
    }
  }
  return blocks
}

// ─── Read All Articles ────────────────────────────────────────
export async function readAllArticles(absRoot: string, KNOWLEDGE_DIR: string, CONCEPTS_SUB: string, CONNECTIONS_SUB: string, QA_SUB: string): Promise<Record<string, string>> {
  const articles: Record<string, string> = {}
  for (const sub of [CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB]) {
    const files = await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${sub}`)
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      const c = await readText(absRoot, `${KNOWLEDGE_DIR}/${sub}/${f}`)
      articles[`${KNOWLEDGE_DIR}/${sub}/${f}`] = c
    }
  }
  return articles
}

// ─── Compile Daily Log → Wiki Articles ──────────────────────
export async function maybeCompile(
  absRoot: string,
  DAILY_DIR: string,
  KNOWLEDGE_DIR: string,
  CONCEPTS_SUB: string,
  CONNECTIONS_SUB: string,
  QA_SUB: string,
  INDEX_FILE: string,
  LOG_FILE: string,
  AGENTS_FILE: string,
  COMPILE_AFTER_HOUR: number,
  client: any
): Promise<void> {
  const hour = new Date().getHours()
  if (hour < COMPILE_AFTER_HOUR) return

  const state = await loadState(absRoot)
  const logs = (await listDirSafe(absRoot, DAILY_DIR)).filter((f) => f.endsWith(".md"))
  if (!logs.length) return

  let compiled = 0
  for (const log of logs) {
    const content = await readText(absRoot, `${DAILY_DIR}/${log}`)
    if (!content.trim()) continue
    const hash = hashStr(content)
    if (state.ingested?.[log]?.hash === hash) continue
    try {
      const success = await compileDailyLog(
        absRoot,
        log,
        content,
        KNOWLEDGE_DIR,
        CONCEPTS_SUB,
        CONNECTIONS_SUB,
        QA_SUB,
        INDEX_FILE,
        LOG_FILE,
        AGENTS_FILE,
        client
      )
      if (success) {
        state.ingested = state.ingested || {}
        state.ingested[log] = { hash, compiled_at: Date.now() }
        compiled++
      } else {
        await debugLog(absRoot, `maybeCompile: compileDailyLog(${log}) returned false, not marking as ingested`)
      }
    } catch (err) {
      // In a real implementation, we'd log this error properly
      console.error(`Compile failed ${log}: ${err}`)
    }
  }
  await saveState(absRoot, state)
  if (compiled > 0) {
    await debugLog(absRoot, `Compiled ${compiled} daily log(s)`)
  }
}

// ─── Compile Single Daily Log ────────────────────────────────
export async function compileDailyLog(
  absRoot: string,
  logName: string,
  logContent: string,
  KNOWLEDGE_DIR: string,
  CONCEPTS_SUB: string,
  CONNECTIONS_SUB: string,
  QA_SUB: string,
  INDEX_FILE: string,
  LOG_FILE: string,
  AGENTS_FILE: string,
  client: any
): Promise<boolean> {
  if (!logContent.trim()) return false

  const schema = await readText(absRoot, AGENTS_FILE)
  const indexContent = await readText(absRoot, INDEX_FILE)

  const articleParts: string[] = []
  for (const sub of [CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB]) {
    const files = await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${sub}`)
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      const c = await readText(absRoot, `${KNOWLEDGE_DIR}/${sub}/${f}`)
      articleParts.push(`### knowledge/${sub}/${f}\n${c.slice(0, 1500)}`)
    }
  }
  const articlesText = articleParts.length
    ? articleParts.join("\n\n")
    : "(no existing articles yet)"

  const prompt = `You are the OPENCODE Memory Compiler. Read a daily conversation log and produce structured wiki articles.

## Schema
${schema.slice(0, 3000)}

## Daily Log

${logContent}

## Current Knowledge Index
${indexContent || "(no index yet)"}

## Existing Articles
${articlesText}

## Task
1. Extract distinct concepts → create files at \`knowledge/concepts/<slug>.md\`
2. If non-obvious connections between 2+ concepts → create \`knowledge/connections/<slug>.md\`
3. If this log adds new info to existing articles → update them in-place
4. Update \`knowledge/index.md\` (complete table, not delta)
5. Append a compilation entry to \`knowledge/log.md\`

Format your output using ---NEWFILE: path--- blocks:
---NEWFILE: knowledge/concepts/python-fstrings.md---
---
title: "Python f-strings"
aliases: [formatted-string-literals]
tags: [python, syntax]
sources:
  - "daily/2026-04-08.md"
created: 2026-04-08
updated: 2026-04-08
word_count: 180
---

# Python f-strings
[content]
---NEWFILE: knowledge/index.md---
# Knowledge Base Index
| Article | Summary | Compiled From | Updated |
|---------|---------|---------------|---------|
| [[concepts/supabase-auth]] | Row-level security patterns and JWT gotchas | daily/2026-04-02.md | 2026-04-02
| [[connections/auth-and-webhooks]] | Token verification patterns shared across Supabase auth and Stripe webhooks | daily/2026-04-02.md, daily/2026-04-04.md | 2026-04-04
---

Begin compilation now.`

  const response = await callLLM(client, prompt)
  if (!response) return false

  const files = parseFileBlocks(response)
  if (!files.length) {
    await debugLog(absRoot, `compileDailyLog: no file blocks parsed from LLM response`)
    return false
  }

  let wroteFiles = 0
  for (const file of files) {
    const safe = file.path.startsWith(KNOWLEDGE_DIR)
    if (!safe) continue
    await writeText(absRoot, file.path, file.content)
    await debugLog(absRoot, `compileDailyLog wrote: ${file.path}`)
    wroteFiles++
  }

  if (wroteFiles === 0) return false

  const state = await loadState(absRoot)
  state.last_compile = Date.now()
  await saveState(absRoot, state)
  return true
}
