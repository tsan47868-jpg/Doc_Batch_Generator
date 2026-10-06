const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const TRANSIENT = [500, 502, 503, 504];

type Provider = 'gemini' | 'openrouter';

const DOWN_COOLDOWN_MS = 60_000;
const AUTH_COOLDOWN_MS = 10 * 60_000;
const QUOTA_COOLDOWN_MS = 30 * 60_000;

const providerAvailableUntil: Record<Provider, number> = { gemini: 0, openrouter: 0 };

function markProviderUnavailable(provider: Provider, ms: number): void {
  const until = Date.now() + Math.max(ms, 0);
  if (until > providerAvailableUntil[provider]) {
    providerAvailableUntil[provider] = until;
  }
}

function isProviderAvailable(provider: Provider): boolean {
  return Date.now() >= providerAvailableUntil[provider];
}

export type GeminiAttempt = {
  model: string;
  httpStatus: number | null;
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
  success: boolean;
};

type GeminiResponse = {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
};

type OpenRouterResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: number | string;
  };
};

type GeminiJsonOptions = {
  onAttempt?: (attempt: GeminiAttempt) => Promise<void>;
};

export class GeminiQuotaError extends Error {}

function formatDelay(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function safeParseJson<T>(raw: string): T {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let start = -1;
    let end = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = cleaned.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = cleaned.lastIndexOf(']');
    }
    if (start !== -1 && end > start) {
      const sub = cleaned.slice(start, end + 1);
      try {
        return JSON.parse(sub) as T;
      } catch {
        const sanitized = sub.replace(/(?<!\\)[\r\n\t]/g, (match) => {
          if (match === '\n') return '\\n';
          if (match === '\r') return '\\r';
          if (match === '\t') return '\\t';
          return '';
        });
        return JSON.parse(sanitized) as T;
      }
    }
    throw new Error('Malformed JSON output');
  }
}

async function openRouterJson<T>(
  prompt: string,
  schema: object,
  temperature = 0.8,
  attempts = 3,
  options: GeminiJsonOptions = {},
): Promise<T> {
  const apiKey = OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  let lastError: Error = new Error('OpenRouter request failed');
  const schemaStr = JSON.stringify(schema, null, 2);
  const systemInstruction = `You are a precise document generation assistant. You MUST respond ONLY with valid JSON matching this schema:\n${schemaStr}\nDo not wrap output in markdown fences. Output raw valid JSON.`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://docbatchgenerator.com',
          'X-Title': 'Doc Batch Generator',
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 8192,
          temperature,
        }),
      });
    } catch (error) {
      await options.onAttempt?.({
        model: `openrouter/${OPENROUTER_MODEL}`,
        httpStatus: null,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });
      lastError = error instanceof Error ? error : new Error('Network error calling OpenRouter');
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      markProviderUnavailable('openrouter', DOWN_COOLDOWN_MS);
      throw lastError;
    }

    if (!res.ok) {
      let message = `OpenRouter API error ${res.status}`;
      try {
        const err = (await res.json()) as OpenRouterResponse;
        message = err?.error?.message || message;
      } catch {
        // use default message
      }

      await options.onAttempt?.({
        model: `openrouter/${OPENROUTER_MODEL}`,
        httpStatus: res.status,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });

      lastError = new Error(message);
      if ((TRANSIENT.includes(res.status) || res.status === 429) && attempt < attempts) {
        await new Promise((r) => setTimeout(r, attempt * 3000));
        continue;
      }
      if (TRANSIENT.includes(res.status) || res.status === 429) {
        markProviderUnavailable('openrouter', DOWN_COOLDOWN_MS);
      } else if (res.status === 401 || res.status === 402 || res.status === 403) {
        markProviderUnavailable('openrouter', AUTH_COOLDOWN_MS);
      }
      throw lastError;
    }

    let data: OpenRouterResponse;
    try {
      data = (await res.json()) as OpenRouterResponse;
    } catch {
      await options.onAttempt?.({
        model: `openrouter/${OPENROUTER_MODEL}`,
        httpStatus: res.status,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });
      lastError = new Error('OpenRouter returned an unreadable response.');
      if (attempt < attempts) continue;
      throw lastError;
    }

    const usageCounts = {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      candidateTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    };

    const text = data.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
      await options.onAttempt?.({
        model: `openrouter/${OPENROUTER_MODEL}`,
        httpStatus: res.status,
        ...usageCounts,
        success: false,
      });
      lastError = new Error('OpenRouter returned an empty response.');
      if (attempt < attempts) continue;
      throw lastError;
    }

    try {
      const result = safeParseJson<T>(text);
      await options.onAttempt?.({
        model: `openrouter/${data.model || OPENROUTER_MODEL}`,
        httpStatus: res.status,
        ...usageCounts,
        success: true,
      });
      return result;
    } catch {
      await options.onAttempt?.({
        model: `openrouter/${OPENROUTER_MODEL}`,
        httpStatus: res.status,
        ...usageCounts,
        success: false,
      });
      lastError = new Error('OpenRouter returned malformed JSON.');
      if (attempt < attempts) continue;
      throw lastError;
    }
  }

  throw lastError;
}

async function geminiJsonOnce<T>(
  apiKey: string,
  prompt: string,
  schema: object,
  temperature = 0.9,
  attempts = 4,
  options: GeminiJsonOptions = {},
): Promise<T> {
  let lastError: Error = new Error('Generation request failed');

  // Attempt Google Gemini; on failure the caller falls through to OpenRouter.
  if (apiKey) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature,
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        });
      } catch (error) {
        await options.onAttempt?.({
          model: GEMINI_MODEL,
          httpStatus: null,
          promptTokens: 0,
          candidateTokens: 0,
          totalTokens: 0,
          success: false,
        });
        lastError = error instanceof Error ? error : new Error('Gemini network error');
        markProviderUnavailable('gemini', DOWN_COOLDOWN_MS);
        break; // break loop to try fallback
      }

      if (!res.ok) {
        let message = `Gemini API error ${res.status}`;
        let retryDelaySeconds = 0;
        let dailyQuota = false;
        try {
          const err = await res.json();
          message = err?.error?.message || message;
          const details = err?.error?.details;
          if (Array.isArray(details)) {
            for (const d of details) {
              if (typeof d?.retryDelay === 'string') {
                const secs = parseFloat(d.retryDelay);
                if (Number.isFinite(secs)) retryDelaySeconds = Math.max(retryDelaySeconds, secs);
              }
              if (Array.isArray(d?.violations)) {
                for (const v of d.violations) {
                  if (typeof v?.quotaId === 'string' && /PerDay/i.test(v.quotaId)) dailyQuota = true;
                }
              }
            }
          }
          if (!retryDelaySeconds) {
            const m = /retry in ([\d.]+)s/i.exec(message);
            if (m) retryDelaySeconds = parseFloat(m[1]);
          }
        } catch {
          message = `${message}; Gemini returned an unreadable error response.`;
        }

        await options.onAttempt?.({
          model: GEMINI_MODEL,
          httpStatus: res.status,
          promptTokens: 0,
          candidateTokens: 0,
          totalTokens: 0,
          success: false,
        });

        if (res.status === 429 && (dailyQuota || retryDelaySeconds > 120)) {
          const resets = retryDelaySeconds > 0 ? ` — it resets in about ${formatDelay(retryDelaySeconds)}` : '';
          lastError = new GeminiQuotaError(
            `Gemini quota reached for this API key${resets}.`,
          );
          markProviderUnavailable(
            'gemini',
            retryDelaySeconds > 0 ? retryDelaySeconds * 1000 : QUOTA_COOLDOWN_MS,
          );
          break; // break to fallback
        }

        lastError = new Error(message);
        if ((TRANSIENT.includes(res.status) || res.status === 429) && attempt < attempts) {
          const delayMs = retryDelaySeconds > 0 ? Math.min(retryDelaySeconds * 1000, 15_000) : attempt * 5000;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        if (TRANSIENT.includes(res.status) || res.status === 429) {
          markProviderUnavailable('gemini', DOWN_COOLDOWN_MS);
        }
        break; // break to fallback
      }

      let data: GeminiResponse;
      try {
        data = (await res.json()) as GeminiResponse;
      } catch {
        await options.onAttempt?.({
          model: GEMINI_MODEL,
          httpStatus: res.status,
          promptTokens: 0,
          candidateTokens: 0,
          totalTokens: 0,
          success: false,
        });
        lastError = new Error('Gemini returned an unreadable response.');
        if (attempt < attempts) continue;
        break;
      }

      const usage = data.usageMetadata;
      const usageCounts = {
        promptTokens: typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0,
        candidateTokens: typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0,
        totalTokens: typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : 0,
      };

      const text: string =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join('') || '';

      if (!text) {
        await options.onAttempt?.({
          model: GEMINI_MODEL,
          httpStatus: res.status,
          ...usageCounts,
          success: false,
        });
        lastError = new Error(
          data.candidates?.[0]?.finishReason === 'SAFETY'
            ? 'Gemini blocked the response for safety reasons.'
            : 'Gemini returned an empty response.',
        );
        if (attempt < attempts) continue;
        break;
      }

      try {
        const result = safeParseJson<T>(text);
        await options.onAttempt?.({
          model: GEMINI_MODEL,
          httpStatus: res.status,
          ...usageCounts,
          success: true,
        });
        return result;
      } catch {
        await options.onAttempt?.({
          model: GEMINI_MODEL,
          httpStatus: res.status,
          ...usageCounts,
          success: false,
        });
        lastError = new Error('Gemini returned malformed JSON.');
        if (attempt < attempts) continue;
        break;
      }
    }
  }

  throw lastError;
}

export async function geminiJson<T>(
  apiKey: string,
  prompt: string,
  schema: object,
  temperature = 0.9,
  attempts = 4,
  options: GeminiJsonOptions = {},
): Promise<T> {
  const hasGeminiKey = Boolean(apiKey && apiKey.trim() && !apiKey.startsWith('AQ.'));
  const hasOpenRouterKey = Boolean(OPENROUTER_API_KEY && OPENROUTER_API_KEY.trim());

  let candidates: Provider[] = [];
  if (hasGeminiKey && hasOpenRouterKey) {
    const geminiUp = isProviderAvailable('gemini');
    const openRouterUp = isProviderAvailable('openrouter');
    if (geminiUp && openRouterUp) {
      candidates = ['gemini', 'openrouter'];
    } else if (geminiUp) {
      candidates = ['gemini'];
      console.warn('openrouter is cooling down; using gemini.');
    } else if (openRouterUp) {
      candidates = ['openrouter'];
      console.warn('gemini is cooling down; using openrouter.');
    } else {
      // Both are cooling down — attempt them anyway rather than failing outright.
      candidates = ['gemini', 'openrouter'];
    }
  } else if (hasGeminiKey) {
    candidates = ['gemini'];
  } else if (hasOpenRouterKey) {
    candidates = ['openrouter'];
  }

  let lastError: Error = new Error('Generation request failed');

  for (const provider of candidates) {
    try {
      if (provider === 'gemini') {
        const result = await geminiJsonOnce<T>(apiKey, prompt, schema, temperature, attempts, options);
        providerAvailableUntil.gemini = 0;
        return result;
      }
      const result = await openRouterJson<T>(prompt, schema, temperature, attempts, options);
      providerAvailableUntil.openrouter = 0;
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`${provider} request failed`);
      console.error(`${provider} failed, falling through to the next provider:`, lastError.message);
    }
  }

  throw lastError;
}
