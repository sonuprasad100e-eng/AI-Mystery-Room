import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// Local directory for downloaded and cached evidence images
export const MEDIA_DIR = path.resolve(currentDir, '../../data/media');

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

export interface GeneratedImageResult {
  imageUrl: string;
  isAiGenerated: boolean;
  provider: 'cloudflare' | 'pollinations' | 'huggingface' | 'procedural-svg';
  error?: string;
}


export interface EvidenceItemContext {
  evidenceId: string;
  title: string;
  locationFound: string;
  timestamp: string;
  imagePrompt: string;
  hotspots?: { xPercent: number; yPercent: number; label: string; detail: string }[];
}

// In-memory cache for generated images by prompt/evidenceId
const imageCache = new Map<string, GeneratedImageResult>();

/**
 * Procedural SVG forensic schematic.
 * Rendered when AI generation is disabled or the external provider is unreachable.
 * Clearly stamped as an annotated evidence diagram, never pretending to be a real photo.
 */
export function generateProceduralForensicSvg(
  context: EvidenceItemContext,
  accentColor = '#d9a441'
): string {
  const safeTitle = context.title.replace(/[<>&"']/g, '').toUpperCase().slice(0, 36);
  const safeLocation = context.locationFound.replace(/[<>&"']/g, '').toUpperCase().slice(0, 40);
  const safeTime = (context.timestamp || '').slice(0, 16);

  // Render hotspot marker rings if coordinates are provided
  const hotspotElements = (context.hotspots || [])
    .map((h, i) => {
      const cx = Math.max(20, Math.min(620, Math.round((h.xPercent / 100) * 640)));
      const cy = Math.max(20, Math.min(380, Math.round((h.yPercent / 100) * 400)));
      return `
        <circle cx="${cx}" cy="${cy}" r="16" fill="none" stroke="${accentColor}" stroke-width="2" stroke-dasharray="3 3"/>
        <circle cx="${cx}" cy="${cy}" r="5" fill="${accentColor}"/>
        <rect x="${cx + 8}" y="${cy - 18}" width="20" height="14" rx="2" fill="#141d28" stroke="#334458"/>
        <text x="${cx + 18}" y="${cy - 8}" fill="${accentColor}" font-family="monospace" font-size="9" text-anchor="middle" font-weight="bold">${i + 1}</text>
      `;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="100%" height="100%">
    <defs>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1c2736" stroke-width="1"/>
      </pattern>
      <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0e1520" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#080c14" stop-opacity="0.98"/>
      </linearGradient>
    </defs>
    <rect width="640" height="400" fill="#080c14"/>
    <rect width="640" height="400" fill="url(#grid)"/>
    <rect width="640" height="400" fill="url(#overlay)"/>
    
    <!-- Coordinate boundary border -->
    <rect x="16" y="16" width="608" height="368" fill="none" stroke="#253549" stroke-width="1"/>
    <line x1="16" y1="56" x2="624" y2="56" stroke="#253549" stroke-width="1"/>
    <line x1="16" y1="344" x2="624" y2="344" stroke="#253549" stroke-width="1"/>

    <!-- Forensic Header -->
    <text x="32" y="38" fill="#e5e7eb" font-family="monospace" font-size="13" font-weight="bold" letter-spacing="1">FORENSIC EVIDENCE SCHEMATIC</text>
    <text x="32" y="50" fill="${accentColor}" font-family="monospace" font-size="8" letter-spacing="1.5">FORENSIC EVIDENCE SCHEMATIC // NOT A REAL PHOTOGRAPH</text>
    <text x="608" y="42" fill="#718294" font-family="monospace" font-size="10" text-anchor="end">${safeTime}</text>

    <!-- Evidence Target Silhouette -->
    <g transform="translate(240, 110)">
      <rect x="0" y="0" width="160" height="130" rx="4" fill="#121b26" stroke="#2d3f56" stroke-width="1.5"/>
      <circle cx="80" cy="65" r="42" fill="none" stroke="${accentColor}" stroke-opacity="0.25" stroke-dasharray="4 4"/>
      <circle cx="80" cy="65" r="3" fill="${accentColor}"/>
      <line x1="20" y1="65" x2="140" y2="65" stroke="#253549" stroke-width="1"/>
      <line x1="80" y1="20" x2="80" y2="110" stroke="#253549" stroke-width="1"/>
      <text x="80" y="122" fill="#8899aa" font-family="monospace" font-size="8" text-anchor="middle">EXHIBIT ZONE</text>
    </g>

    <!-- Hotspots -->
    ${hotspotElements}

    <!-- Footer metadata -->
    <text x="32" y="362" fill="#d1d5db" font-family="monospace" font-size="11" font-weight="bold">${safeTitle}</text>
    <text x="32" y="374" fill="#8899aa" font-family="monospace" font-size="9">${safeLocation}</text>
    <text x="608" y="368" fill="${accentColor}" font-family="monospace" font-size="9" text-anchor="end">${context.evidenceId.toUpperCase()}</text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Detects real image format extension from binary magic bytes.
 */
export function detectImageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'bin' {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    buffer.length > 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }
  return 'bin';
}

/**
 * Builds a curated crime-scene image prompt tailored for forensic realism.
 * Automatically adapts for Indian indoor/outdoor crime scenes, close-up physical clues,
 * fingerprints, broken entry points, and documents without leaking the culprit.
 */
export function buildForensicPhotoPrompt(context: EvidenceItemContext, setting: string): string {
  const cleanPrompt = (context.imagePrompt || '').replace(/[^\w\s,.-]/g, '').trim();
  const cleanTitle = (context.title || '').replace(/[^\w\s,.-]/g, '').trim();
  const cleanLocation = (context.locationFound || '').replace(/[^\w\s,.-]/g, '').trim();
  const lowerDesc = `${cleanTitle} ${cleanPrompt} ${cleanLocation}`.toLowerCase();

  // Detect specific forensic evidence category for macro/detail precision
  let evidenceDetail = 'Forensic crime scene documentation photograph';

  if (lowerDesc.includes('fingerprint') || lowerDesc.includes('latent print') || lowerDesc.includes('smudge')) {
    evidenceDetail = 'Extreme close-up macro forensic photograph of a latent fingerprint dusted with black graphite powder on a smooth reflective surface, sharp ridge details, adhesive tape residue, forensic scale ruler alongside';
  } else if (lowerDesc.includes('footprint') || lowerDesc.includes('shoe print') || lowerDesc.includes('tread')) {
    evidenceDetail = 'High-angle close-up forensic photograph of an isolated dusty shoe tread impression on polished marble flooring, sharp tread pattern ridges, oblique raking lighting, crime-scene scale marker';
  } else if (lowerDesc.includes('lock') || lowerDesc.includes('padlock') || lowerDesc.includes('forced entry') || lowerDesc.includes('latch')) {
    evidenceDetail = 'Detailed forensic close-up photograph of a scratched brass padlock and pried wooden door frame, metallic tool marks, chipped varnish, splintered wood fibers, natural dim indoor light';
  } else if (lowerDesc.includes('glass') || lowerDesc.includes('window') || lowerDesc.includes('shards') || lowerDesc.includes('display case')) {
    evidenceDetail = 'Crime-scene forensic photograph of shattered tempered glass fragments scattered across an empty velvet jewelry display case and marble floor, sharp refractive highlights, dramatic directional spotlight';
  } else if (lowerDesc.includes('document') || lowerDesc.includes('ledger') || lowerDesc.includes('receipt') || lowerDesc.includes('note') || lowerDesc.includes('paper')) {
    evidenceDetail = 'Flat-lay overhead archival photograph of a worn paper document and handwritten diary on a dark wooden office desk, authentic paper grain, faint blue ink, slight creasing, forensic evidence tent nearby';
  } else if (lowerDesc.includes('keycard') || lowerDesc.includes('card') || lowerDesc.includes('badge')) {
    evidenceDetail = 'Close-up evidence photograph of a magnetic access keycard lying on a tiled floor near a doorway, plastic texture, subtle scuff marks, realistic indoor ambient lighting';
  } else if (cleanPrompt) {
    evidenceDetail = cleanPrompt;
  } else {
    evidenceDetail = cleanTitle;
  }

  const locStr = cleanLocation ? `located in ${cleanLocation}` : setting ? `at ${setting}` : 'at crime scene';

  return `Photorealistic ${evidenceDetail}, ${locStr}, authentic Indian interior architecture, realistic materials and surface textures, natural camera perspective, soft ambient lighting with moody directional shadows, 35mm documentary photography, sharp focus on physical evidence, no people, no watermark, no text overlay, no fantasy elements`;
}

/**
 * Generates an image using Cloudflare Workers AI with FLUX.1 Schnell.
 * Model: @cf/black-forest-labs/flux-1-schnell
 * Credentials stay on the server and are never logged or exposed.
 */
async function fetchCloudflareFluxImage(
  prompt: string,
  evidenceId: string
): Promise<string | null> {
  if (!env.cloudflareAccountId || !env.cloudflareApiToken) {
    console.warn('[image-service] Cloudflare credentials missing (CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is empty).');
    return null;
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.cloudflareApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        steps: 4,
      }),
      signal: AbortSignal.timeout(25000), // 25s timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let safeMsg = `HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errorText);
        if (errJson.errors && Array.isArray(errJson.errors) && errJson.errors.length > 0) {
          safeMsg = errJson.errors.map((e: any) => e.message || e.code).join('; ');
        }
      } catch {
        safeMsg = errorText.slice(0, 150);
      }
      console.warn(`[image-service] Cloudflare Workers AI returned ${response.status}: ${safeMsg}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    let imageBuffer: Buffer;

    if (contentType.includes('application/json')) {
      const json: any = await response.json();
      const base64Data = json.result?.image || json.image;
      if (!base64Data || typeof base64Data !== 'string') {
        console.warn('[image-service] Cloudflare Workers AI response missing base64 image data');
        return null;
      }
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      const arrayBuf = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuf);
    }

    if (!imageBuffer || imageBuffer.length < 500) {
      console.warn(`[image-service] Cloudflare image buffer too small (${imageBuffer?.length || 0} bytes)`);
      return null;
    }

    const ext = detectImageExtension(imageBuffer);
    const safeExt = ext === 'bin' ? 'jpg' : ext;

    const safeId = evidenceId.replace(/[^\w-]/g, '_');
    const filename = `evidence_cf_${safeId}_${Date.now()}.${safeExt}`;
    const filePath = path.join(MEDIA_DIR, filename);

    await fs.promises.writeFile(filePath, imageBuffer);
    return `/api/media/${filename}`;
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.warn(`[image-service] Cloudflare Workers AI request timed out for evidence ${evidenceId}`);
    } else {
      console.warn(`[image-service] Cloudflare Workers AI error for ${evidenceId}: ${error?.message || 'Network error'}`);
    }
    return null;
  }
}

/**
 * Fetches an image from Pollinations.ai and saves it locally.
 * Returns local `/api/media/:filename` on success, or null on rate-limit/error.
 */
async function fetchPollinationsImage(
  prompt: string,
  evidenceId: string
): Promise<string | null> {
  const encoded = encodeURIComponent(prompt);
  const keyParam = env.pollinationsApiKey ? `&key=${encodeURIComponent(env.pollinationsApiKey)}` : '';
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=640&height=400&model=turbo&nologo=true${keyParam}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(14000),
    headers: { 'User-Agent': 'AIMysteryRoom/1.0' },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const cleanError = errorBody.slice(0, 150).replace(/key=[\w-]+/g, 'key=[REDACTED]');
    console.warn(`[image-service] Pollinations returned HTTP ${response.status}: ${cleanError}`);
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('image')) {
    console.warn(`[image-service] Unexpected content type from Pollinations: ${contentType}`);
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 500) {
    console.warn(`[image-service] Image buffer too small (${buffer.byteLength} bytes)`);
    return null;
  }

  const ext = detectImageExtension(buffer);
  const safeExt = ext === 'bin' ? 'jpg' : ext;

  // Save to local disk for permanent serving
  const safeId = evidenceId.replace(/[^\w-]/g, '_');
  const filename = `evidence_${safeId}_${Date.now()}.${safeExt}`;
  const filePath = path.join(MEDIA_DIR, filename);

  await fs.promises.writeFile(filePath, buffer);
  return `/api/media/${filename}`;
}

/**
 * Fetches an image from Hugging Face Serverless Inference API (if configured).
 */
async function fetchHuggingFaceImage(
  prompt: string,
  evidenceId: string
): Promise<string | null> {
  if (!env.hfApiToken) {
    console.warn('[image-service] Hugging Face token not configured (HF_API_TOKEN is empty).');
    return null;
  }

  const modelUrl = 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell';
  const response = await fetch(modelUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(18000),
    headers: {
      Authorization: `Bearer ${env.hfApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.warn(`[image-service] Hugging Face returned HTTP ${response.status}: ${errorText.slice(0, 150)}`);
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 500) return null;

  const ext = detectImageExtension(buffer);
  const safeExt = ext === 'bin' ? 'jpg' : ext;

  const safeId = evidenceId.replace(/[^\w-]/g, '_');
  const filename = `evidence_hf_${safeId}_${Date.now()}.${safeExt}`;
  const filePath = path.join(MEDIA_DIR, filename);

  await fs.promises.writeFile(filePath, buffer);
  return `/api/media/${filename}`;
}

/**
 * Main entry point: Generates or retrieves a forensic evidence image.
 * Supports Cloudflare (FLUX.1 Schnell), Pollinations, and Hugging Face.
 * Always falls back gracefully to a procedural forensic SVG diagram on failure or when disabled.
 */
export async function generateEvidenceImage(
  context: EvidenceItemContext,
  setting = 'Crime scene',
  forceAi = false
): Promise<GeneratedImageResult> {
  const cacheKey = `${context.evidenceId}:${context.imagePrompt || context.title}`;
  if (!forceAi && imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  // If AI generation is disabled and not forced, return procedural SVG schematic immediately
  if (!env.enableAiImageGen && !forceAi) {
    const result: GeneratedImageResult = {
      imageUrl: generateProceduralForensicSvg(context),
      isAiGenerated: false,
      provider: 'procedural-svg',
    };
    imageCache.set(cacheKey, result);
    return result;
  }

  const prompt = buildForensicPhotoPrompt(context, setting);

  try {
    let localImageUrl: string | null = null;
    let providerName: 'cloudflare' | 'pollinations' | 'huggingface' = 'pollinations';

    if (env.imageProvider === 'cloudflare') {
      providerName = 'cloudflare';
      localImageUrl = await fetchCloudflareFluxImage(prompt, context.evidenceId);

      // Graceful fallback to Pollinations if Cloudflare returns null (e.g. rate limit or network issue)
      if (!localImageUrl) {
        console.warn(`[image-service] Cloudflare unavailable; attempting fallback to Pollinations for ${context.evidenceId}`);
        localImageUrl = await fetchPollinationsImage(prompt, context.evidenceId);
        if (localImageUrl) {
          providerName = 'pollinations';
        }
      }
    } else if (env.imageProvider === 'huggingface') {
      providerName = 'huggingface';
      localImageUrl = await fetchHuggingFaceImage(prompt, context.evidenceId);
      if (!localImageUrl) {
        localImageUrl = await fetchPollinationsImage(prompt, context.evidenceId);
        if (localImageUrl) {
          providerName = 'pollinations';
        }
      }
    } else {
      providerName = 'pollinations';
      localImageUrl = await fetchPollinationsImage(prompt, context.evidenceId);
    }

    if (localImageUrl) {
      const result: GeneratedImageResult = {
        imageUrl: localImageUrl,
        isAiGenerated: true,
        provider: providerName,
      };
      imageCache.set(cacheKey, result);
      return result;
    }
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[image-service] Generation failed for ${context.evidenceId}: ${rawMsg.slice(0, 120)}`);
  }

  // Graceful fallback to procedural forensic SVG blueprint
  const fallbackResult: GeneratedImageResult = {
    imageUrl: generateProceduralForensicSvg(context),
    isAiGenerated: false,
    provider: 'procedural-svg',
  };
  imageCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

