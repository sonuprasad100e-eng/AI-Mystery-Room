import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { CaseModel } from '../models/Case.model.js';
import { mongoReady } from '../config/db.js';
import { env } from '../config/env.js';
import { seedCase } from './seedCase.js';
import { generatedCaseJsonSchema, TimelineValidationError, validateGeneratedCase } from '../schemas/case.schema.js';
import { generateEvidenceImage, generateProceduralForensicSvg } from './image.service.js';
import type { MysteryCase, PublicCase } from '../types.js';

const memory = new Map<string, MysteryCase>([[seedCase._id, seedCase]]);
function id() { return `CASE-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }

export class CaseGenerationError extends Error {
  status = 503;
}

const SUSPECT_PALETTE = ['#d9a441', '#7aa6c2', '#b581a8', '#91a879'];

export function generateNoirAvatarSvg(name: string, index: number): string {
  const color = SUSPECT_PALETTE[index % SUSPECT_PALETTE.length];
  const safeName = name.replace(/[<>&"']/g, '').toUpperCase().slice(0, 24);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><defs><linearGradient id="bg${index}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#141c28"/><stop offset="100%" stop-color="#080c14"/></linearGradient></defs><rect width="320" height="320" fill="url(#bg${index})"/><circle cx="160" cy="160" r="140" fill="none" stroke="#253244" stroke-width="2"/><circle cx="160" cy="160" r="130" fill="none" stroke="${color}" stroke-opacity="0.3" stroke-dasharray="4 4"/><circle cx="160" cy="118" r="42" fill="#1b2533" stroke="${color}" stroke-width="2"/><path d="M96 244 Q160 176 224 244" fill="#253244" stroke="${color}" stroke-width="1.5"/><text x="160" y="130" fill="${color}" font-family="monospace" font-size="28" font-weight="bold" text-anchor="middle">${initials}</text><rect x="24" y="270" width="272" height="28" rx="4" fill="#0d141e" stroke="#253244" stroke-width="1"/><text x="160" y="289" fill="#e5e7eb" font-family="monospace" font-size="11" letter-spacing="1" text-anchor="middle">${safeName}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
  return cases.map((c: any) => ({
    id: c._id,
    title: c.title,
    caseNumber: c.caseNumber,
    crimeType: c.crimeType,
    difficulty: c.difficulty,
    status: c.status,
    createdAt: c.createdAt,
  }));
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
      const basePrompt = `Write one short fictional mystery for this scenario: ${prompt}\nDifficulty: ${difficulty}. Use Indian names for all people in the mystery (victim and suspects), such as Rahul Sharma, Priya Patil, Amit Verma, Ananya Deshmukh, Arjun Mehta, Neha Singh, Rajesh Nair, Pooja Patel, etc. Set the mystery in a familiar Indian location (such as Mumbai, Delhi, Bengaluru, Pune, Kolkata, Jaipur, or an Indian shop, office, or residential apartment) unless the user scenario explicitly specifies another country. Write everything in simple, basic English. Use short sentences and common everyday words throughout all fields (briefing, alibis, bios, messages, clues, timeline, and quotes). Avoid difficult or complicated vocabulary. Keep every field about this same incident. Use exactly three suspects and exactly one culprit. Make non-culprit alibis fit the timeline; explain the culprit's contradiction in the solution. The solution.alibiContradiction field must include the culprit's exact full name as written in suspects[].name and explain the contradiction. Choose incidentTimestamp first and use its exact YYYY-MM-DD date for every ISO UTC message, photo, and CCTV frame timestamp; never use another evidence date. TimelineSummary HH:mm times are UTC times on that same incident date. Create 3-5 timelineSummary entries as strings, in chronological order. Every entry must start exactly with a valid 24-hour UTC time in HH:mm followed by " - " and its description; use times from the incident date, and include the UTC time of incidentTimestamp. Valid: "21:30 - The security guard enters the gallery." Valid: "22:05 - The alarm is triggered." Invalid: "9:30 PM - The guard enters." Invalid: "At around 10 PM, the guard enters." At most one message thread with 2-4 messages, exactly two forensic clues, and one CCTV clue with 2-3 timestamped frame descriptions. Keep the title to 2-8 words; do not prefix it with “The A” or suffix it with “Case”. Do not invent media URLs. The required imageUrl and snapshotSvgOrUrl fields must be empty strings because no media provider is configured. videoUrl is optional: omit that property entirely because no real playable video asset exists; do not use an empty string or null. Describe what real generated case-scene images or video should depict in imagePrompt and frame descriptions. Solution must identify one listed suspect and cite existing evidence IDs. Return only the requested JSON.`;
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

  // Enrich suspects with stylish procedural noir silhouette avatars
  const suspectsWithAvatars = generated.suspects.map((suspect, index) => ({
    ...suspect,
    avatarUrl: suspect.avatarUrl && (suspect.avatarUrl.startsWith('http') || suspect.avatarUrl.startsWith('data:'))
      ? suspect.avatarUrl
      : generateNoirAvatarSvg(suspect.name, index),
  }));

  // Enrich forensic photo evidence with AI-generated images or procedural schematics
  const photosWithImages = await Promise.all(
    generated.evidence.photos.map(async (photo, index) => {
      if (photo.imageUrl && (photo.imageUrl.startsWith('http') || photo.imageUrl.startsWith('data:') || photo.imageUrl.startsWith('/api/media'))) {
        return photo;
      }
      // Primary exhibit gets AI generation attempted if enabled
      const shouldAttemptAi = env.enableAiImageGen && index === 0;
      if (shouldAttemptAi) {
        try {
          const res = await generateEvidenceImage(photo, generated.setting);
          return { ...photo, imageUrl: res.imageUrl };
        } catch {
          return { ...photo, imageUrl: generateProceduralForensicSvg(photo) };
        }
      }
      return { ...photo, imageUrl: generateProceduralForensicSvg(photo) };
    })
  );

  const data: MysteryCase = {
    ...generated,
    suspects: suspectsWithAvatars,
    evidence: {
      ...generated.evidence,
      photos: photosWithImages,
    },
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

  // Deduplicate submitted evidence IDs to prevent score inflation
  const uniqueEvidence = Array.from(new Set(evidenceIds || []));
  const totalKeyEvidence = Math.max(1, solution.keyEvidenceIds?.length || 1);
  const hits = uniqueEvidence.filter((x) => (solution.keyEvidenceIds || []).includes(x)).length;

  // Score strictly bounded between 0 and 100
  const score = correct ? Math.min(100, 70 + Math.round((30 * hits) / totalKeyEvidence)) : 0;
  const status = correct ? 'solved' : 'failed';

  if (mongoReady) {
    c.status = status;
    c.attemptsCount = (c.attemptsCount || 0) + 1;
    await c.save();
  } else {
    c.status = status;
    c.attemptsCount = (c.attemptsCount || 0) + 1;
    memory.set(caseId, c);
  }

  return {
    correct,
    score,
    solution,
    feedback: correct
      ? 'Your accusation fits the evidence. The reconstruction follows.'
      : 'That accusation does not account for the full evidence trail.',
  };
}

export async function getHint(caseId: string, step: number) {
  const c: any = await getCase(caseId);
  if (!c) return null;
  const hints = [
    `Review the timestamps around ${c.incidentTimestamp}.`,
    'Compare the stated alibis with the recovered messages and camera anomalies.',
    `The key contradiction is: ${c.solution?.alibiContradiction || 'an alibi discrepancy.'}`,
  ];
  const safeStep = Math.min(Math.max(1, step), hints.length);
  return hints[safeStep - 1];
}

/**
 * Interrogates a specific suspect using the configured Gemini model.
 * The suspect answers in character using simple, everyday English.
 * Critical safety rules:
 * - Innocent suspects DO NOT receive the solution or know who the culprit is.
 * - The culprit suspect is instructed to strictly protect their alibi and NEVER confess.
 * - Frontend NEVER receives internal solution fields or prompt instructions.
 */
export async function interrogateSuspect(
  caseId: string,
  suspectId: string,
  question: string,
  history: Array<{ role: 'user' | 'suspect'; content: string }> = []
): Promise<{ answer: string; suspectId: string } | null> {
  const c: any = await getCase(caseId);
  if (!c) return null;

  const suspect = c.suspects?.find((s: any) => s.suspectId === suspectId);
  if (!suspect) {
    const err: any = new Error('Suspect not found');
    err.status = 404;
    throw err;
  }

  // If Gemini key is not configured, return a polite in-character alibi response
  if (!env.geminiKey) {
    return {
      answer: `I already told you my alibi: ${suspect.alibi}. I have nothing more to say right now.`,
      suspectId: suspect.suspectId,
    };
  }

  const isCulprit = c.solution?.culpritSuspectId === suspect.suspectId;
  const recentHistory = (history || [])
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Investigator' : suspect.name}: ${h.content}`)
    .join('\n');

  const systemInstructions = isCulprit
    ? `You are roleplaying as ${suspect.name}, ${suspect.occupation} in an Indian mystery investigation.
Setting: ${c.setting}.
Victim: ${c.victim.name} (${c.victim.role}).
Cause of incident: ${c.victim.causeOfIncident}.
Incident details: ${c.briefing}.
Your relationship to victim: ${suspect.relationshipToVictim}.
Your personality and quirks: ${suspect.quirks.join(', ')}.
Your stated alibi: ${suspect.alibi}.
Your hidden motive: ${suspect.motive}.
CRITICAL SECRET (DO NOT REVEAL): You committed the crime. The investigator is trying to catch your contradiction: "${c.solution?.alibiContradiction || ''}".
STRICT RULES:
1. You MUST NEVER confess. Never say "I did it", "I am guilty", or admit guilt under any circumstance.
2. Defend your stated alibi firmly: "${suspect.alibi}".
3. If questioned about your contradiction or whereabouts, give a plausible natural excuse or deny it, but NEVER admit you committed the crime.
4. Speak in simple, basic English. Use short, common words.
5. Keep your response short: exactly 1 to 3 sentences.
6. Do not include role prefixes like "${suspect.name}:". Just speak directly.`
    : `You are roleplaying as ${suspect.name}, ${suspect.occupation} in an Indian mystery investigation.
Setting: ${c.setting}.
Victim: ${c.victim.name} (${c.victim.role}).
Cause of incident: ${c.victim.causeOfIncident}.
Incident details: ${c.briefing}.
Your relationship to victim: ${suspect.relationshipToVictim}.
Your personality and quirks: ${suspect.quirks.join(', ')}.
Your stated alibi: ${suspect.alibi}.
STRICT RULES:
1. You are completely INNOCENT. You did NOT commit this crime and you DO NOT know who the culprit is.
2. Speak truthfully based ONLY on what you personally saw, did, and your alibi: "${suspect.alibi}".
3. You do not know what other people did or thought when you were not with them.
4. If asked about something you did not witness or do not know, say naturally in simple English: "I don't know about that. I was ${suspect.alibi}."
5. Speak in simple, basic English. Use short, common words.
6. Keep your response short: exactly 1 to 3 sentences.
7. Do not include role prefixes like "${suspect.name}:". Just speak directly.`;

  const conversationPrompt = `${systemInstructions}

${recentHistory ? `Previous conversation:\n${recentHistory}\n` : ''}
Investigator's question: "${question}"
Your answer (in simple English, 1-3 sentences):`;

  try {
    const ai = new GoogleGenAI({
      apiKey: env.geminiKey,
      httpOptions: { timeout: 45 * 1000, retryOptions: { attempts: 2 } },
    });

    const result = await ai.models.generateContent({
      model: env.geminiModel,
      contents: conversationPrompt,
      config: {
        maxOutputTokens: 200,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    let rawAnswer = (result.text || '').trim();
    // Clean up any speaker prefixes or surrounding quotes
    rawAnswer = rawAnswer.replace(new RegExp(`^${suspect.name}\\s*:\\s*`, 'i'), '');
    rawAnswer = rawAnswer.replace(/^["']|["']$/g, '').trim();

    if (!rawAnswer) {
      rawAnswer = `I have already told you my alibi: ${suspect.alibi}. Please check the case records.`;
    }

    return {
      answer: rawAnswer,
      suspectId: suspect.suspectId,
    };
  } catch (err: any) {
    const failure = safeFailure(err);
    console.warn('[interrogate] Gemini call failed', {
      suspectId,
      status: failure.status,
      code: failure.code,
      details: typeof failure.details === 'string' ? failure.details.slice(0, 150) : failure.details,
    });

    if (failure.status === 429 || failure.code === 'RESOURCE_EXHAUSTED') {
      const err429: any = new Error('The suspect is feeling overwhelmed right now. Please wait a few seconds and ask again.');
      err429.status = 429;
      throw err429;
    }

    const serviceErr: any = new Error('The suspect could not be questioned right now. Please try asking again.');
    serviceErr.status = 503;
    throw serviceErr;
  }
}

