import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as kit from '../docker/recorder/demo-kit.js'
import { Demo, readingTime, zoomedBox } from '../docker/recorder/demo-kit.js'

// What Claude is told about the library; anything missing from it won't be used.
const REFERENCE = fs.readFileSync(new URL('../docker/recorder/demo-kit.md', import.meta.url), 'utf8')

// Methods scripts aren't meant to call.
const INTERNAL = new Set(['constructor', 'setup', 'stopRecording', 'moveTo', 'update', 'render', 'evaluateOverlay', 'action', 'ring', 'moveToPoint', 'drawOptions', 'findWithText', 'cdp'])

test('test_readingTime_should_allow_a_second_per_four_words', () => {
  assert.equal(readingTime('one two three four five six seven eight nine ten eleven twelve'), 3000)
})

test('test_readingTime_should_allow_at_least_two_seconds', () => {
  assert.equal(readingTime('Hello'), 2000)
  assert.equal(readingTime(''), 2000)
  assert.equal(readingTime(null), 2000)
})

const VIEWPORT = { width: 1920, height: 1080 }

test('test_zoomedBox_should_grow_the_box_around_its_middle', () => {
  assert.deepEqual(zoomedBox({ x: 860, y: 490, width: 200, height: 100 }, VIEWPORT, 2), { x: 760, y: 440, width: 400, height: 200 })
})

test('test_zoomedBox_should_keep_the_zoomed_box_inside_the_viewport', () => {
  assert.deepEqual(zoomedBox({ x: 0, y: 1000, width: 200, height: 80 }, VIEWPORT, 2), { x: 40, y: 880, width: 400, height: 160 })
})

test('test_zoomedBox_should_scale_less_when_the_box_would_not_fit', () => {
  assert.deepEqual(zoomedBox({ x: 100, y: 100, width: 920, height: 100 }, VIEWPORT, 3), { x: 40, y: 50, width: 1840, height: 200 })
})

test('test_zoomedBox_should_leave_a_box_too_big_to_grow_as_it_is', () => {
  assert.deepEqual(zoomedBox({ x: 0, y: 0, width: 1900, height: 300 }, VIEWPORT, 1.5), { x: 0, y: 0, width: 1900, height: 300 })
})

test('test_record_should_be_described_in_the_reference', () => {
  assert.match(REFERENCE, /`record\(script, options\?\)`/)
  assert.match(REFERENCE, /import \{ record \} from 'demo-kit'/)
  assert.deepEqual(Object.keys(kit).sort(), ['Demo', 'OUTPUT_VIDEO', 'readingTime', 'record', 'zoomedBox'])
})

test('test_Demo_should_have_every_public_method_described_in_the_reference', () => {
  const methods = Object.getOwnPropertyNames(Demo.prototype).filter((name) => !INTERNAL.has(name))
  const missing = methods.filter((name) => !REFERENCE.includes(`demo.${name}(`))
  assert.deepEqual(missing, [])
})
