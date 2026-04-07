/**
 * OpenCode Memory Compiler — Extraction Plugin
 *
 * Listens for session lifecycle events and automatically extracts
 * knowledge from conversation transcripts into the wiki.
 *
 * Two triggers:
 *   1. session.idle — fires when a session ends
 *   2. experimental.session.compacting — fires before auto-compaction
 *
 * Install: add to your opencode.json config:
 *   { "plugin": ["./extraction-plugin.ts"] }
 */

import type { Plugin, Hooks } from "@opencode-ai/plugin";

const WIKI_DIR = ".";
const MAX_TURNS = 30;
const MAX_CONTEXT_CHARS = 15_000;
const MIN_TURNS_SESSION_END = 1;
const MIN_TURNS_PRE_COMPACT = 5;

const processedSessions = new Set<string>();

interface MessageInfo {
    role: string;
}

interface TextPart {
    type: "text";
    text: string;
}

interface Part {
    type: string;
    text?: string;
}

interface Message {
    info: MessageInfo;
    parts: Part[];
}

function extractTextFromMessages(messages: Message[], maxTurns: number, maxChars: number): string {
    const turns: string[] = [];

    for (const msg of messages) {
        const role = msg.info.role;
        if (role !== "user" && role !== "assistant") continue;

        const textParts = msg.parts
            .filter((p): p is TextPart => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0)
            .map((p) => p.text!.trim());

        if (textParts.length === 0) continue;

        const label = role === "user" ? "User" : "Assistant";
        turns.push(`**${label}:** ${textParts.join("\n")}\n`);
    }

    let recent = turns.slice(-maxTurns);
    let context = recent.join("\n");

    if (context.length > maxChars) {
        context = context.slice(-maxChars);
        const boundary = context.indexOf("\n**");
        if (boundary > 0) {
            context = context.slice(boundary + 1);
        }
    }

    return context;
}

async function spawnExtractionSession(
    client: any,
    directory: string,
    sessionID: string,
    context: string,
    source: string,
): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeSessionID = sessionID.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);

    const extractionPrompt = `You are a knowledge extraction agent. A conversation session has ended and you need to extract key knowledge from it.

## Session Metadata
- Session ID: ${sessionID}
- Source: ${source}
- Extracted at: ${new Date().toISOString()}

## Conversation Context

${context}

## Your Task

Read the conversation above and extract important knowledge. Follow the schema in OPENCODE.md strictly.

1. Identify decisions, patterns, gotchas, lessons, and architecture notes
2. Create or update articles in articles/ subdirectories
3. Append an entry to logs/YYYY-MM-DD.md (create if needed)
4. Append a line to log.md (master log)
5. Update index.md with any new articles

Use the article format specified in OPENCODE.md. Every article must have frontmatter, related links, and source references.

If nothing in this conversation is worth saving (just greetings, trivial Q&A, etc.), respond with "FLUSH_OK" and do not create any files.`;

    try {
        const extractionSession = await client.session.create({
            directory,
            title: `extract-${safeSessionID}-${timestamp}`,
        });

        await client.session.prompt(extractionSession.id, {
            directory,
            parts: [{ type: "text", text: extractionPrompt }],
            agent: "build",
        });

        console.log(`[wiki] Extraction session created for ${sessionID} (${source})`);
    } catch (err) {
        console.error(`[wiki] Failed to create extraction session for ${sessionID}:`, err);
    }
}

export const extractionPlugin: Plugin = async (input) => {
    const { client, directory } = input;
    const hooks: Hooks = {};

    hooks.event = async ({ event }) => {
        const eventType = event.type;

        if (eventType === "session.idle") {
            const sessionID = event.properties?.sessionID;
            if (!sessionID || processedSessions.has(sessionID)) return;
            processedSessions.add(sessionID);

            console.log(`[wiki] Session ${sessionID} ended — extracting knowledge`);

            try {
                const messages = await client.session.messages({ sessionID, directory });
                const context = extractTextFromMessages(messages, MAX_TURNS, MAX_CONTEXT_CHARS);

                if (!context.trim()) {
                    console.log(`[wiki] Empty context for ${sessionID}, skipping`);
                    return;
                }

                const turnCount = context.split("**User:**").length + context.split("**Assistant:**").length - 2;
                if (turnCount < MIN_TURNS_SESSION_END) {
                    console.log(`[wiki] Only ${turnCount} turns for ${sessionID}, skipping`);
                    return;
                }

                await spawnExtractionSession(client, directory, sessionID, context, "session-end");
            } catch (err) {
                console.error(`[wiki] Failed to process session ${sessionID}:`, err);
            }
        }
    };

    hooks["experimental.session.compacting"] = async (event) => {
        const sessionID = event.sessionId;
        if (!sessionID || processedSessions.has(sessionID)) return;
        processedSessions.add(sessionID);

        console.log(`[wiki] Session ${sessionID} compacting — extracting knowledge before context loss`);

        try {
            const messages = await client.session.messages({ sessionID, directory });
            const context = extractTextFromMessages(messages, MAX_TURNS, MAX_CONTEXT_CHARS);

            if (!context.trim()) {
                console.log(`[wiki] Empty context for ${sessionID} compaction, skipping`);
                return;
            }

            const turnCount = context.split("**User:**").length + context.split("**Assistant:**").length - 2;
            if (turnCount < MIN_TURNS_PRE_COMPACT) {
                console.log(`[wiki] Only ${turnCount} turns for ${sessionID} compaction, skipping`);
                return;
            }

            await spawnExtractionSession(client, directory, sessionID, context, "pre-compact");
        } catch (err) {
            console.error(`[wiki] Failed to process compaction for ${sessionID}:`, err);
        }
    };

    return hooks;
};

export default extractionPlugin;
