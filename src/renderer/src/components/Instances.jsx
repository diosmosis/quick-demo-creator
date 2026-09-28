import React, { useEffect, useState } from 'react'
import { api } from '../api'

const RUNNING = new Set(['running', 'starting'])
const NO_VOLUMES = []

// The Environment stage's copies of DDEV projects. `instances` come from
// api.listInstances(). DDEV commands go through the `on*` callbacks, which run
// one at a time (`busy` while one does); `onOpen(fn)` runs a quick action,
// such as opening a folder, and shows its error.
export default function Instances({ instances, error, busy, onCreate, onDdev, onSetVolumes, onRemove, onOpen, onRefresh }) {
  const lastTemplate = instances[instances.length - 1]?.template || ''
  const [template, setTemplate] = useState('')
  const [templateInfo, setTemplateInfo] = useState({ problem: '', name: '' })
  const [name, setName] = useState('')
  const [mode, setMode] = useState('copy')
  const [copyDatabase, setCopyDatabase] = useState(true)

  // The template of the last instance added, until one is chosen.
  useEffect(() => {
    if (!template && lastTemplate) setTemplate(lastTemplate)
  }, [lastTemplate])

  // A name that isn't taken yet, whenever the template or the list changes.
  const taken = instances.map((i) => i.name).join(' ')
  useEffect(() => {
    if (!template) return
    api.checkTemplate(template).then((info) => {
      setTemplateInfo(info)
      setName(info.name)
    })
  }, [template, taken])

  const chooseTemplate = async () => {
    const dir = await api.selectFolder()
    if (dir) setTemplate(dir)
  }

  const add = () => onCreate({ template, name: name.trim(), mode, copyDatabase })

  return (
    <div className="instances">
      <div className="instance-new">
        <div className="pane-title">Add an instance</div>
        <div className="row">
          <input
            type="text"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="The folder of a DDEV project to copy, e.g. ~/Projects/matomo"
            spellCheck={false}
          />
          <button className="btn secondary" onClick={chooseTemplate}>
            Choose…
          </button>
        </div>
        {template && templateInfo.problem && <span className="field-error">{templateInfo.problem}</span>}
        <div className="row instance-new-options">
          <label className="inline-field">
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
          <label className="inline-field">
            As a
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="copy">full copy</option>
              <option value="worktree">git worktree</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={copyDatabase} onChange={(e) => setCopyDatabase(e.target.checked)} />
            Import the template's database
          </label>
          <button className="btn" onClick={add} disabled={busy || !template || !!templateInfo.problem || !name.trim()}>
            Add and start
          </button>
        </div>
        <p className="hint">
          {mode === 'copy'
            ? 'Copies the whole folder, including what git ignores (vendor, node_modules, local config), so it runs like the template does.'
            : "Checks out the template's current commit: only what is committed, so dependencies and local config have to be set up in it."}{' '}
          It runs as its own DDEV project at https://{name || 'name'}.ddev.site
          {copyDatabase && ", starting with a copy of the template's database, if the template is running"}.
        </p>
      </div>

      <div className="pane-title instances-head">
        Instances
        <button className="link-btn" onClick={onRefresh} disabled={busy}>
          Refresh
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {instances.length === 0 && <p className="muted">None yet. Add one above to copy a DDEV project and start it.</p>}
      {instances.map((inst) => (
        <Instance key={inst.name} inst={inst} busy={busy} onDdev={onDdev} onSetVolumes={onSetVolumes} onRemove={onRemove} onOpen={onOpen} />
      ))}
    </div>
  )
}

function Instance({ inst, busy, onDdev, onSetVolumes, onRemove, onOpen }) {
  const [command, setCommand] = useState('')
  const [showVolumes, setShowVolumes] = useState(false)
  const running = RUNNING.has(inst.status)
  const missing = inst.status === 'missing'

  const run = (e) => {
    e.preventDefault()
    if (command.trim()) onDdev(inst.name, command.trim())
  }

  return (
    <div className="instance">
      <div className="instance-head">
        <span className={`status-dot ${running ? 'on' : missing ? 'bad' : ''}`} title={inst.status} />
        <strong>{inst.name}</strong>
        <span className="muted">{inst.status}</span>
        {inst.url && running && (
          <button className="link-btn" onClick={() => onOpen(() => api.openExternal(inst.url))} title="Open in the browser">
            {inst.url}
          </button>
        )}
        <span className="instance-actions">
          {running ? (
            <>
              <button className="btn secondary" disabled={busy} onClick={() => onDdev(inst.name, ['restart'])}>
                Restart
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => onDdev(inst.name, ['stop'])}>
                Stop
              </button>
            </>
          ) : (
            <button className="btn secondary" disabled={busy || missing} onClick={() => onDdev(inst.name, ['start'])}>
              Start
            </button>
          )}
          <button className="btn secondary" disabled={missing} onClick={() => onOpen(() => api.editInstance(inst.name))} title="Open the copy's folder in your editor (set in Settings)">
            Edit files
          </button>
          <button className="btn secondary" disabled={missing} onClick={() => onOpen(() => api.openPath(inst.dir))}>
            Open folder
          </button>
          <button className="btn danger" disabled={busy} onClick={() => onRemove(inst.name)}>
            Delete
          </button>
        </span>
      </div>
      <div className="instance-paths muted">
        {inst.mode === 'worktree' ? 'Worktree' : 'Copy'} of <code>{inst.template}</code> in <code>{inst.dir}</code>
      </div>
      <form className="row instance-command" onSubmit={run}>
        <code>ddev</code>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="a command to run in it, e.g. import-db --file=dump.sql.gz, or exec php console plugin:activate Foo"
          spellCheck={false}
        />
        <button className="btn secondary" disabled={busy || missing || !command.trim()}>
          Run
        </button>
      </form>
      <button className="link-btn instance-volumes-toggle" onClick={() => setShowVolumes((v) => !v)}>
        {showVolumes ? 'Hide volumes' : `Volumes (${inst.volumes?.length || 0})`}
      </button>
      {showVolumes && <Volumes inst={inst} busy={busy} onSave={onSetVolumes} />}
    </div>
  )
}

// Extra bind mounts into the instance's containers, applied on its next start.
function Volumes({ inst, busy, onSave }) {
  const saved = inst.volumes || NO_VOLUMES
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [JSON.stringify(saved)])
  const changed = JSON.stringify(draft) !== JSON.stringify(saved)

  const set = (i, patch) => setDraft((d) => d.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const choose = async (i) => {
    const dir = await api.selectFolder()
    if (dir) set(i, { source: dir })
  }

  return (
    <div className="volumes">
      <p className="hint">
        Mounts a folder from this machine into a service's container, such as a plugin checkout into{' '}
        <code>/var/www/html/plugins/MyPlugin</code> in <code>web</code>. Takes effect when the instance is next started or
        restarted.
      </p>
      {draft.map((v, i) => (
        <div key={i} className="row volume">
          <input type="text" value={v.source} onChange={(e) => set(i, { source: e.target.value })} placeholder="/path/on/this/machine" spellCheck={false} />
          <button className="btn secondary" onClick={() => choose(i)}>
            Choose…
          </button>
          <span className="muted">→</span>
          <input type="text" className="volume-service" value={v.service} onChange={(e) => set(i, { service: e.target.value })} title="The service to mount it in" spellCheck={false} />
          <input type="text" value={v.target} onChange={(e) => set(i, { target: e.target.value })} placeholder="/path/in/the/container" spellCheck={false} />
          <label className="checkbox" title="Mount it read-only">
            <input type="checkbox" checked={v.readOnly} onChange={(e) => set(i, { readOnly: e.target.checked })} />
            read-only
          </label>
          <button className="link-btn" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className="row">
        <button className="btn secondary" onClick={() => setDraft((d) => [...d, { source: '', target: '', service: 'web', readOnly: false }])}>
          Add volume
        </button>
        {changed && (
          <>
            <button className="btn secondary" disabled={busy} onClick={() => onSave(inst.name, draft, false)}>
              Save
            </button>
            <button className="btn" disabled={busy} onClick={() => onSave(inst.name, draft, true)}>
              Save and restart
            </button>
            <button className="link-btn" onClick={() => setDraft(saved)}>
              Discard changes
            </button>
          </>
        )}
      </div>
    </div>
  )
}
