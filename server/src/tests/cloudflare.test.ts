import test from 'node:test';
import assert from 'node:assert';
import {
  detectImageExtension,
  buildForensicPhotoPrompt,
  generateEvidenceImage,
} from '../services/image.service.js';
import { env } from '../config/env.js';

test('detectImageExtension detects JPEG, PNG, and WEBP headers accurately', () => {
  // JPEG magic bytes: FF D8 FF
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.strictEqual(detectImageExtension(jpegHeader), 'jpg');

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.strictEqual(detectImageExtension(pngHeader), 'png');

  // WEBP magic bytes: RIFF....WEBP
  const webpHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  ]);
  assert.strictEqual(detectImageExtension(webpHeader), 'webp');

  // Unknown binary
  const randomBytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  assert.strictEqual(detectImageExtension(randomBytes), 'bin');
});

test('buildForensicPhotoPrompt creates detailed prompts for forensic categories without leaking solution', () => {
  const fingerprintItem = {
    evidenceId: 'ev_fp_1',
    title: 'Smudged Fingerprint on Display Counter',
    locationFound: 'Jewellery Shop Counter, Zaveri Bazaar, Mumbai',
    timestamp: '2026-10-27T20:15:00.000Z',
    imagePrompt: 'Latent print lifted with tape',
  };
  const prompt1 = buildForensicPhotoPrompt(fingerprintItem, 'Zaveri Bazaar, Mumbai');
  assert.ok(prompt1.toLowerCase().includes('latent fingerprint'), 'Must detect fingerprint category');
  assert.ok(prompt1.includes('Zaveri Bazaar, Mumbai'), 'Must include location context');
  assert.ok(prompt1.includes('no people'), 'Must include negative prompts');

  const lockItem = {
    evidenceId: 'ev_lock_1',
    title: 'Pried Brass Padlock',
    locationFound: 'Back Door Entrance, Colaba, Mumbai',
    timestamp: '2026-10-27T20:20:00.000Z',
    imagePrompt: 'Forced entry scratches on padlock',
  };
  const prompt2 = buildForensicPhotoPrompt(lockItem, 'Colaba, Mumbai');
  assert.ok(prompt2.toLowerCase().includes('padlock'), 'Must detect lock category');
  assert.ok(prompt2.includes('Colaba, Mumbai'));

  const glassItem = {
    evidenceId: 'ev_glass_1',
    title: 'Shattered Display Glass',
    locationFound: 'Main Showroom',
    timestamp: '2026-10-27T20:25:00.000Z',
    imagePrompt: 'Broken glass shards on velvet case',
  };
  const prompt3 = buildForensicPhotoPrompt(glassItem, 'Jewellery Shop, Mumbai');
  assert.ok(prompt3.toLowerCase().includes('glass'), 'Must detect glass category');
});

test('generateEvidenceImage falls back to procedural SVG when credentials are missing or provider fails', async () => {
  const fakeContext = {
    evidenceId: 'ev_fallback_test_' + Date.now(),
    title: 'Mysterious Footprint',
    locationFound: 'Corridor',
    timestamp: '2026-10-27T21:00:00.000Z',
    imagePrompt: 'Dusty shoe tread on marble',
  };

  // Temporarily clear tokens to test fallback resilience
  const origAccount = env.cloudflareAccountId;
  const origToken = env.cloudflareApiToken;
  const origProvider = env.imageProvider;

  try {
    (env as any).imageProvider = 'cloudflare';
    (env as any).cloudflareAccountId = '';
    (env as any).cloudflareApiToken = '';

    const result = await generateEvidenceImage(fakeContext, 'Office', true);
    assert.strictEqual(typeof result.imageUrl, 'string');
    // Result will either be Pollinations fallback or procedural SVG
    assert.ok(
      result.imageUrl.startsWith('/api/media/') || result.imageUrl.startsWith('data:image/svg+xml,'),
      'Must return valid media URL or SVG URI'
    );
  } finally {
    (env as any).cloudflareAccountId = origAccount;
    (env as any).cloudflareApiToken = origToken;
    (env as any).imageProvider = origProvider;
  }
});

test('generateEvidenceImage with Cloudflare FLUX.1 Schnell generates and saves real photograph if configured', async () => {
  if (!env.cloudflareAccountId || !env.cloudflareApiToken) {
    console.log('Skipping live Cloudflare test: credentials not found');
    return;
  }

  const liveContext = {
    evidenceId: 'ev_live_cf_' + Date.now(),
    title: 'Broken Velvet Jewelry Box',
    locationFound: 'Jewellery Showroom Safe, Mumbai',
    timestamp: '2026-10-27T21:30:00.000Z',
    imagePrompt: 'An open velvet jewelry display box on marble counter, broken glass shards',
  };

  const origProvider = env.imageProvider;
  try {
    (env as any).imageProvider = 'cloudflare';
    const result = await generateEvidenceImage(liveContext, 'Mumbai, Maharashtra', true);

    assert.strictEqual(result.isAiGenerated, true);
    assert.strictEqual(result.provider, 'cloudflare');
    assert.ok(result.imageUrl.startsWith('/api/media/evidence_cf_'));
    assert.ok(result.imageUrl.endsWith('.jpg') || result.imageUrl.endsWith('.png'));
  } finally {
    (env as any).imageProvider = origProvider;
  }
});
