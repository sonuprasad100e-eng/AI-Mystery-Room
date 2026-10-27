import 'dotenv/config';
export const env={port:Number(process.env.PORT||5000),mongoUri:process.env.MONGODB_URI||'',geminiKey:process.env.GEMINI_API_KEY||'',geminiModel:process.env.GEMINI_TEXT_MODEL||'gemini-3.5-flash-lite'};
