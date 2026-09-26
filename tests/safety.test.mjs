import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkScript } from '../src/main/safety.js'

const GOOD = `
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const OUTPUT_DIR = '/output'
const APP_URL = 'http://localhost:8080'

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
fs.mkdirSync(OUTPUT_DIR, { recursive: true })
const recorder = await page.screencast({ path: path.join(OUTPUT_DIR, 'demo.webm') })
await page.evaluateOnNewDocument(() => {
  const el = document.createElement('div')
  eval('1 + 1')
})
await page.goto(APP_URL)
await sleep(1000)
fs.writeFileSync(\`\${OUTPUT_DIR}/log.txt\`, 'done')
await recorder.stop()
await browser.close()
`

const messages = (code) => checkScript(code).findings.map((f) => `${f.severity}: ${f.message}`)
const dangers = (code) => checkScript(code).findings.filter((f) => f.severity === 'danger')

test('test_checkScript_should_pass_a_typical_recording_script', () => {
  const report = checkScript(GOOD)
  assert.equal(report.ok, true)
  // eval inside the page is only a warning
  assert.deepEqual(messages(GOOD), ['warning: Evaluates a string as code (eval).'])
})

test('test_checkScript_should_block_child_process_imports_in_every_form', () => {
  for (const code of [
    "import { exec } from 'child_process'",
    "import cp from 'node:child_process'",
    "const cp = require('child_process')",
    "const cp = await import('node:child_process')"
  ]) {
    const report = checkScript(code + '\npage.screencast({ path: "/output/a.webm" })')
    assert.equal(report.ok, false, code)
    assert.match(report.findings[0].message, /runs other programs/)
  }
})

test('test_checkScript_should_block_computed_module_names', () => {
  assert.equal(checkScript("const m = 'child' + '_process'; require(m)").ok, false)
  assert.equal(checkScript('await import(name)').ok, false)
})

test('test_checkScript_should_block_network_modules', () => {
  assert.match(dangers("import https from 'https'")[0].message, /network requests/)
  assert.match(dangers("import net from 'node:net'")[0].message, /sockets/)
})

test('test_checkScript_should_warn_about_packages_missing_from_the_image', () => {
  const report = checkScript("import axios from 'axios'")
  assert.equal(report.ok, true)
  assert.match(report.findings[0].message, /isn't installed/)
})

test('test_checkScript_should_block_eval_and_function_constructors_in_node', () => {
  assert.equal(checkScript("eval('x')").ok, false)
  assert.equal(checkScript("new Function('return 1')").ok, false)
  assert.equal(checkScript("Function('return 1')()").ok, false)
})

test('test_checkScript_should_block_file_writes_outside_the_output_directory', () => {
  const d = dangers("import fs from 'fs'\nfs.writeFileSync('/etc/hosts', 'x')")
  assert.equal(d.length, 1)
  assert.match(d[0].message, /writeFileSync\(\) on "\/etc\/hosts"/)
  assert.equal(d[0].line, 2)
  assert.equal(checkScript("fs.rmSync('/output/../app', { recursive: true })").ok, false)
  assert.equal(checkScript("const HOME = '/root'; fs.rm(path.join(HOME, '.ssh'))").ok, false)
  assert.equal(checkScript("fs.unlinkSync('../secret')").ok, false)
})

test('test_checkScript_should_allow_file_writes_under_output_and_relative_paths', () => {
  assert.equal(checkScript("fs.writeFileSync('/output/a.txt', 'x')").ok, true)
  assert.equal(checkScript("const D = '/output'; fs.writeFileSync(path.join(D, name), 'x')").ok, true)
  assert.equal(checkScript("fs.writeFileSync('notes.txt', 'x')").ok, true)
})

test('test_checkScript_should_warn_when_a_write_path_cannot_be_resolved', () => {
  const report = checkScript('fs.writeFileSync(somePath, "x")')
  assert.equal(report.ok, true)
  assert.match(report.findings[0].message, /can't be checked statically/)
})

test('test_checkScript_should_not_trust_reassigned_constants', () => {
  const report = checkScript("let D = '/output'\nD = '/etc'\nfs.writeFileSync(D + '/x', 'y')")
  assert.match(report.findings[0].message, /can't be checked statically/)
})

test('test_checkScript_should_warn_when_the_recording_is_saved_outside_output', () => {
  assert.ok(messages("page.screencast({ path: '/tmp/demo.webm' })").some((m) => /won't be kept/.test(m)))
})

test('test_checkScript_should_warn_when_nothing_is_recorded', () => {
  assert.ok(messages("await page.goto('http://x')").some((m) => /Never calls demo-kit's record\(\) or page.screencast\(\)/.test(m)))
})

test('test_checkScript_should_pass_a_demo_kit_script', () => {
  const code = `
import { record } from 'demo-kit'
const APP_URL = process.env.APP_URL || 'http://localhost:8080'
await record(async (demo) => {
  await demo.scene('Home')
  await demo.goto(APP_URL)
})`
  assert.deepEqual(checkScript(code), { ok: true, findings: [] })
})

test('test_checkScript_should_count_demo_kit_record_under_any_import_name', () => {
  for (const code of [
    "import { record as go } from 'demo-kit'\nawait go(async () => {})",
    "import * as kit from 'demo-kit'\nawait kit.record(async () => {})"
  ]) {
    assert.deepEqual(messages(code), [], code)
  }
  // A record() that isn't demo-kit's records nothing.
  assert.ok(messages("import { record } from './other.js'\nawait record()").some((m) => /Never calls/.test(m)))
})

test('test_checkScript_should_block_dangerous_process_members', () => {
  assert.equal(checkScript("process.binding('fs')").ok, false)
  assert.equal(checkScript('process.env.HOME').ok, true)
})

test('test_checkScript_should_warn_about_reading_the_whole_environment_but_not_named_variables', () => {
  for (const code of ['process.env.APP_URL', "process.env['APP_URL']", 'const { APP_URL } = process.env']) {
    assert.ok(!messages(code).some((m) => /environment/.test(m)), code)
  }
  for (const code of ['JSON.stringify(process.env)', 'process.env[name]', 'const { ...all } = process.env']) {
    assert.ok(messages(code).some((m) => /whole environment/.test(m)), code)
  }
})

test('test_checkScript_should_flag_suspicious_source_patterns', () => {
  assert.equal(checkScript("fetch('http://169.254.169.254/latest/meta-data')").ok, false)
  assert.equal(checkScript("const pool = 'stratum+tcp://pool'").ok, false)
  assert.equal(checkScript("fs.readFileSync('/home/me/.ssh/id_rsa')").ok, false)
  const blob = "'" + 'QUJD'.repeat(80) + "'"
  assert.ok(messages(`const x = ${blob}`).some((m) => /base64-like/.test(m)))
  assert.ok(messages("String.fromCharCode(104, 105)").some((m) => /character codes/.test(m)))
})

test('test_checkScript_should_warn_about_node_side_fetch_but_not_page_side', () => {
  assert.ok(messages("await fetch('http://x')").some((m) => /from Node/.test(m)))
  assert.ok(!messages("await page.evaluate(() => fetch('/api'))").some((m) => /from Node/.test(m)))
})

test('test_checkScript_should_block_scripts_that_do_not_parse', () => {
  const report = checkScript('const = ;')
  assert.equal(report.ok, false)
  assert.match(report.findings[0].message, /isn't valid JavaScript/)
})

test('test_checkScript_should_block_empty_scripts', () => {
  assert.equal(checkScript('  \n').ok, false)
})

test('test_checkScript_should_accept_commonjs_scripts', () => {
  const code = "const puppeteer = require('puppeteer')\n;(async () => { await page.screencast({ path: '/output/a.webm' }) })()"
  assert.deepEqual(checkScript(code), { ok: true, findings: [] })
})
