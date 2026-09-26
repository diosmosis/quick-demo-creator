import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNotFound, spawnInShell, withoutShellNoise } from '../src/main/shell.js'

test('test_spawnInShell_should_pass_arguments_through_without_shell_parsing', async () => {
  const { code, stdout } = await run('printf', ['%s|', 'a b', '$HOME', '"q"', '`x`'])
  assert.equal(code, 0)
  assert.equal(stdout.split('\n').pop(), 'a b|$HOME|"q"|`x`|')
})

test('test_isNotFound_should_recognise_a_missing_executable_but_not_an_exit_code_of_127', async () => {
  const missing = await run('no-such-executable-qdc', ['--version'])
  assert.equal(isNotFound(missing.code, missing.stderr), true)

  const exited = await run('bash', ['-c', 'exit 127'])
  assert.equal(isNotFound(exited.code, exited.stderr), false)
})

test('test_withoutShellNoise_should_drop_only_the_job_control_warnings', () => {
  const text = [
    'bash: cannot set terminal process group (-1): Inappropriate ioctl for device',
    'bash: no job control in this shell',
    'bash: real problem'
  ].join('\n')
  assert.equal(withoutShellNoise(text), 'bash: real problem')
})

function run(exe, args) {
  return new Promise((resolve) => {
    const child = spawnInShell(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
