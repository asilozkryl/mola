const { contextBridge, ipcRenderer } = require('electron');

// This preload is attached only to packaged local screens, never the Mola server.
contextBridge.exposeInMainWorld('molaDesktop', Object.freeze({
  getState: () => ipcRenderer.invoke('desktop:state'),
  connect: (serverUrl) => ipcRenderer.invoke('desktop:connect', serverUrl),
  getSources: () => ipcRenderer.invoke('desktop:sources'),
  selectSource: (sourceId) => ipcRenderer.invoke('desktop:select-source', sourceId),
  getUpdateState: () => ipcRenderer.invoke('desktop:updates:state'),
  checkUpdates: () => ipcRenderer.invoke('desktop:updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:updates:download'),
  cancelUpdate: () => ipcRenderer.invoke('desktop:updates:cancel'),
  installUpdate: () => ipcRenderer.invoke('desktop:updates:install'),
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Güncelleme dinleyicisi geçersiz.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:updates:state', listener);
    return () => ipcRenderer.removeListener('desktop:updates:state', listener);
  },
}));
