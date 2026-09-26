import React from 'react'

// Identifies a finding across edits: its message and the code on its line,
// rather than the line number, which shifts as lines are added above it.
export function findingKey(finding, code) {
  const text = finding.line ? (code.split('\n')[finding.line - 1] ?? '').trim() : ''
  return `${finding.severity}|${finding.message}|${text}`
}

// The safety check's findings that haven't been dismissed yet; nothing at all
// once they all have. Dismissing a danger finding is how the user says they
// have reviewed it, so recording is allowed once none are left.
export default function SafetyCheck({ findings, onDismiss, onGoToLine }) {
  if (!findings.length) return null
  const danger = findings.some((f) => f.severity === 'danger')
  return (
    <div className={`safety ${danger ? 'danger' : 'warn'}`}>
      <div className="safety-title">
        {danger
          ? 'Safety check: this script does things a recording script should not. Dismiss each one once you have reviewed it.'
          : 'Safety check: nothing dangerous found, but note:'}
      </div>
      <ul>
        {findings.map((f) => (
          <li key={f.key} className={f.severity}>
            <span className="safety-text">
              {f.line ? (
                <button className="line" title="Show this line" onClick={() => onGoToLine(f.line)}>
                  line {f.line}
                </button>
              ) : null}{' '}
              {f.message}
            </span>
            <button
              className="dismiss"
              title={f.severity === 'danger' ? "I've reviewed this; record anyway" : 'Dismiss'}
              onClick={() => onDismiss(f.key)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
