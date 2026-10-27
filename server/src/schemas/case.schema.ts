import { z } from 'zod';

export const generateSchema = z.object({
  prompt: z.string().trim().min(10).max(600),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
});

export const solveSchema = z.object({
  suspectId: z.string().min(1),
  selectedEvidenceIds: z.array(z.string()).default([]),
  reasoning: z.string().optional(),
});

const shortText = z.string().trim().min(1).max(500);
const timelineEventPattern = /^((?:[01]\d|2[0-3]):[0-5]\d) - \S.*$/;
const timelineEvent = z.string().min(1).max(500).regex(timelineEventPattern).describe(
  'Timeline entry formatted exactly as HH:mm - description, using a 24-hour UTC time on the incident date.',
);

export class TimelineValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
    this.name = 'TimelineValidationError';
  }
}

export const generatedCaseSchema = z.object({
  title: z.string().trim().min(3).max(80),
  crimeType: z.string().trim().min(2).max(60),
  setting: z.string().trim().min(2).max(120),
  incidentTimestamp: z.string().datetime(),
  victim: z.object({
    name: shortText, age: z.number().int().min(1).max(120), role: shortText,
    causeOfIncident: shortText, background: shortText,
  }).strict(),
  briefing: shortText,
  timelineSummary: z.array(timelineEvent).min(3).max(6),
  suspects: z.array(z.object({
    suspectId: z.string().min(1), name: shortText, age: z.number().int().min(18).max(110),
    occupation: shortText, relationshipToVictim: shortText, bio: shortText, motive: shortText,
    alibi: shortText, quirks: z.array(shortText).max(3), avatarUrl: z.string(),
    interrogationQuote: shortText,
  }).strict()).length(3),
  evidence: z.object({
    whatsappThreads: z.array(z.object({
      evidenceId: z.string().min(1), title: shortText, participants: z.array(shortText).min(2).max(4),
      extractedFromDevice: shortText,
      messages: z.array(z.object({
        messageId: z.string().min(1), senderId: z.string().min(1), senderName: shortText,
        timestamp: z.string().datetime(), text: shortText,
        isDeletedOrRecovered: z.boolean().optional(),
        readStatus: z.enum(['sent', 'delivered', 'read']),
      }).strict()).min(2).max(5),
    }).strict()).max(1),
    photos: z.array(z.object({
      evidenceId: z.string().min(1), title: shortText, locationFound: shortText,
      timestamp: z.string().datetime(), imagePrompt: shortText,
      imageUrl: z.string(), forensicNote: shortText,
      hotspots: z.array(z.object({
        xPercent: z.number().min(0).max(100), yPercent: z.number().min(0).max(100),
        label: shortText, detail: shortText,
      }).strict()).min(1).max(3),
    }).strict()).length(2),
    cctvRecordings: z.array(z.object({
      evidenceId: z.string().min(1), cameraId: shortText, location: shortText,
      timeRange: shortText, technicalStatus: shortText,
      videoUrl: z.string().url().optional().describe(
        'Optional playable HTTP or HTTPS video URL. Include only when a real video asset exists; otherwise omit this property entirely.',
      ),
      frames: z.array(z.object({
        frameId: z.string().min(1), timestamp: z.string().datetime(),
        cameraName: shortText, visualDescription: shortText,
        detectedEntities: z.array(shortText).max(5), anomalyFlag: z.boolean(),
        snapshotSvgOrUrl: z.string(),
      }).strict()).min(1).max(4),
    }).strict()).length(1),
  }).strict(),
  solution: z.object({
    culpritSuspectId: z.string().min(1), motiveSummary: shortText,
    alibiContradiction: shortText, keyEvidenceIds: z.array(z.string().min(1)).min(2).max(4),
    fullReconstruction: shortText,
  }).strict(),
}).strict();

export type GeneratedCase = z.infer<typeof generatedCaseSchema>;

export function generatedCaseJsonSchema() {
  const fullSchema = z.toJSONSchema(generatedCaseSchema, { target: 'draft-07' });
  // Gemini's constrained decoder can reject nested item/numeric bounds as too complex.
  // Keep the structure in the provider schema and enforce every bound locally with Zod.
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

export function validateGeneratedCase(input: unknown): GeneratedCase {
  const data = generatedCaseSchema.parse(input);
  const isHttpUrl = (value: string) => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
    catch { return false; }
  };
  const suspectIds = data.suspects.map(({ suspectId }) => suspectId);
  const evidenceIds = [
    ...data.evidence.whatsappThreads.map(({ evidenceId }) => evidenceId),
    ...data.evidence.photos.map(({ evidenceId }) => evidenceId),
    ...data.evidence.cctvRecordings.map(({ evidenceId }) => evidenceId),
  ];
  if (new Set(suspectIds).size !== 3) throw new Error('Generated case must contain three unique suspects.');
  if (!suspectIds.includes(data.solution.culpritSuspectId)) throw new Error('Solution culprit must match one suspect.');
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new Error('Evidence IDs must be unique.');
  if (data.solution.keyEvidenceIds.some((id) => !evidenceIds.includes(id))) throw new Error('Solution refers to missing evidence.');
  if (new Set(data.solution.keyEvidenceIds).size !== data.solution.keyEvidenceIds.length) throw new Error('Solution evidence IDs must be unique.');
  if (data.evidence.photos.some(({ imageUrl }) => !isHttpUrl(imageUrl))) throw new Error('Photo URLs must use HTTP or HTTPS.');
  if (data.evidence.cctvRecordings.some(({ videoUrl, frames }) => !isHttpUrl(videoUrl || '') || frames.some(({ snapshotSvgOrUrl }) => !isHttpUrl(snapshotSvgOrUrl)))) {
    throw new Error('Video and frame URLs must use HTTP or HTTPS.');
  }
  const culprit = data.suspects.find(({ suspectId }) => suspectId === data.solution.culpritSuspectId)!;
  if (!data.solution.alibiContradiction.toLowerCase().includes(culprit.name.toLowerCase())) {
    throw new Error('The solution must explain the listed culprit’s alibi contradiction.');
  }
  for (const thread of data.evidence.whatsappThreads) {
    if (thread.messages.some(({ senderName }) => !thread.participants.includes(senderName))) {
      throw new Error('Message senders must be listed as thread participants.');
    }
  }
  const timelineTimes = data.timelineSummary.map((event, index) => {
    const match = timelineEventPattern.exec(event);
    if (!match) throw new TimelineValidationError(`timelineSummary.${index}`, 'Timeline events must use exactly HH:mm - description with a valid 24-hour time.');
    const [hours, minutes] = match[1].split(':').map(Number);
    return hours * 60 + minutes;
  });
  const outOfOrderIndex = timelineTimes.findIndex((time, index) => index > 0 && time < timelineTimes[index - 1]);
  if (outOfOrderIndex >= 0) {
    throw new TimelineValidationError(`timelineSummary.${outOfOrderIndex}`, 'Timeline events must be in chronological order.');
  }
  const incidentTime = Date.parse(data.incidentTimestamp);
  if (!timelineTimes.includes(new Date(incidentTime).getUTCHours() * 60 + new Date(incidentTime).getUTCMinutes())) {
    throw new TimelineValidationError('timelineSummary', 'Timeline must include the UTC time of incidentTimestamp.');
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
  if (cleanTitle.split(/\s+/).length > 8) throw new Error('Generated title must be short and clear.');
  return { ...data, title: cleanTitle };
}
