# SPEC.md — AI Mystery Room (Single Source of Truth for Codex)

**Project Name:** AI Mystery Room  
**Development Methodology:** Spec-Driven Development (SDD)  
**Target Agent:** OpenAI Codex / Autonomous Coding Agent  
**Tech Stack:** MERN (MongoDB, Express.js, React + Vite, Node.js) + Google Gemini API (`@google/genai`)  
**Status:** Production-Ready Baseline Specification  

## 1. Executive Summary & System Vision

**AI Mystery Room** is an interactive detective web application where a user inputs a short scenario, theme, or story prompt (e.g., *"A priceless emerald vanished during a blackout at a billionaire's yacht party"*), and the backend orchestrates Google Gemini models to generate a complete, self-contained murder/crime mystery investigation.

Each generated case features:
1. **Case Briefing:** Crime summary, timeline of events, crime scene description, and victim/incident report.
2. **Suspect Profiles:** 3 to 4 distinct suspects, each with a persona, motive, alibi, relationship to the incident, and AI-generated mugshot/portrait. Exactly **one** suspect is the true culprit, with a deterministic logical contradiction in their alibi exposed by the evidence.
3. **Interactive Evidence Locker:**
   - **WhatsApp Chat Logs:** Multi-turn group or direct message threads with timestamps, read receipts, and subtle clues.
   - **Photographic Evidence:** AI-generated crime scene or clue photos (or high-contrast SVG/Canvas forensic reconstructions with fallback support).
   - **CCTV Security Footage Logs:** Simulated multi-camera security feed player with timestamped movement logs, visual frame snapshots, and anomaly markers.
4. **Verdict & Deduction Engine:** The player inspects evidence, optionally takes notes on an interactive Detective Board, selects a suspect, and submits their accusation. The backend validates the accusation against the hidden solution and reveals the full step-by-step reconstruction of the crime.

## 2. Core Architecture & Tech Stack

| Layer | Technology | Version / Package | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React (Vite) + TypeScript | `react@^18.3.0`, `vite@^5.4.0` | SPA UI with detective dashboard, evidence viewers, and state management |
| **Styling & UI** | Tailwind CSS + Lucide Icons | `tailwindcss@^3.4.0`, `lucide-react` | Noir detective aesthetic, WhatsApp UI clone, CCTV HUD overlay |
| **Backend Runtime** | Node.js + Express.js | `express@^4.19.0`, `cors`, `dotenv` | REST API, Gemini orchestration, solution shielding, verdict evaluation |
| **Database** | MongoDB + Mongoose | `mongoose@^8.5.0` | Persistent storage of generated cases, suspects, evidence, and user attempts |
| **AI SDK** | Google Gen AI SDK | `@google/genai` | Structured JSON case generation (`gemini-2.5-flash`) & image synthesis (`imagen-3.0-generate-002` with deterministic SVG forensic fallback) |
| **Validation** | Zod | `zod@^3.23.0` | Strict runtime schema validation for API payloads and Gemini structured outputs |

### Architectural Security Rule: Solution Shielding
The true culprit (`solution.culpritSuspectId`, `solution.explanation`, `solution.keyEvidenceIds`) is stored in the MongoDB `Case` document on the backend. **The `GET /api/cases/:id` endpoint MUST strip the `solution` object before sending the payload to the client** so users cannot inspect network traffic to cheat. The `solution` is only revealed when the user submits their final accusation via `POST /api/cases/:id/solve`.

## 3. Repository & Directory Structure

Codex must initialize and maintain the following monorepo structure:

```text
ai-mystery-room/
├── README.md
├── SPEC.md
├── package.json                  # Root workspace scripts (dev, build, seed)
├── .env.example
├── server/                       # Node.js + Express Backend
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # Express app entry point & server listen
│       ├── config/
│       │   ├── db.ts             # MongoDB connection handler (with in-memory fallback)
│       │   └── env.ts            # Environment variable validation
│       ├── models/
│       │   └── Case.model.ts     # Mongoose schema & TypeScript interfaces
│       ├── schemas/
│       │   └── case.schema.ts    # Gemini responseSchema & Zod validators
│       ├── services/
│       │   ├── gemini.service.ts # Gemini text + image generation & fallback engine
│       │   └── case.service.ts   # Business logic, solution stripping, verdict scoring
│       ├── controllers/
│       │   └── case.controller.ts
│       └── routes/
│           └── case.routes.ts
└── client/                       # React + Vite + Tailwind Frontend
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── types/
        │   └── mystery.ts        # Shared frontend TypeScript interfaces
        ├── api/
        │   └── caseApi.ts        # Axios/Fetch wrapper for backend endpoints
        ├── context/
        │   └── CaseContext.tsx   # Active case state, pinned clues, suspect notes
        ├── components/
        │   ├── layout/
        │   │   ├── Navbar.tsx
        │   │   └── CaseHeader.tsx
        │   ├── generator/
        │   │   ├── ScenarioPromptForm.tsx
        │   │   └── GenerationLoader.tsx
        │   ├── suspects/
        │   │   ├── SuspectGrid.tsx
        │   │   └── SuspectDossierModal.tsx
        │   ├── evidence/
        │   │   ├── EvidenceTabs.tsx
        │   │   ├── WhatsAppViewer.tsx
        │   │   ├── PhotoEvidenceViewer.tsx
        │   │   └── CctvFootagePlayer.tsx
        │   ├── notebook/
        │   │   └── DetectiveNotepad.tsx
        │   └── verdict/
        │       ├── AccusationModal.tsx
        │       └── CaseResolutionScreen.tsx
        └── pages/
            ├── HomePage.tsx
            ├── InvestigationRoomPage.tsx
            └── CaseArchivePage.tsx
```

## 4. Database Schema Specification (MongoDB / Mongoose)

File: `server/src/models/Case.model.ts`

```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface ISuspect {
  suspectId: string;          // e.g., "suspect_1"
  name: string;
  age: number;
  occupation: string;
  relationshipToVictim: string;
  bio: string;
  motive: string;
  alibi: string;
  quirks: string[];
  avatarUrl: string;          // Base64 data URI or generated image URL
  interrogationQuote: string; // Direct statement given to police
}

export interface IWhatsAppMessage {
  messageId: string;
  senderId: string;           // Matches a suspectId, "victim", or "unknown"
  senderName: string;
  timestamp: string;          // e.g., "22:14"
  text: string;
  isDeletedOrRecovered?: boolean;
  readStatus: 'sent' | 'delivered' | 'read';
}

export interface IWhatsAppThread {
  evidenceId: string;         // e.g., "ev_wa_1"
  title: string;              // e.g., "Yacht Crew Group Chat" or "Encrypted DM: Victor <-> Victim"
  participants: string[];
  extractedFromDevice: string;
  messages: IWhatsAppMessage[];
}

export interface IPhotoEvidence {
  evidenceId: string;         // e.g., "ev_img_1"
  title: string;
  locationFound: string;
  timestamp: string;
  imagePrompt: string;        // Prompt sent to Imagen / SVG generator
  imageUrl: string;           // Base64 Data URI or hosted URL
  forensicNote: string;       // Caption explaining physical details visible in the image
  hotspots: {                 // Interactive clickable areas on the image
    xPercent: number;
    yPercent: number;
    label: string;
    detail: string;
  }[];
}

export interface ICctvFrame {
  frameId: string;
  timestamp: string;          // e.g., "23:04:12"
  cameraName: string;         // e.g., "CAM-02: East Hallway"
  visualDescription: string;  // Detailed description of what appears on screen
  detectedEntities: string[]; // e.g., ["Tall figure in raincoat", "Muddy bootprint"]
  anomalyFlag: boolean;       // True if timestamp tamper, motion blur, or critical clue
  snapshotSvgOrUrl: string;   // Visual frame representation
}

export interface ICctvRecording {
  evidenceId: string;         // e.g., "ev_cctv_1"
  cameraId: string;
  location: string;
  timeRange: string;          // e.g., "22:45:00 - 23:30:00"
  technicalStatus: string;    // e.g., "Signal interference between 23:10 and 23:12"
  frames: ICctvFrame[];
}

export interface ICaseSolution {
  culpritSuspectId: string;   // Must match one ISuspect.suspectId
  motiveSummary: string;
  alibiContradiction: string; // Exact explanation of how the proofs disprove the culprit's alibi
  keyEvidenceIds: string[];   // Array of evidenceId values that prove guilt
  fullReconstruction: string; // Narrative walkthrough of how the crime was committed
}

export interface ICaseDocument extends Document {
  userPrompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  title: string;
  caseNumber: string;         // e.g., "CASE-2026-8841"
  crimeType: string;
  setting: string;
  incidentTimestamp: string;
  victim: {
    name: string;
    age: number;
    role: string;
    causeOfIncident: string;
    background: string;
  };
  briefing: string;
  timelineSummary: string[];
  suspects: ISuspect[];
  evidence: {
    whatsappThreads: IWhatsAppThread[];
    photos: IPhotoEvidence[];
    cctvRecordings: ICctvRecording[];
  };
  solution: ICaseSolution;    // Stripped on GET /api/cases/:id
  status: 'unsolved' | 'solved' | 'failed';
  attemptsCount: number;
  createdAt: Date;
}
```

## 5. Gemini AI Integration & Prompt Engineering

File: `server/src/services/gemini.service.ts`

### 5.1 SDK Initialization
Use the official `@google/genai` SDK:
```typescript
import { GoogleGenAI, Type, Schema } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

### 5.2 Structured Case Generation (`gemini-2.5-flash`)
To guarantee deterministic, parseable JSON that never breaks the frontend UI, all mystery generation calls MUST set `config.responseMimeType = "application/json"` and provide a strict `config.responseSchema`.

#### Logical Consistency Rules (System Instruction for Gemini)
Embed the following system instruction in `gemini.service.ts`:
```text
You are a master detective fiction architect and forensic puzzle designer.
Given a user's short scenario prompt and difficulty level, construct a complete, fair, and logically airtight mystery investigation.

CRITICAL DESIGN RULES:
1. FAIR PLAY MYSTERY: The mystery MUST be solvable using ONLY the generated evidence. Never rely on outside knowledge or random guessing.
2. THE CULPRIT'S CONTRADICTION: Choose exactly ONE suspect as the culprit (`solution.culpritSuspectId`). Give every suspect a plausible motive and an alibi. However, the culprit's stated alibi MUST be directly contradicted by a cross-reference across at least TWO pieces of evidence (for example: Suspect B claims they left the building at 22:30, a WhatsApp message shows their phone connected to the basement Wi-Fi at 22:48, and CAM-03 shows a figure with Suspect B's distinctive watch entering the vault corridor at 22:52).
3. RED HERRINGS: Innocent suspects should have secrets or suspicious behavior (e.g., an argument with the victim, a deleted message about a different matter) so the puzzle requires careful timestamp and detail verification.
4. REALISTIC WHATSAPP LOGS: Include at least 2 WhatsApp threads with 6-10 messages each, complete with realistic timestamps (HH:MM), sender IDs, and at least one "recovered deleted message" or subtle linguistic tell.
5. FORENSIC PHOTOS: Generate 2-3 photographic evidence items with 2-3 interactive hotspots (`xPercent`, `yPercent` between 15 and 85) pointing out physical clues in the scene.
6. CCTV FOOTAGE: Generate 2 CCTV camera logs, each containing 4-5 sequential timestamped frames describing movement, lighting, or timestamp anomalies.
```

### 5.3 Visual Asset Generation Strategy (Dual-Mode Pipeline)
For `suspects[].avatarUrl`, `evidence.photos[].imageUrl`, and `evidence.cctvRecordings[].frames[].snapshotSvgOrUrl`:
1. **Primary Mode (Imagen 3 / Gemini Image Generation):** If `ENABLE_AI_IMAGE_GEN=true` is set in `.env`, call `ai.models.generateImages` (`model: 'imagen-3.0-generate-002'`) with the generated `imagePrompt` and convert the returned base64 bytes to `data:image/jpeg;base64,...`.
2. **Zero-Latency / Quota-Safe Fallback Mode (Procedural Forensic SVG Renderer):** Because image generation APIs can hit rate limits or add 15+ seconds of latency for 8+ images per case, `gemini.service.ts` MUST include a built-in deterministic SVG data-URI generator that renders:
   - Stylized dark-noir suspect silhouettes with distinct accessory/color badges for suspect avatars.
   - Annotated forensic crime-scene diagrams with coordinate grids and clue markers aligned with `hotspots` (`xPercent`, `yPercent`) for photo evidence.
   - Scanline-filtered CCTV security monitor frames with embedded camera IDs, timestamps, and entity bounding boxes for CCTV frames.

## 6. REST API Specification

Base URL: `/api`

| Method | Endpoint | Description | Request Body | Response (`200` / `201`) |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Health check & DB status | None | `{ status: "ok", dbState: "connected", aiConfigured: true }` |
| `POST` | `/api/cases/generate` | Generates a new AI Mystery Case from user prompt | `{ prompt: string, difficulty?: "easy" \| "medium" \| "hard" }` | `{ case: PublicCaseDTO }` (excludes `solution`) |
| `GET` | `/api/cases` | Lists recent cases for Case Archive page | None | `{ cases: CaseSummaryDTO[] }` |
| `GET` | `/api/cases/:id` | Fetches full investigation data for a single case | None | `{ case: PublicCaseDTO }` (excludes `solution`) |
| `POST` | `/api/cases/:id/hint` | Generates or returns a progressive forensic hint | `{step: number}` | `{ hint: string }` |
| `POST` | `/api/cases/:id/solve` | Submits culprit accusation & optional key evidence | `{ suspectId: string, selectedEvidenceIds: string[], reasoning?: string }` | `{ correct: boolean, score: number, solution: ICaseSolution, feedback: string }` |

### 6.1 Endpoint Contracts & Validation Rules

#### `POST /api/cases/generate`
- **Validation (Zod):**
  - `prompt`: `z.string().min(10, "Scenario must be at least 10 characters").max(600)`
  - `difficulty`: `z.enum(["easy", "medium", "hard"]).default("medium")`
- **Process:**
  1. Validate request payload.
  2. Call `geminiService.generateMysteryCase(prompt, difficulty)`.
  3. Persist complete case document (including `solution`) in MongoDB.
  4. Strip `solution` field and return `201 Created` with the sanitized case object.

#### `POST /api/cases/:id/solve`
- **Validation (Zod):**
  - `suspectId`: `z.string().min(1)`
  - `selectedEvidenceIds`: `z.array(z.string()).default([])`
  - `reasoning`: `z.string().optional()`
- **Scoring Logic (`case.service.ts`):**
  - `isCorrectCulprit = (caseDoc.solution.culpritSuspectId === suspectId)`
  - Base score: `70` points if `isCorrectCulprit` is true, `0` otherwise.
  - Evidence bonus: Up to `30` points based on overlap between `selectedEvidenceIds` and `caseDoc.solution.keyEvidenceIds`.
  - Update `caseDoc.status = isCorrectCulprit ? 'solved' : 'failed'` and increment `attemptsCount`.
  - Return full `solution` object so the user can review the crime reconstruction.

## 7. Frontend UI/UX Specification

### 7.1 Visual Theme & Aesthetic Direction
- **Palette:** Dark Noir Forensic Terminal
  - Background Primary: `#0B0F17` (`slate-950`)
  - Surface / Dossier Cards: `#111827` (`gray-900`) with subtle `#1F2937` borders
  - Primary Accent (Forensic Amber): `#F59E0B` (`amber-500`)
  - Secondary Accent (Crimson Alert): `#EF4444` (`red-500`)
  - WhatsApp Brand Accent: `#10B981` (`emerald-500`) / Dark Chat Bubble `#005C4B`
  - CCTV HUD Accent: `#22D3EE` (`cyan-400`) with monospace typography (`JetBrains Mono` or `Fira Code`)

### 7.2 Views & Component Requirements

1. **Home / Scenario Generator (`HomePage.tsx`):**
   - Hero section introducing **AI Mystery Room**.
   - `ScenarioPromptForm`:
     - Textarea for custom scenario input.
     - 4 "Quick-Start Preset" chips for instant testing (e.g., *"Blackout at the Louvre Vault"*, *"Poisoned Espresso at a Tech Startup IPO"*, *"Locked-Room Disappearance on the Orient Express"*, *"Sabotage at the Deep-Sea Research Station"*).
     - Difficulty selector (`Easy`, `Medium`, `Hard`).
     - "Generate Investigation" CTA button.
   - `GenerationLoader`: Multi-stage animated forensic terminal loader (*"Synthesizing crime scene..."*, *"Forging suspect alibis..."*, *"Extracting WhatsApp backups..."*, *"Recovering CCTV timestamps..."*) while waiting for Gemini response.

2. **Investigation Room (`InvestigationRoomPage.tsx`):**
   - **Top Bar (`CaseHeader.tsx`):** Displays Case ID, Title, Incident Time, Difficulty Badge, "Request Hint" button, and primary **"Make Accusation"** CTA button.
   - **Left Column (35% width on desktop) — Case Dossier & Suspects:**
     - **Briefing Card:** Victim details, cause of incident, setting, and timeline summary.
     - **Suspect Lineup (`SuspectGrid.tsx`):** Cards for each suspect showing avatar, name, role, relationship, and quick-view alibi. Clicking a card opens `SuspectDossierModal.tsx` with full biography, motive, police interrogation quote, and a "Mark as Prime Suspect" toggle.
   - **Right Column (65% width on desktop) — Interactive Evidence Locker (`EvidenceTabs.tsx`):**
     - **Tab 1: WhatsApp Logs (`WhatsAppViewer.tsx`):**
       - Left sidebar listing extracted chat threads (`title`, `extractedFromDevice`).
       - Right chat pane styled authentically like dark-mode WhatsApp Web: message bubbles, sender names color-coded per participant, timestamps (`HH:MM`), double-check read receipts (`✓✓`), and a special red/amber banner for `[RECOVERED DELETED MESSAGE]` items.
       - "Pin to Evidence Board" button on each thread.
     - **Tab 2: Forensic Photos (`PhotoEvidenceViewer.tsx`):**
       - Grid of crime scene photographs with location and timestamp metadata.
       - Interactive Hotspot Inspector: Pulsing amber markers (`xPercent`, `yPercent`) overlaid on the image. Clicking a marker reveals a forensic callout tooltip with `label` and `detail`.
     - **Tab 3: CCTV Security Feeds (`CctvFootagePlayer.tsx`):**
       - Simulated multi-camera security monitor with scanline CSS overlay, `REC ●` blinking indicator, and camera selector tabs (`CAM-01`, `CAM-02`).
       - Frame scrubber / timeline stepper allowing the player to step through sequential frames (`Prev Frame`, `Play/Pause Loop`, `Next Frame`).
       - Displays the visual snapshot, timestamp, detected entities tags, and highlights `ANOMALY DETECTED` frames in crimson.
   - **Floating Drawer / Bottom Panel (`DetectiveNotepad.tsx`):**
     - Allows the user to jot down freeform notes and view their pinned evidence IDs (`selectedEvidenceIds`) that will be submitted with their final accusation.

3. **Accusation & Verdict Flow (`AccusationModal.tsx` & `CaseResolutionScreen.tsx`):**
   - Clicking **"Make Accusation"** opens a confirmation modal where the user:
     1. Selects the culprit from the suspect lineup.
     2. Checks 1–3 key pieces of evidence that prove the contradiction.
     3. Optionally writes their deduction summary.
   - Submitting calls `POST /api/cases/:id/solve` and transitions to `CaseResolutionScreen.tsx`:
     - Dramatic reveal banner: **"CASE SOLVED"** (Emerald) or **"WRONGFUL ACCUSATION"** (Crimson).
     - Displays the true culprit, score breakdown (`0-100`), the exact **Alibi Contradiction**, the **Key Evidence** items highlighted, and the **Full Crime Reconstruction**.

## 8. Environment Variables & Configuration

File: `.env.example`

```ini
# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB Connection (Falls back to in-memory store if unreachable during local evaluation)
MONGODB_URI=mongodb://127.0.0.1:27017/ai-mystery-room

# Google Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_TEXT_MODEL=gemini-2.5-flash
ENABLE_AI_IMAGE_GEN=false

# Frontend Vite Proxy / API Base
VITE_API_BASE_URL=http://localhost:5000/api
```

### Resilience Requirement for Local / Sandbox Execution
- **Database Fallback:** If `MONGODB_URI` is not running locally when the server boots, `db.ts` must gracefully log a warning and activate an in-memory repository fallback (pre-seeded with 1 complete playable demo case) so the application remains 100% functional out-of-the-box.
- **Demo Case Seeding:** Include a pre-built, high-quality seed case (*"CASE-2026-001: The Midnight Gallery Heist"*) so users and automated tests can immediately test the WhatsApp viewer, photo hotspots, CCTV player, and accusation flow even before entering a custom Gemini prompt.

## 9. Step-by-Step Implementation Plan for Codex

Codex should execute the build in the following strict order:

1. **Step 1 — Workspace & Backend Scaffolding:**
   - Initialize root `package.json`, `server/package.json`, and `server/tsconfig.json`.
   - Implement `server/src/config/env.ts` and `server/src/config/db.ts` with Mongoose + in-memory store fallback.
2. **Step 2 — Schemas, Models & Seed Data:**
   - Create `Case.model.ts` and `case.schema.ts` (Zod + `@google/genai` `responseSchema`).
   - Create `server/src/services/seedCase.ts` containing a rich, solvable default mystery case.
3. **Step 3 — Gemini Service & Procedural Forensic Asset Engine:**
   - Implement `server/src/services/gemini.service.ts` using `@google/genai` (`ai.models.generateContent` with `gemini-2.5-flash` and structured JSON schema).
   - Implement the SVG forensic image/avatar/CCTV frame generator and optional Imagen 3 integration.
4. **Step 4 — Express Controllers & Routes:**
   - Implement `case.service.ts`, `case.controller.ts`, and `case.routes.ts`.
   - Enforce solution stripping on `GET /api/cases` and `GET /api/cases/:id`.
5. **Step 5 — Frontend Scaffolding & State:**
   - Scaffold `client/` with Vite, React, TypeScript, Tailwind CSS, and `lucide-react`.
   - Implement `types/mystery.ts`, `api/caseApi.ts`, and `context/CaseContext.tsx`.
6. **Step 6 — Evidence Viewers & Detective UI:**
   - Build `WhatsAppViewer.tsx`, `PhotoEvidenceViewer.tsx`, `CctvFootagePlayer.tsx`, `SuspectGrid.tsx`, `AccusationModal.tsx`, and `CaseResolutionScreen.tsx`.
7. **Step 7 — End-to-End Verification:**
   - Run backend unit/integration tests and verify frontend production build (`npm run build`).

## 10. Acceptance Criteria & Verification Checklist

- [ ] **AC-1 (Prompt-to-Case Generation):** Submitting a custom scenario on the home page calls `POST /api/cases/generate` and returns a complete mystery with 3–4 suspects, WhatsApp logs, photo evidence with hotspots, and CCTV recordings.
- [ ] **AC-2 (Solution Secrecy):** Inspecting the network response of `GET /api/cases/:id` confirms that `solution` (`culpritSuspectId`, `alibiContradiction`, `fullReconstruction`) is NOT present in the client payload.
- [ ] **AC-3 (Interactive WhatsApp Proof Viewer):** Users can switch between WhatsApp chat threads, view sender-attributed message bubbles with timestamps and read receipts, and spot recovered/deleted messages.
- [ ] **AC-4 (Interactive Photo Proof Viewer):** Users can inspect crime scene visuals and click coordinate hotspots (`xPercent`, `yPercent`) to reveal forensic notes.
- [ ] **AC-5 (Interactive CCTV Proof Player):** Users can switch between security cameras, scrub through timestamped frames, and identify flagged anomaly frames.
- [ ] **AC-6 (Culprit Selection & Verdict Reveal):** Selecting a suspect and submitting an accusation calls `POST /api/cases/:id/solve`, returns whether the user succeeded, calculates an investigation score (`0–100`), and reveals the full crime reconstruction.
