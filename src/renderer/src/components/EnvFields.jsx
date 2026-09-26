import React from 'react'

// A field for each environment variable the script reads. `values` are the
// ones remembered for `project`.
export default function EnvFields({ vars, values, project, onChange }) {
  return (
    <div className="side-body">
      <p className="hint">
        Passed to the recorder. Leave a field blank for the script's default{project && `; remembered for ${project}`}.
      </p>
      {vars.length === 0 && <p className="muted">The script doesn't read any environment variables.</p>}
      {vars.map((v) => (
        <label key={v.name} className="env-field">
          <code>{v.name}</code>
          <input
            type="text"
            value={values[v.name] ?? ''}
            placeholder={v.fallback || v.computed || '(no default)'}
            title={v.computed ? `Left blank, the script computes it: ${v.computed}` : undefined}
            onChange={(e) => onChange(v.name, e.target.value)}
            spellCheck={false}
          />
        </label>
      ))}
    </div>
  )
}
