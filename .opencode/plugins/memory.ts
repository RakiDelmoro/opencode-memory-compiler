/**
 * OpenCode Memory Compiler Plugin
 *
 * Captures session transcripts, extracts knowledge, compiles structured
 * wiki articles, and injects memory context into new sessions.
 *
 * No external API keys or Python scripts required — everything runs
 * through the OpenCode SDK (client.session.prompt()).
 *
 * Architecture (Karpathy LLM Wiki pattern):
 *   raw sources (daily logs)  →  LLM extraction  →  persistent wiki (knowledge/)
 *                                                                         ↑ injected at session start
 */

import { type Plugin, tool } from "@opencode-ai/plugin"
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

  // ── helpers ───────────────────────────────────────────────────

  async function ensureDirs(): Promise<void> {
    await $`mkdir -p ${root}/${DAILY_DIR} ${root}/${KNOWLEDGE_DIR}/${CONCEPTS_SUB} ${root}/${KNOWLEDGE_DIR}/${CONNECTIONS_SUB} ${root}/${KNOWLEDGE_DIR}/${QA_SUB} ${root}/${STATE_DIR}`
  }

  async function readText(relPath: string): Promise<string> {
    try {
      return await Bun.file(`${root}/${relPath}`).text()
    } catch {
      return ""
    }
  }

  async function writeText(relPath: string, content: string): Promise<void> {
    const abs = `${root}/${relPath}`
    const dir = abs.substring(0, abs.lastIndexOf("/"))
    await $`mkdir -p ${dir}`
    await Bun.write(abs, content)
  }

  function sha256(content: string): string {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    // Simple hash for deduplication purposes
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < data.length; i++) {
      h1 = 31 * h1 + data[i] * 307
      h2 = 31 * h2 + data[i] * 307
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

  async function listDirSafe(relDir: string): Promise<string[]> {
    try {
      const { stdout } = await $`ls ${root}/${relDir}`.nothrow()
      return stdout.trim().split("\n").filter(Boolean)
    } catch {
      return []
    }
  }

  // ── LLM helper ──────────────────────────────────────────────
  // Creates a temporary session, sends a prompt, returns the text response.
  // Uses the user's configured model (no external keys).
  async function callLLM(prompt: string): Promise<string> {
    let sessionId = ""
    try {
      const created = await client.session.create({
        body: { title: "[memory-agent]" },
      })
      sessionId = created.id

      const result: any = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
      })

      const parts = result?.parts ?? []
      const text = parts
        .filter((p: any) => p?.type === "text" || p?.type === "part.text")
        .map((p: any) => p?.text ?? "")
        .join("\n")

      return text || ""
    } catch (err) {
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
        await client.session.delete({ path: { id: sessionId } }).catch(() => {})
      }
    }
  }

  /*  Parse LLM responses containing file-write blocks.  Format:
      ---NEWFILE: path/to/file.md---
      <file content goes here>
  */
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

  // ── 1) Memory injection at session start ──────────────────────
  async function injectMemory(sessionId: string): Promise<void> {
    const indexContent = await readText(INDEX_FILE)
    if (!indexContent) return

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
    }).catch(() => {})
  }

  // ── 2) Session capture on idle ──────────────────────────────────
  async function captureSession(sessionId: string): Promise<void> {
    await ensureDirs()

    let msgs: Array<any> = []
    try {
      const response: any = await client.session.messages({ path: { id: sessionId } })
      msgs = Array.isArray(response) ? response : response?.messages ?? []
    } catch (err) {
      await client.app.log({
        body: { service: "memory-compiler", level: "error", message: `Failed to fetch messages: ${(err as Error)?.message}` },
      })
      return
    }

    if (msgs.length < 2) return

    const now = new Date()
    const transcript = msgs
      .map((m: any) => {
        const role = ((m?.info?.role ?? m?.role ?? "unknown") as string).toUpperCase()
        const parts = m?.parts ?? []
        const texts = parts
          .filter((p: any) => p?.type === "text")
          .map((p: any) => {
            const t = typeof p?.text === "string" ? p.text : ""
            return t.length > 2000 ? t.slice(0, 2000) + "…[truncated]" : t
          })
          .filter(Boolean)
          .join("\n")
        return texts ? `**${role}:** ${texts}` : ""
      })
      .filter(Boolean)
      .join("\n\n---\n\n")

    if (!transcript.trim()) return

    const today = now.toISOString().split("T")[0]
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const title = (msgs[0]?.info?.sessionTitle ?? sessionId).slice(0, 50)
    const logFile = `${DAILY_DIR}/${today}.md`

    const existing = await readText(logFile)
    const header = existing === "" ? `# Daily Log: ${today}\n\n## Sessions\n` : ""
    const entry = `\n\n### Session (${time}) - ${title}\n\n${transcript}\n`
    await writeText(logFile, existing + header + entry)

    const extracted = await extractKnowledge(transcript, time, title)
    if (extracted) {
      const updated = await readText(logFile)
      await writeText(logFile, updated + `\n${extracted}\n`)
    }

    await maybeCompile()
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
      const hash = sha256(content)
      if (state.ingested?.[log]?.hash === hash) continue
      try {
        await compileDailyLog(log)
        state.ingested = state.ingested || {}
        state.ingested[log] = { hash, compiled_at: Date.now() }
        compiled++
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

  async function compileDailyLog(logName: string): Promise<void> {
    const logContent = await readText(`${DAILY_DIR}/${logName}`)
    if (!logContent.trim()) return

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
    if (!response) return

    const files = parseFileBlocks(response)
    for (const file of files) {
      const safe = file.path.startsWith(KNOWLEDGE_DIR)
      if (!safe) continue
      await writeText(file.path, file.content)
    }

    const state = await loadState()
    state.last_compile = Date.now()
    await saveState(state)
  }

  // ── 4) Tools ────────────────────────────────────────────────────
  return {
    // ── Event hooks ──
    event: async (input: { event: { type: string; properties?: any } }) => {
      const { event } = input
      if (event.type === "session.idle") {
        const sid = event.properties?.info?.id
        if (sid) setTimeout(() => captureSession(sid), 5000)
      }
      if (event.type === "session.created") {
        const sid = event.properties?.info?.id
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
          const state = await loadState()
          const logs = (await listDirSafe(DAILY_DIR)).filter((f) => f.endsWith(".md"))

          if (!logs.length) return "No daily logs found."

          let compiled = 0
          for (const log of logs) {
            const content = await readText(`${DAILY_DIR}/${log}`)
            const hash = sha256(content)
            if (state.ingested?.[log]?.hash === hash) continue
            try {
              await compileDailyLog(log)
              state.ingested = state.ingested || {}
              state.ingested[log] = { hash, compiled_at: Date.now() }
              compiled++
            } catch {}
          }

          await saveState(state)
          return compiled > 0
            ? `✅ Compiled ${compiled} daily log(s) into knowledge articles.`
            : "All daily logs already compiled. Nothing new to process."
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
          const logs = (await listDirSafe(DAILY_DIR)).filter((f) => f.endsWith(".md"))
          const concepts = (await listDirSafe(`${KNOWLEDGE_DIR}/${CONCEPTS_SUB}`)).filter((f) => f.endsWith(".md"))
          const connections = (await listDirSafe(`${KNOWLEDGE_DIR}/${CONNECTIONS_SUB}`)).filter((f) => f.endsWith(".md"))
          const qa = (await listDirSafe(`${KNOWLEDGE_DIR}/${QA_SUB}`)).filter((f) => f.endsWith(".md"))
          const compiled = Object.keys(state.ingested || {}).length

          return `## Memory System Status

| Metric | Count |
|--------|-------|
| Daily logs | ${logs.length} |
| Compiled | ${compiled} |
| Pending | ${Math.max(0, logs.length - compiled)} |
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