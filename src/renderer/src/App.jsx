import React, { useCallback, useEffect, useRef, useState } from 'react'
import LogView, { appendLog } from './components/LogView'
import Settings from './components/Settings'
import Markdown from './components/Markdown'
import CodeEditor from './components/CodeEditor'
import { api } from './api'

const STAGES = [
  { key: 'plan', label: 'Plan' },
  { key: 'generate', label: 'Puppeteer script' },
  { key: 'record', label: 'Record' }
]

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function App() {
  const [config, setConfig] = useState(null) // { settings, defaults }
  const [showSettings, setShowSettings] = useState(false)
  const [view, setView] = useState('plan')

  // What the user is working on; persisted so a restart doesn't lose it.
  const [prUrl, setPrUrl] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [script, setScript] = useState('')
  const [code, setCode] = useState('')
  const [safety, setSafety] = useState(null)
  const [overrideSafety, setOverrideSafety] = useState(false)
  // The script's environment variables and this repository's values for them.
  const [envVars, setEnvVars] = useState([])
  const [projectEnv, setProjectEnv] = useState({ project: '', values: {} })
  const [loaded, setLoaded] = useState(false)

  const [running, setRunning] = useState({})
  const [logs, setLogs] = useState({ plan: [], generate: [], record: [] })
  const [errors, setErrors] = useState({})
  // Claude's log is only shown while it works (or after it failed); after
  // that the result takes the space, unless the user asks to see the log.
  const [showLog, setShowLog] = useState({})
  const [startedAt, setStartedAt] = useState({})
  const [now, setNow] = useState(Date.now())
  const [recording, setRecording] = useState(null) // { runDir, files, failed }

  useEffect(() => {
    api.getSettings().then(setConfig)
    api.getSession().then((s) => {
      setPrUrl(s.prUrl || '')
      setPrTitle(s.prTitle || '')
      setScript(s.script || '')
      setCode(s.code || '')
      if (s.code) api.checkSafety(s.code).then(setSafety)
      setView(s.code ? 'generate' : 'plan')
      setLoaded(true)
    })
    return api.onJobEvent(({ stage, ...event }) => {
      // Image rebuilds from Settings show up in the recording log.
      const target = stage === 'image' ? 'record' : stage
      setLogs((l) => ({ ...l, [target]: appendLog(l[target], event) }))
    })
  }, [])

  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => api.saveSession({ prUrl, prTitle, script, code }), 400)
    return () => clearTimeout(t)
  }, [loaded, prUrl, prTitle, script, code])

  // Re-check the script as the user edits it.
  const edited = useRef(false)
  const codeEditor = useRef(null)
  useEffect(() => {
    if (!edited.current) return
    const t = setTimeout(() => api.checkSafety(code).then(setSafety), 300)
    return () => clearTimeout(t)
  }, [code])

  useEffect(() => {
    const t = setTimeout(() => api.scriptEnv(code).then(setEnvVars), 300)
    return () => clearTimeout(t)
  }, [code])

  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => api.getProjectEnv(prUrl).then(setProjectEnv), 300)
    return () => clearTimeout(t)
  }, [loaded, prUrl])

  const setEnvValue = (name, value) => {
    setProjectEnv((p) => ({ ...p, values: { ...p.values, [name]: value } }))
    api.setProjectEnv(prUrl, { [name]: value })
  }

  const anyRunning = Object.values(running).some(Boolean)
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyRunning])

  // Runs one stage: clears its log, tracks running/error state.
  const runStage = useCallback(async (stage, fn) => {
    setView(stage === 'image' ? 'record' : stage)
    const logKey = stage === 'image' ? 'record' : stage
    setLogs((l) => ({ ...l, [logKey]: [] }))
    setErrors((e) => ({ ...e, [logKey]: null }))
    setShowLog((v) => ({ ...v, [logKey]: undefined }))
    setStartedAt((t) => ({ ...t, [logKey]: Date.now() }))
    setNow(Date.now())
    setRunning((r) => ({ ...r, [logKey]: true }))
    try {
      await fn()
    } catch (e) {
      setErrors((err) => ({ ...err, [logKey]: e.message }))
      if (logKey === 'record' && e.data) setRecording({ ...e.data, failed: true })
    } finally {
      setRunning((r) => ({ ...r, [logKey]: false }))
      setNow(Date.now())
    }
  }, [])

  const plan = () =>
    runStage('plan', async () => {
      const res = await api.plan(prUrl)
      setScript(res.script)
      setPrTitle(res.prTitle)
      setPrUrl(res.prUrl)
    })

  const generate = () =>
    runStage('generate', async () => {
      const res = await api.generate(script, prUrl)
      edited.current = false
      setCode(res.code)
      setSafety(res.safety)
      setOverrideSafety(false)
    })

  const record = () =>
    runStage('record', async () => {
      setRecording(null)
      setRecording(await api.record({ code, script, prUrl, overrideSafety, env: projectEnv.values }))
    })

  const rebuildImage = () => {
    setShowSettings(false)
    runStage('image', async () => {
      setRecording(null)
      await api.buildImage()
    })
  }

  const saveSettings = async (form) => {
    const settings = await api.saveSettings(form)
    setConfig((c) => ({ ...c, settings }))
  }

  const blocked = safety && !safety.ok && !overrideSafety

  const stageState = (key) => {
    if (running[key]) return 'running'
    if (errors[key]) return 'failed'
    if ((key === 'plan' && script) || (key === 'generate' && code) || (key === 'record' && recording && !recording.failed)) {
      return 'done'
    }
    return 'idle'
  }

  const logVisible = (stage) => running[stage] || (showLog[stage] ?? (!!errors[stage] && logs[stage].length > 0))

  const elapsed = (stage) => startedAt[stage] && <span className="elapsed">{formatElapsed(now - startedAt[stage])}</span>

  // Hides or brings back Claude's log once it has finished.
  const logToggle = (stage) =>
    !running[stage] &&
    logs[stage].length > 0 && (
      <button className="link-btn" onClick={() => setShowLog((v) => ({ ...v, [stage]: !logVisible(stage) }))}>
        {logVisible(stage) ? "Hide Claude's output" : "Show Claude's output"}
      </button>
    )

  const claudePane = (stage, placeholder) => (
    <div className="pane">
      <div className="pane-title">
        Claude
        {running[stage] ? <span className="muted"> — working…</span> : <span className="muted"> — finished</span>}
        {elapsed(stage)}
      </div>
      <LogView entries={logs[stage]} placeholder={placeholder} />
    </div>
  )

  const cancelButton = (stage) =>
    running[stage] && (
      <button className="btn danger" onClick={() => api.cancel(stage)}>
        Cancel
      </button>
    )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Quick Demo Creator</div>
        <nav className="stepper">
          {STAGES.map((s, i) => (
            <button key={s.key} className={`step ${view === s.key ? 'active' : ''} ${stageState(s.key)}`} onClick={() => setView(s.key)}>
              <span className="step-num">{stageState(s.key) === 'done' ? '✓' : i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings" disabled={!config}>
          ⚙
        </button>
      </header>

      {view === 'plan' && (
        <main className="stage">
          <div className="stage-toolbar">
            <input
              type="text"
              className="pr-input"
              placeholder="https://github.com/owner/repo/pull/123"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && prUrl.trim() && !anyRunning && plan()}
            />
            <button className="btn" onClick={plan} disabled={!prUrl.trim() || anyRunning}>
              {running.plan ? 'Planning…' : 'Plan'}
            </button>
            {cancelButton('plan')}
          </div>
          {(prTitle || logs.plan.length > 0) && (
            <div className="pr-title">
              <span>{prTitle}</span>
              {logToggle('plan')}
            </div>
          )}
          {errors.plan && <div className="banner error">{errors.plan}</div>}
          {logVisible('plan') ? (
            claudePane('plan', "Claude's output streams here while it plans the video.")
          ) : (
            <>
              <div className="split even">
                <div className="pane">
                  <div className="pane-title">
                    Video script <span className="muted">— edit it to suit, then generate the Puppeteer script</span>
                  </div>
                  <textarea
                    className="editor"
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder="The planned script appears here. Add anything Claude can't know, such as the URL the app runs at and how to log in."
                    spellCheck
                  />
                </div>
                <div className="pane">
                  <div className="pane-title">Preview</div>
                  <Markdown text={script} placeholder="The rendered script appears here." />
                </div>
              </div>
              <div className="pane-actions">
                <button className="btn" onClick={generate} disabled={!script.trim() || anyRunning}>
                  Generate Puppeteer script →
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {view === 'generate' && (
        <main className="stage">
          <div className="stage-toolbar">
            <div className="stage-heading">Puppeteer script {running.generate && <span className="muted">— generating…</span>}</div>
            {logToggle('generate')}
            {cancelButton('generate')}
          </div>
          {errors.generate && <div className="banner error">{errors.generate}</div>}
          {logVisible('generate') ? (
            claudePane('generate', "Claude's output streams here while it writes the script.")
          ) : (
            <div className="pane">
              <div className="pane-title">
                Generated script <span className="muted">— give it a once-over before recording</span>
              </div>
              <CodeEditor
                ref={codeEditor}
                value={code}
                onChange={(e) => {
                  edited.current = true
                  setCode(e.target.value)
                }}
                placeholder="The generated Puppeteer script appears here."
              />
              {safety && (
                <div className={`safety ${safety.ok ? (safety.findings.length ? 'warn' : 'ok') : 'danger'}`}>
                  <div className="safety-title">
                    {safety.ok
                      ? safety.findings.length
                        ? 'Safety check: nothing dangerous found, but note:'
                        : 'Safety check: nothing suspicious found.'
                      : 'Safety check: this script does things a recording script should not.'}
                  </div>
                  {safety.findings.length > 0 && (
                    <ul>
                      {safety.findings.map((f, i) => (
                        <li key={i} className={f.severity}>
                          {f.line ? (
                            <button className="line" title="Show this line" onClick={() => codeEditor.current?.goToLine(f.line)}>
                              line {f.line}
                            </button>
                          ) : null}{' '}
                          {f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!safety.ok && (
                    <label className="checkbox">
                      <input type="checkbox" checked={overrideSafety} onChange={(e) => setOverrideSafety(e.target.checked)} />
                      I've reviewed these and want to record anyway
                    </label>
                  )}
                </div>
              )}
              {envVars.length > 0 && (
                <div className="env">
                  <div className="env-title">
                    Environment{' '}
                    <span className="muted">
                      — passed to the recorder; leave a field blank for the script's default
                      {projectEnv.project && `. Remembered for ${projectEnv.project}.`}
                    </span>
                  </div>
                  {envVars.map((v) => (
                    <label key={v.name} className="env-row">
                      <code>{v.name}</code>
                      <input
                        type="text"
                        value={projectEnv.values[v.name] ?? ''}
                        placeholder={v.fallback || '(no default)'}
                        onChange={(e) => setEnvValue(v.name, e.target.value)}
                        spellCheck={false}
                      />
                    </label>
                  ))}
                </div>
              )}
              <div className="pane-actions">
                <button className="btn" onClick={record} disabled={!code.trim() || anyRunning || blocked}>
                  Record screencast →
                </button>
              </div>
            </div>
          )}
        </main>
      )}

      {view === 'record' && (
        <main className="stage">
          <div className="stage-toolbar">
            <div className="stage-heading">
              Recording
              {!running.record && recording && !recording.failed && <span className="muted"> — finished</span>}
              {elapsed('record')}
            </div>
            {cancelButton('record')}
            {!running.record && code && (
              <button className="btn secondary" onClick={record} disabled={anyRunning || blocked}>
                Record again
              </button>
            )}
          </div>
          {errors.record && <div className="banner error">{errors.record}</div>}
          {recording && (
            <div className="result">
              <div className="result-path">
                <span className="muted">Saved to</span> <code>{recording.runDir}</code>
                <button className="btn secondary" onClick={() => api.openPath(recording.runDir)}>
                  Open folder
                </button>
              </div>
              {recording.files?.length > 0 ? (
                <ul className="files">
                  {recording.files.map((f) => (
                    <li key={f.name}>
                      {f.name} <span className="muted">{formatSize(f.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted">The script didn't produce any files.</div>
              )}
            </div>
          )}
          <LogView
            entries={logs.record}
            placeholder="The recorder's output streams here. The first recording also builds the recorder image, which takes a few minutes."
          />
        </main>
      )}

      {showSettings && config && (
        <Settings
          settings={config.settings}
          defaults={config.defaults}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
          onRebuildImage={rebuildImage}
        />
      )}
    </div>
  )
}
