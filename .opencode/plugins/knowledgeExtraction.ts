/**
 * Knowledge extraction functionality for the memory compiler plugin
 */

import { debugLog } from "./helpers"

// ─── Preprocessing ──────────────────────────────────────────────
export async function preprocessMessages(
  msgs: Array<{ role: string; text: string; order: number }>
): Promise<Array<{ role: string; text: string; order: number }>> {
  // Score each message for importance
  const scoredMsgs = msgs.map(msg => {
    let score = 0;
    const text = msg.text.toLowerCase();
    
    // Positive indicators
    if (/```|^\s{4}|\b\w+\.(js|ts|tsx|jsx|py|java|cpp|cs|go|rs)\b/.test(text)) {
      score += 2; // Code detection
    }
    if (/\b(react|vue|angular|next|nuxt|express|django|flask|spring|laravel|api|endpoint|database|sql|nosql|auth|jwt|oauth)\b/.test(text)) {
      score += 1.5; // Technical content
    }
    if (/\b(should|will|would|could|might|decide|choose|use|implement|create|build|fix|solve|optimize|refactor)\b/.test(text)) {
      score += 1; // Decision language
    }
    if (text.endsWith('?') || (msg.role === 'assistant' && text.length > 50)) {
      score += 1; // Questions or detailed explanations
    }
    
    // Negative indicators
    if (msg.text.trim().length < 10) {
      score -= 1; // Very short messages
    }
    if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|lol|haha|👍|👎)/i.test(msg.text.trim())) {
      score -= 0.5; // Greetings and acknowledgments
    }
    
    return { ...msg, score };
  });
  
  // Sort by score descending, then by original order
  scoredMsgs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.order - b.order;
  });
  
  // Take top scoring messages, but ensure we keep at least some context
  const threshold = 1.5; // Minimum score to include
  const highScoring = scoredMsgs.filter(msg => msg.score >= threshold);
  
  // If we have too few high scoring messages, take top 50% or at least 3
  if (highScoring.length < 3 && scoredMsgs.length >= 3) {
    const takeCount = Math.max(3, Math.ceil(scoredMsgs.length * 0.5));
    return scoredMsgs.slice(0, takeCount).sort((a, b) => a.order - b.order);
  }
  
  // Otherwise return high scoring messages in original order
  return highScoring.sort((a, b) => a.order - b.order);
}

// ─── LLM Helper ──────────────────────────────────────────────
// The OpenCode SDK wraps all responses under a `data` key:
//   { data: { id: "ses_xxx", ... }, request: {}, response: {} }
// We must unwrap before accessing fields.
export async function callLLM(client: any, prompt: string): Promise<string> {
  let sessionId = ""
  try {
    await debugLog("", `callLLM: creating temp session`)
    const rawCreate: any = await client.session.create({
      body: { title: "[memory-agent]" },
    })
    const created = rawCreate?.data ?? rawCreate
    sessionId = created?.id ?? ""
    await debugLog("", `callLLM: session created, id=${sessionId}, rawKeys=${JSON.stringify(Object.keys(rawCreate ?? {}))}`)

    if (!sessionId.startsWith("ses_")) {
      throw new Error(`session.create returned invalid ID: ${JSON.stringify(rawCreate)}`)
    }

    await debugLog("", `callLLM: sending prompt (${prompt.length} chars) to session ${sessionId}`)
    const rawResult: any = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    })

    // Unwrap SDK response
    const result = rawResult?.data ?? rawResult
    const resultKeys = Object.keys(result ?? {})
    await debugLog("", `callLLM: result keys: ${JSON.stringify(resultKeys)}`)

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

    await debugLog("", `callLLM: got response (${text.length} chars)`)
    return text || ""
  } catch (err) {
    await debugLog("", `callLLM ERROR: ${(err as Error)?.message ?? err}`)
    // In a real implementation, we'd log this error properly
    return ""
  } finally {
    if (sessionId) {
      try {
        await client.session.delete({ sessionID: sessionId })
      } catch {}
    }
  }
}

// ─── Extract Knowledge from Transcript ─────────────────────────────
export async function extractKnowledge(
  client: any,
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

  const result = await callLLM(client, prompt)
  if (!result || result.includes("No significant knowledge extracted")) return null
  return result
}
