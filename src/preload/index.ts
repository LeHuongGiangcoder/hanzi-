import { contextBridge, ipcRenderer } from 'electron';

const api = {
  question: () => ipcRenderer.invoke('session:question'),
  answer: (wordId: number, raw: string, choice?: number) =>
    ipcRenderer.invoke('session:answer', { wordId, raw, choice }),
  report: (p: Record<string, unknown>) => ipcRenderer.invoke('session:report', p),
  snooze: () => ipcRenderer.invoke('session:snooze'),
  surrender: (typed: string) => ipcRenderer.invoke('session:surrender', { typed }),
  stats: () => ipcRenderer.invoke('stats:get'),
  composing: (on: boolean) => ipcRenderer.invoke('window:composing', on),
  openDrill: () => ipcRenderer.invoke('window:open-drill'),
  onProgress: (cb: (p: unknown) => void) =>
    ipcRenderer.on('progress', (_e, p) => cb(p)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', { key, value }),
};
contextBridge.exposeInMainWorld('hanzi', api);
export type HanziApi = typeof api;
