import React from 'react'

// A field for each environment variable the script reads. `values` are the
// ones remembered for `project`. `suggestions` (the running instances' URLs)
// are offered in every field, from a <datalist> with the id `listId`.
export default function EnvFields({ vars, values, project, suggestions = [], listId, onChange }) {
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
            list={suggestions.length ? listId : undefined}
            spellCheck={false}
          />
        </label>
      ))}
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((url) => (
            <option key={url} value={url} />
          ))}
        </datalist>
      )}
    </div>
  )
}
