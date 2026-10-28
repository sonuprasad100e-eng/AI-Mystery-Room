import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    userPrompt: String,
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    title: String,
    story: String,
    caseNumber: String,
    crimeType: String,
    setting: String,
    incidentTimestamp: String,
    victim: mongoose.Schema.Types.Mixed,
    briefing: String,
    timelineSummary: [String],
    suspects: [mongoose.Schema.Types.Mixed],
    clues: [mongoose.Schema.Types.Mixed],
    hints: [String],
    discoveredClues: { type: [String], default: [] },
    hintsUsed: { type: Number, default: 0 },
    usedHintSteps: { type: [Number], default: [] },
    investigationProgress: mongoose.Schema.Types.Mixed,
    accusationStatus: { type: String, default: 'unsolved' },
    status: { type: String, default: 'unsolved' },
    finalVerdict: mongoose.Schema.Types.Mixed,
    score: { type: Number, default: null },
    interrogationLog: { type: [mongoose.Schema.Types.Mixed], default: [] },
    evidence: mongoose.Schema.Types.Mixed,
    solution: mongoose.Schema.Types.Mixed,
    attemptsCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: true }, strict: false }
);

export const CaseModel = mongoose.models.Case || mongoose.model('Case', schema);
