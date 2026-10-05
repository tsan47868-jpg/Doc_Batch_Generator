const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const TRANSIENT = [500, 503, 504];

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

export async function geminiJson<T>(
  apiKey: string,
  prompt: string,
  schema: object,
  temperature = 0.9,
  attempts = 4,
  options: GeminiJsonOptions = {},
): Promise<T> {
  let lastError: Error = new Error('Gemini request failed');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${MODEL}:generateContent`, {
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
        model: MODEL,
        httpStatus: null,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });
      throw error;
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
        model: MODEL,
        httpStatus: res.status,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });

      if (res.status === 429 && (dailyQuota || retryDelaySeconds > 120)) {
        const resets = retryDelaySeconds > 0 ? ` — it resets in about ${formatDelay(retryDelaySeconds)}` : '';
        throw new Error(
          `Gemini quota reached for this API key${resets}. The free tier allows 20 requests/day per model, and one batch uses 11 (1 plan + 10 documents).`,
        );
      }

      lastError = new Error(message);
      if ((TRANSIENT.includes(res.status) || res.status === 429) && attempt < attempts) {
        const delayMs = retryDelaySeconds > 0 ? Math.min(retryDelaySeconds * 1000, 15_000) : attempt * 5000;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw lastError;
    }

    let data: GeminiResponse;
    try {
      data = (await res.json()) as GeminiResponse;
    } catch {
      await options.onAttempt?.({
        model: MODEL,
        httpStatus: res.status,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        success: false,
      });
      lastError = new Error('Gemini returned an unreadable response. Please try again.');
      if (attempt < attempts) continue;
      throw lastError;
    }
    const usage = data.usageMetadata;
    const usageCounts = {
      promptTokens:
        typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0,
      candidateTokens:
        typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0,
      totalTokens: typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : 0,
    };
    const text: string =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || '')
        .join('') || '';

    if (!text) {
      await options.onAttempt?.({
        model: MODEL,
        httpStatus: res.status,
        ...usageCounts,
        success: false,
      });
      lastError = new Error(
        data.candidates?.[0]?.finishReason === 'SAFETY'
          ? 'Gemini blocked the response for safety reasons. Try a different sample or instructions.'
          : 'Gemini returned an empty response. Please try again.',
      );
      if (attempt < attempts) continue;
      throw lastError;
    }

    let result: T;
    try {
      result = JSON.parse(text) as T;
    } catch {
      await options.onAttempt?.({
        model: MODEL,
        httpStatus: res.status,
        ...usageCounts,
        success: false,
      });
      lastError = new Error('Gemini returned malformed JSON. Please try again.');
      if (attempt < attempts) continue;
      throw lastError;
    }

    await options.onAttempt?.({
      model: MODEL,
      httpStatus: res.status,
      ...usageCounts,
      success: true,
    });
    return result;
  }

  throw lastError;
}
