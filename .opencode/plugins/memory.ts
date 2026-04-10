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

import { type Plugin } from "@opencode-ai/plugin"
import * as path from "node:path"

// Import modules
import {
  DAILY_DIR,
  KNOWLEDGE_DIR,
  CONCEPTS_SUB,
  CONNECTIONS_SUB,
  QA_SUB,
  INDEX_FILE,
  ensureDirs,
  readText,
  debugLog,
} from "./helpers"
import {
  extractSessionId,
  trackMessageRole,
  trackMessagePart,
  activeSession,
  setActiveSession,
} from "./sessionTracking"
import { getTools } from "./tools"

// ─── Plugin ───────────────────────────────────────────────────────
export const MemoryPlugin: Plugin = async ({
  client,
  directory,
}) => {
  const root = directory ?? "."
  const absRoot = path.resolve(root)

  // ── 1) Memory injection at session start ──────────────────────
  async function injectMemory(sessionId: string): Promise<void> {
    const indexContent = await readText(absRoot, INDEX_FILE)
    if (!indexContent) return

    await debugLog(absRoot, `injectMemory: injecting ${indexContent.length} chars into session ${sessionId}`)
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
      debugLog(absRoot, `injectMemory error: ${err}`)
    }
  }

  // ── 2) Plugin Return ───────────────────────────────────────────
  return {
    // ── Event hooks ──
    event: async (input: { event: { type: string; properties?: any } }) => {
      const { event } = input
      const sid = extractSessionId(event)
      if (sid) setActiveSession(sid)

      // Track message roles from message.updated events
      trackMessageRole(event)

      // Track text-type message parts in real-time — deduplicated by part.id
      trackMessagePart(event, activeSession)

      // Session created - inject memory
      if (event.type === "session.created") {
        await debugLog(absRoot, `session.created handler: sid=${sid}`)
        if (sid) setTimeout(() => injectMemory(sid), 1000)
      }
    },

    // ── Tools ──
    tool: getTools(client, directory)
  }
}

export default MemoryPlugin
