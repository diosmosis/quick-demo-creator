import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Recorder, audioArgs, envArgs, inputArgs, networkNotes } from '../src/main/recorder.js'
import { DEFAULT_RECORDING_ENVIRONMENT } from '../src/main/defaults.js'
import { fillTemplate } from '../src/main/text.js'

const ROOTFUL = { rootless: false, desktop: false }

test('test_demoKitReference_should_give_the_default_prompt_the_library_api', () => {
  const recorder = new Recorder(fileURLToPath(new URL('../docker/recorder', import.meta.url)))
  const prompt = fillTemplate(DEFAULT_RECORDING_ENVIRONMENT, { DEMO_API: recorder.demoKitReference() })
  assert.ok(!prompt.includes('{DEMO_API}'))
  assert.match(prompt, /import \{ record \} from 'demo-kit'/)
})

test('test_envArgs_should_pass_values_and_leave_blank_ones_unset', () => {
  assert.deepEqual(envArgs({ APP_URL: 'https://shop.ddev.site', PASSWORD: 'a b=c', EMPTY: ' ', 'BAD-NAME': 'x' }), [
    '-e', 'APP_URL=https://shop.ddev.site',
    '-e', 'PASSWORD=a b=c'
  ])
})

test('test_inputArgs_should_mount_each_file_read_only_in_the_input_directory', () => {
  assert.deepEqual(
    inputArgs([
      { name: 'plugin.zip', path: '/home/me/plugin.zip' },
      { name: 'a,b.csv', path: '/home/me/"odd",dir/a,b.csv' },
      { name: '../escape', path: '/etc/passwd' },
      { name: 'no-path.txt', path: '' }
    ]),
    [
      '--mount', 'type=bind,source=/home/me/plugin.zip,target=/input/plugin.zip,readonly',
      '--mount', 'type=bind,"source=/home/me/""odd"",dir/a,b.csv","target=/input/a,b.csv",readonly',
      '--workdir', '/input'
    ]
  )
})

test('test_audioArgs_should_mount_the_file_read_only_under_a_fixed_name', () => {
  assert.deepEqual(audioArgs('/home/me/Music/Theme.MP3'), [
    '--mount', 'type=bind,source=/home/me/Music/Theme.MP3,target=/audio/background.mp3,readonly',
    '-e', 'AUDIO=/audio/background.mp3'
  ])
  assert.deepEqual(audioArgs('/home/me/"odd",dir/track.$(rm -rf ~)'), [
    '--mount', 'type=bind,"source=/home/me/""odd"",dir/track.$(rm -rf ~)",target=/audio/background,readonly',
    '-e', 'AUDIO=/audio/background'
  ])
})

test('test_audioArgs_should_add_nothing_without_a_file', () => {
  assert.deepEqual(audioArgs(''), [])
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
