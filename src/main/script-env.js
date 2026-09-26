// The environment variables a generated script reads. The recorder container
// gets none of this machine's environment, so the app shows a field for each
// of these and passes the values in with `docker run -e`.
import * as walk from 'acorn-walk'
import { parse } from './safety.js'

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// Set by the recorder image or Docker; a script reading these isn't asking to
// be configured.
const PROVIDED = new Set(['HOME', 'PATH', 'PWD', 'HOSTNAME', 'CONVERT_MP4', 'PUPPETEER_CACHE_DIR', 'NODE_VERSION', 'YARN_VERSION'])

// [{ name, fallback }] in order of first use. The fallback is the literal the
// script uses when the variable is unset (after || or ??, or a destructuring
// default), or '' when there is none.
export function scriptEnvVars(code) {
  let ast
  try {
    ast = parse(code)
  } catch {
    return []
  }
  const found = new Map()
  const add = (name, fallbackNode) => {
    if (typeof name !== 'string' || !ENV_NAME.test(name) || PROVIDED.has(name)) return
    const fallback = literal(fallbackNode) ?? ''
    const known = found.get(name)
    if (!known) found.set(name, { name, fallback })
    else if (!known.fallback) known.fallback = fallback
  }

  walk.fullAncestor(ast, (node, _state, ancestors) => {
    if (!isProcessEnv(node)) return
    const parent = ancestors[ancestors.length - 2]
    if (parent?.type === 'MemberExpression' && parent.object === node) {
      const grand = ancestors[ancestors.length - 3]
      const defaulted = grand?.type === 'LogicalExpression' && grand.left === parent && ['||', '??'].includes(grand.operator)
      add(parent.computed ? literal(parent.property) : parent.property.name, defaulted ? grand.right : null)
    } else if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'ObjectPattern') {
      for (const prop of parent.id.properties) {
        if (prop.type !== 'Property') continue
        const name = prop.computed ? literal(prop.key) : prop.key.name ?? prop.key.value
        add(name, prop.value.type === 'AssignmentPattern' ? prop.value.right : null)
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
