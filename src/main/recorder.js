// Stage 3: runs the generated script in the recorder image with only the run's
// output folder mounted.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { splitArgs, scriptExtension } from './text.js'

const HASH_LABEL = 'quick-demo-creator.context-hash'

// Hash of the image's build context, so an edited Dockerfile triggers a rebuild.
function contextHash(dir) {
  const hash = crypto.createHash('sha256')
  for (const name of fs.readdirSync(dir).sort()) {
    hash.update(name).update('\0').update(fs.readFileSync(path.join(dir, name))).update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

// Runs a command, streaming each output line to `onLine`. Resolves with the
// exit code; `onSpawn` receives the child so the caller can cancel it.
function run(cmd, args, { onLine = () => {}, onSpawn = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    onSpawn(child)
    let captured = ''
    const pipe = (stream, kind) => {
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        captured += chunk
        buf += chunk
        const lines = buf.split(/\r?\n|\r/)
        buf = lines.pop()
        for (const line of lines) onLine(line, kind)
      })
      stream.on('end', () => buf && onLine(buf, kind))
    }
    pipe(child.stdout, 'stdout')
    pipe(child.stderr, 'stderr')
    child.on('error', (err) =>
      reject(err.code === 'ENOENT' ? new Error(`Couldn't run "${cmd}". Set the Docker executable in Settings.`) : err)
    )
    child.on('close', (code) => resolve({ code, output: captured }))
  })
}

export class Recorder {
  constructor(contextDir) {
    this.contextDir = contextDir
    this.child = null
    this.container = null
    this.cancelled = false
  }

  async imageIsCurrent(settings) {
    const { code, output } = await run(settings.dockerPath, [
      'image', 'inspect', '--format', `{{ index .Config.Labels "${HASH_LABEL}" }}`, settings.dockerImage
    ])
    return code === 0 && output.trim() === contextHash(this.contextDir)
  }

  async buildImage(settings, onEvent) {
    onEvent({ type: 'status', text: `Building the recorder image "${settings.dockerImage}" (only needed once)…` })
    const { code } = await run(
      settings.dockerPath,
      [
        'build', '--progress=plain',
        '--label', `${HASH_LABEL}=${contextHash(this.contextDir)}`,
        '-t', settings.dockerImage,
        this.contextDir
      ],
      { onLine: (line) => onEvent({ type: 'log', text: line }), onSpawn: (c) => (this.child = c) }
    )
    this.child = null
    if (this.cancelled) throw new Error('Cancelled.')
    if (code !== 0) throw new Error(`docker build failed with code ${code}.`)
  }

  // Rootful Docker needs --user so files in /output end up owned by the host
  // user. Rootless Docker already maps container root to the host user, and
  // there --user would map to a subordinate uid that can't write the mount.
  async userArgs(settings) {
    if (!process.getuid) return []
    const { code, output } = await run(settings.dockerPath, ['info', '--format', '{{json .SecurityOptions}}'])
    if (code === 0 && output.includes('rootless')) return []
    return ['--user', `${process.getuid()}:${process.getgid()}`]
  }

  async ensureImage(settings, onEvent) {
    if (!(await this.imageIsCurrent(settings))) await this.buildImage(settings, onEvent)
  }

  // Records `code` into a new folder under settings.outputDir. Resolves with
  // the folder and the files the run produced.
  async record({ settings, code, script, name, onEvent }) {
    this.cancelled = false
    await this.ensureImage(settings, onEvent)
    if (this.cancelled) throw new Error('Cancelled.')

    const runDir = path.join(settings.outputDir, `${name}-${timestamp()}`)
    fs.mkdirSync(runDir, { recursive: true })
    const scriptName = `demo${scriptExtension(code)}`
    const scriptPath = path.join(runDir, scriptName)
    fs.writeFileSync(scriptPath, code)
    fs.writeFileSync(path.join(runDir, 'script.md'), script || '')
    const before = new Set(fs.readdirSync(runDir))

    this.container = `quick-demo-creator-${crypto.randomBytes(4).toString('hex')}`
    const args = [
      'run', '--rm', '--init',
      '--name', this.container,
      '--shm-size=1g',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      ...(await this.userArgs(settings)),
      '-e', `CONVERT_MP4=${settings.convertToMp4 ? 1 : 0}`,
      '-v', `${runDir}:/output`,
      '-v', `${scriptPath}:/app/${scriptName}:ro`,
      ...splitArgs(settings.dockerRunArgs || ''),
      settings.dockerImage,
      scriptName
    ]
    onEvent({ type: 'status', text: `$ ${settings.dockerPath} ${args.join(' ')}` })

    const { code: exit } = await run(settings.dockerPath, args, {
      onLine: (line, kind) => onEvent({ type: kind === 'stderr' ? 'stderr' : 'log', text: line }),
      onSpawn: (c) => (this.child = c)
    })
    this.child = null
    this.container = null

    const files = fs
      .readdirSync(runDir)
      .filter((f) => !before.has(f))
      .map((f) => ({ name: f, size: fs.statSync(path.join(runDir, f)).size }))

    if (this.cancelled) throw Object.assign(new Error('Cancelled.'), { runDir, files })
    if (exit !== 0) {
      throw Object.assign(new Error(`The script exited with code ${exit}. See the log above.`), { runDir, files })
    }
    return { runDir, files }
  }

  cancel(settings) {
    this.cancelled = true
    // Killing the docker CLI leaves the container running; stop it by name.
    if (this.container) spawn(settings.dockerPath, ['kill', this.container], { stdio: 'ignore' }).on('error', () => {})
    if (this.child) this.child.kill('SIGTERM')
  }
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
