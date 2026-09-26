import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scriptEnvVars } from '../src/main/script-env.js'

test('test_scriptEnvVars_should_list_variables_in_order_with_their_defaults', () => {
  const code = `
const APP_URL = process.env.APP_URL || 'https://shop.ddev.site'
const USER = process.env['ADMIN_USER'] ?? \`admin\`
const PASSWORD = process.env.ADMIN_PASSWORD
const again = process.env.APP_URL
`
  assert.deepEqual(scriptEnvVars(code), [
    { name: 'APP_URL', fallback: 'https://shop.ddev.site', computed: '' },
    { name: 'ADMIN_USER', fallback: 'admin', computed: '' },
    { name: 'ADMIN_PASSWORD', fallback: '', computed: '' }
  ])
})

test('test_scriptEnvVars_should_read_destructured_variables_and_their_defaults', () => {
  const code = "const { APP_URL = 'http://localhost:8080', TOKEN } = process.env"
  assert.deepEqual(scriptEnvVars(code), [
    { name: 'APP_URL', fallback: 'http://localhost:8080', computed: '' },
    { name: 'TOKEN', fallback: '', computed: '' }
  ])
})

test('test_scriptEnvVars_should_take_a_default_given_on_a_later_read', () => {
  const code = "if (!process.env.APP_URL) {}\nconst url = process.env.APP_URL || 'http://localhost'"
  assert.deepEqual(scriptEnvVars(code), [{ name: 'APP_URL', fallback: 'http://localhost', computed: '' }])
})

test('test_scriptEnvVars_should_give_the_source_of_a_default_that_is_code', () => {
  const code = `
const APP_URL = process.env.APP_URL || 'http://localhost'
const LOGIN_URL = process.env.LOGIN_URL ?? \`\${APP_URL}/login\`
const { HOST = new URL(APP_URL).host } = process.env
const ADMIN = process.env.ADMIN || process.env.USER || 'admin'
`
  assert.deepEqual(scriptEnvVars(code), [
    { name: 'APP_URL', fallback: 'http://localhost', computed: '' },
    { name: 'LOGIN_URL', fallback: '', computed: '`${APP_URL}/login`' },
    { name: 'HOST', fallback: '', computed: 'new URL(APP_URL).host' },
    { name: 'ADMIN', fallback: '', computed: "process.env.USER || 'admin'" },
    { name: 'USER', fallback: '', computed: '' }
  ])
})

test('test_scriptEnvVars_should_put_a_multi_line_default_on_one_line', () => {
  const code = 'const URL = process.env.URL || [\n  BASE,\n  "x"\n].join("/")'
  assert.deepEqual(scriptEnvVars(code), [{ name: 'URL', fallback: '', computed: '[ BASE, "x" ].join("/")' }])
})

test('test_scriptEnvVars_should_skip_computed_names_and_what_the_container_sets_itself', () => {
  const code = 'const a = process.env[name]\nconst b = process.env.HOME\nconst c = process.env.CONVERT_MP4'
  assert.deepEqual(scriptEnvVars(code), [])
})

test('test_scriptEnvVars_should_return_nothing_for_a_script_that_does_not_parse', () => {
  assert.deepEqual(scriptEnvVars('const = process.env.APP_URL'), [])
})
