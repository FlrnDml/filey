import { contextBridge, ipcRenderer } from 'electron';
import { PAGE_RENDERER_CHANNELS, type PdfRendererBridge, type RenderRequest, type RenderResponse } from './protocol';

/** The only thing the page-renderer window can do: receive render requests and answer them. */
const bridge: PdfRendererBridge = {
  onRequest(listener) {
    ipcRenderer.on(PAGE_RENDERER_CHANNELS.request, (_event, request: RenderRequest) => listener(request));
  },
  respond(response: RenderResponse) {
    ipcRenderer.send(PAGE_RENDERER_CHANNELS.result, response);
  },
};

contextBridge.exposeInMainWorld('pdfRenderer', bridge);
