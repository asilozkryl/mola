const { contextBridge, ipcRenderer } = require('electron');

// This preload is attached only to packaged local screens, never the Mola server.
contextBridge.exposeInMainWorld('molaDesktop', Object.freeze({
  getState: () => ipcRenderer.invoke('desktop:state'),
  connect: (serverUrl) => ipcRenderer.invoke('desktop:connect', serverUrl),
  getSources: () => ipcRenderer.invoke('desktop:sources'),
  selectSource: (sourceId) => ipcRenderer.invoke('desktop:select-source', sourceId),
}));
