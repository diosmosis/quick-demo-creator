import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitArgs, fillTemplate, extractCode, scriptExtension, truncate } from '../src/main/text.js'

test('test_splitArgs_should_split_on_whitespace', () => {
  assert.deepEqual(splitArgs('  --a  b\tc '), ['--a', 'b', 'c'])
  assert.deepEqual(splitArgs(''), [])
})

test('test_splitArgs_should_keep_quoted_text_together', () => {
  assert.deepEqual(splitArgs(`--allowedTools "WebFetch,Bash(gh pr view:*)" 'a b' x"y z"`), [
    '--allowedTools',
    'WebFetch,Bash(gh pr view:*)',
    'a b',
    'xy z'
  ])
  assert.deepEqual(splitArgs(`"" ''`), ['', ''])
})

test('test_splitArgs_should_honour_backslash_escapes', () => {
  assert.deepEqual(splitArgs(String.raw`a\ b "c\"d" 'e\f'`), ['a b', 'c"d', 'e\\f'])
})

test('test_splitArgs_should_reject_unterminated_quotes', () => {
  assert.throws(() => splitArgs('"abc'), /Unterminated/)
})

test('test_fillTemplate_should_replace_every_placeholder_literally', () => {
  assert.equal(fillTemplate('{A} and {A}, {B}', { A: '$&x', B: 'y' }), '$&x and $&x, y')
})

test('test_extractCode_should_prefer_the_longest_javascript_fence', () => {
  const answer = 'Here:\n```bash\nnpm i puppeteer and some long long text\n```\n```js\nshort()\n```\n```javascript\nconst longer = 1\n```\nEnjoy'
  assert.equal(extractCode(answer), 'const longer = 1')
})

test('test_extractCode_should_fall_back_to_any_fence_then_the_whole_answer', () => {
  assert.equal(extractCode('```text\nabc\n```'), 'abc')
  assert.equal(extractCode('  plain code  '), 'plain code')
})

test('test_scriptExtension_should_choose_cjs_only_for_require_based_scripts', () => {
  assert.equal(scriptExtension("const p = require('puppeteer')"), '.cjs')
  assert.equal(scriptExtension("import p from 'puppeteer'\nconst x = require"), '.mjs')
  assert.equal(scriptExtension("import p from 'puppeteer'\nconst m = createRequire(import.meta.url)('x')"), '.mjs')
  assert.equal(scriptExtension('console.log(1)'), '.mjs')
})

test('test_truncate_should_note_how_much_was_dropped', () => {
  assert.equal(truncate('abc', 5, 'cut'), 'abc')
  assert.equal(truncate('abcdef', 2, 'cut'), 'ab\n\n[… cut: 4 more characters omitted]')
})
