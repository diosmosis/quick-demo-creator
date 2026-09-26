import { contextBridge, ipcRenderer } from 'electron'

// Main answers { ok, value } / { ok: false, error, data }. That is passed on
// as-is: an Error thrown here would lose `data` crossing the context bridge,
// so src/renderer/src/api.js turns it into a thrown Error on the other side.
const call = (channel, arg) => ipcRenderer.invoke(channel, arg)

// The only surface the renderer can touch.
const api = {
  // settings & session
  getSettings: () => call('settings:get'),
  saveSettings: (patch) => call('settings:set', patch),
  getSession: () => call('session:get'),
  saveSession: (session) => call('session:set', session),

  // environment
  verifyToken: (token) => call('github:verifyToken', token),
  toolVersion: (path) => call('tools:version', { path }),
  selectFolder: () => call('dialog:selectFolder'),
  openPath: (path) => call('shell:openPath', path),

  // stages
  plan: (prUrl) => call('plan:start', { prUrl }),
  generate: (script, prUrl) => call('generate:start', { script, prUrl }),
  checkSafety: (code) => call('safety:check', { code }),
  scriptEnv: (code) => call('script:env', { code }),
  getProjectEnv: (prUrl) => call('projectEnv:get', prUrl),
  setProjectEnv: (prUrl, values) => call('projectEnv:set', { prUrl, values }),
  record: (args) => call('record:start', args),
  buildImage: () => call('image:build'),
  cancel: (stage) => call('job:cancel', stage),

  // streamed output from a running stage; returns an unsubscribe function.
  onJobEvent: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('job:event', listener)
    return () => ipcRenderer.removeListener('job:event', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
