// Small string helpers shared by the stages.

// Splits a command-line style string into arguments. Understands single and
// double quotes and backslash escapes, which is all the argument fields need —
// nothing here is ever handed to a shell.
export function splitArgs(input) {
  const args = []
  let current = ''
  let inArg = false
  let quote = null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < input.length) current += input[++i]
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inArg = true
    } else if (ch === '\\' && i + 1 < input.length) {
      current += input[++i]
      inArg = true
    } else if (/\s/.test(ch)) {
      if (inArg) args.push(current)
      current = ''
      inArg = false
    } else {
      current += ch
      inArg = true
    }
  }
  if (quote) throw new Error(`Unterminated ${quote} quote in: ${input}`)
  if (inArg) args.push(current)
  return args
}

// Replaces {NAME} placeholders. Uses split/join rather than String#replace so
// `$&` and friends in the values are left alone.
export function fillTemplate(template, vars) {
  let out = template
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{${name}}`).join(value)
  }
  return out
}

const CODE_LANGS = new Set(['', 'js', 'javascript', 'mjs', 'cjs', 'node', 'ts', 'typescript'])

// Pulls the script out of Claude's answer: the longest JavaScript code fence,
// else the longest fence of any kind, else the whole answer.
export function extractCode(answer) {
  const fences = [...answer.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)\n```/g)].map((m) => ({
    lang: m[1].toLowerCase(),
    code: m[2]
  }))
  const longest = (list) => list.reduce((a, b) => (b.code.length > a.code.length ? b : a)).code
  const js = fences.filter((f) => CODE_LANGS.has(f.lang))
  if (js.length) return longest(js)
  if (fences.length) return longest(fences)
  return answer.trim()
}

// A generated script written with require() has to run as CommonJS.
export function scriptExtension(code) {
  const usesImport = /^\s*import\s[^(]/m.test(code) || /^\s*export\s/m.test(code)
  const usesRequire = /\brequire\s*\(/.test(code)
  return usesRequire && !usesImport ? '.cjs' : '.mjs'
}

export function truncate(text, max, note) {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n\n[… ${note}: ${text.length - max} more characters omitted]`
}
