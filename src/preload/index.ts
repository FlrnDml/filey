import { contextBridge, ipcRenderer } from 'electron';
import { FILEY_API_KEY } from '../core/ipc';
import { createFileyApi } from './api';

contextBridge.exposeInMainWorld(FILEY_API_KEY, createFileyApi(ipcRenderer));
