// The Environment stage: copies of a DDEV project ("instances") the demo runs
// against, each started as a DDEV project of its own. A demo that needs two
// Matomos gets two copies of one Matomo checkout.
//
// DDEV knows a project by its folder and its name, so each instance is a copy
// of the template folder with its name set by an override file that sorts
// after the template's own config.*.yaml (config.local.yaml included). Extra
// volumes go in a docker-compose file of our own in the copy's .ddev.
import fs from 'node:fs'
import path from 'node:path'
import { killTree, runCommand } from './shell.js'

export const OVERRIDE_FILE = 'config.zz-quick-demo-creator.yaml'
export const VOLUMES_FILE = 'docker-compose.quick-demo-creator.yaml'
// The template's database, on its way from `ddev export-db` to `ddev import-db`,
// in the copy's .ddev. Not a dotfile: import-db only finds the SQL it unpacks
// with a *.*sql glob.
const DB_DUMP = path.join('.ddev', 'quick-demo-creator-db.sql.gz')
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

export const MODES = ['copy', 'worktree']

// A DDEV project name that is also one DNS label, since it becomes
// <name>.ddev.site.
export function isInstanceName(name) {
  return typeof name === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)
}

// Why `dir` can't be a template, or '' when it can.
export function templateProblem(dir) {
  if (!dir || !path.isAbsolute(dir)) return 'Choose the folder of a DDEV project.'
  if (!fs.existsSync(dir)) return `${dir} doesn't exist.`
  if (!fs.existsSync(path.join(dir, '.ddev', 'config.yaml'))) return `${dir} isn't a DDEV project: it has no .ddev/config.yaml.`
  return ''
}

// Removes the router files DDEV generated for the template's project from its
// copy in `dir`: named for the template's project, they would claim its
// hostname a second time, and the router then never becomes healthy. DDEV
// writes them again, for the copy's name, when it starts. Files without DDEV's
// marker are the project's own and are kept.
export function removeGeneratedRouterFiles(dir) {
  const removed = []
  for (const sub of ['certs', 'config']) {
    const folder = path.join(dir, '.ddev', 'traefik', sub)
    if (!fs.existsSync(folder)) continue
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name)
      if (fs.statSync(file).isFile() && fs.readFileSync(file, 'utf8').includes('#ddev-generated')) {
        fs.rmSync(file)
        removed.push(path.join(sub, name))
      }
    }
  }
  return removed
}

// "<template folder>-demo", then -demo-2, -demo-3, ... until one isn't in `taken`.
export function suggestName(template, taken) {
  const base =
    path
      .basename(template || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'demo'
  const names = new Set(taken)
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}-demo` : `${base}-demo-${i}`
    if (!names.has(name)) return name
  }
}

// The copy's override file: its name, and the template's extra hostnames and
// FQDNs renamed for it (see renamedHosts()). A list in an override file is
// added to the template's rather than replacing it, unless override_config is
// set, which replaces only the settings this file has.
export function overrideYaml(name, hosts = {}) {
  const lines = ['# Written by Quick Demo Creator: this copy runs as a DDEV project of its own.', `name: ${name}`]
  const lists = Object.entries(hosts).filter(([, list]) => list)
  if (lists.length) lines.push('override_config: true')
  for (const [key, list] of lists) {
    lines.push(`${key}:`, ...list.map((host) => `  - ${JSON.stringify(host)}`))
  }
  return lines.join('\n') + '\n'
}

// The template's extra hosts from `ddev describe --json-output`, which only
// lists them all together, domain included: { name, hostnames, fqdns }. A
// host under the primary hostname's domain is an additional_hostnames entry
// (given without that domain), and any other an additional_fqdns one.
export function parseDdevDescribe(output) {
  for (const line of String(output).trim().split('\n').reverse()) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const raw = entry?.raw
    if (!raw || typeof raw.name !== 'string' || !Array.isArray(raw.hostnames)) continue
    const primary = String(raw.hostname || '')
    const domain = primary.startsWith(`${raw.name}.`) ? primary.slice(raw.name.length + 1) : ''
    const hostnames = []
    const fqdns = []
    for (const host of raw.hostnames.map(String)) {
      if (host === primary) continue
      if (domain && host.endsWith(`.${domain}`)) hostnames.push(host.slice(0, -domain.length - 1))
      else fqdns.push(host)
    }
    return { name: raw.name, hostnames, fqdns }
  }
  throw new Error("Couldn't read the project from `ddev describe`.")
}

// `host` for the copy named `to` of the project named `from`: a host that
// begins with the project's name (wp-matomo-ms, *.wp-matomo) gets the copy's
// name instead; null for any other host, which can't follow the rename.
export function renameHost(host, from, to) {
  const wildcard = host.startsWith('*.') ? '*.' : ''
  const rest = host.slice(wildcard.length)
  if (rest !== from && !(rest.startsWith(from) && /^[-.]/.test(rest.slice(from.length)))) return null
  return wildcard + to + rest.slice(from.length)
}

// The template's extra hosts (from parseDdevDescribe()) for its copy named
// `to`: { hosts: { additional_hostnames, additional_fqdns }, kept }. A list
// is only there when one of its hosts was renamed, and then in full, since it
// replaces the template's; `kept` are the hosts that couldn't be, which the
// copy answers to as well as the template.
export function renamedHosts(described, to) {
  const hosts = {}
  const kept = []
  for (const [key, list] of [['additional_hostnames', described.hostnames], ['additional_fqdns', described.fqdns]]) {
    const renamed = list.map((host) => renameHost(host, described.name, to))
    kept.push(...list.filter((_, i) => renamed[i] === null))
    if (renamed.some((host) => host !== null)) hosts[key] = list.map((host, i) => renamed[i] ?? host)
  }
  return { hosts, kept }
}

// Why `volume` ({ source, target, service, readOnly }) can't be mounted, or ''.
export function volumeProblem(volume) {
  const { source = '', target = '', service = '' } = volume || {}
  if (!path.isAbsolute(source)) return 'The folder or file to mount needs an absolute path.'
  if (!fs.existsSync(source)) return `${source} doesn't exist.`
  if (!path.posix.isAbsolute(target) || target === '/') return `Where to mount ${source} needs an absolute path in the container.`
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(service)) return `"${service}" isn't a service name.`
  return ''
}

// The docker-compose file that mounts `volumes`, or '' for none. Values are
// written as JSON strings, which YAML reads as double-quoted scalars.
export function volumesYaml(volumes) {
  const byService = new Map()
  for (const v of volumes) {
    if (!byService.has(v.service)) byService.set(v.service, [])
    byService.get(v.service).push(v)
  }
  if (!byService.size) return ''
  const lines = ['# Written by Quick Demo Creator from the volumes added to this instance.', 'services:']
  for (const [service, mounts] of byService) {
    lines.push(`  ${JSON.stringify(service)}:`, '    volumes:')
    for (const v of mounts) {
      lines.push(
        `      - {"type": "bind", "source": ${JSON.stringify(v.source)}, "target": ${JSON.stringify(v.target)}, "read_only": ${!!v.readOnly}}`
      )
    }
  }
  return lines.join('\n') + '\n'
}

// The projects in `ddev list --json-output`: [{ name, status, approot, url,
// httpUrl }]. DDEV logs JSON lines and the list is the `raw` of the last one.
export function parseDdevList(output) {
  for (const line of String(output).trim().split('\n').reverse()) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(entry?.raw)) continue
    return entry.raw
      .filter((p) => p && typeof p.name === 'string')
      .map((p) => ({
        name: p.name,
        status: String(p.status || ''),
        approot: String(p.approot || ''),
        url: String(p.primary_url || p.httpsurl || ''),
        httpUrl: String(p.httpurl || '')
      }))
  }
  throw new Error("Couldn't read the project list from `ddev list`.")
}

// The stored instances with what DDEV says about each: status is DDEV's
// ("running", "stopped", "paused", ...), or "not created" when DDEV doesn't
// know the project yet, or "missing" when its folder is gone.
export function withStatus(instances, projects) {
  return instances.map((inst) => {
    const project = projects.find((p) => p.name === inst.name && path.resolve(p.approot) === path.resolve(inst.dir))
    const status = !fs.existsSync(inst.dir) ? 'missing' : project?.status || 'not created'
    return { ...inst, status, url: project?.url || '', httpUrl: project?.httpUrl || '' }
  })
}

// Runs DDEV (and git and cp for making copies) for the Environment stage, one
// command at a time.
export class Instances {
  constructor() {
    this.child = null
    this.cancelled = false
  }

  async run(settings, cmd, args, { cwd, onEvent = () => {} } = {}) {
    if (this.cancelled) throw new Error('Cancelled.')
    onEvent({ type: 'status', text: `$ ${[cmd, ...args].join(' ')}${cwd ? `   (in ${cwd})` : ''}` })
    const res = await runCommand(cmd, args, {
      cwd,
      setting: cmd === settings.ddevPath ? 'DDEV executable' : `${cmd} executable`,
      onSpawn: (c) => (this.child = c),
      // The log ends 'log' lines itself, but not 'stderr' ones.
      onLine: (line, kind) => {
        const text = line.replace(ANSI, '')
        onEvent(kind === 'stderr' ? { type: 'stderr', text: text + '\n' } : { type: 'log', text })
      }
    })
    this.child = null
    if (this.cancelled) throw new Error('Cancelled.')
    return res
  }

  async runOrThrow(settings, cmd, args, options) {
    const res = await this.run(settings, cmd, args, options)
    if (res.code !== 0) throw new Error(`\`${[path.basename(cmd), ...args].join(' ')}\` failed with code ${res.code}. See the log above.`)
    return res
  }

  // Not through run(): it is asked for while other commands are running.
  async projects(settings) {
    const { code, output } = await runCommand(settings.ddevPath, ['list', '--json-output'], { setting: 'DDEV executable' })
    if (code !== 0) throw new Error(`ddev list failed with code ${code}: ${output.replace(ANSI, '').trim().split('\n').pop()}`)
    return parseDdevList(output)
  }

  // Makes the copy and names it. Resolves with the instance to store; `taken`
  // are the names of the instances stored already.
  async create(settings, { template, name, mode }, taken, onEvent) {
    this.cancelled = false
    const problem = templateProblem(template)
    if (problem) throw new Error(problem)
    if (!isInstanceName(name)) {
      throw new Error('Name the instance with lower-case letters, digits and hyphens, starting and ending with a letter or digit.')
    }
    if (!MODES.includes(mode)) throw new Error(`Unknown kind of copy: ${mode}.`)
    const project = (await this.projects(settings)).find((p) => p.name === name)
    if (project || taken.includes(name)) {
      throw new Error(`DDEV already has a project named ${name}${project ? ` (in ${project.approot})` : ''}. Choose another name.`)
    }
    const dir = path.join(settings.instancesDir, name)
    if (fs.existsSync(dir)) throw new Error(`${dir} already exists. Choose another name, or move it out of the way.`)
    fs.mkdirSync(settings.instancesDir, { recursive: true })

    try {
      if (mode === 'worktree') {
        onEvent({ type: 'status', text: `Adding a git worktree of ${template} at ${dir}…` })
        await this.runOrThrow(settings, 'git', ['-C', template, 'worktree', 'add', '--detach', dir], { onEvent })
        // A .ddev that isn't committed isn't in the worktree.
        if (!fs.existsSync(path.join(dir, '.ddev', 'config.yaml'))) {
          fs.cpSync(path.join(template, '.ddev'), path.join(dir, '.ddev'), {
            recursive: true,
            verbatimSymlinks: true,
            filter: (src) => path.basename(src) !== 'db_snapshots'
          })
        }
      } else {
        onEvent({ type: 'status', text: `Copying ${template} to ${dir}…` })
        await this.runOrThrow(settings, 'cp', ['-a', '--reflink=auto', template, dir], { onEvent })
      }
    } catch (err) {
      await this.discardCopy(settings, template, dir, mode)
      throw err
    }

    const instance = { name, dir, template, mode, volumes: [] }
    removeGeneratedRouterFiles(dir)
    fs.writeFileSync(path.join(dir, '.ddev', OVERRIDE_FILE), overrideYaml(name, await this.copyHosts(settings, template, name, onEvent)))
    // A copy of an instance would bring its volumes and any dump left over.
    this.writeVolumes(instance)
    fs.rmSync(path.join(dir, DB_DUMP), { force: true })
    return instance
  }

  // The template's extra hostnames and FQDNs, renamed for the copy named
  // `name` (see renamedHosts()). Without them the copy would answer to the
  // template's, and not to its own.
  async copyHosts(settings, template, name, onEvent) {
    const { code, output } = await runCommand(settings.ddevPath, ['describe', '--json-output'], { cwd: template, setting: 'DDEV executable' })
    let described
    try {
      if (code !== 0) throw new Error(`ddev describe failed with code ${code}`)
      described = parseDdevDescribe(output)
    } catch (err) {
      onEvent({ type: 'stderr', text: `Couldn't read the template's hostnames (${err.message}), so the copy keeps them as they are.\n` })
      return {}
    }
    const { hosts, kept } = renamedHosts(described, name)
    for (const list of Object.values(hosts)) {
      onEvent({ type: 'status', text: `Extra hostnames for ${name}: ${list.join(', ')}` })
    }
    if (kept.length) {
      onEvent({
        type: 'stderr',
        text: `${kept.join(', ')} ${kept.length > 1 ? "don't" : "doesn't"} begin with the template's name (${described.name}), so the copy answers to ${kept.length > 1 ? 'them' : 'it'} too, as well as the template. Change that in the copy's .ddev/${OVERRIDE_FILE} if they clash.\n`
      })
    }
    return hosts
  }

  // The rest of creating an instance, once it is stored: starting it and, with
  // `copyDatabase`, importing the template's database (if the template is running).
  async firstStart(settings, instance, copyDatabase, onEvent) {
    const dump = path.join(instance.dir, DB_DUMP)
    try {
      if (copyDatabase) {
        onEvent({ type: 'status', text: "Exporting the template's database (the template has to be running)…" })
        const res = await this.run(settings, settings.ddevPath, ['export-db', `--file=${dump}`], { cwd: instance.template, onEvent })
        if (res.code !== 0) onEvent({ type: 'stderr', text: "Couldn't export the template's database, so the instance starts with an empty one.\n" })
      }
      await this.runOrThrow(settings, settings.ddevPath, ['start'], { cwd: instance.dir, onEvent })
      if (fs.existsSync(dump)) {
        onEvent({ type: 'status', text: "Importing the template's database…" })
        await this.runOrThrow(settings, settings.ddevPath, ['import-db', `--file=${dump}`], { cwd: instance.dir, onEvent })
      }
    } finally {
      fs.rmSync(dump, { force: true })
    }
  }

  writeVolumes(instance) {
    const file = path.join(instance.dir, '.ddev', VOLUMES_FILE)
    const yaml = volumesYaml(instance.volumes || [])
    if (yaml) fs.writeFileSync(file, yaml)
    else fs.rmSync(file, { force: true })
  }

  // `ddev <args>` in the instance's folder.
  async ddev(settings, instance, args, onEvent) {
    this.cancelled = false
    if (!fs.existsSync(instance.dir)) throw new Error(`${instance.dir} no longer exists.`)
    await this.runOrThrow(settings, settings.ddevPath, args, { cwd: instance.dir, onEvent })
  }

  // Deletes the DDEV project (containers, database, volumes) and the copy.
  async remove(settings, instance, onEvent) {
    this.cancelled = false
    if (fs.existsSync(instance.dir)) {
      await this.run(settings, settings.ddevPath, ['delete', '--omit-snapshot', '--yes', instance.name], { onEvent })
    }
    await this.discardCopy(settings, instance.template, instance.dir, instance.mode, onEvent)
  }

  // Removes a copy this class made, and nothing else: its folder has to be
  // named for the instance and hold the override file (or not exist yet).
  async discardCopy(settings, template, dir, mode, onEvent = () => {}) {
    if (!fs.existsSync(dir)) return
    if (mode === 'worktree') {
      const res = await this.run(settings, 'git', ['-C', template, 'worktree', 'remove', '--force', dir], { onEvent }).catch(() => null)
      if (res?.code === 0) return
    }
    const ours = fs.existsSync(path.join(dir, '.ddev', OVERRIDE_FILE)) || path.dirname(dir) === path.resolve(settings.instancesDir)
    if (!ours) throw new Error(`Not deleting ${dir}: it doesn't look like an instance copy.`)
    onEvent({ type: 'status', text: `Deleting ${dir}…` })
    await fs.promises.rm(dir, { recursive: true, force: true })
    if (mode === 'worktree') await this.run(settings, 'git', ['-C', template, 'worktree', 'prune'], { onEvent }).catch(() => {})
  }

  cancel() {
    this.cancelled = true
    if (this.child) killTree(this.child)
  }
}
