// Runs the external tools (Claude, Docker) the way a terminal would.
//
// The app is usually started from the desktop menu, whose environment never
// sources ~/.bashrc (see launch.sh), so whatever it adds to PATH — nvm's node,
// ~/.local/bin, a claudebox install — is missing and a bare name like
// `claudebox` isn't found. Going through an interactive login bash gives the
// command the environment it has in a terminal, as quick-change-editor does.
import { spawn } from 'node:child_process'
import os from 'node:os'

// What an interactive bash with no terminal says before it does anything else.
// It's the shell talking, not the command.
export const SHELL_NOISE = /^bash: (cannot set terminal process group\b.*|no job control in this shell)$/

// Whether the shell couldn't find the executable at all, as opposed to the
// executable exiting with 127 itself: bash says "<exe>: exec: <exe>: not found".
export function isNotFound(code, stderr) {
  return code === 127 && /exec: .*: not found/.test(stderr)
}

export function withoutShellNoise(text) {
  return String(text)
    .split('\n')
    .filter((line) => !SHELL_NOISE.test(line))
    .join('\n')
}

// Starts `exe ...args` in a login shell. The executable and its arguments reach
// the shell as positional parameters, so none of them is ever parsed by it.
//
// The child leads a process group of its own so killTree() reaches everything
// under it: a wrapper script (claudebox, say) is a bash waiting on a child,
// and bash puts off a SIGTERM until that child has finished.
export function spawnInShell(exe, args, options = {}) {
  // "$0" is quoted, so the shell won't expand a leading ~ itself.
  const resolved = exe.startsWith('~/') ? os.homedir() + exe.slice(1) : exe
  return spawn('bash', ['-ilc', 'exec "$0" "$@"', resolved, ...args], { ...options, detached: true })
}

export function killTree(child, signal = 'SIGTERM') {
  try {
    process.kill(-child.pid, signal)
  } catch {
    // Already gone, or never started (no pid).
    try {
      child.kill(signal)
    } catch {}
  }
}

export function notFoundMessage(exe, setting) {
  return `"${exe}" was not found, even with your login shell's PATH. Set the ${setting} in Settings, as an absolute path if need be.`
}

// Runs a command, streaming each output line to `onLine`. Resolves with the
// exit code and everything it printed; `onSpawn` receives the child so the
// caller can cancel it. `setting` names the setting that holds the executable,
// for the error when it isn't found.
export function runCommand(cmd, args, { onLine = () => {}, onSpawn = () => {}, cwd, setting = 'executable' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnInShell(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd })
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
      isNotFound(code, captured) ? reject(new Error(notFoundMessage(cmd, setting))) : resolve({ code, output: captured })
    )
  })
}
