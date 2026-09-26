import React, { forwardRef, useImperativeHandle, useRef } from 'react'

// A textarea with a line-number gutter, since the safety check reports its
// findings by line. The text never wraps, so each line is exactly one row
// and the gutter only has to follow the textarea's scroll position.
const CodeEditor = forwardRef(function CodeEditor({ value, onChange, placeholder }, ref) {
  const text = useRef(null)
  const gutter = useRef(null)
  const lines = value.split('\n')

  useImperativeHandle(ref, () => ({
    // Selects line `n` (1-based) and scrolls it to the middle of the view.
    goToLine(n) {
      const el = text.current
      const index = Math.min(Math.max(n, 1), lines.length) - 1
      const start = lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0)
      el.focus()
      el.setSelectionRange(start, start + lines[index].length)
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
      el.scrollTop = index * lineHeight - (el.clientHeight - lineHeight) / 2
    }
  }))

  return (
    <div className="code-editor">
      <div className="gutter" ref={gutter} aria-hidden>
        {lines.map((_, i) => i + 1).join('\n')}
      </div>
      <textarea
        ref={text}
        className="editor code"
        value={value}
        onChange={onChange}
        onScroll={() => (gutter.current.scrollTop = text.current.scrollTop)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  )
})

export default CodeEditor
