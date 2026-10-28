import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { CaseModel } from '../models/Case.model.js';
import { mongoReady } from '../config/db.js';
import { env } from '../config/env.js';
import { seedCase } from './seedCase.js';
import {
  DIFFICULTY_CONFIGS,
  type Difficulty,
  generatedCaseJsonSchema,
  TimelineValidationError,
  validateGeneratedCase,
} from '../schemas/case.schema.js';
import { generateEvidenceImage, generateProceduralForensicSvg } from './image.service.js';
import type { InvestigationReport, MysteryCase, PublicCase } from '../types.js';

const memory = new Map<string, MysteryCase>([[seedCase._id, seedCase]]);

function id() {
  return `CASE-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export class CaseGenerationError extends Error {
  status = 503;
}

const SUSPECT_PALETTE = ['#d9a441', '#7aa6c2', '#b581a8', '#91a879', '#e06c75'];

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
  const err = error as {
    name?: string;
    message?: string;
    status?: number;
    code?: string;
    path?: string;
    issues?: { path: PropertyKey[]; code: string; message: string }[];
  };
  const rawMessage = typeof err?.message === 'string' ? err.message : 'Unknown error.';
  let providerError: { code?: number | string; status?: string; message?: string } | undefined;
  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed && typeof parsed.error === 'object') providerError = parsed.error;
  } catch {
    /* SDK may wrap the JSON provider body in a status message. */
  }
  const httpMatch = /HTTP\s+(\d{3})\s+([A-Z_]+)/i.exec(rawMessage);
  const retryableMatch =
    /Retryable HTTP Error:\s*(Request Timeout|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i.exec(
      rawMessage
    );
  const retryableStatuses: Record<string, [number, string]> = {
    'request timeout': [408, 'DEADLINE_EXCEEDED'],
    'too many requests': [429, 'RESOURCE_EXHAUSTED'],
    'internal server error': [500, 'INTERNAL'],
    'bad gateway': [502, 'BAD_GATEWAY'],
    'service unavailable': [503, 'UNAVAILABLE'],
    'gateway timeout': [504, 'DEADLINE_EXCEEDED'],
  };
  const mappedRetryable = retryableMatch ? retryableStatuses[retryableMatch[1].toLowerCase()] : undefined;
  const status =
    typeof err?.status === 'number'
      ? err.status
      : typeof providerError?.code === 'number'
        ? providerError.code
        : httpMatch
          ? Number(httpMatch[1])
          : mappedRetryable?.[0] ?? null;
  const code =
    typeof providerError?.status === 'string'
      ? providerError.status
      : typeof err?.code === 'string'
        ? err.code
        : httpMatch?.[2] || mappedRetryable?.[1] || null;
  const safeProviderMessage = typeof providerError?.message === 'string' ? providerError.message : rawMessage;
  const details =
    err?.name === 'ZodError' && Array.isArray(err.issues)
      ? err.issues.map(({ path, code: issueCode, message }) => ({
          path: path.map(String).join('.'),
          code: issueCode,
          message,
        }))
      : error instanceof TimelineValidationError
        ? [{ path: error.path, code: 'custom', message: rawMessage }]
        : safeProviderMessage
            .replace(/AIza[\w-]{15,}/g, '[REDACTED]')
            .replace(/(api[_-]?key\s*[:=]\s*)[^\s,]+/gi, '$1[REDACTED]')
            .replace(/https?:\/\/[^\s"']+/g, '[URL REDACTED]')
            .slice(0, 500);
  return { status, code, details };
}

function timelineFailureDiagnostics(raw: unknown, error: unknown) {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const events = record.timelineSummary;
  const err = error as { name?: string; path?: string; issues?: { path: PropertyKey[]; message: string }[] };
  const paths =
    err?.name === 'ZodError' && Array.isArray(err.issues)
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
    case 400:
      return 'Gemini rejected the generation request (INVALID_ARGUMENT). Check the model request configuration.';
    case 401:
      return 'Gemini authentication failed. Check GEMINI_API_KEY.';
    case 402:
      return 'Gemini billing is unavailable for this project. Check Google AI Studio billing and paid-tier status.';
    case 403:
      return 'This project is not permitted to use the configured Gemini model. Check model access and paid-tier eligibility.';
    case 404:
      return 'The configured Gemini model was not found or is unavailable to this project.';
    case 429: {
      const detail = typeof failure.details === 'string' ? failure.details.toLowerCase() : '';
      if (detail.includes('free_tier') || /limit\s*:\s*0/.test(detail)) {
        return 'Gemini generation is unavailable on this API tier. Check free-tier model access and quota.';
      }
      return 'Gemini quota or rate limit reached. Wait or review the project limits.';
    }
    case 503:
      return 'Gemini is temporarily under high demand. Please try again shortly.';
    case 408:
    case 504:
      return 'The Gemini request timed out. Please try again.';
    default:
      return 'The Gemini provider request failed. Check the sanitized backend diagnostic log.';
  }
}

/**
 * Sanitizes a mystery case before transmitting to client.
 * Solution and protected culprit answers remain strictly on backend
 * until an accusation is submitted and verified.
 */
export function sanitize(c: any): PublicCase {
  const plain = c.toObject ? c.toObject() : { ...c };
  const isResolved = plain.status === 'solved' || plain.status === 'failed';

  if (!isResolved) {
    delete plain.solution;
    if (plain.finalVerdict) {
      delete plain.finalVerdict.solution;
    }
  }

  return plain;
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
    discoveredCluesCount: Array.isArray(c.discoveredClues) ? c.discoveredClues.length : 0,
    totalCluesCount: Array.isArray(c.clues) ? c.clues.length : 0,
    score: c.score ?? null,
  }));
}

export async function getCase(caseId: string) {
  return mongoReady ? CaseModel.findById(caseId) : memory.get(caseId) || null;
}

function cleanTitle(title: string) {
  return title
    .replace(/^the\s+(?=a\s+[a-z])/i, '')
    .replace(/\s+case\s*$/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

export async function createCase(prompt: string, difficulty: 'easy' | 'medium' | 'hard') {
  if (!env.geminiKey) {
    throw new CaseGenerationError('Case generation is unavailable because GEMINI_API_KEY is not configured.');
  }

  const config = DIFFICULTY_CONFIGS[difficulty];
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
      const basePrompt = `Write one complete, logically consistent fictional crime mystery for this scenario: ${prompt}
Difficulty level: ${difficulty}.

MANDATORY DIFFICULTY SPECIFICATIONS:
- Exactly ${config.suspects} suspects in suspects[] array (exactly 1 culprit and ${config.suspects - 1} innocent persons of interest).
- Exactly ${config.clues} clues in clues[] array. Each clue must have:
  * clueId: unique string identifier (e.g. "clue_1", "clue_2")
  * title: short descriptive clue title
  * description: concise factual clue observation
  * type: one of 'physical', 'document', 'surveillance', 'forensic', 'testimony'
  * sourceEvidenceId: optional evidence exhibit reference
- Exactly ${config.hints} progressive hints in hints[] array. Hints must provide gentle investigative nudges WITHOUT revealing or naming the culprit.

CULTURAL AND LINGUISTIC RULES:
- Use Indian names for all people in the mystery (victim and suspects), such as Rahul Sharma, Priya Patil, Amit Verma, Ananya Deshmukh, Arjun Mehta, Neha Singh, Rajesh Nair, Pooja Patel, etc.
- Set the mystery in a familiar Indian location (such as Mumbai, Delhi, Bengaluru, Pune, Kolkata, Jaipur, or an Indian shop, office, or residential apartment) unless the user scenario explicitly specifies another country.
- Write everything in simple, basic English. Use short sentences and common everyday words throughout all fields (story, briefing, alibis, bios, messages, clues, timeline, and quotes). Avoid difficult or complicated vocabulary.

CRIME LOGIC AND SOLUTION PROTECTION:
- The crime must have a logically consistent solution supported by its clues.
- Make non-culprit alibis fit the timeline; explain the culprit's logical contradiction in the solution.
- The solution.alibiContradiction field must include the culprit's exact full name as written in suspects[].name and explain the contradiction.
- Choose incidentTimestamp first and use its exact YYYY-MM-DD date for every ISO UTC message, photo, and CCTV frame timestamp; never use another evidence date.
- TimelineSummary HH:mm times are UTC times on that same incident date. Create 3-5 timelineSummary entries as strings in chronological order. Every entry must start with a valid 24-hour UTC time in HH:mm followed by " - " and its description.
- Include evidence exhibits (1-2 chat threads, 2-3 forensic photos with hotspots, 1 CCTV recording with 2-3 timestamped frame descriptions).
- Do not invent media URLs: imageUrl and snapshotSvgOrUrl must be empty strings. videoUrl is optional: omit that property entirely.
- Describe what real generated images or video should depict in imagePrompt and frame visualDescription.
- Return only the requested JSON conforming to the schema.`;

      const result = await ai.models.generateContent({
        model: env.geminiModel,
        contents: retryCorrection
          ? `${basePrompt}\n\nCorrect the previous validation failure using this exact feedback: ${retryCorrection} Preserve the mystery facts, suspects, clues, evidence relationships, culprit, chronology, and solution while correcting the schema requirements.`
          : basePrompt,
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
      generated = validateGeneratedCase(raw, difficulty);
    } catch (error) {
      const failure = safeFailure(error);
      const timelineDiagnostics = stage === 'zod_validation' ? timelineFailureDiagnostics(raw, error) : undefined;
      lastFailure = failure;
      lastFailureStage = stage;
      console.warn('[case-generation] attempt failed', {
        attempt,
        stage,
        difficulty,
        model: env.geminiModel,
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
    avatarUrl:
      suspect.avatarUrl && (suspect.avatarUrl.startsWith('http') || suspect.avatarUrl.startsWith('data:'))
        ? suspect.avatarUrl
        : generateNoirAvatarSvg(suspect.name, index),
  }));

  // Enrich forensic photo evidence with AI-generated images or procedural schematics
  const photosWithImages = await Promise.all(
    generated.evidence.photos.map(async (photo, index) => {
      if (
        photo.imageUrl &&
        (photo.imageUrl.startsWith('http') ||
          photo.imageUrl.startsWith('data:') ||
          photo.imageUrl.startsWith('/api/media'))
      ) {
        return photo;
      }
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
    story: generated.story || generated.briefing,
    suspects: suspectsWithAvatars,
    clues: generated.clues,
    hints: generated.hints,
    discoveredClues: [],
    hintsUsed: 0,
    usedHintSteps: [],
    investigationProgress: {
      totalClues: generated.clues.length,
      discoveredCount: 0,
      hintsUsedCount: 0,
      progressPercent: 0,
    },
    accusationStatus: 'unsolved',
    interrogationLog: [],
    finalVerdict: null,
    score: null,
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

/**
 * Evaluates an accusation and calculates backend-controlled score using exact requirements:
 * - Correct accusation: Easy = 100, Medium = 150, Hard = 200 points.
 * - Each discovered clue: +5 points.
 * - Each hint used: -10 points.
 * - Minimum score: 0.
 * Formula: max(0, difficultyBasePoints + discoveredClues * 5 - hintsUsed * 10)
 * Base points awarded ONLY for correct accusation.
 * Duplicate requests do not re-inflate score.
 */
export async function solveCase(
  caseId: string,
  suspectId: string,
  selectedEvidenceIds: string[],
  reasoning?: string
) {
  const c: any = await getCase(caseId);
  if (!c) return null;

  const solution = c.solution;
  const correct = solution.culpritSuspectId === suspectId;

  const difficulty = ((c.difficulty || 'medium') as string).toLowerCase() as Difficulty;
  const basePointsMap: Record<Difficulty, number> = {
    easy: 100,
    medium: 150,
    hard: 200,
  };

  const difficultyBasePoints = correct ? (basePointsMap[difficulty] ?? 150) : 0;
  const discoveredCluesCount = Array.isArray(c.discoveredClues) ? new Set(c.discoveredClues).size : 0;
  const hintsUsedCount =
    typeof c.hintsUsed === 'number'
      ? c.hintsUsed
      : Array.isArray(c.usedHintSteps)
        ? c.usedHintSteps.length
        : 0;

  // Prevent duplicate requests from awarding points multiple times:
  // If the case is already solved, return the existing score rather than re-awarding
  let calculatedScore: number;
  if (c.status === 'solved' && typeof c.score === 'number') {
    calculatedScore = c.score;
  } else {
    calculatedScore = Math.max(0, difficultyBasePoints + discoveredCluesCount * 5 - hintsUsedCount * 10);
  }

  const status = correct ? 'solved' : 'failed';
  const feedback = correct
    ? 'Your accusation fits the evidence. The full crime reconstruction follows.'
    : 'That accusation does not account for the full evidence trail.';

  const finalVerdict = {
    correct,
    accusedSuspectId: suspectId,
    score: calculatedScore,
    solution,
    feedback,
    submittedAt: new Date().toISOString(),
    reasoning: reasoning || '',
  };

  c.status = status;
  c.accusationStatus = status;
  c.score = calculatedScore;
  c.finalVerdict = finalVerdict;
  c.attemptsCount = (c.attemptsCount || 0) + 1;

  if (mongoReady && c.save) {
    await c.save();
  } else {
    memory.set(caseId, c);
  }

  return {
    correct,
    score: calculatedScore,
    solution,
    feedback,
    finalVerdict,
    scoreBreakdown: {
      difficultyBasePoints,
      discoveredCluesCount,
      clueBonus: discoveredCluesCount * 5,
      hintsUsedCount,
      hintPenalty: hintsUsedCount * 10,
      totalScore: calculatedScore,
    },
  };
}

/**
 * Returns a progressive hint for the given step.
 * Strictly shields the culprit identity and tracks hint penalties on backend.
 */
export async function getHint(caseId: string, step: number) {
  const c: any = await getCase(caseId);
  if (!c) return null;

  if (!Array.isArray(c.usedHintSteps)) {
    c.usedHintSteps = [];
  }

  const safeStep = Math.max(1, step);
  if (!c.usedHintSteps.includes(safeStep)) {
    c.usedHintSteps.push(safeStep);
    c.hintsUsed = c.usedHintSteps.length;
  }

  const totalClues = Array.isArray(c.clues)
    ? c.clues.length
    : c.difficulty === 'easy'
      ? 5
      : c.difficulty === 'hard'
        ? 9
        : 7;
  const discoveredCount = Array.isArray(c.discoveredClues) ? c.discoveredClues.length : 0;

  c.investigationProgress = {
    totalClues,
    discoveredCount,
    hintsUsedCount: c.hintsUsed,
    progressPercent: Math.min(100, Math.round((discoveredCount / totalClues) * 100)),
  };

  if (mongoReady && c.save) {
    await c.save();
  } else {
    memory.set(caseId, c);
  }

  // Retrieve stored hints from case
  if (Array.isArray(c.hints) && c.hints.length > 0) {
    const hintIdx = Math.min(safeStep - 1, c.hints.length - 1);
    return c.hints[hintIdx];
  }

  // Fallback hints that strictly do NOT reveal the culprit identity
  const fallbackHints = [
    `Review the timestamps around ${c.incidentTimestamp || 'the incident'} across all communication and surveillance logs.`,
    'Compare the suspects’ stated alibis with the recovered communication transcripts and camera anomalies.',
    'Examine physical evidence recovered from the scene against the tools and equipment used by persons of interest.',
  ];
  const idx = Math.min(safeStep - 1, fallbackHints.length - 1);
  return fallbackHints[idx];
}

/**
 * Records discovery of a forensic clue.
 * Deduplicates discovered clues so duplicate clicks cannot award duplicate points.
 */
export async function discoverClue(caseId: string, clueId: string) {
  const c: any = await getCase(caseId);
  if (!c) return null;

  if (!Array.isArray(c.discoveredClues)) {
    c.discoveredClues = [];
  }

  const isNewDiscovery = !c.discoveredClues.includes(clueId);
  if (isNewDiscovery) {
    c.discoveredClues.push(clueId);
  }

  const totalClues = Array.isArray(c.clues) && c.clues.length > 0
    ? c.clues.length
    : c.difficulty === 'easy'
      ? 5
      : c.difficulty === 'hard'
        ? 9
        : 7;

  const discoveredCount = c.discoveredClues.length;
  const progressPercent = Math.min(100, Math.round((discoveredCount / totalClues) * 100));

  c.investigationProgress = {
    totalClues,
    discoveredCount,
    hintsUsedCount: typeof c.hintsUsed === 'number' ? c.hintsUsed : 0,
    progressPercent,
  };

  if (mongoReady && c.save) {
    await c.save();
  } else {
    memory.set(caseId, c);
  }

  return {
    success: true,
    clueId,
    isNewDiscovery,
    discoveredClues: c.discoveredClues,
    investigationProgress: c.investigationProgress,
  };
}

/**
 * Generates an investigation report containing all 7 required sections:
 * 1. Case summary
 * 2. Investigation progress
 * 3. Discovered clues and evidence
 * 4. Relevant suspect statements
 * 5. Important contradictions supported by evidence
 * 6. Final accusation and verdict
 * 7. Explanation supported by the case evidence
 *
 * Strictly shields the culprit in reports generated before accusation.
 */
export async function generateInvestigationReport(caseId: string): Promise<InvestigationReport | null> {
  const c: any = await getCase(caseId);
  if (!c) return null;

  const isResolved = c.status === 'solved' || c.status === 'failed';
  const totalClues = Array.isArray(c.clues) && c.clues.length > 0
    ? c.clues.length
    : c.difficulty === 'easy'
      ? 5
      : c.difficulty === 'hard'
        ? 9
        : 7;

  const discoveredList = Array.isArray(c.discoveredClues) ? c.discoveredClues : [];

  const discoveredDetailed = (c.clues || []).filter((clue: any) =>
    discoveredList.includes(clue.clueId)
  );

  const accusedSuspect =
    isResolved && c.finalVerdict?.accusedSuspectId
      ? c.suspects?.find((s: any) => s.suspectId === c.finalVerdict.accusedSuspectId)
      : undefined;

  const report: InvestigationReport = {
    caseSummary: {
      caseNumber: c.caseNumber || c._id,
      title: c.title,
      crimeType: c.crimeType,
      setting: c.setting,
      incidentTimestamp: c.incidentTimestamp,
      victim: c.victim,
      briefing: c.briefing,
      story: c.story || c.briefing,
      timeline: c.timelineSummary || [],
    },
    investigationProgress: {
      totalClues,
      discoveredCount: discoveredList.length,
      hintsUsedCount: typeof c.hintsUsed === 'number' ? c.hintsUsed : 0,
      progressPercent: Math.min(100, Math.round((discoveredList.length / totalClues) * 100)),
    },
    discoveredClues: discoveredDetailed.map((clue: any) => ({
      clueId: clue.clueId,
      title: clue.title,
      description: clue.description,
      type: clue.type,
      sourceEvidenceId: clue.sourceEvidenceId,
    })),
    evidenceExhibits: {
      messageThreadsCount: c.evidence?.whatsappThreads?.length || 0,
      photosCount: c.evidence?.photos?.length || 0,
      cctvRecordingsCount: c.evidence?.cctvRecordings?.length || 0,
    },
    relevantSuspectStatements:
      Array.isArray(c.interrogationLog) && c.interrogationLog.length > 0
        ? c.interrogationLog
        : (c.suspects || []).map((s: any) => ({
            suspectId: s.suspectId,
            suspectName: s.name,
            question: 'Preliminary statement logged in case dossier',
            answer: s.interrogationQuote || s.alibi,
            timestamp: c.incidentTimestamp,
          })),
    importantContradictions:
      isResolved && c.solution?.alibiContradiction
        ? [c.solution.alibiContradiction]
        : ['Evidence-supported contradiction analysis remains sealed during active investigation.'],
    finalAccusationAndVerdict: {
      isResolved,
      accusationStatus: c.status || 'unsolved',
      accusedSuspect: accusedSuspect
        ? {
            suspectId: accusedSuspect.suspectId,
            name: accusedSuspect.name,
            occupation: accusedSuspect.occupation,
          }
        : undefined,
      verdict: isResolved
        ? c.status === 'solved'
          ? 'CORRECT DEDUCTION'
          : 'INCORRECT ACCUSATION'
        : 'INVESTIGATION PENDING',
      score: isResolved ? (c.score ?? null) : null,
      feedback: isResolved ? c.finalVerdict?.feedback : undefined,
    },
    explanation: isResolved
      ? c.solution?.fullReconstruction || 'Investigation complete.'
      : 'Case remains under active investigation. Final crime reconstruction is sealed until formal accusation is logged.',
    isSolutionShielded: !isResolved,
    generatedAt: new Date().toISOString(),
  };

  return report;
}

/**
 * Interrogates a suspect using Gemini.
 * Stores question and answer in interrogationLog for report generation.
 * Shields internal solution details from the model prompt to prevent prompt injection leaks.
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

  // If Gemini key is not configured, return polite in-character alibi response
  if (!env.geminiKey) {
    const answer = `I already told you my alibi: ${suspect.alibi}. I have nothing more to say right now.`;
    return { answer, suspectId: suspect.suspectId };
  }

  const isCulprit = c.solution?.culpritSuspectId === suspect.suspectId;
  const recentHistory = (history || [])
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Investigator' : suspect.name}: ${h.content}`)
    .join('\n');

  // Guard against prompt injection: do NOT pass explicit contradiction string to suspect prompt
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
STRICT RULES:
1. You MUST NEVER confess. Never say "I did it", "I am guilty", or admit guilt under any circumstance.
2. Defend your stated alibi firmly: "${suspect.alibi}".
3. If questioned about discrepancies, give a plausible excuse or deny it, but NEVER admit committing the crime.
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
4. If asked about something you did not witness, say naturally: "I don't know about that. I was ${suspect.alibi}."
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
    rawAnswer = rawAnswer.replace(new RegExp(`^${suspect.name}\\s*:\\s*`, 'i'), '');
    rawAnswer = rawAnswer.replace(/^["']|["']$/g, '').trim();

    if (!rawAnswer) {
      rawAnswer = `I have already told you my alibi: ${suspect.alibi}. Please check the case records.`;
    }

    // Record interrogation statement for investigation report
    if (!Array.isArray(c.interrogationLog)) {
      c.interrogationLog = [];
    }
    c.interrogationLog.push({
      suspectId: suspect.suspectId,
      suspectName: suspect.name,
      question,
      answer: rawAnswer,
      timestamp: new Date().toISOString(),
    });

    if (mongoReady && c.save) {
      await c.save();
    } else {
      memory.set(caseId, c);
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
      const err429: any = new Error(
        'The suspect is feeling overwhelmed right now. Please wait a few seconds and ask again.'
      );
      err429.status = 429;
      throw err429;
    }

    const serviceErr: any = new Error('The suspect could not be questioned right now. Please try asking again.');
    serviceErr.status = 503;
    throw serviceErr;
  }
}
