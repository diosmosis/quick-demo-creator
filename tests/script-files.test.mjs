import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInputName, scriptInputFiles } from '../src/main/script-files.js'

test('test_scriptInputFiles_should_list_input_names_in_order_of_first_use', () => {
  const code = `
const PLUGIN_ZIP = '/input/my-plugin.zip'
const LOGO = \`/input/logo.png\`
const THEME = "/input/theme/style.css"
const again = '/input/my-plugin.zip'
`
  assert.deepEqual(scriptInputFiles(code), ['my-plugin.zip', 'logo.png', 'theme'])
})

test('test_scriptInputFiles_should_ignore_other_paths_and_unparseable_code', () => {
  assert.deepEqual(scriptInputFiles("const a = '/output/demo.webm', b = '/input/', c = '/inputs/x', d = `/input/${a}`"), [])
  assert.deepEqual(scriptInputFiles('const = ;'), [])
})

test('test_isInputName_should_accept_only_a_single_path_segment', () => {
  assert.equal(isInputName('plugin.zip'), true)
  assert.equal(isInputName('with space, and comma.zip'), true)
  for (const name of ['', '.', '..', 'a/b', 'a\\b', null]) assert.equal(isInputName(name), false, String(name))
})
