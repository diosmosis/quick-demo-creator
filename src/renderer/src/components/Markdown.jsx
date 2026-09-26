import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Read-only rendering of a markdown document. The text comes from Claude, which
// read a PR anyone could have written, so the HTML is sanitized before use.
export default function Markdown({ text, placeholder }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '', { gfm: true, breaks: true })), [text])

  // A link would otherwise navigate the app's own window. window.open goes
  // through the main process's handler, which opens the system browser.
  const onClick = (e) => {
    const a = e.target.closest('a[href]')
    if (!a) return
    e.preventDefault()
    if (/^https?:/i.test(a.href)) window.open(a.href)
  }

  if (!text?.trim()) {
    return (
      <div className="markdown">
        <div className="log-placeholder">{placeholder}</div>
      </div>
    )
  }
  return <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
