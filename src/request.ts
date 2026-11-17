import type { JevAnswer, JevQuestions, JevResponse, JevState } from './types.js';

export const CLEF_MODEL_ID = '@cf/cloudflare/clef';
export const DEFAULT_MODEL = 'clef';
/** Clef accepts at most 64 questions per request; each call asks two. */
export const MAX_QUESTIONS_PER_REQUEST = 64;

export function workersAiUrl(accountId: string, modelId: string = CLEF_MODEL_ID): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelId}`;
}

export interface JevRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** The HTTP request for one Clef call on Workers AI, for any fetch-like transport. */
export function buildJevRequest(
  params: {
    apiKey: string;
    accountId?: string;
    model?: string;
    /** Full endpoint URL; overrides the one built from `accountId`. */
    baseUrl?: string;
  },
  state: JevState,
  questions: JevQuestions,
): JevRequest {
  const model = params.model ?? DEFAULT_MODEL;
  let url = params.baseUrl;
  if (!url) {
    if (!params.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is not configured');
    url = workersAiUrl(params.accountId, `@cf/cloudflare/${model}`);
  }
  return {
    url,
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, state, questions }),
  };
}

/**
 * Validates a Clef response body; throws on anything but an `answers` object.
 * Workers AI REST wraps the model output as `{ success, result, errors }`.
 */
export function parseJevResponse(
  status: number,
  ok: boolean,
  text: string,
): JevResponse {
  if (!ok) {
    throw new Error(`Clef request failed (${status}): ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Clef returned malformed JSON');
  }
  if (parsed !== null && typeof parsed === 'object' && 'result' in parsed) {
    const envelope = parsed as { success?: boolean; result?: unknown; errors?: unknown };
    if (envelope.success === false) {
      throw new Error(`Clef request failed: ${JSON.stringify(envelope.errors).slice(0, 200)}`);
    }
    parsed = envelope.result;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('answers' in parsed) ||
    parsed.answers === null ||
    typeof parsed.answers !== 'object'
  ) {
    throw new Error('Clef response is missing answers');
  }
  return parsed as JevResponse;
}

/** The `noul` probability of one answer (a bare number or `{ noul }`); throws when it is not there. */
export function noulAnswer(
  answers: Record<string, JevAnswer | number>,
  name: string,
): number {
  const answer = answers[name];
  const value =
    typeof answer === 'number'
      ? answer
      : answer && typeof answer === 'object' && 'noul' in answer
        ? answer.noul
        : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid Clef answer for ${name}`);
  }
  return value;
}
