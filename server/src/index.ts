import express from 'express';
import cors from 'cors';
import { connectDb, mongoReady } from './config/db.js';
import { env, validateEnv } from './config/env.js';
import { seedCase } from './services/seedCase.js';
import { CaseModel } from './models/Case.model.js';
import {
  CaseGenerationError,
  createCase,
  getCase,
  listCases,
  sanitize,
  solveCase,
  getHint,
  interrogateSuspect,
} from './services/case.service.js';
import { generateSchema, solveSchema, interrogateSchema } from './schemas/case.schema.js';
import { MEDIA_DIR, generateEvidenceImage } from './services/image.service.js';
import { generateCctvVideo } from './services/video.service.js';


export const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve locally cached and downloaded forensic evidence media
app.use('/api/media', express.static(MEDIA_DIR, { maxAge: '7d' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    dbState: mongoReady ? 'connected' : 'memory',
    aiConfigured: Boolean(env.geminiKey),
    imageGenEnabled: env.enableAiImageGen,
    imageProvider: env.imageProvider,
  });
});

app.get('/api/cases', async (_req, res, next) => {
  try {
    const cases = await listCases();
    res.json({ cases });
  } catch (e) {
    next(e);
  }
});

app.post('/api/cases/generate', async (req, res, next) => {
  try {
    const body = generateSchema.parse(req.body);
    const c = await createCase(body.prompt, body.difficulty);
    res.status(201).json({ case: sanitize(c) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/cases/:id', async (req, res, next) => {
  try {
    const c = await getCase(req.params.id);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    res.json({ case: sanitize(c) });
  } catch (e) {
    next(e);
  }
});

app.post('/api/cases/:id/solve', async (req, res, next) => {
  try {
    const body = solveSchema.parse(req.body);
    const result = await solveCase(req.params.id, body.suspectId, body.selectedEvidenceIds);
    if (!result) return res.status(404).json({ error: 'Case not found' });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

app.post('/api/cases/:id/hint', async (req, res, next) => {
  try {
    const hint = await getHint(req.params.id, Number(req.body.step) || 1);
    if (!hint) return res.status(404).json({ error: 'Case not found' });
    res.json({ hint });
  } catch (e) {
    next(e);
  }
});

// Endpoint to generate or regenerate an AI photograph for a specific forensic exhibit
app.post('/api/cases/:id/evidence/:evidenceId/generate-image', async (req, res, next) => {
  try {
    const c: any = await getCase(req.params.id);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const photo = c.evidence?.photos?.find((p: any) => p.evidenceId === req.params.evidenceId);
    if (!photo) return res.status(404).json({ error: 'Evidence exhibit not found' });

    const result = await generateEvidenceImage(photo, c.setting, true);
    photo.imageUrl = result.imageUrl;

    if (mongoReady) {
      await c.save();
    }
    res.json({
      success: true,
      evidenceId: photo.evidenceId,
      imageUrl: result.imageUrl,
      isAiGenerated: result.isAiGenerated,
      provider: result.provider,
    });
  } catch (e) {
    next(e);
  }
});

// Endpoint to synthesize or regenerate a CCTV surveillance video
app.post('/api/cases/:id/cctv/:evidenceId/generate-video', async (req, res, next) => {
  try {
    const c: any = await getCase(req.params.id);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const recording = c.evidence?.cctvRecordings?.find((r: any) => r.evidenceId === req.params.evidenceId);
    if (!recording) return res.status(404).json({ error: 'CCTV recording not found' });

    const force = Boolean(req.body?.force);
    const result = await generateCctvVideo(c, req.params.evidenceId, force);

    recording.videoUrl = result.videoUrl;
    if (mongoReady) {
      await c.save();
    }

    res.json({
      success: true,
      evidenceId: req.params.evidenceId,
      videoUrl: result.videoUrl,
      durationSeconds: result.durationSeconds,
      isAiGenerated: result.isAiGenerated,
      provider: result.provider,
    });
  } catch (e) {
    next(e);
  }
});


// Endpoints to interrogate a suspect using AI
app.post('/api/cases/:id/interrogate', async (req, res, next) => {
  try {
    const body = interrogateSchema.parse(req.body);
    const result = await interrogateSuspect(req.params.id, body.suspectId, body.question, body.history);
    if (!result) return res.status(404).json({ error: 'Case not found' });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

app.post('/api/cases/:id/suspects/:suspectId/interrogate', async (req, res, next) => {
  try {
    const payload = { ...req.body, suspectId: req.params.suspectId };
    const body = interrogateSchema.parse(payload);
    const result = await interrogateSuspect(req.params.id, req.params.suspectId, body.question, body.history);
    if (!result) return res.status(404).json({ error: 'Case not found' });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Centralized error-handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.name === 'ZodError' && Array.isArray(err.issues)) {
    const messages = err.issues.map((issue: any) => {
      const field = issue.path && issue.path.length > 0 ? issue.path.join('.') : '';
      return field ? `${field}: ${issue.message}` : issue.message;
    });
    return res.status(400).json({ error: messages.join('; ') || 'Invalid request payload.' });
  }

  if (err?.status && typeof err.status === 'number') {
    return res.status(err.status).json({ error: err.message });
  }

  if (err instanceof CaseGenerationError) {
    return res.status(err.status).json({ error: err.message });
  }

  const isDev = env.nodeEnv === 'development';
  console.error('[server error]', err instanceof Error ? err.stack || err.message : err);
  return res.status(500).json({
    error: isDev && typeof err?.message === 'string'
      ? err.message.slice(0, 300)
      : 'An unexpected internal error occurred on the server.',
  });
});

// Boot server when executed directly
export async function startServer() {
  validateEnv();
  await connectDb();
  if (mongoReady && !(await CaseModel.exists({ _id: seedCase._id }))) {
    await CaseModel.create(seedCase);
  }
  return app.listen(env.port, () => {
    console.log(`AI Mystery Room API listening on http://localhost:${env.port}`);
  });
}

// Start if run directly as application entry point
const isDirectRun = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'))
);

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
