import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from server/.env or workspace .env safely
const candidatePaths = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../.env'),
];

for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

if (!accountId || !apiToken) {
  console.error('Error: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing in server/.env');
  process.exit(1);
}

const prompt = 'Photorealistic forensic photograph of an Indian jewellery shop in Mumbai at night, an empty velvet display case, broken glass fragments on the floor, warm indoor lighting, realistic materials, security camera visible in the background, natural camera perspective, detailed crime-scene documentation, no people, no text, no watermark.';

function getImageInfo(buffer) {
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { format: 'png', width, height };
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { format: 'jpeg', width, height };
      }
      if (marker >= 0xc0 && marker <= 0xfe && marker !== 0xd8 && marker !== 0xd9) {
        const len = buffer.readUInt16BE(offset + 2);
        offset += 2 + len;
      } else {
        offset += 2;
      }
    }
    return { format: 'jpeg', width: null, height: null };
  }
  return { format: 'unknown', width: null, height: null };
}

async function runTest() {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        steps: 4,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    console.log(`HTTP Status: ${response.status} ${response.statusText}`);
    console.log(`Generation Time: ${durationMs}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      let safeMsg = 'Request failed';
      try {
        const errJson = JSON.parse(errorText);
        if (errJson.errors && Array.isArray(errJson.errors) && errJson.errors.length > 0) {
          safeMsg = errJson.errors.map(e => e.message || e.code).join('; ');
        } else if (errJson.messages && errJson.messages.length > 0) {
          safeMsg = errJson.messages.join('; ');
        }
      } catch {
        safeMsg = errorText.slice(0, 200);
      }
      console.error(`Error details: ${safeMsg}`);
      process.exit(1);
    }

    const contentType = response.headers.get('content-type') || '';
    let imageBuffer;

    if (contentType.includes('application/json')) {
      const json = await response.json();
      const base64Data = json.result?.image || json.image;
      if (!base64Data) {
        console.error('Error: No image property found in JSON response');
        process.exit(1);
      }
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      const arrayBuf = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuf);
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      console.error('Error: Image buffer is empty');
      process.exit(1);
    }

    const info = getImageInfo(imageBuffer);
    console.log(`Detected Format: ${info.format.toUpperCase()}`);
    console.log(`Image Size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);
    if (info.width && info.height) {
      console.log(`Image Dimensions: ${info.width} x ${info.height}`);
    } else {
      console.log('Image Dimensions: Standard (unparsed metadata)');
    }

    // Ensure target directory exists
    const mediaDir = path.resolve(__dirname, 'data/media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    const ext = info.format === 'jpeg' ? 'jpg' : info.format === 'png' ? 'png' : 'bin';
    const primaryPath = path.join(mediaDir, `cloudflare-test.${ext}`);
    fs.writeFileSync(primaryPath, imageBuffer);
    console.log(`Saved primary image to: ${primaryPath}`);

    // Also write cloudflare-test.png if user requested server/data/media/cloudflare-test.png
    const pngPath = path.join(mediaDir, 'cloudflare-test.png');
    if (primaryPath !== pngPath) {
      fs.writeFileSync(pngPath, imageBuffer);
      console.log(`Also saved to: ${pngPath}`);
    }

    console.log('SUCCESS: Image successfully generated and saved.');
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.log(`Generation Time: ${durationMs}ms`);
    if (err.name === 'AbortError') {
      console.error('Error: Request timed out after 60 seconds.');
    } else {
      console.error(`Safe Error: ${err.message || 'Unknown network error'}`);
    }
    process.exit(1);
  }
}

runTest();
