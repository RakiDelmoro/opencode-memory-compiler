/**
 * Memory Capture Plugin for Opencode
 * 
 * Automatically captures sessions and saves them to the memory system.
 * 
 * Installation:
 *   1. Copy this file to .opencode/plugins/memory-capture.ts
 *   2. Ensure memory system (opencode-memory-compiler) is in project
 *   3. Restart Opencode
 * 
 * Hooks:
 *   - session.created: Captures new session when created
 *   - experimental.session.compacting: Captures before context compaction
 */

import { Plugin, tool } from '@opencode-ai/plugin'
import { spawn } from 'child_process'
import * as path from 'path'

// Configuration - adjust these paths for your setup
// Default to relative path from current working directory
// Can be overridden with MEMORY_ROOT environment variable
const MEMORY_ROOT = process.env.MEMORY_ROOT || './opencode-memory-compiler'
const MEMORY_SAVE_SCRIPT = path.resolve(process.cwd(), MEMORY_ROOT, 'scripts', 'memory_save.py')

// Debug: log the resolved path
console.log('[memory-capture] MEMORY_ROOT:', MEMORY_ROOT)
console.log('[memory-capture] Script path:', MEMORY_SAVE_SCRIPT)

// Track last session captured to avoid duplicates
let lastCapturedSessionId: string | null = null

export const MemoryCapturePlugin: Plugin = async (ctx) => {
  console.log('[memory-capture] Plugin loaded')

  return {
    // Event hook - listen to all server events
    event: async (input) => {
      const { event } = input

      // Session created - capture the new session
      if (event.type === 'session.created') {
        await handleSessionCreated(event.properties.info)
      }

      // Session compaction - capture before context is pruned
      if (event.type === 'experimental.session.compacting') {
        await handleSessionCompacting(event.properties.info)
      }
    },

    // Optional: expose a manual save tool
    tool: {
      memory_save_manual: tool({
        description: 'Manually save current session to memory system',
        args: {},
        async execute(args, context) {
          try {
            // Get current session info
            const result = await ctx.$`opencode session info --json 2>/dev/null || echo '{}'`
            const sessionInfo = JSON.parse(result.stdout.toString() || '{}')
            
            await captureSession({
              id: context.sessionID,
              phase: 'manual'
            })
            
            return 'Session saved to memory system'
          } catch (error) {
            return `Error saving session: ${error}`
          }
        },
      }),
    },
  }

  async function handleSessionCreated(sessionInfo: any) {
    // Small delay to allow session to build up messages
    setTimeout(async () => {
      await captureSession({
        id: sessionInfo.id,
        phase: 'created'
      })
    }, 1000)
  }

  async function handleSessionCompacting(sessionInfo: any) {
    await captureSession({
      id: sessionInfo.id,
      phase: 'compacting'
    })
  }

  async function captureSession(data: { id: string; phase: string }) {
    // Avoid duplicate captures
    if (lastCapturedSessionId === data.id && data.phase !== 'compacting') {
      console.log(`[memory-capture] Skipping duplicate: ${data.id}`)
      return
    }

    // Skip very short sessions (likely just initial connection)
    // The actual filtering will be done by the compile step (LLM-powered)
    // We just skip truly trivial ones here
    console.log(`[memory-capture] Capturing session: ${data.id} (${data.phase})`)

    try {
      // Build session data - get from session store if available
      // Since we can't directly access session data, we'll pass what we know
      // The memory_save.py will handle the actual data retrieval
      const sessionData = JSON.stringify({
        id: data.id,
        timestamp: new Date().toISOString(),
        phase: data.phase,
        // We'll augment this with actual session data if available
      })

      await execMemorySave(sessionData)
      lastCapturedSessionId = data.id
      console.log(`[memory-capture] Session captured: ${data.id}`)
    } catch (error) {
      console.error(`[memory-capture] Error capturing session: ${error}`)
    }
  }
}

function execMemorySave(sessionData: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Use python3 directly - it's in PATH and we verified it works
    const pythonCmd = 'python3'
    
    const proc = spawn(pythonCmd, [MEMORY_SAVE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        console.error(`[memory-capture] memory_save.py error: ${stderr}`)
        reject(new Error(`memory_save.py exited with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })

    // Send session data to stdin
    proc.stdin.write(sessionData)
    proc.stdin.end()
  })
}

export default MemoryCapturePlugin