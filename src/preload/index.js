import { contextBridge, ipcRenderer, webUtils } from 'electron'

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
  selectFiles: () => call('dialog:selectFiles'),
  selectAudio: () => call('dialog:selectAudio'),
  // The path of a file dropped on the page. Synchronous and local, so it is
  // not wrapped like the calls above.
  pathForFile: (file) => webUtils.getPathForFile(file),
  openPath: (path) => call('shell:openPath', path),
  openExternal: (url) => call('shell:openExternal', url),

  // stages
  plan: (prUrl) => call('plan:start', { prUrl }),
  generate: (script, prUrl) => call('generate:start', { script, prUrl }),
  checkSafety: (code) => call('safety:check', { code }),
  scriptEnv: (code) => call('script:env', { code }),
  scriptFiles: (code) => call('script:files', { code }),
  getProjectFiles: (prUrl) => call('projectFiles:get', prUrl),
  setProjectFiles: (prUrl, files) => call('projectFiles:set', { prUrl, files }),
  getProjectEnv: (prUrl) => call('projectEnv:get', prUrl),
  setProjectEnv: (prUrl, values) => call('projectEnv:set', { prUrl, values }),
  listInstances: () => call('instances:list'),
  checkTemplate: (dir) => call('instances:template', dir),
  createInstance: (args) => call('instances:create', args),
  ddev: (name, args) => call('instances:ddev', { name, args }),
  setVolumes: (name, volumes) => call('instances:setVolumes', { name, volumes }),
  removeInstance: (name) => call('instances:remove', { name }),
  editInstance: (name) => call('instances:edit', { name }),
  checkPreconditions: (args) => call('precheck:start', args),
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
