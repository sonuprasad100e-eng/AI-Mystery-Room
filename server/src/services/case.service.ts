import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { CaseModel } from '../models/Case.model.js';
import { mongoReady } from '../config/db.js';
import { env } from '../config/env.js';
import { seedCase } from './seedCase.js';
import { generatedCaseJsonSchema, TimelineValidationError, validateGeneratedCase } from '../schemas/case.schema.js';
import type { MysteryCase, PublicCase } from '../types.js';

const memory = new Map<string, MysteryCase>([[seedCase._id, seedCase]]);
function id() { return `CASE-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }

export class CaseGenerationError extends Error {
  status = 503;
}

function safeFailure(error: unknown) {
  const err = error as { name?: string; message?: string; status?: number; code?: string; path?: string; issues?: { path: PropertyKey[]; code: string; message: string }[] };
  const rawMessage = typeof err?.message === 'string' ? err.message : 'Unknown error.';
  let providerError: { code?: number | string; status?: string; message?: string } | undefined;
  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed && typeof parsed.error === 'object') providerError = parsed.error;
  } catch { /* SDK may wrap the JSON provider body in a status message. */ }
  const httpMatch = /HTTP\s+(\d{3})\s+([A-Z_]+)/i.exec(rawMessage);
  const retryableMatch = /Retryable HTTP Error:\s*(Request Timeout|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i.exec(rawMessage);
  const retryableStatuses: Record<string, [number, string]> = {
    'request timeout': [408, 'DEADLINE_EXCEEDED'],
    'too many requests': [429, 'RESOURCE_EXHAUSTED'],
    'internal server error': [500, 'INTERNAL'],
    'bad gateway': [502, 'BAD_GATEWAY'],
    'service unavailable': [503, 'UNAVAILABLE'],
    'gateway timeout': [504, 'DEADLINE_EXCEEDED'],
  };
  const mappedRetryable = retryableMatch ? retryableStatuses[retryableMatch[1].toLowerCase()] : undefined;
  const status = typeof err?.status === 'number'
    ? err.status
    : typeof providerError?.code === 'number'
      ? providerError.code
      : httpMatch ? Number(httpMatch[1]) : mappedRetryable?.[0] ?? null;
  const code = typeof providerError?.status === 'string'
    ? providerError.status
    : typeof err?.code === 'string' ? err.code : httpMatch?.[2] || mappedRetryable?.[1] || null;
  const safeProviderMessage = typeof providerError?.message === 'string' ? providerError.message : rawMessage;
  const details = err?.name === 'ZodError' && Array.isArray(err.issues)
    ? err.issues.map(({ path, code: issueCode, message }) => ({ path: path.map(String).join('.'), code: issueCode, message }))
    : error instanceof TimelineValidationError
      ? [{ path: error.path, code: 'custom', message: rawMessage }]
    : safeProviderMessage
      .replace(/AIza[\w-]{15,}/g, '[REDACTED]')
      .replace(/(api[_-]?key\s*[:=]\s*)[^\s,]+/ig, '$1[REDACTED]')
      .replace(/https?:\/\/[^\s"']+/g, '[URL REDACTED]')
      .slice(0, 500);
  return { status, code, details };
}

function timelineFailureDiagnostics(raw: unknown, error: unknown) {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const events = record.timelineSummary;
  const err = error as { name?: string; path?: string; issues?: { path: PropertyKey[]; message: string }[] };
  const paths = err?.name === 'ZodError' && Array.isArray(err.issues)
    ? err.issues
      .filter(({ path }) => path[0] === 'timelineSummary')
      .map(({ path, message }) => ({ path: path.map(String).join('.'), message }))
    : error instanceof TimelineValidationError
      ? [{ path: error.path, message: error.message }]
      : [];
  if (!paths.length) return undefined;
  const values = Array.isArray(events)
    ? events.slice(0, 6).map((value, index) => ({
      path: `timelineSummary.${index}`,
      value: typeof value === 'string' ? value.slice(0, 500) : `[${typeof value}]`,
    }))
    : [{ path: 'timelineSummary', value: `[${typeof events}]` }];
  const incidentTimestamp = paths.some(({ message }) => message.includes('incidentTimestamp'))
    ? record.incidentTimestamp
    : undefined;
  return { paths, values, ...(typeof incidentTimestamp === 'string' ? { incidentTimestamp } : {}) };
}

function providerFailureMessage(failure: ReturnType<typeof safeFailure>) {
  switch (failure.status) {
    case 400: return 'Gemini rejected the generation request (INVALID_ARGUMENT). Check the model request configuration.';
    case 401: return 'Gemini authentication failed. Check GEMINI_API_KEY.';
    case 402: return 'Gemini billing is unavailable for this project. Check Google AI Studio billing and paid-tier status.';
    case 403: return 'This project is not permitted to use the configured Gemini model. Check model access and paid-tier eligibility.';
    case 404: return 'The configured Gemini model was not found or is unavailable to this project.';
    case 429: {
      const detail = typeof failure.details === 'string' ? failure.details.toLowerCase() : '';
      if (detail.includes('free_tier') || /limit\s*:\s*0/.test(detail)) {
        return 'Gemini generation is unavailable on this API tier. Check free-tier model access and quota.';
      }
      return 'Gemini quota or rate limit reached. Wait or review the project limits.';
    }
    case 503: return 'Gemini is temporarily under high demand. Please try again shortly.';
    case 408:
    case 504: return 'The Gemini request timed out. Please try again.';
    default: return 'The Gemini provider request failed. Check the sanitized backend diagnostic log.';
  }
}

export function sanitize(c: any): PublicCase {
  const { solution, ...publicCase } = c.toObject ? c.toObject() : c;
  return publicCase;
}

export async function listCases() {
  const cases = mongoReady ? await CaseModel.find().sort({ createdAt: -1 }).limit(50) : [...memory.values()];
  return cases.map((c: any) => ({ id: c._id, title: c.title, caseNumber: c.caseNumber, crimeType: c.crimeType, difficulty: c.difficulty, status: c.status, createdAt: c.createdAt }));
}

export async function getCase(caseId: string) {
  return mongoReady ? CaseModel.findById(caseId) : memory.get(caseId) || null;
}

function cleanTitle(title: string) {
  return title.replace(/^the\s+(?=a\s+[a-z])/i, '').replace(/\s+case\s*$/i, '').replace(/[.!?]+$/, '').trim();
}

export async function createCase(prompt: string, difficulty: 'easy' | 'medium' | 'hard') {
  if (!env.geminiKey) throw new CaseGenerationError('Case generation is unavailable because GEMINI_API_KEY is not configured.');
  const ai = new GoogleGenAI({
    apiKey: env.geminiKey,
    httpOptions: { timeout: 20 * 60 * 1000, retryOptions: { attempts: 3 } },
  });
  let generated: ReturnType<typeof validateGeneratedCase> | undefined;
  let lastError = '';
  let lastFailure: ReturnType<typeof safeFailure> | undefined;
  let lastFailureStage: 'provider_request' | 'json_parse' | 'zod_validation' | undefined;
  let retryCorrection = '';
  const maxValidationRetries = 2;

  for (let attempt = 1; attempt <= maxValidationRetries + 1 && !generated; attempt += 1) {
    let stage: 'provider_request' | 'json_parse' | 'zod_validation' = 'provider_request';
    let raw: unknown;
    try {
      const basePrompt = `Write one short fictional mystery for this scenario: ${prompt}\nDifficulty: ${difficulty}. Keep every field about this same incident. Use exactly three suspects and exactly one culprit. Make non-culprit alibis fit the timeline; explain the culprit's contradiction in the solution. The solution.alibiContradiction field must include the culprit's exact full name as written in suspects[].name and explain the contradiction. Choose incidentTimestamp first and use its exact YYYY-MM-DD date for every ISO UTC message, photo, and CCTV frame timestamp; never use another evidence date. TimelineSummary HH:mm times are UTC times on that same incident date. Create 3-5 timelineSummary entries as strings, in chronological order. Every entry must start exactly with a valid 24-hour UTC time in HH:mm followed by " - " and its description; use times from the incident date, and include the UTC time of incidentTimestamp. Valid: "21:30 - The security guard enters the gallery." Valid: "22:05 - The alarm is triggered." Invalid: "9:30 PM - The guard enters." Invalid: "At around 10 PM, the guard enters." At most one message thread with 2-4 messages, exactly two forensic clues, and one CCTV clue with 2-3 timestamped frame descriptions. Keep the title to 2-8 words; do not prefix it with “The A” or suffix it with “Case”. Do not invent media URLs. The required imageUrl and snapshotSvgOrUrl fields must be empty strings because no media provider is configured. videoUrl is optional: omit that property entirely because no real playable video asset exists; do not use an empty string or null. Describe what real generated case-scene images or video should depict in imagePrompt and frame descriptions. Solution must identify one listed suspect and cite existing evidence IDs. Return only the requested JSON.`;
      const result = await ai.models.generateContent({
        model: env.geminiModel,
        contents: retryCorrection ? `${basePrompt}\n\nCorrect the previous timeline validation failure using this exact feedback: ${retryCorrection} Preserve the mystery's incident facts, suspects, evidence relationships, culprit, chronology, and solution while correcting the timeline.` : basePrompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: generatedCaseJsonSchema(),
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      stage = 'json_parse';
      raw = JSON.parse(result.text || 'null');
      stage = 'zod_validation';
      generated = validateGeneratedCase(raw);
    } catch (error) {
      const failure = safeFailure(error);
      const timelineDiagnostics = stage === 'zod_validation' ? timelineFailureDiagnostics(raw, error) : undefined;
      lastFailure = failure;
      lastFailureStage = stage;
      console.warn('[case-generation] attempt failed', {
        attempt, stage, model: env.geminiModel,
        ...(timelineDiagnostics
          ? { status: failure.status, code: failure.code, details: timelineDiagnostics.paths, timelineDiagnostics }
          : failure),
      });
      lastError = `${stage}: ${Array.isArray(failure.details) ? failure.details.map((item) => `${item.path || '(root)'}: ${item.message}`).join('; ') : failure.details}`;
      if (timelineDiagnostics && attempt <= maxValidationRetries) {
        retryCorrection = JSON.stringify(timelineDiagnostics);
      }
      // The SDK retries transient network/5xx errors with backoff. Avoid repeating
      // the same provider request in the outer validation retry loop.
      if (stage === 'provider_request') break;
    }
  }

  if (!generated) {
    if (lastFailureStage === 'provider_request' && lastFailure) {
      throw new CaseGenerationError(providerFailureMessage(lastFailure));
    }
    if (lastFailureStage === 'zod_validation') {
      throw new CaseGenerationError(`Gemini returned a case that failed local Zod validation: ${lastError}.`);
    }
    throw new CaseGenerationError(`Gemini returned invalid JSON: ${lastError}.`);
  }

  const caseId = id();
  const data: MysteryCase = {
    ...generated,
    title: cleanTitle(generated.title),
    _id: caseId,
    userPrompt: prompt,
    difficulty,
    caseNumber: caseId,
    status: 'unsolved',
    attemptsCount: 0,
    createdAt: new Date(),
  };
  if (mongoReady) return CaseModel.create(data);
  memory.set(data._id, data);
  return data;
}

export async function solveCase(caseId: string, suspectId: string, evidenceIds: string[]) {
  const c: any = await getCase(caseId);
  if (!c) return null;
  const solution = c.solution;
  const correct = solution.culpritSuspectId === suspectId;
  const hits = evidenceIds.filter((x) => solution.keyEvidenceIds.includes(x)).length;
  const score = correct ? 70 + Math.round(30 * hits / Math.max(1, solution.keyEvidenceIds.length)) : 0;
  const status = correct ? 'solved' : 'failed';
  if (mongoReady) { c.status = status; c.attemptsCount += 1; await c.save(); }
  else { c.status = status; c.attemptsCount += 1; memory.set(caseId, c); }
  return { correct, score, solution, feedback: correct ? 'Your accusation fits the evidence. The reconstruction follows.' : 'That accusation does not account for the full evidence trail.' };
}

export async function getHint(caseId: string, step: number) {
  const c: any = await getCase(caseId);
  if (!c) return null;
  const hints = [`Review the timestamps around ${c.incidentTimestamp}.`, 'Compare the stated alibis with the recovered messages and camera anomalies.', `The key contradiction is: ${c.solution.alibiContradiction}`];
  return hints[Math.min(Math.max(0, step - 1), 2)];
}
