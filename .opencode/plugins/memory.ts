/**
 * OpenCode Memory Compiler Plugin
 *
 * Captures session transcripts by tracking message.part.updated events
 * in real-time, extracts knowledge, compiles structured wiki articles,
 * and injects memory context into new sessions.
 *
 * No external API keys or Python scripts required — everything runs
 * through the OpenCode SDK (client.session.prompt()).
 *
 * Architecture (Karpathy LLM Wiki pattern):
 *   raw sources (daily logs)  ->  LLM extraction  ->  persistent wiki (knowledge/)
 *                                                                         ^ injected at session start
 */

import { type Plugin, tool } from "@opencode-ai/plugin"
import * as fs from "node:fs/promises"
import * as path from "node:path"

// ─── Paths (workspace-relative) ───────────────────────────────────
const DAILY_DIR = "daily"
const KNOWLEDGE_DIR = "knowledge"
const CONCEPTS_SUB = "concepts"
const CONNECTIONS_SUB = "connections"
const QA_SUB = "qa"
const INDEX_FILE = `${KNOWLEDGE_DIR}/index.md`
const LOG_FILE = `${KNOWLEDGE_DIR}/log.md`
const STATE_DIR = "state"
const STATE_FILE = `${STATE_DIR}/state.json`
const AGENTS_FILE = "AGENTS.md"
const COMPILE_AFTER_HOUR = 18 // 6 PM local

// ─── Plugin ───────────────────────────────────────────────────────
export const MemoryPlugin: Plugin = async ({
  client,
  directory,
  $,
}) => {
  const root = directory ?? "."
  const absRoot = path.resolve(root)

  // ── In-memory session tracking ─────────────────────────────────
  // Track message parts by ID (avoids duplicates from streaming updates)
  const sessionParts: Map<string, { role: string; text: string; order: number }> = new Map()
  // Track message roles from message.updated events (parts don't carry role)
  const messageRoles: Map<string, string> = new Map()
  let eventCounter = 0

  // Also track the last known session ID for fallback
  let activeSession: string | null = null

  // ── helpers ───────────────────────────────────────────────────

  async function debugLog(msg: string): Promise<void> {
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

  async function ensureDirs(): Promise<void> {
    await fs.mkdir(path.join(absRoot, DAILY_DIR), { recursive: true })
    await fs.mkdir(path.join(absRoot, KNOWLEDGE_DIR, CONCEPTS_SUB), { recursive: true })
    await fs.mkdir(path.join(absRoot, KNOWLEDGE_DIR, CONNECTIONS_SUB), { recursive: true })
    await fs.mkdir(path.join(absRoot, KNOWLEDGE_DIR, QA_SUB), { recursive: true })
    await fs.mkdir(path.join(absRoot, STATE_DIR), { recursive: true })
  }

  async function readText(relPath: string): Promise<string> {
    try {
      return await fs.readFile(path.join(absRoot, relPath), "utf-8")
    } catch {
      return ""
    }
  }

  async function writeText(relPath: string, content: string): Promise<void> {
    const abs = path.join(absRoot, relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, "utf-8")
  }

  async function listDirSafe(relDir: string): Promise<string[]> {
    try {
      const abs = path.join(absRoot, relDir)
      const entries = await fs.readdir(abs, { withFileTypes: true })
      return entries.filter(e => e.isFile()).map(e => e.name)
    } catch (err) {
      await debugLog(`listDirSafe error: ${relDir} -> ${err}`)
      return []
    }
  }

  function hashStr(content: string): string {
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

  async function loadState(): Promise<Record<string, any>> {
    const raw = await readText(STATE_FILE)
    if (!raw || !raw.trim()) return { ingested: {}, query_count: 0, last_lint: null, total_cost: 0 }
    try { return JSON.parse(raw) } catch { return { ingested: {}, query_count: 0, last_lint: null, total_cost: 0 } }
  }

  async function saveState(state: Record<string, any>): Promise<void> {
    await writeText(STATE_FILE, JSON.stringify(state, null, 2))
  }

  // ── LLM helper ──────────────────────────────────────────────
  // The OpenCode SDK wraps all responses under a `data` key:
  //   { data: { id: "ses_xxx", ... }, request: {}, response: {} }
  // We must unwrap before accessing fields.
  async function callLLM(prompt: string): Promise<string> {
    let sessionId = ""
    try {
      await debugLog(`callLLM: creating temp session`)
      const rawCreate: any = await client.session.create({
        body: { title: "[memory-agent]" },
      })
      const created = rawCreate?.data ?? rawCreate
      sessionId = created?.id ?? ""
      await debugLog(`callLLM: session created, id=${sessionId}, rawKeys=${JSON.stringify(Object.keys(rawCreate ?? {}))}`)

      if (!sessionId.startsWith("ses_")) {
        throw new Error(`session.create returned invalid ID: ${JSON.stringify(rawCreate)}`)
      }

      await debugLog(`callLLM: sending prompt (${prompt.length} chars) to session ${sessionId}`)
      const rawResult: any = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
      })

      // Unwrap SDK response
      const result = rawResult?.data ?? rawResult
      const resultKeys = Object.keys(result ?? {})
      await debugLog(`callLLM: result keys: ${JSON.stringify(resultKeys)}`)

      // Check for error responses at both levels
      if (rawResult?.error) throw new Error(`LLM API error: ${JSON.stringify(rawResult.error)}`)
      if (result?.error) throw new Error(`LLM data error: ${JSON.stringify(result.error)}`)

      // Try multiple response formats
      let text = ""

      // Format 1: result.parts
      const parts = result?.parts ?? []
      text = parts
        .filter((p: any) => p?.type === "text" || p?.type === "part.text")
        .map((p: any) => p?.text ?? "")
        .join("\n")

      // Format 2: result.content (array)
      if (!text && Array.isArray(result?.content)) {
        text = result.content
          .filter((p: any) => p?.type === "text")
          .map((p: any) => p?.text ?? "")
          .join("\n")
      }

      // Format 3: result.content (string)
      if (!text && typeof result?.content === "string") {
        text = result.content
      }

      await debugLog(`callLLM: got response (${text.length} chars)`)
      return text || ""
    } catch (err) {
      await debugLog(`callLLM ERROR: ${(err as Error)?.message ?? err}`)
      await client.app.log({
        body: {
          service: "memory-compiler",
          level: "error",
          message: `LLM call failed: ${(err as Error)?.message ?? err}`,
        },
      })
      return ""
    } finally {
      if (sessionId) {
        try {
          await client.session.delete({ sessionID: sessionId })
        } catch {}
      }
    }
  }

  /*  Parse LLM responses containing file-write blocks.  */
  function parseFileBlocks(response: string): Array<{ path: string; content: string }> {
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

  async function readAllArticles(): Promise<Record<string, string>> {
    const articles: Record<string, string> = {}
    for (const sub of [CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB]) {
      const files = await listDirSafe(`${KNOWLEDGE_DIR}/${sub}`)
      for (const f of files.filter((x) => x.endsWith(".md"))) {
        const c = await readText(`${KNOWLEDGE_DIR}/${sub}/${f}`)
        articles[`${KNOWLEDGE_DIR}/${sub}/${f}`] = c
      }
    }
    return articles
  }

  // ── Extract session ID from event properties ─────────────────
  function extractSessionId(ev: { properties?: any }): string | null {
    const p = ev.properties ?? {}
    return p.sessionID
      ?? p.id
      ?? p.session?.id
      ?? p.info?.id
      ?? null
  }

  // ── 1) Memory injection at session start ──────────────────────
  async function injectMemory(sessionId: string): Promise<void> {
    const indexContent = await readText(INDEX_FILE)
    if (!indexContent) return

    await debugLog(`injectMemory: injecting ${indexContent.length} chars into session ${sessionId}`)
    try {
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [
            {
              type: "text",
              text:
                `## Your Knowledge Base\n\nYou have a persistent knowledge base compiled from past coding sessions. ` +
                `Reference these articles when relevant — this is your memory.\n\n` +
                `\`\`\`\n${indexContent}\n\`\`\``,
            },
          ],
          noReply: true,
        },
      })
    } catch (err) {
      debugLog(`injectMemory error: ${err}`)
    }
  }

  // ── 2) Session capture ──────────────────────────────────────
  function getMessagesForSession(sessionId: string): Array<{ role: string; text: string; order: number }> {
    const msgs: Array<{ role: string; text: string; order: number }> = []
    for (const [key, val] of sessionParts.entries()) {
      if (key.startsWith(`${sessionId}:`)) {
        msgs.push(val)
      }
    }
    return msgs.sort((a, b) => a.order - b.order)
  }

  async function captureSession(sessionId: string): Promise<void> {
    await debugLog(`captureSession(${sessionId}) called`)
    await ensureDirs()

    const msgs = getMessagesForSession(sessionId)
    await debugLog(`tracked messages for session: ${msgs.length}`)
    if (msgs.length > 0) {
      const sampleRoles = msgs.map(m => `${m.role}:${m.text.slice(0, 20)}`).join(", ")
      await debugLog(`sample: ${sampleRoles}`)
    }

    if (msgs.length < 2) {
      await debugLog(`skipping: only ${msgs.length} messages with text (need 2+)`)
      return
    }

    const now = new Date()
    const transcript = msgs
      .map((m) => {
        const t = m.text.length > 2000 ? m.text.slice(0, 2000) + "…[truncated]" : m.text
        return t ? `**${m.role.toUpperCase()}:** ${t}` : ""
      })
      .filter(Boolean)
      .join("\n\n---\n\n")

    if (!transcript.trim()) {
      await debugLog(`skipping: empty transcript`)
      return
    }

    const today = now.toISOString().split("T")[0]
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const title = (msgs[0]?.text?.slice(0, 50) ?? sessionId).slice(0, 50)
    const logFile = `${DAILY_DIR}/${today}.md`

    await debugLog(`writing to ${logFile} (transcript: ${transcript.length} chars, title: ${title})`)
    const existing = await readText(logFile)
    const header = existing === "" ? `# Daily Log: ${today}\n\n## Sessions\n` : ""
    const entry = `\n\n### Session (${time}) - ${title}\n\n${transcript}\n`
    await writeText(logFile, existing + header + entry)
    await debugLog(`wrote ${logFile} successfully`)

    // Extract knowledge via LLM
    await debugLog(`extracting knowledge from transcript...`)
    const extracted = await extractKnowledge(transcript, time, title)
    if (extracted) {
      await debugLog(`extracted knowledge (${extracted.length} chars), appending to ${logFile}`)
      const updated = await readText(logFile)
      await writeText(logFile, updated + `\n${extracted}\n`)
      await debugLog(`appended knowledge to ${logFile}`)
    } else {
      await debugLog(`no significant knowledge extracted`)
    }

    // Maybe compile (auto-compile after 6 PM)
    await debugLog(`checking if should compile...`)
    await maybeCompile()
    await debugLog(`captureSession(${sessionId}) complete`)

    // Clean up tracked parts for this session
    for (const key of sessionParts.keys()) {
      if (key.startsWith(`${sessionId}:`)) sessionParts.delete(key)
    }
  }

  async function extractKnowledge(
    transcript: string,
    time: string,
    title: string,
  ): Promise<string | null> {
    const truncated = transcript.length > 12000
      ? transcript.slice(0, 12000) + "\n\n[... transcript truncated for context ...]"
      : transcript

    const prompt = `You are a knowledge-extraction assistant. Read this conversation and extract structured knowledge.

Conversation:
${truncated}

Return ONLY these sections (or "No significant knowledge extracted." if nothing worth capturing):

### Session ${time} - Knowledge: ${title}

**Decisions Made:**
- [Technical decisions, architectural choices, or "None"]

**Patterns Identified:**
- [Coding patterns, debugging approaches, or "None"]

**Lessons Learned:**
- [Gotchas discovered, best practices, or "None"]

**Action Items:**
- [ ] [Follow-up tasks, or "None"]`

    const result = await callLLM(prompt)
    if (!result || result.includes("No significant knowledge extracted")) return null
    return result
  }

  // ── 3) Compile daily logs → wiki articles ──────────────────────
  async function maybeCompile(): Promise<void> {
    const hour = new Date().getHours()
    if (hour < COMPILE_AFTER_HOUR) return

    const state = await loadState()
    const logs = (await listDirSafe(DAILY_DIR)).filter((f) => f.endsWith(".md"))
    if (!logs.length) return

    let compiled = 0
    for (const log of logs) {
      const content = await readText(`${DAILY_DIR}/${log}`)
      if (!content.trim()) continue
      const hash = hashStr(content)
      if (state.ingested?.[log]?.hash === hash) continue
      try {
        const success = await compileDailyLog(log)
        if (success) {
          state.ingested = state.ingested || {}
          state.ingested[log] = { hash, compiled_at: Date.now() }
          compiled++
        } else {
          await debugLog(`maybeCompile: compileDailyLog(${log}) returned false, not marking as ingested`)
        }
      } catch (err) {
        await client.app.log({
          body: { service: "memory-compiler", level: "error", message: `Compile failed ${log}: ${(err as Error)?.message}` },
        })
      }
    }
    await saveState(state)
    if (compiled > 0) {
      await client.app.log({
        body: { service: "memory-compiler", level: "info", message: `Compiled ${compiled} daily log(s)` },
      })
    }
  }

  async function compileDailyLog(logName: string): Promise<boolean> {
    const logContent = await readText(`${DAILY_DIR}/${logName}`)
    if (!logContent.trim()) return false

    const schema = await readText(AGENTS_FILE)
    const indexContent = await readText(INDEX_FILE)

    const articleParts: string[] = []
    for (const sub of [CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB]) {
      const files = await listDirSafe(`${KNOWLEDGE_DIR}/${sub}`)
      for (const f of files.filter((x) => x.endsWith(".md"))) {
        const c = await readText(`${KNOWLEDGE_DIR}/${sub}/${f}`)
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
...
---

Begin compilation now.`

    const response = await callLLM(prompt)
    if (!response) return false

    const files = parseFileBlocks(response)
    if (!files.length) {
      await debugLog(`compileDailyLog: no file blocks parsed from LLM response`)
      return false
    }

    let wroteFiles = 0
    for (const file of files) {
      const safe = file.path.startsWith(KNOWLEDGE_DIR)
      if (!safe) continue
      await writeText(file.path, file.content)
      await debugLog(`compileDailyLog wrote: ${file.path}`)
      wroteFiles++
    }

    if (wroteFiles === 0) return false

    const state = await loadState()
    state.last_compile = Date.now()
    await saveState(state)
    return true
  }

  // ── 4) Tools ────────────────────────────────────────────────────
  return {
    // ── Event hooks ──
    event: async (input: { event: { type: string; properties?: any } }) => {
      const { event } = input
      const sid = extractSessionId(event)
      if (sid) activeSession = sid

      // Track message roles from message.updated events
      if (event.type === "message.updated") {
        const msgId = event.properties?.info?.id ?? event.properties?.messageID
        const role = event.properties?.info?.role
        if (msgId && role) {
          messageRoles.set(msgId, role)
        }
      }

      // Track text-type message parts in real-time — deduplicated by part.id
      if (event.type === "message.part.updated") {
        const p = event.properties
        const sessionID = p?.sessionID ?? p?.part?.sessionID ?? activeSession
        const part = p?.part

        if (sessionID && part?.id && part.type === "text" && part.text?.trim()) {
          const msgId = part.messageID ?? ""
          const role = messageRoles.get(msgId) ?? "user"

          const key = `${sessionID}:${part.id}`
          const existingEntry = sessionParts.get(key)
          sessionParts.set(key, {
            role,
            text: part.text.trim(),
            order: existingEntry?.order ?? eventCounter++,
          })
          await debugLog(`tracked[${sessionID}]: ${role} text (${part.text.trim().length} chars) partId=${part.id}`)
        }
      }

      if (event.type === "session.compacted") {
        await debugLog(`session.compacted handler: sid=${sid ?? "(null)"}`)
        await client.app.log({ body: { service: "memory-compiler", level: "info", message: `session.compacted received, sid=${sid}` } })
        if (sid) await captureSession(sid)
      }

      if (event.type === "session.idle") {
        const captureSid = sid ?? activeSession
        await debugLog(`session.idle handler: sid=${captureSid}`)
        await client.app.log({ body: { service: "memory-compiler", level: "info", message: `session.idle received, sid=${captureSid}` } })
        if (captureSid) await captureSession(captureSid)
        activeSession = null
      }

      if (event.type === "session.created") {
        await debugLog(`session.created handler: sid=${sid}`)
        await client.app.log({ body: { service: "memory-compiler", level: "info", message: `session.created received, sid=${sid}` } })
        if (sid) setTimeout(() => injectMemory(sid), 1000)
      }
    },

    // ── Tools ──
    tool: {
      memory_query: tool({
        description: "Query the memory knowledge base. Ask things like: 'How did we set up auth?' or 'What was the React state management decision?'",
        args: {
          question: tool.schema.string({ description: "The question to answer from the knowledge base." }),
        },
        async execute(args: { question: string }): Promise<string> {
          await ensureDirs()
          const indexContent = await readText(INDEX_FILE)
          const articles = await readAllArticles()

          if (!indexContent && Object.keys(articles).length === 0) {
            return "The knowledge base is empty. Capture some conversations first and run memory_compile."
          }

          const articlesSummary = Object.entries(articles)
            .map(([p, c]) => `### ${p}\n${c.slice(0, 800)}`)
            .join("\n\n")

          const prompt = `Answer this question using the knowledge base.

Question: ${args.question}

## Index
${indexContent || "(no index)"}

## Articles
${articlesSummary}`

          return await callLLM(prompt) || "Sorry, I couldn't process your question."
        }
      }),

      memory_compile: tool({
        description: "Manually compile any uncompiled daily logs into knowledge articles.",
        args: {},
        async execute(): Promise<string> {
          await ensureDirs()
          await debugLog(`memory_compile called`)
          const state = await loadState()
          const logs = await listDirSafe(DAILY_DIR)
          await debugLog(`memory_compile found logs: ${JSON.stringify(logs)}`)
          const mdLogs = logs.filter((f) => f.endsWith(".md"))

          if (!mdLogs.length) return `No daily logs found in ${DAILY_DIR}/. Make sure the plugin captured at least one session.`

          let compiled = 0
          let failed = 0
          for (const log of mdLogs) {
            const content = await readText(`${DAILY_DIR}/${log}`)
            const hash = hashStr(content)
            if (state.ingested?.[log]?.hash === hash) continue
            const success = await compileDailyLog(log)
            if (success) {
              await debugLog(`memory_compile: successfully compiled ${log}`)
              state.ingested = state.ingested || {}
              state.ingested[log] = { hash, compiled_at: Date.now() }
              compiled++
            } else {
              await debugLog(`memory_compile: compileDailyLog(${log}) returned false`)
              failed++
            }
          }

          await saveState(state)
          if (compiled > 0 && failed === 0) return `✅ Compiled ${compiled} daily log(s) into knowledge articles.`
          if (compiled > 0 && failed > 0) return `⚠️ Compiled ${compiled} daily log(s), but ${failed} failed. Check state/debug.log for details.`
          if (failed > 0) return `❌ Compilation failed for ${failed} log(s). LLM returned empty responses — check your model configuration. Check state/debug.log.`
          return "All daily logs already compiled. Nothing new to process."
        }
      }),

      memory_lint: tool({
        description: "Run health checks on the knowledge base (broken links, orphan pages, stale articles).",
        args: {},
        async execute(): Promise<string> {
          await ensureDirs()
          const errors: string[] = []
          const warnings: string[] = []
          const articles = await readAllArticles()
          const allPaths = new Set(Object.keys(articles))
          const wikiLinkRe = /\[\[(.+?)\]\]/g

          for (const [p, content] of Object.entries(articles)) {
            let match: RegExpExecArray | null
            while ((match = wikiLinkRe.exec(content)) !== null) {
              const target = match[1].endsWith(".md") ? match[1] : `${match[1]}.md`
              if (!allPaths.has(target)) {
                warnings.push(`Broken link in ${p} → [[${match[1]}]]`)
              }
            }
          }

          for (const [p, content] of Object.entries(articles)) {
            const clean = content.replace(/^---[\s\S]*?---/, "").trim()
            if (clean.length < 100) {
              warnings.push(`Short article: ${p} (${clean.length} chars)`)
            }
          }

          const state = await loadState()
          state.last_lint = Date.now()
          await saveState(state)

          if (!errors.length && !warnings.length) {
            return "✅ Knowledge base health check passed. No issues found."
          }

          let report = "# Knowledge Base Health Report\n\n"
          if (errors.length) report += "## Errors\n" + errors.map((e) => `- ❌ ${e}`).join("\n") + "\n\n"
          if (warnings.length) report += "## Warnings\n" + warnings.map((w) => `- ⚠️ ${w}`).join("\n") + "\n\n"
          report += `Checked ${Object.keys(articles).length} articles.\n`
          report += `Errors: ${errors.length} | Warnings: ${warnings.length}`
          return report
        }
      }),

      memory_status: tool({
        description: "Show memory system statistics.",
        args: {},
        async execute(): Promise<string> {
          await ensureDirs()
          const state = await loadState()
          const logs = await listDirSafe(DAILY_DIR)
          await debugLog(`memory_status: daily dir has ${logs.length} files: ${JSON.stringify(logs)}`)
          const mdLogs = logs.filter((f) => f.endsWith(".md"))
          const concepts = (await listDirSafe(`${KNOWLEDGE_DIR}/${CONCEPTS_SUB}`)).filter((f) => f.endsWith(".md"))
          const connections = (await listDirSafe(`${KNOWLEDGE_DIR}/${CONNECTIONS_SUB}`)).filter((f) => f.endsWith(".md"))
          const qa = (await listDirSafe(`${KNOWLEDGE_DIR}/${QA_SUB}`)).filter((f) => f.endsWith(".md"))
          const compiled = Object.keys(state.ingested || {}).length

          return `## Memory System Status

| Metric | Count |
|--------|-------|
| Daily logs | ${mdLogs.length} |
| Compiled | ${compiled} |
| Pending | ${Math.max(0, mdLogs.length - compiled)} |
| Concept articles | ${concepts.length} |
| Connection articles | ${connections.length} |
| Q&A articles | ${qa.length} |
| Total cost | $${(state.total_cost ?? 0).toFixed(2)} |
| Queries run | ${state.query_count ?? 0} |`
        }
      }),
    }
  }
}

export default MemoryPlugin
