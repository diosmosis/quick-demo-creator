import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderText
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

// Sits after oneDark so it wins: the editor matches the app's panels rather
// than bringing its own background.
const appTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--panel)' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', borderRight: '1px solid var(--border)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(91, 140, 255, 0.25)'
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
    '.cm-panels': { backgroundColor: 'var(--bg-2)', color: 'var(--text)' },
    '.cm-placeholder': { color: 'var(--muted)' }
  },
  { dark: true }
)

// The generated Puppeteer script, in CodeMirror: line numbers (the safety
// check reports findings by line), JavaScript highlighting, and find/replace
// on Ctrl+F. The document is CodeMirror's; `value` is only pushed in when it
// changes from outside, such as a newly generated script.
const CodeEditor = forwardRef(function CodeEditor({ value, onChange, placeholder }, ref) {
  const host = useRef(null)
  const view = useRef(null)
  // Read through a ref so the view is built once, however often App renders.
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
          EditorState.tabSize.of(2),
          javascript(),
          placeholderText(placeholder ?? ''),
          oneDark,
          appTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString())
          })
        ]
      })
    })
    return () => view.current.destroy()
    // Mount-only: later values arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A value that differs from the document came from outside, not a
  // keystroke (those have already been reported, so they match).
  useEffect(() => {
    const v = view.current
    if (!v || v.state.doc.toString() === value) return
    // Not reported back through onChange: App would take it for an edit.
    const report = change.current
    change.current = () => {}
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    change.current = report
  }, [value])

  useImperativeHandle(ref, () => ({
    // Selects line `n` (1-based) and scrolls it to the middle of the view.
    goToLine(n) {
      const v = view.current
      const doc = v.state.doc
      const line = doc.line(Math.min(Math.max(n, 1), doc.lines))
      v.dispatch({
        selection: EditorSelection.range(line.from, line.to),
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      })
      v.focus()
    }
  }))

  return <div className="code-editor" ref={host} />
})

export default CodeEditor
