// 沙箱 preload：仅暴露 covers 目录列表查询（安全最小面）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('coversAPI', {
  list: () => ipcRenderer.invoke('covers:list'),
})
