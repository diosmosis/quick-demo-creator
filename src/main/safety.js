// A static once-over of the generated Puppeteer script before it runs.
//
// This is a tripwire, not a sandbox: it looks for the things a recording
// script has no business doing (spawning processes, opening sockets, touching
// files outside /output, running obfuscated code) and reports them. The
// container stage 3 runs in is the actual containment.
//
// Findings are 'danger' (recording is blocked until the user overrides it) or
// 'warning' (shown, doesn't block).
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

export const OUTPUT_DIR = '/output'

const ALLOWED_MODULES = new Set([
  'puppeteer',
  'puppeteer-core',
  'fs',
  'fs/promises',
  'path',
  'timers/promises',
  'url',
  'util',
  'os'
])

const DANGEROUS_MODULES = new Map([
  ['child_process', 'runs other programs'],
  ['worker_threads', 'runs code in other threads'],
  ['cluster', 'forks processes'],
  ['net', 'opens network sockets'],
  ['dgram', 'opens network sockets'],
  ['tls', 'opens network sockets'],
  ['http', 'makes network requests from Node'],
  ['https', 'makes network requests from Node'],
  ['http2', 'makes network requests from Node'],
  ['dns', 'performs DNS lookups'],
  ['vm', 'evaluates code dynamically'],
  ['module', 'loads code dynamically'],
  ['inspector', 'attaches a debugger'],
  ['v8', 'reaches into the JavaScript engine'],
  ['process', 'reaches into the process']
])

// fs calls that change the filesystem; the first argument is the path.
const FS_MUTATORS = new Set([
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream',
  'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync',
  'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync',
  'symlink', 'symlinkSync', 'link', 'linkSync', 'chmod', 'chmodSync', 'chown', 'chownSync',
  'truncate', 'truncateSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync'
])

// Functions whose function arguments run inside the page, not in Node.
const BROWSER_CONTEXT_CALLS = new Set([
  'evaluate', 'evaluateHandle', 'evaluateOnNewDocument', '$eval', '$$eval', 'waitForFunction', 'exposeFunction'
])

// Puppeteer calls that write a file to their `path` option.
const PATH_OPTION_CALLS = new Set(['screencast', 'screenshot', 'pdf'])

const SOURCE_PATTERNS = [
  { re: /stratum\+tcp|xmrig|coinhive|cryptonight|monero/i, severity: 'danger', message: 'Mentions cryptocurrency mining.' },
  { re: /169\.254\.169\.254|metadata\.google\.internal/, severity: 'danger', message: 'Reaches for a cloud metadata endpoint.' },
  { re: /\/var\/run\/docker\.sock|docker\.sock/, severity: 'danger', message: 'Refers to the Docker socket.' },
  { re: /(?:~|\$HOME|\/home\/[\w.-]+|\/root)\/\.(?:ssh|aws|gnupg|config|netrc|npmrc|docker)\b/, severity: 'danger', message: 'Refers to credential files in a home directory.' },
  { re: /\/etc\/(?:passwd|shadow|sudoers)/, severity: 'danger', message: 'Refers to system account files.' },
  { re: /['"`][A-Za-z0-9+/]{200,}={0,2}['"`]/, severity: 'warning', message: 'Contains a long base64-like string, which can hide code.' },
  { re: /(?:\\x[0-9a-fA-F]{2}){10,}|(?:\\u[0-9a-fA-F]{4}){10,}/, severity: 'warning', message: 'Contains long runs of escaped characters, which can hide code.' },
  { re: /String\.fromCharCode\s*\(/, severity: 'warning', message: 'Builds strings from character codes, which can hide code.' },
  { re: /Buffer\.from\([^)]*['"](?:base64|hex)['"]\s*\)/, severity: 'warning', message: 'Decodes base64/hex data.' },
  { re: /['"`]file:\/\//, severity: 'warning', message: 'Opens a file:// URL, which reads files from the container.' }
]

function normalizeModule(name) {
  return name.startsWith('node:') ? name.slice(5) : name
}

// Resolves the few expression shapes scripts use to build paths, given the
// string constants declared in the file. Returns undefined when it can't.
function staticString(node, constants) {
  if (!node) return undefined
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? node.value : undefined
    case 'TemplateLiteral': {
      let out = ''
      for (let i = 0; i < node.quasis.length; i++) {
        out += node.quasis[i].value.cooked
        if (i < node.expressions.length) {
          const part = staticString(node.expressions[i], constants)
          if (part === undefined) return undefined
          out += part
        }
      }
      return out
    }
    case 'Identifier':
      return constants.get(node.name)
    case 'BinaryExpression': {
      if (node.operator !== '+') return undefined
      const l = staticString(node.left, constants)
      const r = staticString(node.right, constants)
      return l === undefined || r === undefined ? undefined : l + r
    }
    case 'CallExpression': {
      // path.join(...) / path.resolve(...): the first argument fixes the root.
      const callee = node.callee
      const name = callee.type === 'MemberExpression' ? callee.property.name : callee.name
      if ((name === 'join' || name === 'resolve') && node.arguments.length) {
        const parts = node.arguments.map((a) => staticString(a, constants))
        if (parts[0] === undefined) return undefined
        // Unknown later segments can't climb out if they have no '..'; mark
        // them so the prefix check still applies.
        return parts.map((p) => (p === undefined ? '<dynamic>' : p)).join('/')
      }
      return undefined
    }
    default:
      return undefined
  }
}

function isUnderOutput(p) {
  const parts = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const normalized = '/' + parts.join('/')
  return p.startsWith('/') && (normalized === OUTPUT_DIR || normalized.startsWith(OUTPUT_DIR + '/'))
}

function isRelative(p) {
  return !p.startsWith('/') && !p.includes('..')
}

function parse(code) {
  const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowAwaitOutsideFunction: true }
  try {
    return acorn.parse(code, { ...opts, sourceType: 'module' })
  } catch (moduleErr) {
    try {
      return acorn.parse(code, { ...opts, sourceType: 'script', allowReturnOutsideFunction: true })
    } catch {
      throw moduleErr
    }
  }
}

function lineOf(code, index) {
  return code.slice(0, index).split('\n').length
}

export function checkScript(code) {
  const findings = []
  const add = (severity, message, line) => {
    if (!findings.some((f) => f.message === message && f.line === line)) findings.push({ severity, message, line })
  }

  if (!code.trim()) {
    return { ok: false, findings: [{ severity: 'danger', message: 'The script is empty.' }] }
  }

  let ast
  try {
    ast = parse(code)
  } catch (err) {
    return {
      ok: false,
      findings: [{ severity: 'danger', message: `The script isn't valid JavaScript: ${err.message}`, line: err.loc?.line }]
    }
  }

  // String constants anywhere in the file, for resolving paths like
  // path.join(OUTPUT_DIR, 'demo.webm'). Reassigned names are dropped.
  const constants = new Map()
  const reassigned = new Set()
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (node.id.type !== 'Identifier') return
      if (constants.has(node.id.name)) reassigned.add(node.id.name)
      const value = staticString(node.init, constants)
      if (value !== undefined) constants.set(node.id.name, value)
    },
    AssignmentExpression(node) {
      if (node.left.type === 'Identifier') reassigned.add(node.left.name)
    }
  })
  for (const name of reassigned) constants.delete(name)

  const checkModule = (name, line) => {
    const mod = normalizeModule(name)
    if (DANGEROUS_MODULES.has(mod)) add('danger', `Imports "${name}", which ${DANGEROUS_MODULES.get(mod)}.`, line)
    else if (!ALLOWED_MODULES.has(mod)) add('warning', `Imports "${name}", which isn't installed in the recording image.`, line)
  }

  const checkPath = (node, method, line) => {
    let p = staticString(node, constants)
    if (p === undefined) {
      add('warning', `Calls ${method}() on a path that can't be checked statically; make sure it is under ${OUTPUT_DIR}.`, line)
      return
    }
    const dynamic = p.indexOf('<dynamic>')
    if (dynamic !== -1) p = p.slice(0, dynamic)
    // Relative paths land in the throwaway container, so they're harmless.
    if (isUnderOutput(p) || isRelative(p)) return
    add('danger', `Calls ${method}() on "${p}${dynamic !== -1 ? '…' : ''}", outside ${OUTPUT_DIR}.`, line)
  }

  let screencasts = 0

  walk.fullAncestor(ast, (node, _state, ancestors) => {
    const line = node.loc?.start.line
    const inBrowser = ancestors.some(
      (a, i) =>
        a.type === 'CallExpression' &&
        a.callee.type === 'MemberExpression' &&
        BROWSER_CONTEXT_CALLS.has(a.callee.property.name) &&
        a.arguments.includes(ancestors[i + 1]) &&
        /Function/.test(ancestors[i + 1].type)
    )

    switch (node.type) {
      case 'ImportDeclaration':
        checkModule(node.source.value, line)
        break

      case 'ImportExpression':
        if (node.source.type === 'Literal') checkModule(String(node.source.value), line)
        else add('danger', 'Imports a module whose name is computed at runtime.', line)
        break

      case 'NewExpression':
        if (node.callee.type === 'Identifier' && node.callee.name === 'Function') {
          add(inBrowser ? 'warning' : 'danger', 'Builds a function from a string (new Function).', line)
        }
        break

      case 'CallExpression': {
        const callee = node.callee
        if (callee.type === 'Identifier') {
          if (callee.name === 'require' && !inBrowser) {
            const arg = node.arguments[0]
            if (arg?.type === 'Literal') checkModule(String(arg.value), line)
            else add('danger', 'Requires a module whose name is computed at runtime.', line)
          } else if (callee.name === 'eval') {
            add(inBrowser ? 'warning' : 'danger', 'Evaluates a string as code (eval).', line)
          } else if (callee.name === 'Function') {
            add(inBrowser ? 'warning' : 'danger', 'Builds a function from a string (Function).', line)
          } else if (callee.name === 'fetch' && !inBrowser) {
            add('warning', 'Makes a network request from Node rather than from the page.', line)
          }
        } else if (callee.type === 'MemberExpression' && !callee.computed) {
          const method = callee.property.name
          if (FS_MUTATORS.has(method) && !inBrowser && node.arguments.length) {
            checkPath(node.arguments[0], method, line)
          }
          if (PATH_OPTION_CALLS.has(method)) {
            if (method === 'screencast') screencasts++
            const opts = node.arguments[0]
            const pathProp =
              opts?.type === 'ObjectExpression' &&
              opts.properties.find((p) => p.type === 'Property' && (p.key.name || p.key.value) === 'path')
            if (pathProp) {
              const p = staticString(pathProp.value, constants)
              if (p !== undefined && !p.includes('<dynamic>') && !isUnderOutput(p)) {
                add('warning', `Saves a ${method} to "${p}", which isn't under ${OUTPUT_DIR} and won't be kept.`, line)
              }
            }
          }
        }
        break
      }

      case 'MemberExpression':
        if (
          !inBrowser &&
          node.object.type === 'Identifier' &&
          node.object.name === 'process' &&
          !node.computed
        ) {
          const prop = node.property.name
          if (['binding', '_linkedBinding', 'dlopen', 'setuid', 'setgid', 'kill'].includes(prop)) {
            add('danger', `Uses process.${prop}.`, line)
          } else if (prop === 'env') {
            add('warning', 'Reads environment variables.', line)
          }
        }
        break
    }
  })

  for (const { re, severity, message } of SOURCE_PATTERNS) {
    const m = re.exec(code)
    if (m) add(severity, message, lineOf(code, m.index))
  }

  const longLine = code.split('\n').findIndex((l) => l.length > 1000)
  if (longLine !== -1) add('warning', 'Has a line over 1000 characters long; minified code is hard to review.', longLine + 1)

  if (!screencasts) {
    add('warning', "Never calls page.screencast(), so it probably won't produce a video.")
  }

  findings.sort((a, b) => (a.severity === b.severity ? (a.line ?? 1e9) - (b.line ?? 1e9) : a.severity === 'danger' ? -1 : 1))
  return { ok: !findings.some((f) => f.severity === 'danger'), findings }
}
