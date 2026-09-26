// Every IPC handler. Handlers return { ok, value } or { ok: false, error } so
// the renderer gets the plain message rather than Electron's wrapped one.
import { ipcMain, dialog, shell, net, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, effectiveSettings } from './defaults.js'
import { parsePrUrl, fetchPr, formatPrContext, verifyToken } from './github.js'
import { runClaude } from './claude.js'
import { checkScript } from './safety.js'
import { ENV_NAME, scriptEnvVars } from './script-env.js'
import { Recorder } from './recorder.js'
import { extractCode, fillTemplate } from './text.js'
import { isNotFound, spawnInShell, withoutShellNoise } from './shell.js'

export function registerIpc(app, store) {
  const defaultOutputDir = path.join(app.getPath('videos'), 'quick-demo-creator')
  const settings = () => effectiveSettings(store.get('settings', {}), defaultOutputDir)
  const recorder = new Recorder(path.join(app.getAppPath(), 'docker', 'recorder'))
  const claudeJobs = {}

  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, arg) => {
      try {
        return { ok: true, value: await fn(arg, event) }
      } catch (err) {
        return { ok: false, error: err.message, data: err.runDir ? { runDir: err.runDir, files: err.files } : undefined }
      }
    })

  const emitter = (event, stage) => (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('job:event', { stage, ...payload })
  }

  const claudeCwd = (s) => {
    const dir = s.claudeWorkdir.trim() || path.join(app.getPath('temp'), 'quick-demo-creator')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  // `pr` fills in {PROJECT} in the executable arguments; it may be null.
  async function askClaude(stage, event, prompt, pr) {
    if (claudeJobs[stage]) throw new Error('Already running.')
    const s = settings()
    const job = runClaude({ settings: s, project: pr?.repo, prompt, cwd: claudeCwd(s), onEvent: emitter(event, stage) })
    claudeJobs[stage] = job
    try {
      return await job.done
    } finally {
      delete claudeJobs[stage]
    }
  }

  // --- settings & session -------------------------------------------------
  handle('settings:get', () => ({ settings: settings(), defaults: { ...DEFAULT_SETTINGS, outputDir: defaultOutputDir } }))
  handle('settings:set', (patch) => {
    // Only what differs from the defaults is kept, so a better default in a
    // later version still reaches settings the user never changed.
    const saved = { ...store.get('settings', {}), ...patch }
    for (const [key, value] of Object.entries(saved)) {
      if (value === DEFAULT_SETTINGS[key] || (key === 'outputDir' && value === defaultOutputDir)) delete saved[key]
    }
    store.set({ settings: saved })
    return settings()
  })
  handle('session:get', () => store.get('session', {}))
  handle('session:set', (session) => {
    store.set({ session })
  })

  // Values for the scripts' environment variables, remembered per repository
  // since that is what decides where the app runs locally.
  const projectKey = (prUrl) => {
    const pr = parsePrUrl(prUrl || '')
    return pr ? `${pr.owner}/${pr.repo}`.toLowerCase() : ''
  }
  handle('projectEnv:get', (prUrl) => ({
    project: projectKey(prUrl),
    values: store.get('projectEnv', {})[projectKey(prUrl)] || {}
  }))
  handle('projectEnv:set', ({ prUrl, values }) => {
    const all = store.get('projectEnv', {})
    const key = projectKey(prUrl)
    const merged = { ...all[key] }
    for (const [name, value] of Object.entries(values)) {
      if (!ENV_NAME.test(name)) continue
      if (String(value).trim()) merged[name] = String(value)
      else delete merged[name]
    }
    store.set({ projectEnv: { ...all, [key]: merged } })
  })

  // --- environment ------------------------------------------------------
  handle('github:verifyToken', (token) => verifyToken(token, net.fetch))
  handle('tools:version', ({ path: exe }) => {
    return new Promise((resolve, reject) => {
      const child = spawnInShell(exe, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (out += d))
      child.on('error', (err) => reject(new Error(`Could not start bash: ${err.message}`)))
      child.on('close', (code) => {
        // The last line: a login shell's rc files may print something first.
        const said = withoutShellNoise(out).trim()
        if (code === 0) return resolve(said.split('\n').pop())
        reject(new Error(isNotFound(code, out) ? `"${exe}" was not found, even with your login shell's PATH.` : said || `Exited with code ${code}.`))
      })
    })
  })
  handle('dialog:selectFolder', async (_arg, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })
  handle('shell:openPath', async (p) => {
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  })

  // --- stage 1: plan ----------------------------------------------------
  handle('plan:start', async ({ prUrl }, event) => {
    const pr = parsePrUrl(prUrl)
    if (!pr) throw new Error('Enter a GitHub pull request link, like https://github.com/owner/repo/pull/123.')
    const s = settings()
    const emit = emitter(event, 'plan')

    let prompt = fillTemplate(s.planningPrompt, { PR_LINK: pr.url })
    let prTitle = ''
    if (s.includePrDetails) {
      emit({ type: 'status', text: `Fetching ${pr.owner}/${pr.repo}#${pr.number} from GitHub…` })
      try {
        const details = await fetchPr(pr, s.githubToken, Number(s.maxDiffChars) || DEFAULT_SETTINGS.maxDiffChars, net.fetch)
        prTitle = details.title
        emit({ type: 'status', text: `“${details.title}” — ${details.changedFiles} changed files` })
        prompt += '\n\n' + formatPrContext(details)
      } catch (err) {
        emit({ type: 'stderr', text: `Couldn't fetch the PR (${err.message}); Claude will have to read it itself.\n` })
      }
    }

    if (s.planningInstructions.trim()) prompt += '\n\n' + s.planningInstructions.trim()

    const script = await askClaude('plan', event, prompt, pr)
    return { script, prTitle, prUrl: pr.url }
  })

  // --- stage 2: generate the puppeteer script ---------------------------
  handle('generate:start', async ({ script, prUrl }, event) => {
    if (!script.trim()) throw new Error('The script is empty.')
    const s = settings()
    let prompt = fillTemplate(s.recordingPrompt, { SCRIPT: script })
    if (s.recordingEnvironment.trim()) prompt += '\n\n' + s.recordingEnvironment.trim()

    const answer = await askClaude('generate', event, prompt, parsePrUrl(prUrl))
    const code = extractCode(answer)
    return { code, safety: checkScript(code) }
  })

  handle('safety:check', ({ code }) => checkScript(code))
  handle('script:env', ({ code }) => scriptEnvVars(code))

  // --- stage 3: record --------------------------------------------------
  handle('record:start', async ({ code, script, prUrl, overrideSafety, env = {} }, event) => {
    // Checked again here so the renderer can't skip it.
    const safety = checkScript(code)
    if (!safety.ok && !overrideSafety) {
      throw new Error('The safety check found problems with the script. Review them, then confirm to record anyway.')
    }
    const s = settings()
    const pr = parsePrUrl(prUrl)
    const name = pr ? `${pr.repo}-pr${pr.number}` : 'demo'
    // Only what the script reads goes into the container.
    const vars = scriptEnvVars(code)
    const values = Object.fromEntries(vars.map((v) => [v.name, String(env[v.name] ?? '')]))
    const targets = vars.map((v) => values[v.name].trim() || v.fallback)
    const result = await recorder.record({ settings: s, code, script, name, env: values, targets, onEvent: emitter(event, 'record') })
    if (s.openFolderWhenDone) shell.openPath(result.runDir)
    return result
  })

  handle('image:build', async (_arg, event) => {
    recorder.cancelled = false
    await recorder.buildImage(settings(), emitter(event, 'image'))
  })

  handle('job:cancel', (stage) => {
    if (stage === 'record' || stage === 'image') recorder.cancel(settings())
    else claudeJobs[stage]?.cancel()
  })
}
