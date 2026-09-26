import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envArgs, networkNotes } from '../src/main/recorder.js'

const ROOTFUL = { rootless: false, desktop: false }

test('test_envArgs_should_pass_values_and_leave_blank_ones_unset', () => {
  assert.deepEqual(envArgs({ APP_URL: 'https://shop.ddev.site', PASSWORD: 'a b=c', EMPTY: ' ', 'BAD-NAME': 'x' }), [
    '-e', 'APP_URL=https://shop.ddev.site',
    '-e', 'PASSWORD=a b=c'
  ])
})

test('test_networkNotes_should_say_nothing_for_rootful_docker_on_the_host_network', () => {
  for (const runArgs of [['--network', 'host'], ['--network=host'], ['--net=host']]) {
    assert.deepEqual(networkNotes({ runArgs, docker: ROOTFUL, targets: ['http://localhost:8080'] }), [])
  }
})

test('test_networkNotes_should_ask_for_the_host_network_when_a_url_is_local', () => {
  const notes = networkNotes({
    runArgs: [],
    docker: ROOTFUL,
    targets: ['https://shop.ddev.site/admin', 'http://127.0.0.1:3000', 'https://example.com', 'not a url']
  })
  assert.equal(notes.length, 1)
  assert.match(notes[0], /^https:\/\/shop\.ddev\.site\/admin, http:\/\/127\.0\.0\.1:3000 are served on this machine/)
  assert.deepEqual(networkNotes({ runArgs: [], docker: ROOTFUL, targets: ['https://example.com'] }), [])
})

test('test_networkNotes_should_explain_the_host_network_on_rootless_docker_and_docker_desktop', () => {
  const hostNet = ['--network', 'host']
  assert.match(networkNotes({ runArgs: hostNet, docker: { rootless: true, desktop: false }, targets: [] })[0], /rootless.*10\.0\.2\.2/)
  assert.match(networkNotes({ runArgs: hostNet, docker: { rootless: false, desktop: true }, targets: [] })[0], /Docker Desktop.*host\.docker\.internal/)
})
