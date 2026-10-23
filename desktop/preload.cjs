const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kumonDesktop', Object.freeze({
  info: () => ipcRenderer.invoke('kumon:desktop-info'),
  printHtml: (html) => ipcRenderer.invoke('kumon:print-html', html),
  setKsisBounds: (value) => ipcRenderer.send('kumon:ksis-bounds', {
    x: value?.x, y: value?.y, width: value?.width, height: value?.height, visible: value?.visible === true
  })
}));
