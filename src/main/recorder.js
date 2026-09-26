// Stage 3: runs the generated script in the recorder image with only the run's
// output folder mounted.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { splitArgs, scriptExtension } from './text.js'
import { ENV_NAME } from './script-env.js'
import { SHELL_NOISE, isNotFound, killTree, notFoundMessage, spawnInShell } from './shell.js'

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
    const child = spawnInShell(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    onSpawn(child)
    let captured = ''
    const pipe = (stream, kind) => {
      let buf = ''
      stream.setEncoding('utf8')
      const emit = (line) => {
        if (SHELL_NOISE.test(line)) return
        captured += line + '\n'
        onLine(line, kind)
      }
      stream.on('data', (chunk) => {
        buf += chunk
        const lines = buf.split(/\r?\n|\r/)
        buf = lines.pop()
        lines.forEach(emit)
      })
      stream.on('end', () => buf && emit(buf))
    }
    pipe(child.stdout, 'stdout')
    pipe(child.stderr, 'stderr')
    child.on('error', (err) => reject(new Error(`Could not start bash to run ${cmd}: ${err.message}`)))
    child.on('close', (code) =>
      isNotFound(code, captured) ? reject(new Error(notFoundMessage(cmd, 'Docker executable'))) : resolve({ code, output: captured })
    )
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
    // The last line: a login shell's rc files may print something first.
    return code === 0 && output.trim().split('\n').pop() === contextHash(this.contextDir)
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

  // Which Docker this is. Both kinds change what the container can reach, and
  // rootless also changes which user it should run as.
  async dockerInfo(settings) {
    const { code, output } = await run(settings.dockerPath, ['info', '--format', '{{json .SecurityOptions}} {{.OperatingSystem}}'])
    // The last line: a login shell's rc files may print something first.
    const line = code === 0 ? output.trim().split('\n').pop() : ''
    return { rootless: line.includes('rootless'), desktop: /Docker Desktop/i.test(line) }
  }

  // Rootful Docker needs --user so files in /output end up owned by the host
  // user. Rootless Docker already maps container root to the host user, and
  // there --user would map to a subordinate uid that can't write the mount.
  userArgs(docker) {
    if (!process.getuid || docker.rootless) return []
    return ['--user', `${process.getuid()}:${process.getgid()}`]
  }

  async ensureImage(settings, onEvent) {
    if (!(await this.imageIsCurrent(settings))) await this.buildImage(settings, onEvent)
  }

  // Records `code` into a new folder under settings.outputDir. Resolves with
  // the folder and the files the run produced. `env` is passed into the
  // container; `targets` are the URLs the script will visit, for the notes.
  async record({ settings, code, script, name, env = {}, targets = [], onEvent }) {
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

    const docker = await this.dockerInfo(settings)
    const runArgs = splitArgs(settings.dockerRunArgs || '')
    for (const note of networkNotes({ runArgs, docker, targets })) onEvent({ type: 'stderr', text: note + '\n' })

    this.container = `quick-demo-creator-${crypto.randomBytes(4).toString('hex')}`
    const args = [
      'run', '--rm', '--init',
      '--name', this.container,
      '--shm-size=1g',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      ...this.userArgs(docker),
      ...envArgs(env),
      '-e', `CONVERT_MP4=${settings.convertToMp4 ? 1 : 0}`,
      '-v', `${runDir}:/output`,
      '-v', `${scriptPath}:/app/${scriptName}:ro`,
      ...runArgs,
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
    if (this.container) spawnInShell(settings.dockerPath, ['kill', this.container], { stdio: 'ignore' }).on('error', () => {})
    if (this.child) killTree(this.child)
  }
}

// `-e NAME=value` for each variable that has a value; a blank one is left
// unset so the script's own default applies.
export function envArgs(env) {
  return Object.entries(env)
    .filter(([name, value]) => ENV_NAME.test(name) && String(value ?? '').trim() !== '')
    .flatMap(([name, value]) => ['-e', `${name}=${value}`])
}

// Warnings about URLs on this machine that the container won't reach.
export function networkNotes({ runArgs, docker, targets }) {
  const local = [...new Set(targets.filter(isLocalUrl))]
  const notes = []
  if (!usesHostNetwork(runArgs)) {
    if (local.length) {
      notes.push(
        `${local.join(', ')} ${local.length > 1 ? 'are' : 'is'} served on this machine, but the container doesn't share its network. ` +
          'Add --network host to the extra docker run arguments in Settings.'
      )
    }
  } else if (docker.rootless) {
    notes.push(
      "Docker is rootless, where --network host is RootlessKit's network rather than this machine's, so localhost and " +
        '*.ddev.site in the container don\'t reach apps served here. Allow host loopback ' +
        '(DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=false) and use 10.0.2.2 in place of localhost.'
    )
  } else if (docker.desktop) {
    notes.push(
      "This is Docker Desktop, where --network host is its VM's network unless host networking is turned on in its " +
        'settings (Resources → Network). Otherwise use host.docker.internal in place of localhost.'
    )
  }
  return notes
}

function usesHostNetwork(args) {
  return args.some((arg, i) => /^--net(work)?=host$/.test(arg) || (/^--net(work)?$/.test(arg) && args[i + 1] === 'host'))
}

function isLocalUrl(value) {
  let host
  try {
    host = new URL(value).hostname
  } catch {
    return false
  }
  return host === 'localhost' || host === '[::1]' || /^127\./.test(host) || /\.(ddev\.site|localhost)$/.test(host)
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
