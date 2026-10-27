# AI Mystery Room

A noir-style, AI-assisted detective game. Start with `npm install`, copy `.env.example` to `.env`, then run `npm run dev`. MongoDB and Gemini are optional. The seeded demo works without them; forensic image generation and CCTV video generation/storage are not integrated. The demo contains clue descriptions and timestamped frame records, not real scene photos or video footage.

The API listens on port 5000 and the Vite app on port 5173. Set `GEMINI_API_KEY` to enable generated cases. Set `MONGODB_URI` for persistence. Generated cases are schema-validated and require Gemini; generation failures return an error rather than saving the unrelated demo case.
