import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { app } from '../index.js';
import { isAllowedUrl } from '../schemas/case.schema.js';
import { MEDIA_DIR } from '../services/image.service.js';
import { generateCctvVideo, getFfmpegPath } from '../services/video.service.js';
import { getCase } from '../services/case.service.js';

let server: http.Server;
let baseUrl = '';

test.before(async () => {
  await new Promise<void>((resolve) => {
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
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test('isAllowedUrl validates relative /api/media/ video paths and rejects malicious schemes', () => {
  // Valid relative media paths
  assert.strictEqual(isAllowedUrl('/api/media/cctv_test_video.mp4'), true);
  assert.strictEqual(isAllowedUrl('/api/media/evidence_cf_123.jpg'), true);

  // Valid absolute URLs
  assert.strictEqual(isAllowedUrl('https://example.com/cctv.mp4'), true);
  assert.strictEqual(isAllowedUrl('http://localhost:5000/api/media/cctv.mp4'), true);

  // Valid data URIs
  assert.strictEqual(isAllowedUrl('data:image/svg+xml,%3Csvg%3E%3C/svg%3E'), true);

  // Empty string / undefined
  assert.strictEqual(isAllowedUrl(''), true);
  assert.strictEqual(isAllowedUrl(undefined), true);

  // Malicious or unsupported schemes
  assert.strictEqual(isAllowedUrl('javascript:alert(1)'), false);
  assert.strictEqual(isAllowedUrl('file:///etc/passwd'), false);
  assert.strictEqual(isAllowedUrl('data:text/html,<script>alert(1)</script>'), false);
});

test('getFfmpegPath returns an existing binary on the system', () => {
  const ffmpegPath = getFfmpegPath();
  assert.ok(typeof ffmpegPath === 'string' && ffmpegPath.length > 0);
  assert.ok(fs.existsSync(ffmpegPath) || ffmpegPath === 'ffmpeg');
});

test('POST /api/cases/:id/cctv/:evidenceId/generate-video rejects invalid case ID with 404', async () => {
  const res = await fetch(`${baseUrl}/api/cases/NONEXISTENT-CASE/cctv/ev_cctv_1/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.error, 'Case not found');
});

test('POST /api/cases/:id/cctv/:evidenceId/generate-video rejects invalid evidence ID with 404', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/cctv/ev_invalid_cctv_99/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.error, 'CCTV recording not found');
});

test('POST /api/cases/:id/cctv/:evidenceId/generate-video synthesizes a genuine CCTV MP4 video and serves it with streaming headers', async () => {
  const res = await fetch(`${baseUrl}/api/cases/CASE-2026-001/cctv/ev_cctv_1/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }),
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json();

  assert.strictEqual(data.success, true);
  assert.strictEqual(data.evidenceId, 'ev_cctv_1');
  assert.strictEqual(data.provider, 'cctv-synth');
  assert.strictEqual(data.isAiGenerated, true);
  assert.strictEqual(typeof data.videoUrl, 'string');
  assert.ok(data.videoUrl.startsWith('/api/media/cctv_'));
  assert.ok(data.videoUrl.endsWith('.mp4'));

  // Verify the video file exists on disk and is non-empty
  const fileName = path.basename(data.videoUrl);
  const filePath = path.join(MEDIA_DIR, fileName);
  assert.ok(fs.existsSync(filePath), 'Physical MP4 video file must exist on disk');
  const stat = fs.statSync(filePath);
  assert.ok(stat.size > 50000, `MP4 video file must have reasonable size (>50KB), got ${stat.size} bytes`);

  // Verify the video is served via static media route with correct headers
  const videoStreamRes = await fetch(`${baseUrl}${data.videoUrl}`, {
    headers: { Range: 'bytes=0-1024' },
  });
  assert.ok(videoStreamRes.status === 200 || videoStreamRes.status === 206, 'Should respond with 200 or 206 Partial Content');
  assert.strictEqual(videoStreamRes.headers.get('content-type'), 'video/mp4');
});

test('generateCctvVideo reuses existing video without re-rendering when force is false', async () => {
  const caseDoc: any = await getCase('CASE-2026-001');
  assert.ok(caseDoc, 'Demo case must exist');

  const recording = caseDoc.evidence.cctvRecordings[0];
  assert.ok(recording.videoUrl, 'Video URL must have been populated by previous test');

  const start = Date.now();
  const cachedResult = await generateCctvVideo(caseDoc, recording.evidenceId, false);
  const duration = Date.now() - start;

  assert.strictEqual(cachedResult.videoUrl, recording.videoUrl);
  assert.ok(duration < 100, `Cached video retrieval should be nearly instantaneous (<100ms), took ${duration}ms`);
});
