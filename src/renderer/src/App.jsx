import React, { useCallback, useEffect, useRef, useState } from 'react'
import LogView, { appendLog } from './components/LogView'
import Settings from './components/Settings'
import Markdown from './components/Markdown'
import CodeEditor from './components/CodeEditor'
import InputFiles from './components/InputFiles'
import EnvFields from './components/EnvFields'
import Instances from './components/Instances'
import SafetyCheck, { findingKey } from './components/SafetyCheck'
import { api } from './api'

const STAGES = [
  { key: 'plan', label: 'Plan' },
  { key: 'generate', label: 'Puppeteer script' },
  { key: 'environment', label: 'Environment setup' },
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
  // Safety findings the user has dismissed, by findingKey().
  const [dismissed, setDismissed] = useState(() => new Set())
  const [sideTab, setSideTab] = useState('env')
  // The script's environment variables and this repository's values for them.
  const [envVars, setEnvVars] = useState([])
  const [projectEnv, setProjectEnv] = useState({ project: '', values: {} })
  // The /input files the script names, and the files added for this repository.
  const [requiredFiles, setRequiredFiles] = useState([])
  const [projectFiles, setProjectFiles] = useState([])
  // A file looped under the MP4 as its soundtrack; '' for none.
  const [audio, setAudio] = useState('')
  const [loaded, setLoaded] = useState(false)

  const [running, setRunning] = useState({})
  const [logs, setLogs] = useState({ plan: [], generate: [], environment: [], record: [] })
  const [errors, setErrors] = useState({})
  // Claude's log is only shown while it works (or after it failed); after
  // that the result takes the space, unless the user asks to see the log.
  const [showLog, setShowLog] = useState({})
  const [startedAt, setStartedAt] = useState({})
  const [now, setNow] = useState(Date.now())
  const [recording, setRecording] = useState(null) // { runDir, files, failed }
  // The Environment stage's DDEV project copies, and why DDEV couldn't list them.
  const [instances, setInstances] = useState({ instances: [], error: '' })
  const [checked, setChecked] = useState(null) // the last precondition check: { runDir, files, failed }
  // The Environment setup stage's output, a bottom sheet over the instances.
  const [outputOpen, setOutputOpen] = useState(false)

  useEffect(() => {
    api.getSettings().then(setConfig)
    api.getSession().then((s) => {
      setPrUrl(s.prUrl || '')
      setPrTitle(s.prTitle || '')
      setScript(s.script || '')
      setCode(s.code || '')
      setAudio(s.audio || '')
      if (s.code) api.checkSafety(s.code).then(setSafety)
      setView(s.code ? 'generate' : 'plan')
      setLoaded(true)
    })
    // A file dropped outside a drop target would otherwise replace the page.
    const ignoreDrop = (e) => e.preventDefault()
    window.addEventListener('dragover', ignoreDrop)
    window.addEventListener('drop', ignoreDrop)
    const unsubscribe = api.onJobEvent(({ stage, ...event }) => {
      // Image rebuilds from Settings show up in the recording log.
      const target = stage === 'image' ? 'record' : stage
      setLogs((l) => ({ ...l, [target]: appendLog(l[target], event) }))
    })
    return () => {
      window.removeEventListener('dragover', ignoreDrop)
      window.removeEventListener('drop', ignoreDrop)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => api.saveSession({ prUrl, prTitle, script, code, audio }), 400)
    return () => clearTimeout(t)
  }, [loaded, prUrl, prTitle, script, code, audio])

  // Re-check the script as the user edits it.
  const edited = useRef(false)
  const codeEditor = useRef(null)
  useEffect(() => {
    if (!edited.current) return
    const t = setTimeout(() => api.checkSafety(code).then(setSafety), 300)
    return () => clearTimeout(t)
  }, [code])

  useEffect(() => {
    const t = setTimeout(() => {
      api.scriptEnv(code).then(setEnvVars)
      api.scriptFiles(code).then(setRequiredFiles)
    }, 300)
    return () => clearTimeout(t)
  }, [code])

  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      api.getProjectEnv(prUrl).then(setProjectEnv)
      api.getProjectFiles(prUrl).then(setProjectFiles)
    }, 300)
    return () => clearTimeout(t)
  }, [loaded, prUrl])

  const setEnvValue = (name, value) => {
    setProjectEnv((p) => ({ ...p, values: { ...p.values, [name]: value } }))
    api.setProjectEnv(prUrl, { [name]: value })
  }

  const changeFiles = (files) => {
    setProjectFiles(files)
    api.setProjectFiles(prUrl, files)
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
      if (logKey === 'environment' && e.data) setChecked({ ...e.data, failed: true })
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
      setDismissed(new Set())
    })

  const record = () =>
    runStage('record', async () => {
      setRecording(null)
      setRecording(await api.record({ code, script, prUrl, overrideSafety: !blocked, env: projectEnv.values, files: projectFiles, audio }))
    })

  const refreshInstances = useCallback(() => {
    api.listInstances().then(setInstances, (e) => setInstances((i) => ({ ...i, error: e.message })))
  }, [])

  // DDEV's view of the instances changes outside the app too, so it is asked
  // again every few seconds while the stage is shown.
  useEffect(() => {
    if (view !== 'environment') return
    refreshInstances()
    if (running.environment) return
    const t = setInterval(refreshInstances, 10000)
    return () => clearInterval(t)
  }, [view, running.environment])

  // The output pops up whenever something starts running, and when it fails.
  useEffect(() => {
    if (running.environment || errors.environment) setOutputOpen(true)
  }, [running.environment, errors.environment])

  const environmentJob = (fn) =>
    runStage('environment', async () => {
      try {
        await fn()
      } finally {
        refreshInstances()
      }
    })

  const createInstance = (args) => environmentJob(() => api.createInstance(args))
  const ddev = (name, args) => environmentJob(() => api.ddev(name, args))
  const removeInstance = (name) => environmentJob(() => api.removeInstance(name))
  const setVolumes = async (name, volumes, restart) => {
    if (restart) {
      return environmentJob(async () => {
        await api.setVolumes(name, volumes)
        await api.ddev(name, ['restart'])
      })
    }
    await showingErrors(() => api.setVolumes(name, volumes))
    refreshInstances()
  }
  // For the quick actions that don't clear the stage's log.
  const showingErrors = async (fn) => {
    try {
      await fn()
      setErrors((e) => ({ ...e, environment: null }))
    } catch (e) {
      setErrors((err) => ({ ...err, environment: e.message }))
    }
  }

  const checkPreconditions = () =>
    runStage('environment', async () => {
      setChecked(null)
      setChecked(await api.checkPreconditions({ code, script, prUrl, overrideSafety: !blocked, env: projectEnv.values, files: projectFiles }))
    })

  const rebuildImage = () => {
    setShowSettings(false)
    runStage('image', async () => {
      setRecording(null)
      await api.buildImage()
    })
  }

  const chooseAudio = async () => {
    const path = await api.selectAudio()
    if (path) setAudio(path)
  }

  const saveSettings = async (form) => {
    const settings = await api.saveSettings(form)
    setConfig((c) => ({ ...c, settings }))
  }

  const findings = (safety?.findings || []).map((f) => ({ ...f, key: findingKey(f, code) }))
  const openFindings = findings.filter((f) => !dismissed.has(f.key))
  // Recording waits until every danger finding has been dismissed as reviewed.
  const blocked = openFindings.some((f) => f.severity === 'danger')
  const missingFiles = requiredFiles.filter((n) => !projectFiles.some((f) => f.name === n && f.exists)).length

  const stageState = (key) => {
    if (running[key]) return 'running'
    if (errors[key]) return 'failed'
    if (
      (key === 'plan' && script) ||
      (key === 'generate' && code) ||
      (key === 'environment' && checked && !checked.failed) ||
      (key === 'record' && recording && !recording.failed)
    ) {
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

  // The URLs of the running instances, offered in the environment variables' fields.
  const instanceUrls = instances.instances
    .filter((i) => i.status === 'running')
    .flatMap((i) => [i.url, i.httpUrl])
    .filter(Boolean)

  // The environment variables and input files, shown beside the script and
  // beside the environment; `stage` is the one it is shown in.
  const sidebar = (stage) => (
    <aside className="side">
      <div className="tabs">
        <button className={`tab ${sideTab === 'env' ? 'active' : ''}`} onClick={() => setSideTab('env')}>
          Environment <span className="count">{envVars.length}</span>
        </button>
        <button className={`tab ${sideTab === 'files' ? 'active' : ''}`} onClick={() => setSideTab('files')}>
          Files <span className={`count ${missingFiles ? 'warn' : ''}`}>{missingFiles ? `${missingFiles} missing` : projectFiles.length}</span>
        </button>
      </div>
      {sideTab === 'env' ? (
        <EnvFields
          vars={envVars}
          values={projectEnv.values}
          project={projectEnv.project}
          suggestions={instanceUrls}
          listId={`instance-urls-${stage}`}
          onChange={setEnvValue}
        />
      ) : (
        <InputFiles required={requiredFiles} files={projectFiles} onChange={changeFiles} />
      )}
      <div className="side-actions">
        <div className="audio-pick">
          <div className="files-head">
            <span>Background audio</span>
            <span className="files-actions">
              <button className="link-btn" onClick={chooseAudio}>
                {audio ? 'Change…' : 'Choose…'}
              </button>
              {audio && (
                <button className="link-btn" onClick={() => setAudio('')}>
                  Remove
                </button>
              )}
            </span>
          </div>
          {audio ? (
            <span className="files-path" title={audio}>
              {audio.split(/[\\/]/).pop()}
            </span>
          ) : (
            <span className="hint">None. A file chosen here is looped under the MP4 for its whole length.</span>
          )}
          {audio && config && !config.settings.convertToMp4 && (
            <span className="files-path missing">Only added to the MP4: turn on Convert to MP4 in Settings.</span>
          )}
        </div>
        {blocked && <p className="hint">Dismiss the safety check's red findings once you've reviewed them.</p>}
        {stage === 'environment' && (
          <button
            className="btn secondary"
            onClick={checkPreconditions}
            disabled={!code.trim() || anyRunning || blocked}
            title="Runs the script only up to where the recording would start, so just its precondition checks run"
          >
            Check preconditions
          </button>
        )}
        {stage === 'generate' ? (
          <button className="btn" onClick={() => setView('environment')} disabled={!code.trim()}>
            Setup Environment →
          </button>
        ) : (
          <button className="btn" onClick={record} disabled={!code.trim() || anyRunning || blocked}>
            Record screencast →
          </button>
        )}
      </div>
    </aside>
  )

  // Every stage stays rendered and the others are only hidden, so switching
  // keeps where each one was scrolled to, and the script editor's undo history.
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

      <main className="stage" hidden={view !== 'plan'}>
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

      <main className="stage" hidden={view !== 'generate'}>
        <div className="stage-toolbar">
          <div className="stage-heading">Puppeteer script {running.generate && <span className="muted">— generating…</span>}</div>
          {logToggle('generate')}
          {cancelButton('generate')}
        </div>
        {errors.generate && <div className="banner error">{errors.generate}</div>}
        {logVisible('generate') ? (
          claudePane('generate', "Claude's output streams here while it writes the script.")
        ) : (
          <div className="script-layout">
            <div className="pane">
              <div className="pane-title">
                Generated script <span className="muted">— give it a once-over before recording</span>
                {findings.length > openFindings.length && (
                  <button className="link-btn" onClick={() => setDismissed(new Set())}>
                    Show {findings.length - openFindings.length} dismissed safety{' '}
                    {findings.length - openFindings.length > 1 ? 'notes' : 'note'}
                  </button>
                )}
              </div>
              <CodeEditor
                ref={codeEditor}
                value={code}
                onChange={(text) => {
                  edited.current = true
                  setCode(text)
                }}
                placeholder="The generated Puppeteer script appears here."
              />
              <SafetyCheck
                findings={openFindings}
                onDismiss={(key) => setDismissed((d) => new Set(d).add(key))}
                onGoToLine={(line) => codeEditor.current?.goToLine(line)}
              />
            </div>
            {sidebar('generate')}
          </div>
        )}
      </main>

      <main className="stage" hidden={view !== 'environment'}>
        <div className="stage-toolbar">
          <div className="stage-heading">
            Environment setup
            {running.environment && <span className="muted"> — working…</span>}
            {running.environment && elapsed('environment')}
          </div>
          {cancelButton('environment')}
        </div>
        {errors.environment && <div className="banner error">{errors.environment}</div>}
        {checked && !checked.failed && <div className="banner ok">The preconditions are met. Record when you're ready.</div>}
        {checked?.failed && checked.files?.some((f) => f.name === 'failure.png') && (
          <div className="result-path">
            <span className="muted">The page when the check failed:</span>
            <button className="btn secondary" onClick={() => showingErrors(() => api.openPath(`${checked.runDir}/failure.png`))}>
              Open screenshot
            </button>
          </div>
        )}
        <div className="script-layout">
          <div className="environment-main">
            <Instances
              instances={instances.instances}
              error={instances.error}
              busy={anyRunning}
              onCreate={createInstance}
              onDdev={ddev}
              onSetVolumes={setVolumes}
              onRemove={removeInstance}
              onOpen={showingErrors}
              onRefresh={refreshInstances}
            />
            <div className={`output-sheet ${outputOpen ? 'open' : ''}`}>
              <button className="output-sheet-bar" onClick={() => setOutputOpen((o) => !o)} title={outputOpen ? 'Hide the output' : 'Show the output'}>
                <span className="output-sheet-title">Output</span>
                {running.environment ? (
                  <span className="muted">— working…</span>
                ) : errors.environment ? (
                  <span className="output-sheet-failed">— failed</span>
                ) : (
                  logs.environment.length > 0 && <span className="muted">— finished</span>
                )}
                {elapsed('environment')}
                <span className="output-sheet-toggle">{outputOpen ? '▾' : '▴'}</span>
              </button>
              <LogView
                entries={logs.environment}
                placeholder="DDEV's output, and the log of the precondition checks, appear here. Check preconditions runs the script only up to where the recording would start."
              />
            </div>
          </div>
          {sidebar('environment')}
        </div>
      </main>

      <main className="stage" hidden={view !== 'record'}>
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
