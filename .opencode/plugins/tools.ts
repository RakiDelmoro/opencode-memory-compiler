/**
 * Tools functionality for the memory compiler plugin
 */

import * as path from "path"
import * as fs from "fs"
 import { 
    debugLog, ensureDirs, readText, writeText, listDirSafe, hashStr, loadState, saveState, loadSessionState, saveSessionState,
    DAILY_DIR, KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB, INDEX_FILE, LOG_FILE, AGENTS_FILE, COMPILE_AFTER_HOUR, SEARCH_INDEX_FILE, STATE_DIR,
    extractSessionBlocks, SessionState, readSearchIndex, tokenize, scoreQueryMatch, buildSearchIndex, SearchIndexEntry,
    parseFrontmatter, loadIndexArticles, detectCycles, dirSize, getFileMtime
  } from "./helpers"
import { getMessagesForSession, cleanupSession, activeSession } from "./sessionTracking"
import { preprocessMessages, extractKnowledge } from "./knowledgeExtraction"
 import { compileDailyLog, readAllArticles } from "./compilation"
import { tool } from "@opencode-ai/plugin"

// ─── Tools ────────────────────────────────────────────────────
export function getTools(client: any, directory: string | undefined) {
  const root = directory ?? "."
  const absRoot = path.resolve(root)
  
  return {
    memory_capture: tool({
      description: "Capture current session to daily log with intelligent filtering and knowledge extraction.",
      args: {},
      async execute(): Promise<string> {
        await ensureDirs(absRoot)
        
        const sessionId = activeSession
        if (!sessionId) {
          return "No active session found. Start a session first."
        }
        
        await debugLog(absRoot, `memory_capture called for session ${sessionId}`)
        
        const msgs = getMessagesForSession(sessionId)
        await debugLog(absRoot, `tracked messages for session: ${msgs.length}`)
        if (msgs.length < 2) {
          return `Insufficient messages (${msgs.length}) to capture. Need at least 2 messages.`
        }
        
        // Always apply intelligent preprocessing
        let processedMsgs = await preprocessMessages(msgs)
        await debugLog(absRoot, `after preprocessing: ${processedMsgs.length} messages (from ${msgs.length})`)
        
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
        const orderMin = Math.min(...processedMsgs.map(m => m.order))
        const orderMax = Math.max(...processedMsgs.map(m => m.order))
        const metadata = `<!-- capture:${Date.now()}, session:${sessionId}, messages:${processedMsgs.length}, order:${orderMin}-${orderMax} -->\n`
        const entry = `\n\n### Session (${time}) - ${title}\n\n${metadata}${transcript}\n`
        await writeText(absRoot, logFile, existing + header + entry)
        await debugLog(absRoot, `wrote ${logFile} successfully`)
   
        // Always extract knowledge via LLM
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
   
        // Update session state: mark these messages as captured, preserve compiledUpTo
        const maxCapturedOrder = Math.max(...processedMsgs.map(m => m.order))
        const sessionState = await loadSessionState(absRoot, sessionId)
        const newSessionState: SessionState = {
          sessionId,
          trackedEvents: msgs.length,
          capturedUpTo: Math.max(sessionState?.capturedUpTo ?? 0, maxCapturedOrder),
          lastCapture: now.toISOString(),
          firstEventTime: sessionState?.firstEventTime,
          compiledUpTo: sessionState?.compiledUpTo
        }
        await saveSessionState(absRoot, newSessionState)
        
        // Do NOT auto-compile — compilation must be manual via memory_compile
        await debugLog(absRoot, `memory_capture(${sessionId}) complete — auto-compile disabled`)
        
        // Clean up tracked parts for this session
        cleanupSession(sessionId)
        
        return `✅ Captured session ${sessionId} to ${logFile} (${processedMsgs.length} messages).\n💡 Run memory_compile to process knowledge.`
      }
    }),
    
    memory_query: tool({
      description: "Query the memory knowledge base using graph-aware search. Ask things like: 'How did we set up auth?' or 'What was the React state management decision?'",
      args: {
        question: tool.schema.string({ description: "The question to answer from the knowledge base." }),
        limit: tool.schema.number({ description: "Max number of articles to retrieve (default: 8)", default: 8 })
      },
      async execute(args: { question: string; limit?: number }): Promise<string> {
        await ensureDirs(absRoot)
        const indexContent = await readText(absRoot, INDEX_FILE)
        
        // Load search index (our token index with graph)
        const searchIndex = await readSearchIndex(absRoot)
        if (searchIndex.length === 0) {
          // Fallback: no index yet, try full article load
          const allArticles = await readAllArticles(absRoot, KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB)
          if (Object.keys(allArticles).length === 0) {
            return "The knowledge base is empty. Capture some conversations first and run memory_compile."
          }
          // Build simple summary-based prompt from all articles (limited to first 10)
          const articlesSummary = Object.entries(allArticles)
            .slice(0, args.limit || 8)
            .map(([p, c]) => `## ${p}\n${c.slice(0, 1000)}`)
            .join("\n\n")
          const prompt = `Answer this question using the knowledge base. Cite sources with [[wikilinks]].\n\nQuestion: ${args.question}\n\n## Index\n${indexContent || "(no index)"}\n\n## Articles\n${articlesSummary}`
          return await extractKnowledge(client, prompt, "", "Query") || "Sorry, I couldn't process your question."
        }
        
        // Build quick lookup map: path → entry
        const indexByPath = new Map(searchIndex.map(e => [e.path, e]))
        
        // === Phase 1: Token-based seed retrieval ===
        const queryTokens = tokenize(args.question)
        const scoredSeeds = searchIndex
          .map(entry => ({ path: entry.path, score: scoreQueryMatch(entry, queryTokens), entry }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)
        
        if (scoredSeeds.length === 0) {
          return "No articles match your query. Try rephrasing or capturing more sessions."
        }
        
        // Take top seeds (base set)
        const seedCount = Math.min(6, scoredSeeds.length)
        const seeds = scoredSeeds.slice(0, seedCount)
        
        // === Phase 2: Graph expansion (1-hop) ===
        const neighborSet = new Set<string>()
        const pathToScore = new Map<string, number>()
        
        // Add seeds
        for (const s of seeds) {
          neighborSet.add(s.path)
          pathToScore.set(s.path, s.score * 1.0)  // full weight
        }
        
        // Expand: add outgoing + incoming links from seeds
        for (const s of seeds) {
          const entry = s.entry
          for (const link of entry.wikilinks || []) {
            if (!neighborSet.has(link)) {
              neighborSet.add(link)
              // Initial score: inherited from seed (0.5 × seed score)
              const inherited = s.score * 0.5
              pathToScore.set(link, Math.max(inherited, pathToScore.get(link) || 0))
            }
          }
          for (const back of entry.backlinks || []) {
            if (!neighborSet.has(back)) {
              neighborSet.add(back)
              const inherited = s.score * 0.3  // backlinks slightly less relevant
              pathToScore.set(back, Math.max(inherited, pathToScore.get(back) || 0))
            }
          }
        }
        
        // === Phase 3: Centrality boost ===
        // Compute link frequency (how many times each path appears in neighborSet's wikilinks)
        const linkCount = new Map<string, number>()
        for (const path of neighborSet) {
          const entry = indexByPath.get(path)
          if (entry) {
            for (const link of entry.wikilinks || []) {
              if (neighborSet.has(link)) {
                linkCount.set(link, (linkCount.get(link) || 0) + 1)
              }
            }
          }
        }
        const maxLinks = Math.max(1, ...Array.from(linkCount.values()))
        
        // === Phase 4: Final re-ranking ===
        type ScoredEntry = { path: string; score: number; entry: SearchIndexEntry }
        const candidates: ScoredEntry[] = []
        
        for (const path of neighborSet) {
          // Get entry from map (since all neighborSet paths should be in index)
          const entry = indexByPath.get(path)
          if (!entry) continue
          
          let finalScore = pathToScore.get(path) || 0
          
          // Boost if it was an original seed
          if (seeds.find(s => s.path === path)) {
            finalScore += 0.5
          }
          
          // Centrality boost (0.0–0.3 scaled by link count)
          const centrality = (linkCount.get(path) || 0) / maxLinks
          finalScore += centrality * 0.3
          
          candidates.push({ path, score: finalScore, entry })
        }
        
        // Sort and take top N
        candidates.sort((a, b) => b.score - a.score)
        const finalSet = candidates.slice(0, args.limit || 8)
        
        // === Phase 5: Build prompt with summaries + link context ===
        const formatLink = (p: string) => {
          // Convert 'knowledge/concepts/foo.md' → '[[concepts/foo]]'
          const clean = p.replace(/^knowledge\//, '').replace(/\.md$/, '')
          return `[[${clean}]]`
        }
        
        const contextArticles = finalSet.map(item => {
          const e = item.entry
          const outgoing = e.wikilinks.slice(0, 5).map(l => formatLink(l)).join(', ')
          const incoming = e.backlinks.slice(0, 5).map(l => formatLink(l)).join(', ')
          return `## ${e.path}\n${e.summary}\n🔗 Outgoing: ${outgoing || 'none'}\n🔗 Incoming: ${incoming || 'none'}`
        }).join('\n\n')
        
        const prompt = `Answer this question using the knowledge base. Cite specific articles with [[wikilinks]].
        
Question: ${args.question}

## Index
${indexContent || "(no index yet)"}

## Selected Articles (most relevant with graph context)
${contextArticles}

Provide a concise, well-cited answer. If the answer isn't in the articles, say so.`

        return await extractKnowledge(client, prompt, "", "Query") || "Sorry, I couldn't process your question."
      }
    }),

    memory_compile: tool({
      description: "Compile daily logs into knowledge articles. This is the only way to compile — auto-compile after capture is disabled.",
      args: {
        since: tool.schema.number({ description: "Unix timestamp (ms) — only compile logs modified since this time" }),
        force: tool.schema.boolean({ description: "Force recompile even if already compiled", default: false }),
        log: tool.schema.string({ description: "Compile only this specific log file (e.g., '2026-04-15.md')" })
      },
      async execute(args: { since?: number; force?: boolean; log?: string }): Promise<string> {
        await ensureDirs(absRoot)
        await debugLog(absRoot, `memory_compile called with args: ${JSON.stringify(args)}`)
        
        const state = await loadState(absRoot)
        const allLogs = await listDirSafe(absRoot, DAILY_DIR)
        const mdLogs = allLogs.filter(f => f.endsWith(".md"))
        
        if (!mdLogs.length) {
          return `No daily logs found in ${DAILY_DIR}/. Capture a session first.`
        }

        // Filter logs based on args
        let targetLogs = mdLogs
        if (args.log) {
          if (!mdLogs.includes(args.log)) {
            return `Log '${args.log}' not found. Available: ${mdLogs.join(", ")}`
          }
          targetLogs = [args.log]
        } else if (typeof args.since === "number") {
          const sinceVal = args.since
          targetLogs = mdLogs.filter(log => {
            const fpath = path.join(absRoot, DAILY_DIR, log)
            try {
              const mtime = fs.statSync(fpath).mtime.getTime()
              return mtime >= sinceVal
            } catch { return false }
          })
          await debugLog(absRoot, `memory_compile: since=${args.since} → ${targetLogs.length} logs`)
        } else {
          targetLogs = mdLogs
        }

        if (targetLogs.length === 0) {
          return `No logs to compile with current filters.`
        }

        let compiled = 0
        let skipped = 0
        let failed = 0
        const results: string[] = []

        for (const log of targetLogs) {
          const content = await readText(absRoot, `${DAILY_DIR}/${log}`)
          if (!content.trim()) continue
          
          const hash = hashStr(content)
          if (!args.force && state.ingested?.[log]?.hash === hash) {
            await debugLog(absRoot, `memory_compile: ${log} already compiled (hash match), skipping`)
            results.push(`  • ${log} — already up-to-date`)
            skipped++
            continue
          }

          // Extract session blocks with order info
          const blocks = extractSessionBlocks(content)
          if (blocks.length === 0) {
            await debugLog(absRoot, `memory_compile: ${log} has no session blocks, skipping`)
            results.push(`  • ${log} — no session blocks found`)
            skipped++
            continue
          }

          // Get per-session compile progress (if we have an active session)
          const sessionId = activeSession
          let lastCompiledOrder = 0
          if (sessionId && state.sessions?.[sessionId]?.compiledUpTo?.[log]) {
            lastCompiledOrder = state.sessions[sessionId].compiledUpTo[log]
            await debugLog(absRoot, `memory_compile: session ${sessionId} lastCompiledOrder for ${log} = ${lastCompiledOrder}`)
          } else if (sessionId) {
            await debugLog(absRoot, `memory_compile: session ${sessionId} has no compiledUpTo for ${log}, compiling from start`)
          }

          // Filter blocks to only those with orderMax > lastCompiledOrder
          // Include blocks without order metadata (orderMax === 0) for backwards compatibility
          const newBlocks = blocks.filter(b => b.orderMax === 0 || b.orderMax > lastCompiledOrder)
          
          // Decide which blocks to compile
          let blocksToCompile: typeof blocks
          if (args.force) {
            blocksToCompile = blocks  // force: compile everything
          } else if (newBlocks.length === 0) {
            // Hash changed but no new order ranges → existing blocks modified, recompile all
            blocksToCompile = blocks
          } else {
            blocksToCompile = newBlocks
          }

          if (blocksToCompile.length === 0) {
            await debugLog(absRoot, `memory_compile: ${log} nothing to compile`)
            results.push(`  • ${log} — nothing to compile`)
            skipped++
            continue
          }

          // Build filtered log content from selected blocks
          const filteredContent = blocksToCompile
            .map(b => `${b.metadata}\n\n${b.content}`)
            .join("\n\n---\n\n")

          await debugLog(absRoot, `memory_compile: ${log} compiling ${blocksToCompile.length}/${blocks.length} blocks (order > ${lastCompiledOrder})`)

          // Try compilation
          try {
            const success = await compileDailyLog(
              absRoot, log, filteredContent,
              KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB,
              INDEX_FILE, LOG_FILE, AGENTS_FILE,
              client
            )

            if (success) {
              // Update ingested hash
              state.ingested = state.ingested || {}
              state.ingested[log] = { hash, compiled_at: Date.now() }
              
              // Update per-session compiledUpTo marker
              if (sessionId) {
                // Use max order from compiled blocks (ignore order=0 blocks)
                const compiledOrders = blocksToCompile.map(b => b.orderMax).filter(o => o > 0)
                const maxOrder = compiledOrders.length ? Math.max(...compiledOrders) : lastCompiledOrder
                
                state.sessions = state.sessions || {}
                state.sessions[sessionId] = state.sessions[sessionId] || {}
                state.sessions[sessionId].compiledUpTo = state.sessions[sessionId].compiledUpTo || {}
                state.sessions[sessionId].compiledUpTo[log] = maxOrder
                await debugLog(absRoot, `memory_compile: updated session ${sessionId} compiledUpTo[${log}] = ${maxOrder}`)
              }
              
              compiled++
              results.push(`  • ${log} — ✅ compiled ${blocksToCompile.length} block(s)${blocksToCompile !== newBlocks ? ' (full recompile)' : ''}`)
            } else {
              failed++
              results.push(`  • ${log} — ❌ failed (see debug.log)`)
            }
          } catch (err) {
            failed++
            await debugLog(absRoot, `memory_compile ERROR on ${log}: ${err}`)
            results.push(`  • ${log} — ❌ error: ${(err as Error)?.message}`)
          }
        }

        await saveState(absRoot, state)

        // Build summary
        let summary = ""
        if (compiled > 0 && failed === 0 && skipped === 0) {
          summary = `✅ Compiled ${compiled} log(s) successfully.\n`
        } else if (compiled > 0 && failed > 0) {
          summary = `⚠️ Compiled ${compiled} log(s) with ${failed} failure(s).\n`
        } else if (failed > 0) {
          summary = `❌ All ${failed} log(s) failed to compile.\n`
         } else {
           summary = `📋 All logs already compiled or no new content.\n`
         }

        return summary + results.join("\n")
      }
    }),

    memory_lint: tool({
      description: "Comprehensive health checks: broken links, orphans, sparse articles, frontmatter, graph integrity, and more.",
      args: {},
      async execute(): Promise<string> {
        await ensureDirs(absRoot)
        const errors: string[] = []
        const warnings: string[] = []
        const suggestions: string[] = []
        
        // Load data sources
        const articles = await readAllArticles(absRoot, KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB)
        const allPaths = new Set(Object.keys(articles))
        const indexArticles = await loadIndexArticles(absRoot)
        const searchIndex = await readSearchIndex(absRoot)
        const indexByPath = new Map(searchIndex.map(e => [e.path, e]))
        
        // === Check 1: Broken [[wikilinks]] ===
        for (const [p, content] of Object.entries(articles)) {
          const seenTargets = new Set<string>()
          const wikiLinkRe = /\[\[([^\]]+)\]\]/g
          let match: RegExpExecArray | null
          while ((match = wikiLinkRe.exec(content)) !== null) {
            const raw = match[1]
            // Normalize to expected file path format
            let target = raw
            if (!target.endsWith(".md")) target += ".md"
            if (!target.startsWith("knowledge/")) target = `knowledge/${target}`
            if (!seenTargets.has(target)) {
              seenTargets.add(target)
              if (!allPaths.has(target)) {
                warnings.push(`Broken link in ${p} → [[${raw}]] (target not found)`)
              }
            }
          }
        }
        
        // === Check 2: Orphan pages (no inbound links) ===
        for (const path of allPaths) {
          const entry = indexByPath.get(path)
          if (entry && entry.backlinks && entry.backlinks.length === 0) {
            warnings.push(`Orphan page: ${path} (no inbound links)`)
          }
        }
        
        // === Check 3: Sparse articles (<200 words) ===
        for (const [p, content] of Object.entries(articles)) {
          const body = content.replace(/^---[\s\S]*?---\n/, "").trim() // strip frontmatter
          const words = body.split(/\s+/).filter(w => w.length > 0).length
          if (words > 0 && words < 200) {
            suggestions.push(`Sparse article: ${p} (${words} words)`)
          }
        }
        
        // === Check 4: Frontmatter completeness ===
        const requiredFields = ["title", "sources", "created", "updated"]
        for (const [p, content] of Object.entries(articles)) {
          const fm = parseFrontmatter(content)
          if (!fm) {
            errors.push(`Missing frontmatter in ${p}`)
            continue
          }
          for (const field of requiredFields) {
            if (!fm[field]) {
              errors.push(`${p} — Missing frontmatter field: ${field}`)
            }
          }
        }
        
        // === Check 5: Index/disk sync ===
        for (const indexedPath of indexArticles) {
          if (!allPaths.has(indexedPath)) {
            errors.push(`Index/disk mismatch: index lists [[${indexedPath.replace(/^knowledge\//, '').replace(/\.md$/, '')}]] but file missing`)
          }
        }
        // Also check for articles on disk but not in index (optional: warning)
        for (const diskPath of allPaths) {
          if (!indexArticles.has(diskPath)) {
            suggestions.push(`Article not in index: ${diskPath} (run memory_compile to update index)`)
          }
        }
        
        // === Check 6: Stale backlinks ===
        for (const entry of searchIndex) {
          for (const back of entry.backlinks || []) {
            if (!allPaths.has(back)) {
              errors.push(`Stale backlink: ${entry.path} points to non-existent ${back}`)
            }
          }
        }
        
        // === Check 7: Empty article body ===
        for (const [p, content] of Object.entries(articles)) {
          const body = content.replace(/^---[\s\S]*?---\n/, "").trim()
          if (!body) {
            errors.push(`Empty article body: ${p}`)
          }
        }
        
        // === Check 8: Updated date mismatch ===
        for (const [p, content] of Object.entries(articles)) {
          const fm = parseFrontmatter(content)
          if (fm && fm.updated) {
            try {
              const updatedDate = new Date(fm.updated).getTime()
              const stat = await fs.stat(path.join(absRoot, p))
              const mtime = stat.mtime.getTime()
              // Allow 1 hour tolerance (3600000 ms)
              if (Math.abs(updatedDate - mtime) > 3600000) {
                warnings.push(`${p} — updated date differs from file mtime (frontmatter: ${fm.updated}, file: ${new Date(mtime).toISOString().split('T')[0]})`)
              }
            } catch {}
          }
        }
        
        // === Check 9: Duplicate titles in subdirectory ===
        const titlesByDir = new Map<string, Set<string>>()
        for (const path of allPaths) {
          const content = articles[path]
          const fm = parseFrontmatter(content)
          if (fm && fm.title) {
            const dir = path.substring(0, path.lastIndexOf("/"))
            const set = titlesByDir.get(dir) || new Set()
            if (set.has(fm.title)) {
              warnings.push(`Duplicate title in ${dir}: "${fm.title}" (${path} and another article)`)
            } else {
              set.add(fm.title)
              titlesByDir.set(dir, set)
            }
          }
        }
        
        // === Check 10: Summary length in index.md ===
        const indexContent = await readText(absRoot, INDEX_FILE)
        if (indexContent) {
          const lines = indexContent.split("\n")
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()
            if (line.startsWith("|") && !line.startsWith("| Article")) {
              // Table row: | [[path]] | Summary | ... |
              const parts = line.split("|").map(p => p.trim())
              if (parts.length >= 3) {
                const summary = parts[1] // actually index 1? Let's check: 0 empty, 1 Article, 2 Summary, 3 Compiled From, 4 Updated
                // Wait format: | Article | Summary | Compiled From | Updated |
                // parts[1] = Article, parts[2] = Summary
                const summaryText = parts[2] || ""
                if (summaryText.length > 150) {
                  suggestions.push(`index.md — Summary too long for [[${parts[1]}]] (${summaryText.length} chars, recommended ≤150)`)
                }
              }
            }
          }
        }
        
        // === Check 11: Circular dependencies (graph cycles) ===
        const cycles = detectCycles(searchIndex, 10)
        for (const { cycle } of cycles) {
          // Format cycle as A → B → C → A
          const cycleStr = cycle.map((node, idx) => {
            const name = node.replace(/^knowledge\//, '').replace(/\.md$/, '')
            return `[[${name}]]`
          }).join(" → ")
          warnings.push(`Circular dependency: ${cycleStr}`)
        }
        
        // Build report
        let report = "# Knowledge Base Health Report\n\n"
        if (errors.length === 0 && warnings.length === 0 && suggestions.length === 0) {
          report += "✅ All checks passed. No issues found.\n"
        } else {
          if (errors.length) {
            report += `## ❌ Errors (${errors.length})\n\n${errors.map(e => `- ❌ ${e}`).join("\n")}\n\n`
          }
          if (warnings.length) {
            report += `## ⚠️ Warnings (${warnings.length})\n\n${warnings.map(w => `- ⚠️ ${w}`).join("\n")}\n\n`
          }
          if (suggestions.length) {
            report += `## 💡 Suggestions (${suggestions.length})\n\n${suggestions.map(s => `- 💡 ${s}`).join("\n")}\n\n`
          }
        }
        
        report += `Checked ${Object.keys(articles).length} articles.\n`
        report += `Errors: ${errors.length} | Warnings: ${warnings.length} | Suggestions: ${suggestions.length}`
        
        return report
      }
    }),

    memory_reindex: tool({
      description: "Rebuild the search index from scratch (useful if articles changed or index corrupted).",
      args: {},
      async execute(): Promise<string> {
        await ensureDirs(absRoot)
        try {
          await buildSearchIndex(absRoot)
          const index = await readSearchIndex(absRoot)
          return `✅ Rebuilt search index: ${index.length} articles indexed.`
        } catch (err) {
          await debugLog(absRoot, `memory_reindex error: ${err}`)
          return `❌ Failed to rebuild index: ${err}`
        }
      }
    }),

    memory_status: tool({
      description: "Show comprehensive system statistics including graph metrics and storage.",
      args: {},
      async execute(): Promise<string> {
        await ensureDirs(absRoot)
        const state = await loadState(absRoot)
        const logs = await listDirSafe(absRoot, DAILY_DIR)
        const mdLogs = logs.filter(f => f.endsWith(".md"))
        const concepts = (await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${CONCEPTS_SUB}`)).filter(f => f.endsWith(".md"))
        const connections = (await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${CONNECTIONS_SUB}`)).filter(f => f.endsWith(".md"))
        const qa = (await listDirSafe(absRoot, `${KNOWLEDGE_DIR}/${QA_SUB}`)).filter(f => f.endsWith(".md"))
        const compiled = Object.keys(state.ingested || {}).length
        const allArticles = await readAllArticles(absRoot, KNOWLEDGE_DIR, CONCEPTS_SUB, CONNECTIONS_SUB, QA_SUB)
        const allPaths = Object.keys(allArticles)
        
        // Search index stats
        const index = await readSearchIndex(absRoot)
        const indexStats = index.length > 0 ? {
          articles: index.length,
          lastBuilt: await getFileMtime(absRoot, SEARCH_INDEX_FILE)
        } : null
        
        // Graph centrality from search index
        let mostLinked: Array<{path: string, count: number}> = []
        let mostOutbound: Array<{path: string, count: number}> = []
        if (index.length > 0) {
          const linkCounts = new Map<string, number>()
          const outboundCounts = new Map<string, number>()
          for (const entry of index) {
            outboundCounts.set(entry.path, (entry.wikilinks?.length || 0))
            for (const back of entry.backlinks || []) {
              linkCounts.set(back, (linkCounts.get(back) || 0) + 1)
            }
          }
          mostLinked = Array.from(linkCounts.entries())
            .map(([path, count]) => ({ path, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
          mostOutbound = Array.from(outboundCounts.entries())
            .map(([path, count]) => ({ path, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
        }
        
        // Sessions
        const sessions = Object.keys(state.sessions || {})
        const avgCaptured = sessions.length > 0
          ? Math.round(sessions.reduce((sum, sid) => {
              const s = state.sessions[sid]
              return sum + (s?.capturedUpTo || 0)
            }, 0) / sessions.length)
          : 0
        
        // Storage sizes (KB)
        const dailySize = (await dirSize(absRoot, DAILY_DIR)) / 1024
        const knowledgeSize = (await dirSize(absRoot, KNOWLEDGE_DIR)) / 1024
        const stateSize = (await dirSize(absRoot, STATE_DIR)) / 1024
        
        // Recent activity (human-readable)
        const lastCapture = state.sessions && sessions.length > 0
          ? Math.max(...sessions.map(sid => new Date(state.sessions[sid].lastCapture).getTime()))
          : 0
        const lastCompile = state.last_compile ? new Date(state.last_compile).getTime() : 0
        
        return `## Memory System Status

| Metric | Count / Value |
|--------|---------------|
| Daily logs | ${mdLogs.length} |
| Compiled | ${compiled} |
| Pending | ${Math.max(0, mdLogs.length - compiled)} |
| Concept articles | ${concepts.length} |
| Connection articles | ${connections.length} |
| Q&A articles | ${qa.length} |
| Total cost | $${(state.total_cost ?? 0).toFixed(2)} |
| Queries run | ${state.query_count ?? 0} |
| Index articles | ${indexStats?.articles ?? 'none'} |
| Index built | ${indexStats ? new Date(indexStats.lastBuilt * 1000).toLocaleString() : 'no index'} |
| Most linked | ${mostLinked.map(l => `[[${l.path.replace(/^knowledge\//, '').replace(/\.md$/, '')}]] (${l.count})`).join(', ') || 'none'} |
| Most outbound | ${mostOutbound.map(o => `[[${o.path.replace(/^knowledge\//, '').replace(/\.md$/, '')}]] (${o.count})`).join(', ') || 'none'} |
| Sessions tracked | ${sessions.length} (avg captured: ${avgCaptured}) |
| Sessions incomplete | ${sessions.filter(sid => {
            const s = state.sessions[sid]
            return s.capturedUpTo > (s.compiledUpTo?.[Object.keys(s.compiledUpTo || {})[0]] || 0)
          }).length} |
| Storage (daily) | ${dailySize.toFixed(1)} KB |
| Storage (knowledge) | ${knowledgeSize.toFixed(1)} KB |
| Storage (state) | ${stateSize.toFixed(1)} KB |
| Last capture | ${lastCapture ? new Date(lastCapture).toLocaleString() : 'never'} |
| Last compile | ${lastCompile ? new Date(lastCompile).toLocaleString() : 'never'} |`
      }
    })
  }
}
