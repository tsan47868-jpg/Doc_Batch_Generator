import type { GeminiAttempt } from '@/lib/gemini';

const MODEL = 'openrouter/free';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TRANSIENT = [500, 502, 503, 504];

type OpenRouterResponse = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: { content?: string | null };
  }>;
};

type OpenRouterOptions = {
  onAttempt?: (attempt: GeminiAttempt) => Promise<void>;
};

export async function openrouterJson<T>(
  apiKey: string,
  prompt: string,
  schema: object,
  temperature = 0.9,
  attempts = 4,
  options: OpenRouterOptions = {},
): Promise<T> {
  let lastError: Error = new Error('OpenRouter request failed');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{
            role: 'user',
            content: `${prompt}\n\nReturn only valid JSON matching this schema: ${JSON.stringify(schema)}`,
          }],
          response_format: { type: 'json_object' },
          temperature,
          max_tokens: 16384,
        }),
      });
    } catch (error) {
      await options.onAttempt?.({
        model: MODEL,
        httpStatus: null,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });
      throw error;
    }

    if (!response.ok) {
      let message = `OpenRouter API error ${response.status}`;
      try {
        const errorBody = (await response.json()) as {
          error?: { message?: string };
        };
        if (errorBody.error?.message) message = errorBody.error.message;
      } catch {
        message += '; OpenRouter returned an unreadable error response.';
      }

      await options.onAttempt?.({
        model: MODEL,
        httpStatus: response.status,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });

      lastError = new Error(message);
      if ((TRANSIENT.includes(response.status) || response.status === 429) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        continue;
      }
      throw lastError;
    }

    let data: OpenRouterResponse;
    try {
      data = (await response.json()) as OpenRouterResponse;
    } catch {
      await options.onAttempt?.({
        model: MODEL,
        httpStatus: response.status,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });
      lastError = new Error('OpenRouter returned an unreadable response. Please try again.');
      if (attempt < attempts) continue;
      throw lastError;
    }

    const usage = data.usage;
    const usageCounts = {
      promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      candidateTokens:
        typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0,
      totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0,
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';

    if (!text) {
      await options.onAttempt?.({
        model: data.model || MODEL,
        httpStatus: response.status,
        ...usageCounts,
        success: false,
      });
      lastError = new Error('OpenRouter returned an empty response. Please try again.');
      if (attempt < attempts) continue;
      throw lastError;
    }

    let result: T;
    try {
      result = JSON.parse(text) as T;
    } catch {
      await options.onAttempt?.({
        model: data.model || MODEL,
        httpStatus: response.status,
        ...usageCounts,
        success: false,
      });
      lastError = new Error('OpenRouter returned malformed JSON. Please try again.');
      if (attempt < attempts) continue;
      throw lastError;
    }

    await options.onAttempt?.({
      model: data.model || MODEL,
      httpStatus: response.status,
      ...usageCounts,
      success: true,
    });
    return result;
  }

  throw lastError;
}
