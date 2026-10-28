import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('client API configuration and media URL resolution logic', async (t) => {
  const clientApiFile = path.resolve(currentDir, '../../../client/src/config/api.ts');
  const { getApiBaseUrl, getBackendOrigin, resolveMediaUrl }: any = await import(pathToFileURL(clientApiFile).href);

  await t.test('defaults to /api when VITE_API_BASE_URL is not set', () => {
    delete process.env.VITE_API_BASE_URL;
    const url = getApiBaseUrl();
    assert.strictEqual(url, '/api');
  });

  await t.test('appends /api if given host URL without /api', () => {
    process.env.VITE_API_BASE_URL = 'https://ai-mystery-room-msfn.onrender.com';
    const url = getApiBaseUrl();
    assert.strictEqual(url, 'https://ai-mystery-room-msfn.onrender.com/api');
  });

  await t.test('preserves /api and trims trailing slashes', () => {
    process.env.VITE_API_BASE_URL = 'https://ai-mystery-room-msfn.onrender.com/api/';
    const url = getApiBaseUrl();
    assert.strictEqual(url, 'https://ai-mystery-room-msfn.onrender.com/api');
  });

  await t.test('extracts backend origin for media asset resolution', () => {
    process.env.VITE_API_BASE_URL = 'https://ai-mystery-room-msfn.onrender.com/api';
    const mediaUrl = resolveMediaUrl('/api/media/evidence_cf_123.jpg');
    assert.strictEqual(mediaUrl, 'https://ai-mystery-room-msfn.onrender.com/api/media/evidence_cf_123.jpg');

    const videoUrl = resolveMediaUrl('/api/media/cctv_case_001.mp4');
    assert.strictEqual(videoUrl, 'https://ai-mystery-room-msfn.onrender.com/api/media/cctv_case_001.mp4');
  });

  await t.test('preserves absolute URLs and data URIs untouched', () => {
    assert.strictEqual(
      resolveMediaUrl('data:image/svg+xml,%3Csvg%3E%3C/svg%3E'),
      'data:image/svg+xml,%3Csvg%3E%3C/svg%3E'
    );
    assert.strictEqual(
      resolveMediaUrl('https://images.example.com/photo.jpg'),
      'https://images.example.com/photo.jpg'
    );
    assert.strictEqual(resolveMediaUrl(''), '');
    assert.strictEqual(resolveMediaUrl(null), '');
  });

  // Clean up
  delete process.env.VITE_API_BASE_URL;
});
