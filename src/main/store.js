// Tiny JSON-file settings store in the app's userData directory.
//
// NOTE: the GitHub token is stored in plain text. This is a local developer
// tool; prefer a fine-grained, read-only token scoped to the repositories you
// demo from.
import fs from 'node:fs'
import path from 'node:path'

export class Store {
  constructor(app) {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.data = this._read()
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return {}
    }
  }

  _write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  get(key, fallback) {
    return key in this.data ? this.data[key] : fallback
  }

  getAll() {
    return { ...this.data }
  }

  set(patch) {
    this.data = { ...this.data, ...patch }
    this._write()
    return this.data
  }
}
