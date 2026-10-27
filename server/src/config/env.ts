import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Check possible .env file locations in priority order:
// 1. server/.env (relative to this module file in src/config or dist/config)
// 2. process.cwd() / server/.env (when started from workspace root)
// 3. process.cwd() / .env (when started from server/ or if root .env exists)
// 4. workspace root .env
const candidateEnvPaths = [
  path.resolve(currentDir, '../../.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(currentDir, '../../../.env'),
];

let loadedPath: string | null = null;
for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    loadedPath = envPath;
    break;
  }
}

// Fallback to default dotenv loading if none of the explicit paths were found
if (!loadedPath) {
  dotenv.config();
}

const rawPort = process.env.PORT;
const port = rawPort && !isNaN(Number(rawPort)) && Number(rawPort) > 0 ? Number(rawPort) : 5000;
const mongoUri = process.env.MONGODB_URI || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const geminiModel = process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite';
const nodeEnv = process.env.NODE_ENV || 'development';
const enableAiImageGen =
  process.env.ENABLE_AI_IMAGE_GEN === 'true' || process.env.ENABLE_AI_IMAGE_GENERATION === 'true';
const imageProvider = (process.env.IMAGE_PROVIDER || 'pollinations').toLowerCase();
const pollinationsApiKey = process.env.POLLINATIONS_API_KEY || '';
const hfApiToken = process.env.HF_API_TOKEN || '';
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || '';
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() || '';

export const env = {
  port,
  mongoUri,
  geminiKey,
  geminiModel,
  nodeEnv,
  enableAiImageGen,
  imageProvider,
  pollinationsApiKey,
  hfApiToken,
  cloudflareAccountId,
  cloudflareApiToken,
};

/**
 * Validates and logs server configuration safely at startup
 * without exposing sensitive API keys or credentials.
 */
export function validateEnv() {
  console.log('--- Server Configuration ---');
  console.log(`Port: ${env.port}`);
  console.log(`Environment: ${env.nodeEnv}`);
  console.log(`Gemini API: ${env.geminiKey ? 'Configured (Active)' : 'Not configured (AI generation disabled, demo available)'}`);
  if (env.geminiKey) {
    console.log(`Gemini Model: ${env.geminiModel}`);
  }
  console.log(`Image Generation: ${env.enableAiImageGen ? `Enabled (provider: ${env.imageProvider})` : 'Disabled (procedural SVG schematics active)'}`);
  if (env.imageProvider === 'cloudflare') {
    console.log(`Cloudflare Workers AI: ${env.cloudflareAccountId && env.cloudflareApiToken ? 'Configured (FLUX.1 Schnell)' : 'Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN'}`);
  }
  console.log(`MongoDB: ${env.mongoUri ? 'URI configured' : 'Not configured (In-memory store will be used)'}`);
  console.log('----------------------------');
}

