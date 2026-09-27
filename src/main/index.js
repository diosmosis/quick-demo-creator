import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { Store } from './store.js'
import { registerIpc } from './ipc.js'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Quick Demo Creator',
    backgroundColor: '#16171c',
    // Linux window managers take the taskbar/panel icon from the window itself
    // (_NET_WM_ICON), not the .desktop entry. nativeImage can't read SVG, hence
    // a PNG rendering of assets/icon.svg.
    icon: path.join(__dirname, '../../assets/icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Start maximized. Wait for the first paint so the window doesn't flash at
  // its default size before expanding.
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  // Open external links in the system browser rather than a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const store = new Store(app)
  registerIpc(app, store)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
