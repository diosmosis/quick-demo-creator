import React, { useState } from 'react'
import { api } from '../api'

// Every setting the app has. Edits are local until Save.
export default function Settings({ settings, defaults, onSave, onClose, onRebuildImage }) {
  const [form, setForm] = useState(settings)
  const [checks, setChecks] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const reset = (key) => setForm((f) => ({ ...f, [key]: defaults[key] }))

  const check = async (key, fn) => {
    setChecks((c) => ({ ...c, [key]: { busy: true } }))
    try {
      const text = await fn()
      setChecks((c) => ({ ...c, [key]: { ok: true, text } }))
    } catch (e) {
      setChecks((c) => ({ ...c, [key]: { ok: false, text: e.message } }))
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const chooseFolder = async () => {
    const dir = await api.selectFolder()
    if (dir) setForm((f) => ({ ...f, outputDir: dir }))
  }

  const CheckResult = ({ k }) => {
    const c = checks[k]
    if (!c) return null
    if (c.busy) return <span className="check">Checking…</span>
    return <span className={`check ${c.ok ? 'ok' : 'bad'}`}>{c.text}</span>
  }

  const ResetLink = ({ k }) =>
    form[k] !== defaults[k] ? (
      <button className="link-btn" onClick={() => reset(k)}>
        Reset to default
      </button>
    ) : null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <section>
            <h3>GitHub</h3>
            <div className="field">
              <label>Token (optional, needed for private repositories)</label>
              <div className="row">
                <input type="password" value={form.githubToken} onChange={set('githubToken')} placeholder="ghp_… or github_pat_…" />
                <button
                  className="btn secondary"
                  disabled={!form.githubToken}
                  onClick={() => check('token', async () => `Signed in as ${(await api.verifyToken(form.githubToken)).login}`)}
                >
                  Verify
                </button>
              </div>
              <CheckResult k="token" />
              <p className="hint">
                Read access to <em>Pull requests</em> and <em>Contents</em> is enough. It is also passed to Claude as{' '}
                <code>GH_TOKEN</code>/<code>GITHUB_TOKEN</code>.
              </p>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.includePrDetails} onChange={set('includePrDetails')} />
              Fetch the PR's description and diff and append them to the planning prompt
            </label>
            <p className="hint">
              Saves Claude from having to reach GitHub itself, which it may not be able to do for a private repository.
            </p>
            <div className="field narrow">
              <label>Maximum diff size (characters)</label>
              <input type="number" min="1000" step="1000" value={form.maxDiffChars} onChange={set('maxDiffChars')} />
            </div>
          </section>

          <section>
            <h3>Claude</h3>
            <div className="field">
              <label>Executable</label>
              <div className="row">
                <input type="text" value={form.claudePath} onChange={set('claudePath')} placeholder="claude" />
                <button className="btn secondary" onClick={() => check('claude', () => api.toolVersion(form.claudePath))}>
                  Test
                </button>
              </div>
              <CheckResult k="claude" />
              <p className="hint">
                A name on <code>PATH</code> or a path, e.g. <code>claudebox</code>. It runs through a login shell, so it
                finds what your <code>~/.bashrc</code> puts on <code>PATH</code> even when started from the desktop menu.
              </p>
            </div>
            <div className="field">
              <label>Executable arguments</label>
              <input type="text" value={form.executableArgs} onChange={set('executableArgs')} placeholder="(none)" />
              <p className="hint">
                For a wrapper around Claude, placed straight after the executable and never given to Claude.{' '}
                <code>{'{PROJECT}'}</code> is replaced with the PR's repository name, so for claudebox use{' '}
                <code>--project {'{PROJECT}'}</code>, and send the prompt as the last argument: the
                box doesn't pass standard input on to Claude.
              </p>
            </div>
            <div className="field">
              <label>
                Extra arguments <ResetLink k="claudeArgs" />
              </label>
              <input type="text" value={form.claudeArgs} onChange={set('claudeArgs')} />
              <p className="hint">
                Placed before <code>-p --output-format stream-json --verbose --include-partial-messages</code>, which the app
                always adds. Quote arguments containing spaces.
              </p>
            </div>
            <div className="field">
              <label>Send the prompt</label>
              <select value={form.promptDelivery} onChange={set('promptDelivery')}>
                <option value="stdin">on standard input</option>
                <option value="argument">as the last argument</option>
              </select>
              <p className="hint">Standard input has no length limit; use an argument if your wrapper doesn't forward stdin (claudebox with{' '}
                <code>--project</code> doesn't). Linux limits one argument to 128 KB, so lower the maximum diff size if
                planning then fails with <code>E2BIG</code>.</p>
            </div>
            <div className="field">
              <label>Working directory</label>
              <input type="text" value={form.claudeWorkdir} onChange={set('claudeWorkdir')} placeholder="(a temporary directory)" />
            </div>
          </section>

          <section>
            <h3>Prompts</h3>
            <div className="field">
              <label>
                Stage 1 — planning. <code>{'{PR_LINK}'}</code> is replaced with the PR link. <ResetLink k="planningPrompt" />
              </label>
              <textarea rows={6} value={form.planningPrompt} onChange={set('planningPrompt')} />
            </div>
            <div className="field">
              <label>
                Stage 1 — output instructions, appended to the prompt above <ResetLink k="planningInstructions" />
              </label>
              <textarea rows={3} value={form.planningInstructions} onChange={set('planningInstructions')} />
              <p className="hint">
                Keeps the answer to just the script, since it goes straight into the editor. Leave it blank to send nothing.
              </p>
            </div>
            <div className="field">
              <label>
                Stage 2 — Puppeteer script. <code>{'{SCRIPT}'}</code> is replaced with the edited script.{' '}
                <ResetLink k="recordingPrompt" />
              </label>
              <textarea rows={5} value={form.recordingPrompt} onChange={set('recordingPrompt')} />
            </div>
            <div className="field">
              <label>
                Stage 2 — recording environment, appended to the prompt above <ResetLink k="recordingEnvironment" />
              </label>
              <textarea rows={12} value={form.recordingEnvironment} onChange={set('recordingEnvironment')} />
              <p className="hint">
                Tells Claude how stage 3 runs the script (paths, packages, browser flags). Leave it blank to send nothing.
              </p>
            </div>
          </section>

          <section>
            <h3>Recording</h3>
            <div className="field">
              <label>Docker executable</label>
              <div className="row">
                <input type="text" value={form.dockerPath} onChange={set('dockerPath')} placeholder="docker" />
                <button className="btn secondary" onClick={() => check('docker', () => api.toolVersion(form.dockerPath))}>
                  Test
                </button>
              </div>
              <CheckResult k="docker" />
            </div>
            <div className="field">
              <label>Recorder image name</label>
              <div className="row">
                <input type="text" value={form.dockerImage} onChange={set('dockerImage')} />
                <button className="btn secondary" onClick={onRebuildImage} title="Save settings first if you changed the image name">
                  Rebuild image
                </button>
              </div>
              <p className="hint">Built automatically the first time you record, and again whenever its Dockerfile changes.</p>
            </div>
            <div className="field">
              <label>
                Extra <code>docker run</code> arguments <ResetLink k="dockerRunArgs" />
              </label>
              <input type="text" value={form.dockerRunArgs} onChange={set('dockerRunArgs')} />
              <p className="hint">
                <code>--network host</code> lets the script reach apps served on this machine (<code>localhost</code>,{' '}
                <code>*.ddev.site</code>) on rootful Docker. On rootless Docker or Docker Desktop it doesn't, and the
                recording log says what to do instead. Remove it to give the container only ordinary outbound access.
              </p>
            </div>
            <div className="field">
              <label>Output folder</label>
              <div className="row">
                <input type="text" value={form.outputDir} onChange={set('outputDir')} />
                <button className="btn secondary" onClick={chooseFolder}>
                  Choose…
                </button>
              </div>
              <p className="hint">Each recording gets its own subfolder here.</p>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.convertToMp4} onChange={set('convertToMp4')} />
              Also convert the recording to MP4
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.openFolderWhenDone} onChange={set('openFolderWhenDone')} />
              Open the output folder when a recording finishes
            </label>
          </section>
        </div>

        <div className="modal-footer">
          {error && <span className="field-error">{error}</span>}
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={saving}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
