import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../index.js';
import { validateGeneratedCase, TimelineValidationError } from '../schemas/case.schema.js';
import { generateNoirAvatarSvg, solveCase, getHint } from '../services/case.service.js';

let server: http.Server;
let baseUrl = '';

test.before(async () => {
  await new Promise<void>((resolve) => {
    // Listen on an ephemeral port (0) for tests
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test('GET /api/health returns 200 with status and configuration state', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.status, 'ok');
  assert.ok(data.dbState === 'connected' || data.dbState === 'memory');
  assert.strictEqual(typeof data.aiConfigured, 'boolean');
});

test('GET /api/cases lists cases with summary metadata', async () => {
  const res = await fetch(`${baseUrl}/api/cases`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.cases));
  assert.ok(data.cases.length >= 1);
  const seed = data.cases.find((c: any) => c.caseNumber === 'CASE-2026-001');
  assert.ok(seed, 'Seeded demo case should be present in case listing');
  assert.strictEqual(seed.title, 'The Midnight Gallery Heist');
});

test('GET /api/cases/:id retrieves case with solution strictly shielded', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.case);
  assert.strictEqual(data.case._id, 'CASE-2026-001');
  // Architectural Security Rule: solution MUST be stripped from public case endpoint
  assert.strictEqual(data.case.solution, undefined, 'Solution object must not be exposed');
  assert.ok(Array.isArray(data.case.suspects));
  assert.ok(Array.isArray(data.case.timelineSummary));
  assert.ok(data.case.evidence.whatsappThreads);
  assert.ok(data.case.evidence.photos);
  assert.ok(data.case.evidence.cctvRecordings);
});

test('GET /api/cases/:id returns 404 for non-existent case', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-DOES-NOT-EXIST`);
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.error, 'Case not found');
});

test('POST /api/cases/:id/hint returns progressive hints and handles bounds', async () => {
  // Step 1
  const res1 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 1 }),
  });
  assert.strictEqual(res1.status, 200);
  const data1 = await res1.json();
  assert.ok(data1.hint.includes('timestamps'));

  // Step 2
  const res2 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 2 }),
  });
  assert.strictEqual(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.hint.includes('alibis'));

  // Step 3 (reveals contradiction)
  const res3 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 3 }),
  });
  assert.strictEqual(res3.status, 200);
  const data3 = await res3.json();
  assert.ok(data3.hint.includes('contradiction'));

  // Step 99 (bounded to maximum step)
  const res99 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 99 }),
  });
  assert.strictEqual(res99.status, 200);
  const data99 = await res99.json();
  assert.ok(data99.hint.length > 0);

  // Missing case
  const resMissing = await fetch(`${baseUrl}/api/cases/NON-EXISTENT/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 1 }),
  });
  assert.strictEqual(resMissing.status, 404);
});

test('POST /api/cases/:id/solve evaluates correct accusation and calculates 100 score', async () => {
  // In CASE-2026-001, culprit is suspect_4 (Felix Moore) and key evidence includes ev_wa_1, ev_wa_2, ev_img_1, ev_cctv_1
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_4',
      selectedEvidenceIds: ['ev_wa_1', 'ev_wa_2', 'ev_img_1', 'ev_cctv_1'],
      reasoning: 'Felix Moore bypassed the electrical relay and looped the camera.',
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.correct, true);
  assert.strictEqual(data.score, 100);
  assert.ok(data.solution);
  assert.strictEqual(data.solution.culpritSuspectId, 'suspect_4');
  assert.ok(data.solution.fullReconstruction);
});

test('POST /api/cases/:id/solve handles wrong accusation with 0 score and solution reveal', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_1', // Wrong suspect (Mara Chen)
      selectedEvidenceIds: ['ev_wa_1'],
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.correct, false);
  assert.strictEqual(data.score, 0);
  assert.ok(data.solution);
});

test('POST /api/cases/:id/solve prevents score inflation on duplicate evidence IDs', async () => {
  // Submitting 10 copies of the same evidence ID must NOT inflate score over 100
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_4',
      selectedEvidenceIds: Array(10).fill('ev_wa_1'),
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.correct, true);
  // With 1 unique match out of 4 keys: 70 + round(30 * 1 / 4) = 78
  assert.strictEqual(data.score, 78);
  assert.ok(data.score <= 100);
});

test('POST /api/cases/:id/solve rejects invalid payload with clean 400 error', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suspectId: '' }),
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.ok(typeof data.error === 'string');
  assert.ok(data.error.includes('suspect'));
});

test('POST /api/cases/generate rejects short scenario with clean 400 error', async () => {
  const res = await fetch(`${baseUrl}/api/cases/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Short' }),
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.ok(typeof data.error === 'string');
  assert.ok(data.error.includes('prompt') || data.error.includes('characters'));
});

test('validateGeneratedCase enforces timeline ordering and normalizes dash punctuation', () => {
  const validCase = {
    title: 'Bank Vault Heist',
    crimeType: 'Heist',
    setting: 'Downtown Bank',
    incidentTimestamp: '2026-10-27T14:30:00.000Z',
    victim: { name: 'Bank Staff', age: 40, role: 'Cashier', causeOfIncident: 'Vault breached', background: 'Vault guard' },
    briefing: 'Vault 4 was emptied during lunch.',
    timelineSummary: [
      '14:00 — Guard logs shift start.',
      '14:30 – Alarm wires cut.',
      '14:45 - Safe doors found open.'
    ],
    suspects: [
      { suspectId: 's1', name: 'John Doe', age: 35, occupation: 'Locksmith', relationshipToVictim: 'Contractor', bio: 'Bio', motive: 'Greed', alibi: 'At lunch', quirks: [], avatarUrl: '', interrogationQuote: 'Not me.' },
      { suspectId: 's2', name: 'Jane Smith', age: 29, occupation: 'Teller', relationshipToVictim: 'Coworker', bio: 'Bio', motive: 'Debt', alibi: 'At desk', quirks: [], avatarUrl: '', interrogationQuote: 'I saw a van.' },
      { suspectId: 's3', name: 'Bob Ray', age: 50, occupation: 'Guard', relationshipToVictim: 'Security', bio: 'Bio', motive: 'Grudge', alibi: 'On patrol', quirks: [], avatarUrl: '', interrogationQuote: 'Clean hallway.' },
    ],
    evidence: {
      whatsappThreads: [],
      photos: [
        { evidenceId: 'p1', title: 'Cut wire', locationFound: 'Panel', timestamp: '2026-10-27T14:35:00.000Z', imagePrompt: 'wire', imageUrl: '', forensicNote: 'note', hotspots: [{ xPercent: 50, yPercent: 50, label: 'Cut', detail: 'Clean cut' }] },
        { evidenceId: 'p2', title: 'Pry mark', locationFound: 'Door', timestamp: '2026-10-27T14:40:00.000Z', imagePrompt: 'door', imageUrl: '', forensicNote: 'note', hotspots: [{ xPercent: 10, yPercent: 10, label: 'Mark', detail: 'Steel mark' }] },
      ],
      cctvRecordings: [{
        evidenceId: 'c1', cameraId: 'CAM-1', location: 'Vault', timeRange: '14:00-15:00', technicalStatus: 'Normal',
        videoUrl: '', // empty string should be omitted safely by preprocessor
        frames: [{ frameId: 'f1', timestamp: '2026-10-27T14:28:00.000Z', cameraName: 'CAM-1', visualDescription: 'Desc', detectedEntities: [], anomalyFlag: false, snapshotSvgOrUrl: '' }],
      }],
    },
    solution: {
      culpritSuspectId: 's1',
      motiveSummary: 'Needed cash.',
      alibiContradiction: 'John Doe claimed he was at lunch, but his tools were found at the scene.',
      keyEvidenceIds: ['p1', 'p2'],
      fullReconstruction: 'John picked the lock.',
    },
  };

  const validated = validateGeneratedCase(validCase);
  assert.strictEqual(validated.title, 'Bank Vault Heist');
  assert.strictEqual(validated.evidence.cctvRecordings[0].videoUrl, undefined);
  assert.strictEqual(validated.timelineSummary[0], '14:00 - Guard logs shift start.');
  assert.strictEqual(validated.timelineSummary[1], '14:30 - Alarm wires cut.');
  assert.strictEqual(validated.timelineSummary[2], '14:45 - Safe doors found open.');
});

test('validateGeneratedCase rejects out-of-order timeline events', () => {
  const invalidTimelineCase = {
    title: 'Bank Vault Heist',
    crimeType: 'Heist',
    setting: 'Downtown Bank',
    incidentTimestamp: '2026-10-27T14:30:00.000Z',
    victim: { name: 'Bank Staff', age: 40, role: 'Cashier', causeOfIncident: 'Vault breached', background: 'Vault guard' },
    briefing: 'Vault 4 was emptied during lunch.',
    timelineSummary: [
      '14:45 - Safe doors found open.',
      '14:00 - Guard logs shift start.', // out of order!
      '14:30 - Alarm wires cut.'
    ],
    suspects: [
      { suspectId: 's1', name: 'John Doe', age: 35, occupation: 'Locksmith', relationshipToVictim: 'Contractor', bio: 'Bio', motive: 'Greed', alibi: 'At lunch', quirks: [], avatarUrl: '', interrogationQuote: 'Not me.' },
      { suspectId: 's2', name: 'Jane Smith', age: 29, occupation: 'Teller', relationshipToVictim: 'Coworker', bio: 'Bio', motive: 'Debt', alibi: 'At desk', quirks: [], avatarUrl: '', interrogationQuote: 'I saw a van.' },
      { suspectId: 's3', name: 'Bob Ray', age: 50, occupation: 'Guard', relationshipToVictim: 'Security', bio: 'Bio', motive: 'Grudge', alibi: 'On patrol', quirks: [], avatarUrl: '', interrogationQuote: 'Clean hallway.' },
    ],
    evidence: {
      whatsappThreads: [],
      photos: [
        { evidenceId: 'p1', title: 'Cut wire', locationFound: 'Panel', timestamp: '2026-10-27T14:35:00.000Z', imagePrompt: 'wire', imageUrl: '', forensicNote: 'note', hotspots: [{ xPercent: 50, yPercent: 50, label: 'Cut', detail: 'Clean cut' }] },
        { evidenceId: 'p2', title: 'Pry mark', locationFound: 'Door', timestamp: '2026-10-27T14:40:00.000Z', imagePrompt: 'door', imageUrl: '', forensicNote: 'note', hotspots: [{ xPercent: 10, yPercent: 10, label: 'Mark', detail: 'Steel mark' }] },
      ],
      cctvRecordings: [{
        evidenceId: 'c1', cameraId: 'CAM-1', location: 'Vault', timeRange: '14:00-15:00', technicalStatus: 'Normal',
        frames: [{ frameId: 'f1', timestamp: '2026-10-27T14:28:00.000Z', cameraName: 'CAM-1', visualDescription: 'Desc', detectedEntities: [], anomalyFlag: false, snapshotSvgOrUrl: '' }],
      }],
    },
    solution: {
      culpritSuspectId: 's1',
      motiveSummary: 'Needed cash.',
      alibiContradiction: 'John Doe claimed he was at lunch.',
      keyEvidenceIds: ['p1', 'p2'],
      fullReconstruction: 'John picked the lock.',
    },
  };

  assert.throws(() => validateGeneratedCase(invalidTimelineCase), (err: any) => {
    return err instanceof TimelineValidationError && err.message.includes('chronological order');
  });
});

test('generateNoirAvatarSvg produces valid SVG data URI with initials', () => {
  const svgUri = generateNoirAvatarSvg('Victor Vance', 0);
  assert.ok(svgUri.startsWith('data:image/svg+xml,'));
  const decoded = decodeURIComponent(svgUri.replace('data:image/svg+xml,', ''));
  assert.ok(decoded.includes('VV'), 'Should contain suspect initials');
  assert.ok(decoded.includes('VICTOR VANCE'), 'Should contain suspect name');
});

test('generateProceduralForensicSvg produces rich vector schematic and explicitly marks it NOT a real photograph', async () => {
  const { generateProceduralForensicSvg } = await import('../services/image.service.js');
  const samplePhoto = {
    evidenceId: 'ev_test_1',
    title: 'Shattered Display Glass',
    locationFound: 'North Wing Gallery',
    timestamp: '2026-10-27T14:35:00.000Z',
    imagePrompt: 'Macro crime scene photograph of shattered tempered display glass',
    imageUrl: '',
    forensicNote: 'Impact origin points to an interior tool strike.',
    hotspots: [
      { xPercent: 42, yPercent: 55, label: 'Impact Apex', detail: 'Radial fracture hub' },
    ],
  };

  const svgUri = generateProceduralForensicSvg(samplePhoto);
  assert.ok(svgUri.startsWith('data:image/svg+xml,'));
  const decoded = decodeURIComponent(svgUri.replace('data:image/svg+xml,', ''));
  assert.ok(decoded.includes('SHATTERED DISPLAY GLASS'), 'Must contain exhibit title');
  assert.ok(decoded.includes('NORTH WING GALLERY'), 'Must contain location found');
  assert.ok(
    decoded.includes('FORENSIC EVIDENCE SCHEMATIC // NOT A REAL PHOTOGRAPH'),
    'Must explicitly state that it is a procedural schematic and not a real photograph'
  );
  assert.ok(decoded.includes('cx="269"') && decoded.includes('cy="220"'), 'Must contain mapped hotspot coordinate rings');
});

test('generateEvidenceImage falls back cleanly to procedural SVG when AI image gen is disabled', async () => {
  const { generateEvidenceImage } = await import('../services/image.service.js');
  const samplePhoto = {
    evidenceId: 'ev_test_2',
    title: 'Fibers on Window Latch',
    locationFound: 'Library Balcony',
    timestamp: '2026-10-27T14:38:00.000Z',
    imagePrompt: 'Wool fibers caught in a brass sash latch',
    imageUrl: '',
    forensicNote: 'Navy blue wool fibers recovered with tweezers.',
    hotspots: [],
  };

  const { env } = await import('../config/env.js');
  const orig = env.enableAiImageGen;
  try {
    (env as any).enableAiImageGen = false;
    const result = await generateEvidenceImage(samplePhoto, 'Old Victorian Mansion');
    assert.strictEqual(typeof result.imageUrl, 'string');
    assert.ok(result.imageUrl.startsWith('data:image/svg+xml,'));
    assert.strictEqual(result.isAiGenerated, false);
  } finally {
    (env as any).enableAiImageGen = orig;
  }
});


test('GET /api/media serves cached evidence media files with static headers', async () => {
  const { MEDIA_DIR } = await import('../services/image.service.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const testFileName = `test_media_${Date.now()}.txt`;
  const testFilePath = path.join(MEDIA_DIR, testFileName);
  fs.writeFileSync(testFilePath, 'FORENSIC_MEDIA_TEST_PAYLOAD');

  try {
    const res = await fetch(`${baseUrl}/api/media/${testFileName}`);
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.strictEqual(body, 'FORENSIC_MEDIA_TEST_PAYLOAD');
  } finally {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  }
});

test('POST /api/cases/:id/evidence/:evidenceId/generate-image handles on-demand generation', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/evidence/ev_img_1/generate-image`, {
    method: 'POST',
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.evidenceId, 'ev_img_1');
  assert.strictEqual(typeof data.imageUrl, 'string');
  assert.strictEqual(typeof data.isAiGenerated, 'boolean');
  assert.strictEqual(typeof data.provider, 'string');
});

test('POST /api/cases/:id/evidence/:evidenceId/generate-image returns 404 for missing case or evidence', async () => {
  const missingCaseRes = await fetch(`${baseUrl}/api/cases/CASE-NOT-EXIST/evidence/ev_img_1/generate-image`, {
    method: 'POST',
  });
  assert.strictEqual(missingCaseRes.status, 404);

  const missingEvidenceRes = await fetch(`${baseUrl}/api/cases/CASE-2026-001/evidence/ev_non_existent/generate-image`, {
    method: 'POST',
  });
  assert.strictEqual(missingEvidenceRes.status, 404);
});

test('POST /api/cases/:id/interrogate handles valid suspect inquiry and shields solution', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_1',
      question: 'Where were you between 23:00 and 23:25?',
      history: [],
    }),
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.suspectId, 'suspect_1');
  assert.strictEqual(typeof data.answer, 'string');
  assert.ok(data.answer.length > 0);
  // Must NOT expose secret solution fields to the frontend
  assert.strictEqual(data.solution, undefined, 'Solution object must never be sent');
  assert.strictEqual(data.culpritSuspectId, undefined, 'Culprit ID must never be exposed');
  assert.strictEqual(data.fullReconstruction, undefined, 'Full reconstruction must never be exposed');
});

test('POST /api/cases/:id/interrogate rejects invalid case ID with 404', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-NOT-EXIST/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_1',
      question: 'Where were you?',
    }),
  });
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.error, 'Case not found');
});

test('POST /api/cases/:id/interrogate rejects invalid suspect ID with 404', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_ghost_999',
      question: 'Where were you?',
    }),
  });
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.error, 'Suspect not found');
});

test('POST /api/cases/:id/interrogate rejects empty question with 400 validation error', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_1',
      question: '   ',
    }),
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('Question must not be empty') || data.error.includes('question'));
});

test('POST /api/cases/:id/interrogate rejects excessively long question (>300 chars) with 400', async () => {
  const excessivelyLong = 'A'.repeat(350);
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_1',
      question: excessivelyLong,
    }),
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes('300 characters') || data.error.includes('question'));
});

test('POST /api/cases/:id/suspects/:suspectId/interrogate supports REST path parameter', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/suspects/suspect_2/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'Did you see anything on the dock?',
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.suspectId, 'suspect_2');
  assert.strictEqual(typeof data.answer, 'string');
});

test('POST /api/cases/:id/interrogate accepts multi-turn conversation history', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/interrogate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_3',
      question: 'Why were you in the restoration room so late?',
      history: [
        { role: 'user', content: 'What were you working on?' },
        { role: 'suspect', content: 'I was restoring an old oil painting.' },
      ],
    }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.suspectId, 'suspect_3');
  assert.strictEqual(typeof data.answer, 'string');
});


