export const GENERATION_MODES = [
  { id: 'gemini-1', label: 'Gemini API 1' },
  { id: 'gemini-2', label: 'Gemini API 2' },
  { id: 'gemini-3', label: 'Gemini API 3' },
  { id: 'openrouter-free', label: 'OpenRouter free models' },
] as const;

export type GenerationMode = (typeof GENERATION_MODES)[number]['id'];

export function isGenerationMode(value: string): value is GenerationMode {
  return GENERATION_MODES.some((mode) => mode.id === value);
}
