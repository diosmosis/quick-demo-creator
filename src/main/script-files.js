// The input files a generated script reads. The user adds them in the app and
// the recorder mounts each one read-only at /input/<name>, which is also the
// container's working directory.
import * as walk from 'acorn-walk'
import { parse } from './safety.js'

export const INPUT_DIR = '/input'

// A name a file can be mounted under: one path segment.
export function isInputName(name) {
  return typeof name === 'string' && name !== '.' && name !== '..' && /^[^/\\\0]+$/.test(name)
}

// The names under /input the script mentions in string literals, in order of
// first use: '/input/plugin.zip' gives 'plugin.zip'. A deeper path gives its
// first segment, which is what has to be mounted.
export function scriptInputFiles(code) {
  let ast
  try {
    ast = parse(code)
  } catch {
    return []
  }
  const found = new Set()
  const add = (value) => {
    const m = /^\/input\/([^/]+)/.exec(value)
    if (m && isInputName(m[1])) found.add(m[1])
  }
  walk.full(ast, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') add(node.value)
    else if (node.type === 'TemplateLiteral') add(node.quasis[0].value.cooked ?? '')
  })
  return [...found]
}
