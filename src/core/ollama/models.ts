/** `qwen2.5vl` and `qwen2.5vl:latest` are the same model: Ollama adds `:latest` when no tag is given. */
const withTag = (name: string) => (name.includes(':') ? name : `${name}:latest`);

/** Whether `name` is one of the installed `models` (as listed by `OllamaStatus.models`). Pure, so the renderer can use it too. */
export const isModelInstalled = (models: readonly string[], name: string): boolean => models.some((m) => withTag(m) === withTag(name.trim()));

/** Where people get Ollama. The only external address Filey opens for it; the renderer cannot pass another one. */
export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';
