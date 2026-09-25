// Runs the Claude CLI non-interactively and turns its stream-json output into
// events the UI can show as they happen.
import { spawn } from 'node:child_process'
import { splitArgs } from './text.js'

// Always added after the user's own arguments: the parser below depends on them.
const STREAM_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']

function summarizeToolInput(name, input = {}) {
  if (input.command) return input.command
  if (input.url) return input.url
  if (input.file_path) return input.file_path
  if (input.pattern) return input.pattern
  const json = JSON.stringify(input)
  return json.length > 200 ? json.slice(0, 200) + '…' : json
}

function toolResultText(content) {
  const text = Array.isArray(content)
    ? content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
    : String(content ?? '')
  const lines = text.split('\n')
  const head = lines.slice(0, 6).join('\n')
  return lines.length > 6 ? `${head}\n… (${lines.length - 6} more lines)` : head
}

// Feed it stdout chunks; it calls `emit` with UI events and tracks the final
// answer. Lines that aren't JSON are passed through as plain text, so a wrapper
// that prints its own output (or a claude without stream-json) still works.
export class StreamParser {
  constructor(emit) {
    this.emit = emit
    this.buffer = ''
    this.sawDeltas = false
    this.wroteText = false
    this.lastAssistantText = ''
    this.plainText = ''
    this.result = null
  }

  feed(chunk) {
    this.buffer += chunk
    let nl
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      this.line(line)
    }
  }

  end() {
    if (this.buffer) this.line(this.buffer)
    this.buffer = ''
  }

  // The answer: the result event's text, else the last thing Claude said.
  answer() {
    if (this.result && typeof this.result.result === 'string') return this.result.result
    return this.lastAssistantText || this.plainText
  }

  line(line) {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      msg = null
    }
    if (!msg || typeof msg !== 'object' || !msg.type) {
      this.plainText += line + '\n'
      this.emit({ type: 'text', text: line + '\n' })
      return
    }

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.emit({ type: 'status', text: `Claude session started${msg.model ? ` (${msg.model})` : ''}` })
        }
        break

      case 'stream_event':
        this.streamEvent(msg.event || {})
        break

      case 'assistant':
        this.assistant(msg.message || {})
        break

      case 'user':
        for (const block of msg.message?.content || []) {
          if (block.type === 'tool_result') {
            this.emit({ type: 'toolResult', text: toolResultText(block.content), isError: !!block.is_error })
          }
        }
        break

      case 'result':
        this.result = msg
        break
    }
  }

  streamEvent(event) {
    if (event.type === 'message_start' && this.wroteText) {
      this.emit({ type: 'text', text: '\n\n' })
    } else if (event.type === 'content_block_delta') {
      const d = event.delta || {}
      if (d.type === 'text_delta' && d.text) {
        this.sawDeltas = true
        this.wroteText = true
        this.emit({ type: 'text', text: d.text })
      } else if (d.type === 'thinking_delta' && d.thinking) {
        this.emit({ type: 'thinking', text: d.thinking })
      }
    }
  }

  assistant(message) {
    const texts = []
    for (const block of message.content || []) {
      if (block.type === 'text') texts.push(block.text)
      if (block.type === 'tool_use') {
        this.emit({ type: 'tool', name: block.name, text: summarizeToolInput(block.name, block.input) })
      }
    }
    if (texts.length) {
      this.lastAssistantText = texts.join('')
      // Without --include-partial-messages support the text only arrives here.
      if (!this.sawDeltas) {
        this.emit({ type: 'text', text: (this.wroteText ? '\n\n' : '') + this.lastAssistantText })
        this.wroteText = true
      }
    }
  }
}

// Starts Claude with `prompt`. Returns { done, cancel }: `done` resolves with
// the final answer, or rejects with a readable error.
export function runClaude({ settings, prompt, cwd, onEvent }) {
  const byArgument = settings.promptDelivery === 'argument'
  const args = [...splitArgs(settings.claudeArgs || ''), ...STREAM_ARGS]
  onEvent({ type: 'status', text: `$ ${[settings.claudePath, ...args].join(' ')}${byArgument ? ' <prompt>' : ' < prompt'}` })
  if (byArgument) args.push(prompt)

  const env = { ...process.env }
  if (settings.githubToken) {
    env.GH_TOKEN = settings.githubToken
    env.GITHUB_TOKEN = settings.githubToken
  }

  const child = spawn(settings.claudePath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  const parser = new StreamParser(onEvent)
  let stderr = ''
  let cancelled = false

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => parser.feed(chunk))
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    onEvent({ type: 'stderr', text: chunk })
  })
  // A wrapper that doesn't read stdin closes it early; that's not an error.
  child.stdin.on('error', () => {})
  if (byArgument) child.stdin.end()
  else child.stdin.end(prompt)

  const done = new Promise((resolve, reject) => {
    child.on('error', (err) => {
      reject(
        err.code === 'ENOENT'
          ? new Error(`Couldn't run "${settings.claudePath}". Set the Claude executable in Settings.`)
          : err
      )
    })
    child.on('close', (code, signal) => {
      parser.end()
      if (cancelled) return reject(new Error('Cancelled.'))
      const result = parser.result
      if (result) {
        const cost = typeof result.total_cost_usd === 'number' ? `, $${result.total_cost_usd.toFixed(2)}` : ''
        const secs = result.duration_ms ? `${Math.round(result.duration_ms / 1000)}s` : ''
        onEvent({ type: 'status', text: `Finished (${[secs, `${result.num_turns ?? '?'} turns`].filter(Boolean).join(', ')}${cost})` })
        if (result.is_error) return reject(new Error(result.result || `Claude reported an error (${result.subtype}).`))
      }
      const answer = parser.answer().trim()
      if (code !== 0 && !result) {
        const tail = stderr.trim().split('\n').slice(-5).join('\n')
        return reject(new Error(`Claude exited with ${signal || `code ${code}`}${tail ? `:\n${tail}` : ''}`))
      }
      if (!answer) return reject(new Error('Claude finished without an answer.'))
      resolve(answer)
    })
  })

  return {
    done,
    cancel() {
      cancelled = true
      child.kill('SIGTERM')
    }
  }
}
