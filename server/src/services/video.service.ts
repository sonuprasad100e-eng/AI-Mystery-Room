import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from './image.service.js';

export interface GeneratedVideoResult {
  videoUrl: string;
  durationSeconds: number;
  isAiGenerated: boolean;
  provider: 'cctv-synth';
}

// In-flight generation jobs to prevent duplicate rendering for identical requests
const inFlightJobs = new Map<string, Promise<GeneratedVideoResult>>();

/**
 * Resolves the executable path to FFmpeg.
 * Prefers bundled static binary (@ffmpeg-installer/ffmpeg) on Windows,
 * with fallback to system ffmpeg command.
 */
export function getFfmpegPath(): string {
  if (ffmpegInstaller?.path && fs.existsSync(ffmpegInstaller.path)) {
    return ffmpegInstaller.path;
  }
  return 'ffmpeg';
}

/**
 * Creates a minimal fallback solid JPEG image if no forensic photograph exists on disk yet.
 * Ensures video synthesizer can always render even on a fresh case.
 */
function ensureFallbackBaseImage(): string {
  const fallbackPath = path.join(MEDIA_DIR, 'cctv_base_frame.jpg');
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }

  // Look for any existing JPEG or PNG in MEDIA_DIR
  try {
    const files = fs.readdirSync(MEDIA_DIR);
    const existingPhoto = files.find(f => f.startsWith('evidence_') && (f.endsWith('.jpg') || f.endsWith('.png')));
    if (existingPhoto) {
      return path.join(MEDIA_DIR, existingPhoto);
    }
  } catch {
    // Ignore read error
  }

  // Create a minimal 960x540 dark gray raw JPEG buffer if needed
  // A tiny 1x1 black JPEG header
  const minimalJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07,
    0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f,
    0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c,
    0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d,
    0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xbf,
    0x80, 0xff, 0xd9
  ]);

  fs.writeFileSync(fallbackPath, minimalJpeg);
  return fallbackPath;
}

/**
 * Finds the most suitable existing forensic image file for this camera's location.
 */
function findSourceImageForRecording(caseDoc: any, recording: any): string {
  // 1. Check if any photo in evidence.photos has a local /api/media/ image
  if (Array.isArray(caseDoc.evidence?.photos)) {
    // Try matching location
    const matchedPhoto = caseDoc.evidence.photos.find((p: any) =>
      typeof p.imageUrl === 'string' &&
      p.imageUrl.startsWith('/api/media/') &&
      (p.locationFound?.toLowerCase().includes(recording.location?.toLowerCase()) ||
       recording.location?.toLowerCase().includes(p.locationFound?.toLowerCase()))
    );

    if (matchedPhoto) {
      const fileName = path.basename(matchedPhoto.imageUrl);
      const fullPath = path.join(MEDIA_DIR, fileName);
      if (fs.existsSync(fullPath)) return fullPath;
    }

    // Otherwise use any photo in the case that exists on disk
    for (const p of caseDoc.evidence.photos) {
      if (typeof p.imageUrl === 'string' && p.imageUrl.startsWith('/api/media/')) {
        const fileName = path.basename(p.imageUrl);
        const fullPath = path.join(MEDIA_DIR, fileName);
        if (fs.existsSync(fullPath)) return fullPath;
      }
    }
  }

  // 2. Check for any existing forensic image in MEDIA_DIR
  try {
    const files = fs.readdirSync(MEDIA_DIR);
    const candidate = files.find(f => f.startsWith('evidence_') && (f.endsWith('.jpg') || f.endsWith('.png')));
    if (candidate) {
      return path.join(MEDIA_DIR, candidate);
    }
  } catch {
    // Directory error handled below
  }

  return ensureFallbackBaseImage();
}

/**
 * Builds the CCTV video synthesis filter chain with:
 * - Ken Burns slow zoom
 * - Surveillance color grading & noise
 * - Scanline grid
 * - Camera ID and timestamp text overlay
 * - Anomaly signal glitch if recording contains an anomaly flag
 */
function buildCctvFilterChain(recording: any): string {
  const camName = (recording.cameraId || 'SURVEILLANCE CAM').replace(/['":\\]/g, '').toUpperCase();
  const location = (recording.location || 'SECURED AREA').replace(/['":\\]/g, '').toUpperCase();
  const labelText = `${camName}  ${location}  (REC)`.replace(/:/g, '\\:');

  // Get timestamp from first frame or fallback
  let timeStr = '23:08:15';
  if (Array.isArray(recording.frames) && recording.frames.length > 0) {
    const rawTs = recording.frames[0].timestamp || '';
    if (rawTs.includes('T')) {
      const parts = rawTs.split('T')[1];
      if (parts) timeStr = parts.slice(0, 8);
    } else if (rawTs) {
      timeStr = rawTs.slice(0, 8);
    }
  }
  const escapedTime = timeStr.replace(/['"\\:]/g, (c) => (c === ':' ? '\\:' : ''));
  const timeText = `${escapedTime} UTC`;

  const hasAnomaly = Array.isArray(recording.frames) && recording.frames.some((f: any) => f.anomalyFlag);

  const filters = [
    // Slow digital zoom in (150 frames = 6 seconds at 25 fps)
    "zoompan=z='min(zoom+0.0014,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=960x540:fps=25",
  ];

  // If there is an anomaly, inject a glitch pulse around second 3 (frames 70-76)
  if (hasAnomaly) {
    filters.push("eq=contrast='if(between(n,70,76),2.2,1.2)':brightness='if(between(n,70,76),0.28,-0.05)':saturation=0.2");
  } else {
    filters.push("eq=contrast=1.2:brightness=-0.05:saturation=0.22");
  }

  // Analog CCTV temporal film grain
  filters.push("noise=alls=12:allf=t+u");

  // Subtle scanlines across 540 vertical pixels
  filters.push("drawgrid=width=960:height=4:thickness=1:color=black@0.18");

  // Camera & Location Badge (top-left)
  filters.push(
    `drawtext=text='${labelText}':fontcolor=0x66f088:fontsize=16:x=20:y=20:box=1:boxcolor=black@0.65:boxborderw=4`
  );

  // Timestamp Badge (top-right)
  filters.push(
    `drawtext=text='${timeText}':fontcolor=white:fontsize=16:x=w-tw-20:y=20:box=1:boxcolor=black@0.65:boxborderw=4`
  );

  return filters.join(',');
}

/**
 * Synthesizes a CCTV surveillance MP4 video for a specific camera recording.
 * Handles duplicate prevention, timeouts, concurrency, and graceful fallbacks.
 */
export async function generateCctvVideo(
  caseDoc: any,
  evidenceId: string,
  force = false
): Promise<GeneratedVideoResult> {
  const recordings: any[] = caseDoc.evidence?.cctvRecordings || [];
  const recording = recordings.find((r: any) => r.evidenceId === evidenceId);

  if (!recording) {
    throw new Error(`CCTV recording with evidenceId "${evidenceId}" not found in case.`);
  }

  // Duplicate prevention: if video already exists and is valid on disk, reuse immediately unless force=true
  if (!force && typeof recording.videoUrl === 'string' && recording.videoUrl.startsWith('/api/media/')) {
    const existingFileName = path.basename(recording.videoUrl);
    const existingFilePath = path.join(MEDIA_DIR, existingFileName);
    if (fs.existsSync(existingFilePath)) {
      return {
        videoUrl: recording.videoUrl,
        durationSeconds: 6,
        isAiGenerated: true,
        provider: 'cctv-synth',
      };
    }
  }

  const jobKey = `${caseDoc._id || 'demo'}:${evidenceId}`;
  if (inFlightJobs.has(jobKey)) {
    return inFlightJobs.get(jobKey)!;
  }

  const jobPromise = (async (): Promise<GeneratedVideoResult> => {
    const sourceImagePath = findSourceImageForRecording(caseDoc, recording);
    const safeCaseId = (caseDoc._id || 'case').replace(/[^\w-]/g, '_');
    const safeEvidenceId = evidenceId.replace(/[^\w-]/g, '_');
    const outFilename = `cctv_${safeCaseId}_${safeEvidenceId}_${Date.now()}.mp4`;
    const outputPath = path.join(MEDIA_DIR, outFilename);

    const filterChain = buildCctvFilterChain(recording);
    const ffmpegPath = getFfmpegPath();

    const args = [
      '-y',
      '-loop', '1',
      '-i', sourceImagePath,
      '-vf', filterChain,
      '-t', '6',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-movflags', '+faststart',
      outputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = cp.execFile(ffmpegPath, args, { timeout: 30000 }, (err, _stdout, stderr) => {
        if (err) {
          const safeError = (stderr || err.message || '').slice(-300);
          console.error(`[video-service] FFmpeg render failed: ${safeError}`);
          reject(new Error(`FFmpeg video synthesis failed: ${err.message}`));
        } else {
          resolve();
        }
      });

      child.on('error', (spawnErr) => {
        reject(new Error(`Could not execute FFmpeg at ${ffmpegPath}: ${spawnErr.message}`));
      });
    });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      throw new Error('Video generation failed: output file is missing or corrupted.');
    }

    const relativeUrl = `/api/media/${outFilename}`;
    recording.videoUrl = relativeUrl;

    return {
      videoUrl: relativeUrl,
      durationSeconds: 6,
      isAiGenerated: true,
      provider: 'cctv-synth',
    };
  })();

  inFlightJobs.set(jobKey, jobPromise);

  try {
    return await jobPromise;
  } finally {
    inFlightJobs.delete(jobKey);
  }
}
