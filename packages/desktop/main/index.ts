// Electron main entry. Creates the AppController composition root once the app
// is ready and manages the window/app lifecycle.

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { AppController } from './appController'

let controller: AppController | null = null

// Product identity so the window, alt-tab, and taskbar grouping show
// "Interview Assistant" rather than the default Electron name, and (on Windows)
// the AppUserModelId matches the installer appId so the taskbar uses the
// installed app's icon (Req 5.3, 5.5). Set before `whenReady` so it applies to
// the first window.
app.setName('Interview Assistant')
if (process.platform === 'win32') app.setAppUserModelId('ai.interviewassistant.desktop')

app.whenReady().then(() => {
  const preloadPath = join(__dirname, '../preload/index.mjs')
  controller = new AppController(preloadPath)
  controller.initialize()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) controller?.recreateWindowIfNeeded()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  controller?.dispose()
})
