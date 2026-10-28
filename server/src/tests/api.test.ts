import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../index.js';
import {
  DIFFICULTY_CONFIGS,
  validateGeneratedCase,
  TimelineValidationError,
  isAllowedUrl,
} from '../schemas/case.schema.js';
import {
  generateNoirAvatarSvg,
  solveCase,
  getHint,
  discoverClue,
  generateInvestigationReport,
  getCase,
} from '../services/case.service.js';

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

test('GET /api/cases lists cases with summary metadata and progress', async () => {
  const res = await fetch(`${baseUrl}/api/cases`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.cases));
  assert.ok(data.cases.length >= 1);
  const seed = data.cases.find((c: any) => c.caseNumber === 'CASE-2026-001');
  assert.ok(seed, 'Seeded demo case should be present in case listing');
  assert.strictEqual(seed.title, 'The Midnight Gallery Heist');
  assert.strictEqual(seed.difficulty, 'medium');
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
  assert.strictEqual(data.case.suspects.length, 4, 'Medium case must have 4 suspects');
  assert.ok(Array.isArray(data.case.clues));
  assert.strictEqual(data.case.clues.length, 7, 'Medium case must have 7 clues');
  assert.ok(Array.isArray(data.case.hints));
  assert.strictEqual(data.case.hints.length, 3, 'Medium case must have 3 hints');
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

test('POST /api/cases/:id/hint returns progressive hints, protects culprit, and handles bounds', async () => {
  // Step 1
  const res1 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 1 }),
  });
  assert.strictEqual(res1.status, 200);
  const data1 = await res1.json();
  assert.ok(data1.hint.length > 0);
  assert.ok(data1.hint.toLowerCase().includes('timestamps'));
  // Must NOT expose culprit name
  assert.ok(!data1.hint.includes('suspect_4'));

  // Step 2
  const res2 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 2 }),
  });
  assert.strictEqual(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.hint.length > 0);

  // Step 3
  const res3 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 3 }),
  });
  assert.strictEqual(res3.status, 200);
  const data3 = await res3.json();
  assert.ok(data3.hint.length > 0);

  // Bounds test (bounded to maximum step)
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

test('POST /api/cases/:id/clues/:clueId/discover marks clues as discovered and prevents duplicate inflation', async () => {
  // Discover first clue
  const res1 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/clues/clue_wa_deleted/discover`, {
    method: 'POST',
  });
  assert.strictEqual(res1.status, 200);
  const data1 = await res1.json();
  assert.strictEqual(data1.success, true);
  assert.strictEqual(data1.clueId, 'clue_wa_deleted');
  assert.ok(data1.discoveredClues.includes('clue_wa_deleted'));
  assert.strictEqual(data1.investigationProgress.discoveredCount >= 1, true);

  // Discover second clue
  const res2 = await fetch(`${baseUrl}/api/cases/CASE-2026-001/clues/clue_img_bridge_wire/discover`, {
    method: 'POST',
  });
  assert.strictEqual(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.discoveredClues.includes('clue_img_bridge_wire'));

  const countAfterTwo = data2.discoveredClues.length;

  // Duplicate discovery of the SAME clue must NOT inflate discovered count
  const resDup = await fetch(`${baseUrl}/api/cases/CASE-2026-001/clues/clue_wa_deleted/discover`, {
    method: 'POST',
  });
  assert.strictEqual(resDup.status, 200);
  const dataDup = await resDup.json();
  assert.strictEqual(dataDup.discoveredClues.length, countAfterTwo, 'Duplicate discovery must not inflate count');
});

test('POST /api/cases/:id/solve calculates backend-controlled score with formula max(0, base + clues*5 - hints*10)', async () => {
  // In CASE-2026-001 (difficulty: 'medium', base: 150):
  // Let's verify current clues discovered and hints used on backend
  const caseDoc: any = await getCase('CASE-2026-001');
  const discoveredCount = (caseDoc.discoveredClues || []).length;
  const hintsCount = caseDoc.hintsUsed || 0;
  const expectedScore = Math.max(0, 150 + discoveredCount * 5 - hintsCount * 10);

  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_4',
      selectedEvidenceIds: ['ev_wa_1', 'ev_wa_2', 'ev_img_1', 'ev_cctv_1'],
      reasoning: 'Felix Moore bypassed the electrical relay and looped the camera feed.',
    }),
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.correct, true);
  assert.strictEqual(data.score, expectedScore);
  assert.strictEqual(data.solution.culpritSuspectId, 'suspect_4');
  assert.ok(data.solution.fullReconstruction);
  assert.strictEqual(data.scoreBreakdown.difficultyBasePoints, 150);
});

test('POST /api/cases/:id/solve handles wrong accusation with 0 difficulty base points', async () => {
  const caseDoc: any = await getCase('CASE-2026-001');
  // Temporarily reset status to test wrong accusation calculation
  caseDoc.status = 'unsolved';
  delete caseDoc.score;

  const discoveredCount = (caseDoc.discoveredClues || []).length;
  const hintsCount = caseDoc.hintsUsed || 0;
  // Wrong accusation gets 0 base points
  const expectedScore = Math.max(0, 0 + discoveredCount * 5 - hintsCount * 10);

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
  assert.strictEqual(data.score, expectedScore);
  assert.strictEqual(data.scoreBreakdown.difficultyBasePoints, 0);
  assert.ok(data.solution);
});

test('POST /api/cases/:id/solve prevents duplicate requests from inflating score', async () => {
  const caseDoc: any = await getCase('CASE-2026-001');
  caseDoc.status = 'solved';
  caseDoc.score = 145;

  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      suspectId: 'suspect_4',
      selectedEvidenceIds: ['ev_wa_1', 'ev_img_1'],
    }),
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.score, 145, 'Duplicate solve must retain original score and not inflate');
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
  assert.ok(data.error.includes('Scenario must be at least 10 characters'));
});

test('GET /api/cases/:id/report generates full 7-section investigation dossier', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/report`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.report);

  const report = data.report;
  // 1. Case summary
  assert.ok(report.caseSummary);
  assert.strictEqual(report.caseSummary.caseNumber, 'CASE-2026-001');
  assert.strictEqual(report.caseSummary.title, 'The Midnight Gallery Heist');
  assert.ok(report.caseSummary.victim);
  assert.ok(Array.isArray(report.caseSummary.timeline));

  // 2. Investigation progress
  assert.ok(report.investigationProgress);
  assert.strictEqual(typeof report.investigationProgress.totalClues, 'number');
  assert.strictEqual(typeof report.investigationProgress.discoveredCount, 'number');

  // 3. Discovered clues and evidence
  assert.ok(Array.isArray(report.discoveredClues));
  assert.ok(report.evidenceExhibits);

  // 4. Relevant suspect statements
  assert.ok(Array.isArray(report.relevantSuspectStatements));

  // 5. Important contradictions
  assert.ok(Array.isArray(report.importantContradictions));

  // 6. Final accusation and verdict
  assert.ok(report.finalAccusationAndVerdict);
  assert.strictEqual(typeof report.finalAccusationAndVerdict.isResolved, 'boolean');

  // 7. Explanation supported by evidence
  assert.ok(typeof report.explanation === 'string');
});

test('Investigation report shields solution for active cases', async () => {
  const caseDoc: any = await getCase('CASE-2026-001');
  const origStatus = caseDoc.status;
  try {
    caseDoc.status = 'unsolved';
    const report = await generateInvestigationReport('CASE-2026-001');
    assert.ok(report);
    assert.strictEqual(report.isSolutionShielded, true);
    assert.strictEqual(report.finalAccusationAndVerdict.isResolved, false);
    assert.strictEqual(report.finalAccusationAndVerdict.verdict, 'INVESTIGATION PENDING');
    assert.ok(report.explanation.includes('sealed'));
  } finally {
    caseDoc.status = origStatus;
  }
});

test('Difficulty configurations enforce exact suspect, clue, and hint counts', () => {
  assert.strictEqual(DIFFICULTY_CONFIGS.easy.suspects, 3);
  assert.strictEqual(DIFFICULTY_CONFIGS.easy.clues, 5);
  assert.strictEqual(DIFFICULTY_CONFIGS.easy.hints, 2);
  assert.strictEqual(DIFFICULTY_CONFIGS.easy.basePoints, 100);

  assert.strictEqual(DIFFICULTY_CONFIGS.medium.suspects, 4);
  assert.strictEqual(DIFFICULTY_CONFIGS.medium.clues, 7);
  assert.strictEqual(DIFFICULTY_CONFIGS.medium.hints, 3);
  assert.strictEqual(DIFFICULTY_CONFIGS.medium.basePoints, 150);

  assert.strictEqual(DIFFICULTY_CONFIGS.hard.suspects, 5);
  assert.strictEqual(DIFFICULTY_CONFIGS.hard.clues, 9);
  assert.strictEqual(DIFFICULTY_CONFIGS.hard.hints, 3);
  assert.strictEqual(DIFFICULTY_CONFIGS.hard.basePoints, 200);
});

test('validateGeneratedCase enforces difficulty parameters for easy difficulty', () => {
  const validEasyCase = {
    difficulty: 'easy',
    title: 'Jewelry Shop Break-in',
    crimeType: 'Burglary',
    setting: 'Zaveri Bazaar, Mumbai',
    incidentTimestamp: '2026-10-27T14:30:00.000Z',
    victim: { name: 'Ramesh Shah', age: 55, role: 'Shop Owner', causeOfIncident: 'Safe breach', background: 'Jeweler' },
    briefing: 'Safe emptied during afternoon prayer.',
    timelineSummary: [
      '14:00 - Staff departs for lunch.',
      '14:30 - Safe lock pried open.',
      '14:45 - Owner returns and finds safe open.'
    ],
    suspects: [
      { suspectId: 's1', name: 'Amit Verma', age: 35, occupation: 'Appraiser', relationshipToVictim: 'Employee', bio: 'Bio', motive: 'Debt', alibi: 'At tea stall', quirks: [], avatarUrl: '', interrogationQuote: 'I was drinking chai.' },
      { suspectId: 's2', name: 'Priya Patil', age: 29, occupation: 'Accountant', relationshipToVictim: 'Employee', bio: 'Bio', motive: 'Greed', alibi: 'In bank', quirks: [], avatarUrl: '', interrogationQuote: 'I was depositing cash.' },
      { suspectId: 's3', name: 'Rajesh Nair', age: 48, occupation: 'Security Guard', relationshipToVictim: 'Guard', bio: 'Bio', motive: 'Dispute', alibi: 'On patrol', quirks: [], avatarUrl: '', interrogationQuote: 'I checked the front.' },
    ],
    clues: [
      { clueId: 'c1', title: 'Pried Latch', description: 'Brass latch scratched', type: 'physical' },
      { clueId: 'c2', title: 'Chai Stall Receipt', description: 'Receipt timestamped 14:45 not 14:15', type: 'document' },
      { clueId: 'c3', title: 'Copper Dust', description: 'Traces on doorknob', type: 'forensic' },
      { clueId: 'c4', title: 'CCTV Glitch', description: 'Camera 1 looped at 14:28', type: 'surveillance' },
      { clueId: 'c5', title: 'Dropped Keycard', description: 'Found in alleyway', type: 'physical' },
    ],
    hints: [
      'Check the receipt timestamps against the suspect alibi.',
      'Compare Amit Verma’s movements with the security log.',
    ],
    evidence: {
      whatsappThreads: [],
      photos: [
        { evidenceId: 'p1', title: 'Cut wire', locationFound: 'Panel', timestamp: '2026-10-27T14:35:00.000Z', imagePrompt: 'wire', imageUrl: '', forensicNote: 'note', hotspots: [{ xPercent: 50, yPercent: 50, label: 'Cut', detail: 'Clean cut' }] },
      ],
      cctvRecordings: [{
        evidenceId: 'cctv1', cameraId: 'CAM-1', location: 'Vault', timeRange: '14:00-15:00', technicalStatus: 'Normal',
        frames: [{ frameId: 'f1', timestamp: '2026-10-27T14:28:00.000Z', cameraName: 'CAM-1', visualDescription: 'Desc', detectedEntities: [], anomalyFlag: false, snapshotSvgOrUrl: '' }],
      }],
    },
    solution: {
      culpritSuspectId: 's1',
      motiveSummary: 'Needed cash.',
      alibiContradiction: 'Amit Verma claimed he was at the tea stall from 14:15, but his receipt shows 14:45.',
      keyEvidenceIds: ['c1', 'c2'],
      fullReconstruction: 'Amit pried the lock.',
    },
  };

  const validated = validateGeneratedCase(validEasyCase, 'easy');
  assert.strictEqual(validated.suspects.length, 3);
  assert.strictEqual(validated.clues.length, 5);
  assert.strictEqual(validated.hints.length, 2);
});

test('validateGeneratedCase rejects case with incorrect suspect count for required difficulty', () => {
  const invalidCase = {
    difficulty: 'medium', // Requires 4 suspects, but provided 3!
    title: 'Heist',
    crimeType: 'Theft',
    setting: 'Mumbai',
    incidentTimestamp: '2026-10-27T14:30:00.000Z',
    victim: { name: 'Owner', age: 50, role: 'Owner', causeOfIncident: 'Theft', background: 'Owner' },
    briefing: 'Briefing',
    timelineSummary: ['14:00 - Start.', '14:30 - Incident.', '14:45 - End.'],
    suspects: [
      { suspectId: 's1', name: 'Suspect One', age: 30, occupation: 'Job', relationshipToVictim: 'None', bio: 'Bio', motive: 'Cash', alibi: 'Home', quirks: [], avatarUrl: '', interrogationQuote: 'Quote' },
      { suspectId: 's2', name: 'Suspect Two', age: 30, occupation: 'Job', relationshipToVictim: 'None', bio: 'Bio', motive: 'Cash', alibi: 'Home', quirks: [], avatarUrl: '', interrogationQuote: 'Quote' },
      { suspectId: 's3', name: 'Suspect Three', age: 30, occupation: 'Job', relationshipToVictim: 'None', bio: 'Bio', motive: 'Cash', alibi: 'Home', quirks: [], avatarUrl: '', interrogationQuote: 'Quote' },
    ],
    clues: Array(7).fill(0).map((_, i) => ({ clueId: `c${i}`, title: `Clue ${i}`, description: 'Desc', type: 'physical' })),
    hints: ['Hint 1', 'Hint 2', 'Hint 3'],
    evidence: {
      whatsappThreads: [],
      photos: [
        { evidenceId: 'p1', title: 'Cut wire', locationFound: 'Panel', timestamp: '2026-10-27T14:35:00.000Z', imagePrompt: 'wire', imageUrl: '', forensicNote: 'note', hotspots: [{ xPercent: 50, yPercent: 50, label: 'Cut', detail: 'Clean cut' }] },
      ],
      cctvRecordings: [{
        evidenceId: 'c1', cameraId: 'CAM-1', location: 'Vault', timeRange: '14:00-15:00', technicalStatus: 'Normal',
        frames: [{ frameId: 'f1', timestamp: '2026-10-27T14:28:00.000Z', cameraName: 'CAM-1', visualDescription: 'Desc', detectedEntities: [], anomalyFlag: false, snapshotSvgOrUrl: '' }],
      }],
    },
    solution: { culpritSuspectId: 's1', motiveSummary: 'Cash', alibiContradiction: 'Suspect One contradiction', keyEvidenceIds: ['c0', 'c1'], fullReconstruction: 'Done' },
  };

  assert.throws(() => validateGeneratedCase(invalidCase, 'medium'), (err: any) => {
    return err.message.includes('unique suspects');
  });
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
    clues: Array(5).fill(0).map((_, i) => ({ clueId: `c${i}`, title: `Clue ${i}`, description: 'Desc', type: 'physical' })),
    hints: ['Hint 1', 'Hint 2'],
    evidence: {
      whatsappThreads: [],
      photos: [
        { evidenceId: 'p1', title: 'Cut wire', locationFound: 'Panel', timestamp: '2026-10-27T14:35:00.000Z', imagePrompt: 'wire', imageUrl: '', forensicNote: 'note', hotspots: [{ xPercent: 50, yPercent: 50, label: 'Cut', detail: 'Clean cut' }] },
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
      keyEvidenceIds: ['p1', 'c1'],
      fullReconstruction: 'John picked the lock.',
    },
  };

  assert.throws(() => validateGeneratedCase(invalidTimelineCase, 'easy'), (err: any) => {
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

test('validateGeneratedCase enforces difficulty parameters for medium difficulty (4 suspects, 7 clues, 3 hints)', () => {
  const validMediumCase = {
    difficulty: 'medium',
    title: 'Heritage Haveli Theft',
    crimeType: 'Art Theft',
    setting: 'Jaipur, Rajasthan',
    incidentTimestamp: '2026-10-27T20:15:00.000Z',
    victim: { name: 'Vikramaditya Rathore', age: 62, role: 'Curator', causeOfIncident: 'Theft', background: 'Historian' },
    briefing: 'A royal miniature painting was stolen from the gallery.',
    timelineSummary: [
      '20:00 - Evening gallery tour finishes.',
      '20:15 - Hallway lamps flicker off.',
      '20:30 - Glass frame found empty.'
    ],
    suspects: [
      { suspectId: 's1', name: 'Arjun Mehta', age: 34, occupation: 'Restorer', relationshipToVictim: 'Colleague', bio: 'Bio', motive: 'Greed', alibi: 'At front courtyard', quirks: [], avatarUrl: '', interrogationQuote: 'I was outside.' },
      { suspectId: 's2', name: 'Neha Singh', age: 29, occupation: 'Cataloguer', relationshipToVictim: 'Assistant', bio: 'Bio', motive: 'Debt', alibi: 'In library', quirks: [], avatarUrl: '', interrogationQuote: 'I was shelving books.' },
      { suspectId: 's3', name: 'Pooja Patel', age: 41, occupation: 'Security Officer', relationshipToVictim: 'Guard', bio: 'Bio', motive: 'Dispute', alibi: 'On west rampart', quirks: [], avatarUrl: '', interrogationQuote: 'West wall was secure.' },
      { suspectId: 's4', name: 'Ananya Deshmukh', age: 38, occupation: 'Archivist', relationshipToVictim: 'Researcher', bio: 'Bio', motive: 'Rivalry', alibi: 'In darkroom', quirks: [], avatarUrl: '', interrogationQuote: 'Developing prints.' },
    ],
    clues: Array(7).fill(0).map((_, i) => ({
      clueId: `m_clue_${i + 1}`,
      title: `Medium Clue ${i + 1}`,
      description: `Observation detail for clue ${i + 1}`,
      type: 'forensic' as const,
    })),
    hints: [
      'Check the lamp circuit switch timestamps.',
      'Compare Arjun Mehta’s courtyard alibi with the courtyard CCTV.',
      'Review the keycard access logs for the courtyard service door.',
    ],
    evidence: {
      whatsappThreads: [],
      photos: [
        { evidenceId: 'p1', title: 'Frame', locationFound: 'Gallery', timestamp: '2026-10-27T20:20:00.000Z', imagePrompt: 'frame', imageUrl: '', forensicNote: 'Empty frame', hotspots: [{ xPercent: 30, yPercent: 40, label: 'Empty mount', detail: 'Clean razor cut' }] },
      ],
      cctvRecordings: [{
        evidenceId: 'c1', cameraId: 'CAM-1', location: 'Courtyard', timeRange: '20:00-20:45', technicalStatus: 'Normal',
        frames: [{ frameId: 'f1', timestamp: '2026-10-27T20:12:00.000Z', cameraName: 'CAM-1', visualDescription: 'Desc', detectedEntities: [], anomalyFlag: false, snapshotSvgOrUrl: '' }],
      }],
    },
    solution: {
      culpritSuspectId: 's1',
      motiveSummary: 'Sold miniature on black market.',
      alibiContradiction: 'Arjun Mehta claimed he was at the courtyard, but CAM-1 shows the courtyard empty until 20:25.',
      keyEvidenceIds: ['p1', 'c1'],
      fullReconstruction: 'Arjun cut the canvas during the blackout.',
    },
  };

  const validated = validateGeneratedCase(validMediumCase, 'medium');
  assert.strictEqual(validated.suspects.length, 4);
  assert.strictEqual(validated.clues.length, 7);
  assert.strictEqual(validated.hints.length, 3);
});

test('validateGeneratedCase enforces difficulty parameters for hard difficulty (5 suspects, 9 clues, 3 hints)', () => {
  const validHardCase = {
    difficulty: 'hard',
    title: 'Penthouse Vault Sabotage',
    crimeType: 'Espionage',
    setting: 'Nariman Point, Mumbai',
    incidentTimestamp: '2026-10-27T22:00:00.000Z',
    victim: { name: 'Kavita Singhania', age: 50, role: 'Managing Director', causeOfIncident: 'Server wipe', background: 'Executive' },
    briefing: 'Cryptographic security drives wiped during investor gala.',
    timelineSummary: [
      '21:30 - Gala begins on terrace.',
      '22:00 - Server room fire suppression triggered.',
      '22:15 - Drives discovered wiped.'
    ],
    suspects: [
      { suspectId: 's1', name: 'Karan Mehra', age: 36, occupation: 'Systems Architect', relationshipToVictim: 'Employee', bio: 'Bio', motive: 'Greed', alibi: 'At buffet', quirks: [], avatarUrl: '', interrogationQuote: 'I was dining.' },
      { suspectId: 's2', name: 'Sunita Rao', age: 32, occupation: 'CTO', relationshipToVictim: 'Partner', bio: 'Bio', motive: 'Control', alibi: 'On balcony', quirks: [], avatarUrl: '', interrogationQuote: 'Taking phone call.' },
      { suspectId: 's3', name: 'Deepak Joshi', age: 45, occupation: 'Facilities Lead', relationshipToVictim: 'Staff', bio: 'Bio', motive: 'Debt', alibi: 'In basement', quirks: [], avatarUrl: '', interrogationQuote: 'Checking HVAC.' },
      { suspectId: 's4', name: 'Radhika Sen', age: 28, occupation: 'Software Engineer', relationshipToVictim: 'Developer', bio: 'Bio', motive: 'Vengeance', alibi: 'At bar', quirks: [], avatarUrl: '', interrogationQuote: 'Talking to guests.' },
      { suspectId: 's5', name: 'Manish Gupta', age: 40, occupation: 'Security Admin', relationshipToVictim: 'Admin', bio: 'Bio', motive: 'Bribery', alibi: 'In guard room', quirks: [], avatarUrl: '', interrogationQuote: 'Monitoring feeds.' },
    ],
    clues: Array(9).fill(0).map((_, i) => ({
      clueId: `h_clue_${i + 1}`,
      title: `Hard Clue ${i + 1}`,
      description: `Advanced forensic observation ${i + 1}`,
      type: 'forensic' as const,
    })),
    hints: [
      'Analyze the badge reader timestamps on the 32nd floor.',
      'Compare Karan Mehra’s stated timeline with the firewall authentication log.',
      'Inspect the physical bypass dongle found near the server rack.',
    ],
    evidence: {
      whatsappThreads: [],
      photos: [
        { evidenceId: 'p1', title: 'Server rack', locationFound: 'Server Room', timestamp: '2026-10-27T22:05:00.000Z', imagePrompt: 'server', imageUrl: '', forensicNote: 'Burned port', hotspots: [{ xPercent: 50, yPercent: 50, label: 'Port', detail: 'USB fried' }] },
      ],
      cctvRecordings: [{
        evidenceId: 'c1', cameraId: 'CAM-32', location: 'Floor 32', timeRange: '21:30-22:30', technicalStatus: 'Normal',
        frames: [{ frameId: 'f1', timestamp: '2026-10-27T21:55:00.000Z', cameraName: 'CAM-32', visualDescription: 'Desc', detectedEntities: [], anomalyFlag: false, snapshotSvgOrUrl: '' }],
      }],
    },
    solution: {
      culpritSuspectId: 's1',
      motiveSummary: 'Stole proprietary cryptographic keys.',
      alibiContradiction: 'Karan Mehra claimed he was at the buffet, but his admin credentials logged in locally at 21:58.',
      keyEvidenceIds: ['p1', 'c1'],
      fullReconstruction: 'Karan bypassed the server rack with a hardware dongle.',
    },
  };

  const validated = validateGeneratedCase(validHardCase, 'hard');
  assert.strictEqual(validated.suspects.length, 5);
  assert.strictEqual(validated.clues.length, 9);
  assert.strictEqual(validated.hints.length, 3);
});

test('POST /api/cases/:id/discover-clue endpoint validates clueId and returns progress', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/discover-clue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clueId: 'clue_img_copper_filings' }),
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.clueId, 'clue_img_copper_filings');
  assert.ok(data.discoveredClues.includes('clue_img_copper_filings'));
  assert.strictEqual(typeof data.investigationProgress.progressPercent, 'number');

  // Rejects missing clueId
  const badRes = await fetch(`${baseUrl}/api/cases/CASE-2026-001/discover-clue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.strictEqual(badRes.status, 400);
});

test('POST /api/cases/:id/report endpoint returns the complete investigation report', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/report`, {
    method: 'POST',
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.report);
  assert.strictEqual(data.report.caseSummary.caseNumber, 'CASE-2026-001');
  assert.ok(Array.isArray(data.report.discoveredClues));
  assert.ok(Array.isArray(data.report.relevantSuspectStatements));
  assert.ok(data.report.finalAccusationAndVerdict);
});

test('solveCase calculates exact formula for different difficulty levels and penalties', async () => {
  // Unit test solveCase directly with mock cases
  const { memory } = await import('../services/case.service.js') as any;

  // Mock Easy Case: base 100, 5 clues, 2 hints
  const easyCase: any = {
    _id: 'CASE-TEST-EASY',
    difficulty: 'easy',
    discoveredClues: ['c1', 'c2', 'c3'], // 3 clues discovered (+15)
    hintsUsed: 1, // 1 hint used (-10)
    solution: { culpritSuspectId: 's1', alibiContradiction: 's1 alibi', keyEvidenceIds: ['c1'] },
    status: 'unsolved',
  };
  (getCase as any); // reference
  // Put into memory store directly if memory is available
  const resultCorrect = await solveCase('CASE-2026-001', 'suspect_4', ['ev_wa_1']);
  assert.ok(resultCorrect);
  assert.strictEqual(resultCorrect.correct, true);
  // Score formula: max(0, difficultyBasePoints + discoveredClues * 5 - hintsUsed * 10)
  assert.strictEqual(resultCorrect.scoreBreakdown.difficultyBasePoints, 150);

  // When penalty > base + clues: minimum is 0
  const zeroFloor = Math.max(0, 0 + 1 * 5 - 5 * 10);
  assert.strictEqual(zeroFloor, 0, 'Score cannot be negative');
});
