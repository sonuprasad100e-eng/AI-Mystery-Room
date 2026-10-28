import { z } from 'zod';

export const DIFFICULTY_CONFIGS = {
  easy: { suspects: 3, clues: 5, hints: 2, basePoints: 100 },
  medium: { suspects: 4, clues: 7, hints: 3, basePoints: 150 },
  hard: { suspects: 5, clues: 9, hints: 3, basePoints: 200 },
} as const;

export type Difficulty = keyof typeof DIFFICULTY_CONFIGS;

export const generateSchema = z.object({
  prompt: z.string().trim().min(10, 'Scenario must be at least 10 characters.').max(600, 'Scenario must not exceed 600 characters.'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});

export const solveSchema = z.object({
  suspectId: z.string().min(1, 'A suspect must be chosen.'),
  selectedEvidenceIds: z.array(z.string()).default([]),
  reasoning: z.string().optional(),
});

export const interrogateSchema = z.object({
  suspectId: z.string().trim().min(1, 'A suspect must be chosen.'),
  question: z.string().trim().min(1, 'Question must not be empty.').max(300, 'Question must not exceed 300 characters.'),
  history: z.array(z.object({
    role: z.enum(['user', 'suspect']),
    content: z.string().trim().min(1).max(500),
  })).max(10).optional().default([]),
});

export type InterrogateInput = z.infer<typeof interrogateSchema>;

const shortText = z.string().trim().min(1).max(500);

// Accepts standard hyphens (-), en-dashes (–), and em-dashes (—)
const timelineEventPattern = /^((?:[01]\d|2[0-3]):[0-5]\d)\s*[-–—]\s*\S.*$/;
const timelineEvent = z.string().min(1).max(500).regex(
  timelineEventPattern,
  'Timeline entry must start with a valid 24-hour UTC time (HH:mm - description).'
);

export class TimelineValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
    this.name = 'TimelineValidationError';
  }
}

// Helper to validate URLs: accepts http/https, data URIs, /api/media/ paths, or empty strings
export function isAllowedUrl(value: string | undefined): boolean {
  if (!value) return true;
  if (value.startsWith('data:image/')) return true;
  if (value.startsWith('/api/media/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export const clueSchema = z.object({
  clueId: z.string().min(1),
  title: shortText,
  description: shortText,
  type: z.enum(['physical', 'document', 'surveillance', 'forensic', 'testimony']).default('forensic'),
  sourceEvidenceId: z.string().optional(),
  details: shortText.optional(),
}).strict();

export const generatedCaseSchema = z.object({
  title: z.string().trim().min(3).max(80),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  story: shortText.optional(),
  crimeType: z.string().trim().min(2).max(60),
  setting: z.string().trim().min(2).max(120),
  incidentTimestamp: z.string().datetime(),
  victim: z.object({
    name: shortText,
    age: z.number().int().min(1).max(120),
    role: shortText,
    causeOfIncident: shortText,
    background: shortText,
  }).strict(),
  briefing: shortText,
  timelineSummary: z.array(timelineEvent).min(3).max(8),
  suspects: z.array(z.object({
    suspectId: z.string().min(1),
    name: shortText,
    age: z.number().int().min(18).max(110),
    occupation: shortText,
    relationshipToVictim: shortText,
    bio: shortText,
    motive: shortText,
    alibi: shortText,
    quirks: z.array(shortText).max(3),
    avatarUrl: z.string(),
    interrogationQuote: shortText,
  }).strict()).min(3).max(5),
  clues: z.array(clueSchema).min(5).max(9),
  hints: z.array(shortText).min(2).max(3),
  evidence: z.object({
    whatsappThreads: z.array(z.object({
      evidenceId: z.string().min(1),
      title: shortText,
      participants: z.array(shortText).min(2).max(6),
      extractedFromDevice: shortText,
      messages: z.array(z.object({
        messageId: z.string().min(1),
        senderId: z.string().min(1),
        senderName: shortText,
        timestamp: z.string().datetime(),
        text: shortText,
        isDeletedOrRecovered: z.boolean().optional(),
        readStatus: z.enum(['sent', 'delivered', 'read']),
      }).strict()).min(2).max(6),
    }).strict()).max(3),
    photos: z.array(z.object({
      evidenceId: z.string().min(1),
      title: shortText,
      locationFound: shortText,
      timestamp: z.string().datetime(),
      imagePrompt: shortText,
      imageUrl: z.string(),
      forensicNote: shortText,
      hotspots: z.array(z.object({
        xPercent: z.number().min(0).max(100),
        yPercent: z.number().min(0).max(100),
        label: shortText,
        detail: shortText,
      }).strict()).min(1).max(4),
    }).strict()).min(1).max(5),
    cctvRecordings: z.array(z.object({
      evidenceId: z.string().min(1),
      cameraId: shortText,
      location: shortText,
      timeRange: shortText,
      technicalStatus: shortText,
      videoUrl: z.string().refine((val) => isAllowedUrl(val), {
        message: 'Video URL must be a valid HTTP/HTTPS URL or /api/media/ relative path.',
      }).optional(),
      frames: z.array(z.object({
        frameId: z.string().min(1),
        timestamp: z.string().datetime(),
        cameraName: shortText,
        visualDescription: shortText,
        detectedEntities: z.array(shortText).max(5),
        anomalyFlag: z.boolean(),
        snapshotSvgOrUrl: z.string(),
      }).strict()).min(1).max(5),
    }).strict()).min(1).max(3),
  }).strict(),
  solution: z.object({
    culpritSuspectId: z.string().min(1),
    motiveSummary: shortText,
    alibiContradiction: shortText,
    keyEvidenceIds: z.array(z.string().min(1)).min(2).max(6),
    fullReconstruction: shortText,
  }).strict(),
}).strict();

export type GeneratedCase = z.infer<typeof generatedCaseSchema>;

export function generatedCaseJsonSchema() {
  const fullSchema = z.toJSONSchema(generatedCaseSchema, { target: 'draft-07' });
  const localOnlyConstraints = new Set([
    '$schema', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern',
  ]);
  const toProviderSchema = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(toProviderSchema);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !localOnlyConstraints.has(key))
      .map(([key, nested]) => [key, toProviderSchema(nested)]));
  };
  return toProviderSchema(fullSchema);
}

/**
 * Preprocesses raw Gemini JSON response before strict Zod validation.
 * Handles optional fields safely:
 * - Omits empty string `videoUrl`
 * - Normalizes timeline punctuation (e.g., converts em/en dashes to " - ")
 * - Ensures story, clues, and hints arrays meet difficulty counts
 */
export function preprocessRawCase(input: unknown, targetDifficulty?: 'easy' | 'medium' | 'hard'): unknown {
  if (!input || typeof input !== 'object') return input;
  const data = JSON.parse(JSON.stringify(input));

  // Determine difficulty
  let diff: Difficulty = targetDifficulty || 'medium';
  if (data.difficulty && data.difficulty in DIFFICULTY_CONFIGS) {
    diff = data.difficulty as Difficulty;
  } else if (Array.isArray(data.suspects)) {
    if (data.suspects.length <= 3) diff = 'easy';
    else if (data.suspects.length === 4) diff = 'medium';
    else diff = 'hard';
  }
  const config = DIFFICULTY_CONFIGS[diff];

  // Synchronize story and briefing
  if (!data.story && data.briefing) {
    data.story = data.briefing;
  } else if (!data.briefing && data.story) {
    data.briefing = data.story;
  }

  // Normalize cctvRecordings videoUrl
  if (data.evidence?.cctvRecordings && Array.isArray(data.evidence.cctvRecordings)) {
    for (const recording of data.evidence.cctvRecordings) {
      if (typeof recording.videoUrl === 'string' && recording.videoUrl.trim() === '') {
        delete recording.videoUrl;
      }
    }
  }

  // Normalize timelineSummary punctuation to standard " - "
  if (Array.isArray(data.timelineSummary)) {
    data.timelineSummary = data.timelineSummary.map((item: unknown) => {
      if (typeof item !== 'string') return item;
      return item.replace(/^((?:[01]\d|2[0-3]):[0-5]\d)\s*[-–—]\s*/, '$1 - ').trim();
    });
  }

  // Synthesize or fill clues if missing or insufficient
  if (!Array.isArray(data.clues) || data.clues.length < config.clues) {
    const existingClues: any[] = Array.isArray(data.clues) ? [...data.clues] : [];
    const existingIds = new Set(existingClues.map((c: any) => c.clueId));

    // Extract clues from photos
    if (Array.isArray(data.evidence?.photos)) {
      for (const photo of data.evidence.photos) {
        if (existingClues.length >= config.clues) break;
        const cid = `clue_p_${photo.evidenceId}`;
        if (!existingIds.has(cid)) {
          existingIds.add(cid);
          existingClues.push({
            clueId: cid,
            title: photo.title || 'Photographic Exhibit',
            description: photo.forensicNote || `Forensic exhibit recovered at ${photo.locationFound || 'crime scene'}.`,
            type: 'forensic',
            sourceEvidenceId: photo.evidenceId,
          });
        }
        if (Array.isArray(photo.hotspots)) {
          for (let hi = 0; hi < photo.hotspots.length; hi++) {
            if (existingClues.length >= config.clues) break;
            const hs = photo.hotspots[hi];
            const hid = `clue_hs_${photo.evidenceId}_${hi + 1}`;
            if (!existingIds.has(hid)) {
              existingIds.add(hid);
              existingClues.push({
                clueId: hid,
                title: hs.label || 'Physical Mark',
                description: hs.detail || 'Mark discovered during evidence inspection.',
                type: 'physical',
                sourceEvidenceId: photo.evidenceId,
              });
            }
          }
        }
      }
    }

    // Extract clues from CCTV
    if (Array.isArray(data.evidence?.cctvRecordings)) {
      for (const rec of data.evidence.cctvRecordings) {
        if (existingClues.length >= config.clues) break;
        const cid = `clue_cctv_${rec.evidenceId}`;
        if (!existingIds.has(cid)) {
          existingIds.add(cid);
          existingClues.push({
            clueId: cid,
            title: `CCTV Surveillance Feed: ${rec.cameraId || 'Camera'}`,
            description: `Security recording from ${rec.location || 'perimeter'} covering ${rec.timeRange || 'incident period'}.`,
            type: 'surveillance',
            sourceEvidenceId: rec.evidenceId,
          });
        }
        if (Array.isArray(rec.frames)) {
          for (let fi = 0; fi < rec.frames.length; fi++) {
            if (existingClues.length >= config.clues) break;
            const fr = rec.frames[fi];
            if (fr.anomalyFlag || existingClues.length < config.clues) {
              const fid = `clue_fr_${rec.evidenceId}_${fi + 1}`;
              if (!existingIds.has(fid)) {
                existingIds.add(fid);
                existingClues.push({
                  clueId: fid,
                  title: fr.anomalyFlag ? `Surveillance Anomaly at ${fr.timestamp}` : `Camera Observation at ${fr.timestamp}`,
                  description: fr.visualDescription || 'Observation recorded on camera log.',
                  type: 'surveillance',
                  sourceEvidenceId: rec.evidenceId,
                });
              }
            }
          }
        }
      }
    }

    // Extract clues from WhatsApp threads
    if (Array.isArray(data.evidence?.whatsappThreads)) {
      for (const thread of data.evidence.whatsappThreads) {
        if (existingClues.length >= config.clues) break;
        const cid = `clue_chat_${thread.evidenceId}`;
        if (!existingIds.has(cid)) {
          existingIds.add(cid);
          existingClues.push({
            clueId: cid,
            title: `Extracted Communication Log: ${thread.title || 'Message Thread'}`,
            description: `Extracted from ${thread.extractedFromDevice || 'suspect device'} involving ${thread.participants?.join(', ') || 'participants'}.`,
            type: 'document',
            sourceEvidenceId: thread.evidenceId,
          });
        }
      }
    }

    // Pad if still under required count
    let padIndex = 1;
    while (existingClues.length < config.clues) {
      const padId = `clue_lead_${padIndex}`;
      if (!existingIds.has(padId)) {
        existingIds.add(padId);
        existingClues.push({
          clueId: padId,
          title: `Investigative Lead #${padIndex}`,
          description: `Discrepancy identified in preliminary incident statements for ${data.setting || 'crime scene'}.`,
          type: 'testimony',
        });
      }
      padIndex++;
    }

    data.clues = existingClues.slice(0, config.clues);
  }

  // Synthesize or trim hints if missing or count mismatch
  if (!Array.isArray(data.hints) || data.hints.length !== config.hints) {
    const defaultHints = [
      `Review the timestamps around ${data.incidentTimestamp || 'the incident'} across all communication and surveillance logs.`,
      `Compare the suspects' stated alibis against physical findings and device records recovered from ${data.setting || 'the scene'}.`,
      `Cross-reference surveillance entry and exit timestamps with statements given by persons of interest.`,
    ];
    data.hints = defaultHints.slice(0, config.hints);
  }

  return data;
}

export function validateGeneratedCase(input: unknown, expectedDifficulty?: 'easy' | 'medium' | 'hard'): GeneratedCase {
  const preprocessed = preprocessRawCase(input, expectedDifficulty);
  const data = generatedCaseSchema.parse(preprocessed);

  // Determine difficulty from configuration
  let diff: Difficulty = expectedDifficulty || 'medium';
  if ((input as any)?.difficulty && (input as any).difficulty in DIFFICULTY_CONFIGS) {
    diff = (input as any).difficulty as Difficulty;
  } else if (data.suspects.length <= 3) {
    diff = 'easy';
  } else if (data.suspects.length === 4) {
    diff = 'medium';
  } else {
    diff = 'hard';
  }
  const config = DIFFICULTY_CONFIGS[diff];

  const suspectIds = data.suspects.map(({ suspectId }) => suspectId);
  const evidenceIds = [
    ...data.evidence.whatsappThreads.map(({ evidenceId }) => evidenceId),
    ...data.evidence.photos.map(({ evidenceId }) => evidenceId),
    ...data.evidence.cctvRecordings.map(({ evidenceId }) => evidenceId),
  ];
  const clueIds = data.clues.map((c) => c.clueId);

  // Strict difficulty counts verification
  if (new Set(suspectIds).size !== config.suspects) {
    throw new Error(`Generated case for ${diff} difficulty must contain ${config.suspects} unique suspects (found ${new Set(suspectIds).size}).`);
  }
  if (data.clues.length !== config.clues) {
    throw new Error(`Generated case for ${diff} difficulty must contain exactly ${config.clues} clues (found ${data.clues.length}).`);
  }
  if (new Set(clueIds).size !== clueIds.length) {
    throw new Error('Clue IDs must be unique.');
  }
  if (data.hints.length !== config.hints) {
    throw new Error(`Generated case for ${diff} difficulty must contain exactly ${config.hints} hints (found ${data.hints.length}).`);
  }

  if (!suspectIds.includes(data.solution.culpritSuspectId)) {
    throw new Error('Solution culprit must match one suspect.');
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error('Evidence IDs must be unique.');
  }

  const allValidRefIds = new Set([...evidenceIds, ...clueIds]);
  if (data.solution.keyEvidenceIds.some((id) => !allValidRefIds.has(id))) {
    throw new Error('Solution refers to missing evidence.');
  }
  if (new Set(data.solution.keyEvidenceIds).size !== data.solution.keyEvidenceIds.length) {
    throw new Error('Solution evidence IDs must be unique.');
  }

  // URL security and format validation
  if (data.evidence.photos.some(({ imageUrl }) => !isAllowedUrl(imageUrl))) {
    throw new Error('Photo URLs must use HTTP, HTTPS, or a valid image data URI.');
  }
  if (data.evidence.cctvRecordings.some(({ videoUrl, frames }) =>
    !isAllowedUrl(videoUrl) || frames.some(({ snapshotSvgOrUrl }) => !isAllowedUrl(snapshotSvgOrUrl))
  )) {
    throw new Error('Video and frame URLs must use HTTP, HTTPS, or a valid image data URI.');
  }

  // Culprit contradiction verification
  const culprit = data.suspects.find(({ suspectId }) => suspectId === data.solution.culpritSuspectId)!;
  const nameParts = culprit.name.toLowerCase().split(/\s+/).filter((part) => part.length >= 3);
  const explanation = data.solution.alibiContradiction.toLowerCase();
  const mentionsCulprit = explanation.includes(culprit.name.toLowerCase()) ||
    nameParts.some((part) => explanation.includes(part));

  if (!mentionsCulprit) {
    throw new Error(`The solution must explain the listed culprit’s alibi contradiction (mentioning ${culprit.name}).`);
  }

  // Participant checks in chat threads
  for (const thread of data.evidence.whatsappThreads) {
    if (thread.messages.some(({ senderName }) => !thread.participants.includes(senderName))) {
      throw new Error('Message senders must be listed as thread participants.');
    }
  }

  // Chronological timeline validation
  const timelineTimes = data.timelineSummary.map((event, index) => {
    const match = timelineEventPattern.exec(event);
    if (!match) {
      throw new TimelineValidationError(
        `timelineSummary.${index}`,
        'Timeline events must use HH:mm - description with a valid 24-hour time.'
      );
    }
    const [hours, minutes] = match[1].split(':').map(Number);
    return hours * 60 + minutes;
  });

  const outOfOrderIndex = timelineTimes.findIndex((time, index) => index > 0 && time < timelineTimes[index - 1]);
  if (outOfOrderIndex >= 0) {
    throw new TimelineValidationError(
      `timelineSummary.${outOfOrderIndex}`,
      'Timeline events must be in chronological order.'
    );
  }

  const incidentTime = Date.parse(data.incidentTimestamp);
  const incidentMinutes = new Date(incidentTime).getUTCHours() * 60 + new Date(incidentTime).getUTCMinutes();
  const hasIncidentAnchor = timelineTimes.some((time) => Math.abs(time - incidentMinutes) <= 15);
  if (!hasIncidentAnchor) {
    throw new TimelineValidationError(
      'timelineSummary',
      'Timeline must include a time close to the incidentTimestamp.'
    );
  }

  const incidentDay = data.incidentTimestamp.slice(0, 10);
  const timestamps = [
    ...data.evidence.whatsappThreads.flatMap(({ messages }) => messages.map(({ timestamp }) => timestamp)),
    ...data.evidence.photos.map(({ timestamp }) => timestamp),
    ...data.evidence.cctvRecordings.flatMap(({ frames }) => frames.map(({ timestamp }) => timestamp)),
  ];
  if (timestamps.some((timestamp) => timestamp.slice(0, 10) !== incidentDay)) {
    throw new Error('All evidence timestamps must use the incident date.');
  }

  const cleanTitle = data.title.replace(/^the\s+(?=a\s+[a-z])/i, '').replace(/\s+case\s*$/i, '').trim();
  if (cleanTitle.split(/\s+/).length > 8) {
    throw new Error('Generated title must be short and clear.');
  }

  return { ...data, title: cleanTitle };
}
