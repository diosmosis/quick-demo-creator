import React, { useState } from 'react'
import { api } from '../api'

const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p

// The files mounted read-only in the recorder's /input. `required` are the
// names the script mentions, each shown as a slot to drop a file on (it is
// mounted under the slot's name, whatever it is called here); a file dropped
// anywhere else in the box keeps its own name. `files` is [{ name, path,
// exists }].
export default function InputFiles({ required, files, onChange }) {
  const [over, setOver] = useState(null) // the slot being dragged over, or '' for the box

  const byName = new Map(files.map((f) => [f.name, f]))
  const extra = files.filter((f) => !required.includes(f.name))

  // Adds or replaces files by name.
  const put = (added) => {
    const names = new Set(added.map((f) => f.name))
    onChange([...files.filter((f) => !names.has(f.name)), ...added.map((f) => ({ ...f, exists: true }))])
  }
  const remove = (name) => onChange(files.filter((f) => f.name !== name))

  const dropTarget = (slot) => ({
    onDragOver: (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setOver(slot)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOver(null)
    },
    onDrop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setOver(null)
      const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean)
      if (!paths.length) return
      put(slot ? [{ name: slot, path: paths[0] }] : paths.map((p) => ({ name: baseName(p), path: p })))
    }
  })

  const choose = async (slot) => {
    const paths = await api.selectFiles()
    if (!paths.length) return
    put(slot ? [{ name: slot, path: paths[0] }] : paths.map((p) => ({ name: baseName(p), path: p })))
  }

  const row = (name, file, isRequired) => (
    <div key={name} className={`files-row ${over === name ? 'over' : ''}`} {...(isRequired ? dropTarget(name) : {})}>
      <div className="files-head">
        <code>/input/{name}</code>
        <span className="files-actions">
          {isRequired && (
            <button className="link-btn" onClick={() => choose(name)}>
              {file ? 'Change…' : 'Choose…'}
            </button>
          )}
          {file && (
            <button className="link-btn" onClick={() => remove(name)}>
              Remove
            </button>
          )}
        </span>
      </div>
      {file ? (
        <span className={`files-path ${file.exists ? '' : 'missing'}`} title={file.path}>
          {file.path}
          {!file.exists && ' — no longer exists'}
        </span>
      ) : (
        <span className="files-path missing">Needed by the script. Drop a file here or choose one.</span>
      )}
    </div>
  )

  return (
    <div className={`side-body files ${over === '' ? 'over' : ''}`} {...dropTarget('')}>
      <p className="hint">
        Mounted read-only in the recorder's <code>/input</code>, its working directory. Drop a file on a slot the script
        names, or anywhere here to add it under its own name.
      </p>
      {required.map((name) => row(name, byName.get(name), true))}
      {extra.map((f) => row(f.name, f, false))}
      {!required.length && !extra.length && <p className="muted">None added, and the script doesn't name any.</p>}
      <button className="btn secondary files-add" onClick={() => choose('')}>
        Add files…
      </button>
    </div>
  )
}
