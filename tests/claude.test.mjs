import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StreamParser } from '../src/main/claude.js'

const line = (o) => JSON.stringify(o) + '\n'
const delta = (text) => line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

function parse(chunks) {
  const events = []
  const parser = new StreamParser((e) => events.push(e))
  for (const c of chunks) parser.feed(c)
  parser.end()
  return { events, parser }
}

test('test_feed_should_stream_text_deltas_and_take_the_answer_from_the_result', () => {
  const all = delta('Hel') + delta('lo') + line({ type: 'result', subtype: 'success', result: 'Hello', is_error: false })
  // split mid-line to prove buffering works
  const { events, parser } = parse([all.slice(0, 50), all.slice(50)])
  assert.deepEqual(events, [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }])
  assert.equal(parser.answer(), 'Hello')
})

test('test_feed_should_report_tool_use_and_results', () => {
  const { events } = parse([
    line({ type: 'system', subtype: 'init', model: 'claude-x' }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'gh pr view 1' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'a\nb\nc\nd\ne\nf\ng\nh', is_error: false }] } })
  ])
  assert.deepEqual(events, [
    { type: 'status', text: 'Claude session started (claude-x)' },
    { type: 'tool', name: 'Bash', text: 'gh pr view 1' },
    { type: 'toolResult', text: 'a\nb\nc\nd\ne\nf\n… (2 more lines)', isError: false }
  ])
})

test('test_feed_should_separate_consecutive_messages', () => {
  const { events } = parse([
    delta('one'),
    line({ type: 'stream_event', event: { type: 'message_start' } }),
    delta('two')
  ])
  assert.deepEqual(events.map((e) => e.text).join(''), 'one\n\ntwo')
})

test('test_feed_should_show_assistant_text_when_there_are_no_partial_messages', () => {
  const { events, parser } = parse([
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'final' }] } })
  ])
  assert.deepEqual(events.map((e) => e.text).join(''), 'first\n\nfinal')
  assert.equal(parser.answer(), 'final')
})

test('test_feed_should_not_repeat_assistant_text_already_streamed', () => {
  const { events } = parse([delta('hi'), line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })])
  assert.deepEqual(events, [{ type: 'text', text: 'hi' }])
})

test('test_feed_should_pass_non_json_output_through_as_the_answer', () => {
  const { events, parser } = parse(['plain output\nsecond line'])
  assert.deepEqual(events.map((e) => e.text), ['plain output\n', 'second line\n'])
  assert.equal(parser.answer(), 'plain output\nsecond line\n')
})
