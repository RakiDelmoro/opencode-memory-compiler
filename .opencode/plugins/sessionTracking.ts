/**
 * Session tracking functionality for the memory compiler plugin
 */

// ─── Types ─────────────────────────────────────────────────────
export type MessagePart = {
  role: string;
  text: string;
  order: number;
};

// ─── Session Tracking ──────────────────────────────────────────
// Track message parts by ID (avoids duplicates from streaming updates)
export const sessionParts: Map<string, MessagePart> = new Map();
// Track message roles from message.updated events (parts don't carry role)
export const messageRoles: Map<string, string> = new Map();
let eventCounter = 0;

// Also track the last known session ID for fallback
export let activeSession: string | null = null;

// Extract session ID from event properties
export function extractSessionId(ev: { properties?: any }): string | null {
  const p = ev.properties ?? {};
  return p.sessionID
    ?? p.id
    ?? p.session?.id
    ?? p.info?.id
    ?? null;
}

// Get messages for a specific session
export function getMessagesForSession(sessionId: string): MessagePart[] {
  const msgs: MessagePart[] = [];
  for (const [key, val] of sessionParts.entries()) {
    if (key.startsWith(`${sessionId}:`)) {
      msgs.push(val);
    }
  }
  return msgs.sort((a, b) => a.order - b.order);
}

// Track message roles from message.updated events
export function trackMessageRole(event: { type: string; properties?: any }): void {
  if (event.type === "message.updated") {
    const msgId = event.properties?.info?.id ?? event.properties?.messageID;
    const role = event.properties?.info?.role;
    if (msgId && role) {
      messageRoles.set(msgId, role);
    }
  }
}

// Track text-type message parts in real-time — deduplicated by part.id
export function trackMessagePart(
  event: { type: string; properties?: any },
  sessionId: string | null
): void {
  if (event.type === "message.part.updated") {
    const p = event.properties;
    const sessionID = p?.sessionID ?? p?.part?.sessionID ?? sessionId;
    const part = p?.part;

    if (sessionID && part?.id && part.type === "text" && part.text?.trim()) {
      const msgId = part.messageID ?? "";
      const role = messageRoles.get(msgId) ?? "user";

      const key = `${sessionID}:${part.id}`;
      const existingEntry = sessionParts.get(key);
      sessionParts.set(key, {
        role,
        text: part.text.trim(),
        order: existingEntry?.order ?? eventCounter++,
      });
    }
  }
}

// Clean up tracked parts for a session
export function cleanupSession(sessionId: string): void {
  for (const key of sessionParts.keys()) {
    if (key.startsWith(`${sessionId}:`)) sessionParts.delete(key);
  }
}

// Reset active session
export function resetActiveSession(): void {
  activeSession = null;
}

// Set active session
export function setActiveSession(sid: string | null): void {
  activeSession = sid;
}
