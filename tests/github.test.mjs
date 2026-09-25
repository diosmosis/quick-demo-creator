import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePrUrl, formatPrContext } from '../src/main/github.js'

test('test_parsePrUrl_should_accept_pr_links_and_shorthand', () => {
  const expected = { owner: 'matomo-org', repo: 'matomo', number: 123, url: 'https://github.com/matomo-org/matomo/pull/123' }
  assert.deepEqual(parsePrUrl('https://github.com/matomo-org/matomo/pull/123'), expected)
  assert.deepEqual(parsePrUrl(' github.com/matomo-org/matomo/pull/123/files?w=1 '), expected)
  assert.deepEqual(parsePrUrl('https://www.github.com/matomo-org/matomo/pull/123#discussion'), expected)
  assert.deepEqual(parsePrUrl('matomo-org/matomo#123'), expected)
})

test('test_parsePrUrl_should_reject_anything_else', () => {
  for (const input of ['', 'https://github.com/a/b/issues/1', 'https://gitlab.com/a/b/pull/1', 'https://github.com/a/b/pull/x']) {
    assert.equal(parsePrUrl(input), null, input)
  }
})

test('test_formatPrContext_should_include_description_and_diff', () => {
  const text = formatPrContext({
    title: 'Add export', author: 'me', state: 'open', base: 'main', head: 'feat', body: '', changedFiles: 2, diff: '+x'
  })
  assert.match(text, /Title: Add export/)
  assert.match(text, /Branches: feat → main/)
  assert.match(text, /\(no description\)/)
  assert.match(text, /```diff\n\+x\n```/)
})
