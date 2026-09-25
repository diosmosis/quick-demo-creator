import React, { useEffect, useRef } from 'react'

// Folds a streamed event into the log. Consecutive text of the same kind is
// merged so a token-by-token stream stays one block.
export function appendLog(entries, event) {
  const { type } = event
  const last = entries[entries.length - 1]
  if (['text', 'thinking', 'log', 'stderr'].includes(type)) {
    const text = type === 'log' ? event.text + '\n' : event.text
    if (last && last.type === type) {
      return [...entries.slice(0, -1), { ...last, text: last.text + text }]
    }
    return [...entries, { type, text }]
  }
  return [...entries, event]
}

// Streamed output of a stage. Sticks to the bottom unless the user has
// scrolled up to read something.
export default function LogView({ entries, placeholder }) {
  const ref = useRef(null)
  const stick = useRef(true)

  useEffect(() => {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [entries])

  const onScroll = () => {
    const el = ref.current
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <div className="log" ref={ref} onScroll={onScroll}>
      {entries.length === 0 && <div className="log-placeholder">{placeholder}</div>}
      {entries.map((e, i) => {
        switch (e.type) {
          case 'status':
            return (
              <div key={i} className="log-status">
                {e.text}
              </div>
            )
          case 'tool':
            return (
              <div key={i} className="log-tool">
                <span className="log-tool-name">{e.name}</span> {e.text}
              </div>
            )
          case 'toolResult':
            return (
              <pre key={i} className={`log-tool-result${e.isError ? ' error' : ''}`}>
                {e.text}
              </pre>
            )
          case 'error':
            return (
              <div key={i} className="log-error">
                {e.text}
              </div>
            )
          default:
            return (
              <pre key={i} className={`log-${e.type}`}>
                {e.text}
              </pre>
            )
        }
      })}
    </div>
  )
}
