// The environment variables a generated script reads. The recorder container
// gets none of this machine's environment, so the app shows a field for each
// of these and passes the values in with `docker run -e`.
import * as walk from 'acorn-walk'
import { parse } from './safety.js'

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// Set by the recorder image or Docker; a script reading these isn't asking to
// be configured.
const PROVIDED = new Set(['HOME', 'PATH', 'PWD', 'HOSTNAME', 'CONVERT_MP4', 'PUPPETEER_CACHE_DIR', 'NODE_VERSION', 'YARN_VERSION'])

// [{ name, fallback, computed }] in order of first use. The fallback is the
// literal the script uses when the variable is unset (after || or ??, or a
// destructuring default), or '' when there is none. When the default is code
// instead, such as `${APP_URL}/login`, computed is its source and fallback ''.
export function scriptEnvVars(code) {
  let ast
  try {
    ast = parse(code)
  } catch {
    return []
  }
  const found = new Map()
  const add = (name, defaults) => {
    if (typeof name !== 'string' || !ENV_NAME.test(name) || PROVIDED.has(name)) return
    const fallback = (defaults.length === 1 && literal(defaults[0].node)) || ''
    const computed = fallback || !defaults.length ? '' : defaults.map((d, i) => (i ? ` ${d.operator} ` : '') + source(code, d.node)).join('')
    const known = found.get(name)
    if (!known) found.set(name, { name, fallback, computed })
    else if (!known.fallback && !known.computed) Object.assign(known, { fallback, computed })
  }

  walk.fullAncestor(ast, (node, _state, ancestors) => {
    if (!isProcessEnv(node)) return
    const parent = ancestors[ancestors.length - 2]
    if (parent?.type === 'MemberExpression' && parent.object === node) {
      // Everything after it in `process.env.A || process.env.B || 'b'`.
      const defaults = []
      let read = parent
      for (let i = ancestors.length - 3; i >= 0; i--) {
        const up = ancestors[i]
        if (up.type !== 'LogicalExpression' || up.left !== read || !['||', '??'].includes(up.operator)) break
        defaults.push({ node: up.right, operator: up.operator })
        read = up
      }
      add(parent.computed ? literal(parent.property) : parent.property.name, defaults)
    } else if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'ObjectPattern') {
      for (const prop of parent.id.properties) {
        if (prop.type !== 'Property') continue
        const name = prop.computed ? literal(prop.key) : prop.key.name ?? prop.key.value
        add(name, prop.value.type === 'AssignmentPattern' ? [{ node: prop.value.right }] : [])
      }
    }
  })
  return [...found.values()]
}

function isProcessEnv(node) {
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    node.object.name === 'process' &&
    node.property.name === 'env'
  )
}

function literal(node) {
  if (node?.type === 'Literal' && ['string', 'number'].includes(typeof node.value)) return String(node.value)
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return undefined
}

// A default's code on one line, as a placeholder can only show one.
function source(code, node) {
  return code.slice(node.start, node.end).replace(/\s+/g, ' ')
}
