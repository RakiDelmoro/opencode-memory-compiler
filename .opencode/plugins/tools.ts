/**
 * Tools functionality for the memory compiler plugin
 */

import * as path from "node:path"
import { 
  debugLog, ensureDirs, readText, writeText, listDirSafe, hashStr, loadState, saveState,
  DAILY_DIR, KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB, INDEX_FILE, LOG_FILE, AGENTS_FILE, COMPILE_AFTER_HOUR
} from "./helpers"
import { getMessagesForSession, cleanupSession, activeSession } from "./sessionTracking"
import { preprocessMessages, extractKnowledge } from "./knowledgeExtraction"
import { maybeCompile, compileDailyLog, readAllArticles } from "./compilation"
import { tool } from "@opencode-ai/plugin"

// ─── Tools ────────────────────────────────────────────────────
export function getTools(client: any, directory: string | undefined) {
  const root = directory ?? "."
  const absRoot = path.resolve(root)
  
  return {
    memory_capture: tool({
      description: "Manually capture session knowledge with intelligent filtering",
      args: {
        sessionId: tool.schema.string({ 
          description: "Optional session ID (uses current session if not provided)" 
        }),
        intelligent: tool.schema.boolean({
          description: "Apply intelligent preprocessing (recommended: true)",
          default: true
        })
      },
      async execute(args: { sessionId?: string; intelligent?: boolean }): Promise<string> {
        await ensureDirs(absRoot)
        
        const sessionId = args.sessionId ?? activeSession
        if (!sessionId) {
          return "No active session found. Please provide a session ID or ensure there's an active session."
        }
        
        await debugLog(absRoot, `memory_capture called for session ${sessionId} with intelligent=${args.intelligent ?? true}`)
        
        const msgs = getMessagesForSession(sessionId)
        await debugLog(absRoot, `tracked messages for session: ${msgs.length}`)
        if (msgs.length < 2) {
          return `Insufficient messages (${msgs.length}) to capture. Need at least 2 messages.`
        }
        
        // Intelligent preprocessing if enabled
        let processedMsgs = msgs
        if (args.intelligent ?? true) {
          processedMsgs = await preprocessMessages(msgs)
          await debugLog(absRoot, `after preprocessing: ${processedMsgs.length} messages (from ${msgs.length})`)
        }
        
        if (processedMsgs.length < 2) {
          return `Insufficient messages after preprocessing (${processedMsgs.length}). Need at least 2 messages.`
        }
        
        const now = new Date()
        const transcript = processedMsgs
          .map((m) => {
            const t = m.text.length > 2000 ? m.text.slice(0, 2000) + "…[truncated]" : m.text
            return t ? `**${m.role.toUpperCase()}:** ${t}` : ""
          })
          .filter(Boolean)
          .join("\n\n---\n\n")
  
        if (!transcript.trim()) {
          await debugLog(absRoot, `skipping: empty transcript`)
          return "No content to capture after processing."
        }
  
        const today = now.toISOString().split("T")[0]
        const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        const title = (processedMsgs[0]?.text?.slice(0, 50) ?? sessionId).slice(0, 50)
        const logFile = `${DAILY_DIR}/${today}.md`
  
        await debugLog(absRoot, `writing to ${logFile} (transcript: ${transcript.length} chars, title: ${title})`)
        const existing = await readText(absRoot, logFile)
        const header = existing === "" ? `# Daily Log: ${today}\n\n## Sessions\n` : ""
        const entry = `\n\n### Session (${time}) - ${title}\n\n${transcript}\n`
        await writeText(absRoot, logFile, existing + header + entry)
        await debugLog(absRoot, `wrote ${logFile} successfully`)
  
        // Extract knowledge via LLM
        await debugLog(absRoot, `extracting knowledge from transcript...`)
        const extracted = await extractKnowledge(client, transcript, time, title)
        if (extracted) {
          await debugLog(absRoot, `extracted knowledge (${extracted.length} chars), appending to ${logFile}`)
          const updated = await readText(absRoot, logFile)
          await writeText(absRoot, logFile, updated + `\n${extracted}\n`)
          await debugLog(absRoot, `appended knowledge to ${logFile}`)
        } else {
          await debugLog(absRoot, `no significant knowledge extracted`)
        }
  
        // Maybe compile (auto-compile after 6 PM)
        await debugLog(absRoot, `checking if should compile...`)
        await maybeCompile(
          absRoot,
          DAILY_DIR,
          KNOWLEDGE_DIR,
          CONCEPTS_SUB,
          CONNECTIONS_SUB,
          QA_SUB,
          INDEX_FILE,
          LOG_FILE,
          AGENTS_FILE,
          COMPILE_AFTER_HOUR,
          client
        )
        await debugLog(absRoot, `memory_capture(${sessionId}) complete`)
        
        // Clean up tracked parts for this session
        cleanupSession(sessionId)
        
        return `✅ Captured session ${sessionId} to ${logFile} (${processedMsgs.length} messages after processing)`
      }
    }),
    
    memory_query: tool({
      description: "Query the memory knowledge base. Ask things like: 'How did we set up auth?' or 'What was the React state management decision?'",
      args: {
        question: tool.schema.string({ description: "The question to answer from the knowledge base." }),
      },
      async execute(args: { question: string }): Promise<string> {
        await ensureDirs(absRoot)
        const indexContent = await readText(absRoot, INDEX_FILE)
        const articles = await readAllArticles(absRoot, KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB)

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

        return await extractKnowledge(client, prompt, "", "Query") || "Sorry, I couldn't process your question."
      }
    }),

    memory_compile: tool({
      description: "Manually compile any uncompiled daily logs into knowledge articles.",
      args: {},
      async execute(): Promise<string> {
        await ensureDirs(absRoot)
        await debugLog(absRoot, `memory_compile called`)
        const state = await loadState(absRoot)
        const logs = await listDirSafe(absRoot, DAILY_DIR)
        await debugLog(absRoot, `memory_compile found logs: ${JSON.stringify(logs)}`)
        const mdLogs = logs.filter((f) => f.endsWith(".md"))

        if (!mdLogs.length) return `No daily logs found in ${DAILY_DIR}/. Make sure the plugin captured at least one session.`

        let compiled = 0
        let failed = 0
        for (const log of mdLogs) {
          const content = await readText(absRoot, `${DAILY_DIR}/${log}`)
          const hash = hashStr(content)
          if (state.ingested?.[log]?.hash === hash) continue
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
            await debugLog(absRoot, `memory_compile: successfully compiled ${log}`)
            state.ingested = state.ingested || {}
            state.ingested[log] = { hash, compiled_at: Date.now() }
            compiled++
          } else {
            await debugLog(absRoot, `memory_compile: compileDailyLog(${log}) returned false`)
            failed++
          }
        }

        await saveState(absRoot, state)
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
        await ensureDirs(absRoot)
        const errors: string[] = []
        const warnings: string[] = []
        const articles = await readAllArticles(absRoot, KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB)
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

        const state = await loadState(absRoot)
        state.last_lint = Date.now()
        await saveState(absRoot, state)

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
        await ensureDirs(absRoot)
        const state = await loadState(absRoot)
        const logs = await listDirSafe(absRoot, DAILY_DIR)
        await debugLog(absRoot, `memory_status: daily dir has ${logs.length} files: ${JSON.stringify(logs)}`)
        const mdLogs = logs.filter((f) => f.endsWith(".md"))
        const concepts = (await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${CONCEPTS_SUB}`)).filter((f) => f.endsWith(".md"))
        const connections = (await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${CONNECTIONS_SUB}`)).filter((f) => f.endsWith(".md"))
        const qa = (await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${QA_SUB}`)).filter((f) => f.endsWith(".md"))
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
    })
  }
}
