export interface CaseClue {
  clueId: string;
  title: string;
  description: string;
  type: 'physical' | 'document' | 'surveillance' | 'forensic' | 'testimony';
  sourceEvidenceId?: string;
  details?: string;
}

export interface InvestigationProgress {
  totalClues: number;
  discoveredCount: number;
  hintsUsedCount: number;
  progressPercent: number;
}

export interface FinalVerdict {
  correct: boolean;
  accusedSuspectId: string;
  score: number;
  solution?: {
    culpritSuspectId: string;
    motiveSummary: string;
    alibiContradiction: string;
    keyEvidenceIds: string[];
    fullReconstruction: string;
  };
  feedback: string;
  submittedAt: string;
}

export interface InterrogationStatement {
  suspectId: string;
  suspectName: string;
  question: string;
  answer: string;
  timestamp: string;
}

export interface InvestigationReport {
  caseSummary: {
    caseNumber: string;
    title: string;
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
    story: string;
    timeline: string[];
  };
  investigationProgress: InvestigationProgress;
  discoveredClues: Array<{
    clueId: string;
    title: string;
    description: string;
    type: string;
    sourceEvidenceId?: string;
  }>;
  evidenceExhibits: {
    messageThreadsCount: number;
    photosCount: number;
    cctvRecordingsCount: number;
  };
  relevantSuspectStatements: InterrogationStatement[];
  importantContradictions: string[];
  finalAccusationAndVerdict: {
    isResolved: boolean;
    accusationStatus: 'unsolved' | 'solved' | 'failed';
    accusedSuspect?: {
      suspectId: string;
      name: string;
      occupation: string;
    };
    verdict?: 'CORRECT DEDUCTION' | 'INCORRECT ACCUSATION' | 'INVESTIGATION PENDING';
    score: number | null;
    feedback?: string;
  };
  explanation: string;
  isSolutionShielded: boolean;
  generatedAt: string;
}

export type MysteryCase = {
  _id: string;
  userPrompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  title: string;
  story: string;
  caseNumber: string;
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
  suspects: {
    suspectId: string;
    name: string;
    age: number;
    occupation: string;
    relationshipToVictim: string;
    bio: string;
    motive: string;
    alibi: string;
    quirks: string[];
    avatarUrl: string;
    interrogationQuote: string;
  }[];
  clues: CaseClue[];
  hints: string[];
  discoveredClues: string[];
  hintsUsed: number;
  usedHintSteps?: number[];
  investigationProgress: InvestigationProgress;
  accusationStatus: 'unsolved' | 'solved' | 'failed';
  interrogationLog?: InterrogationStatement[];
  finalVerdict?: FinalVerdict | null;
  score?: number | null;
  evidence: {
    whatsappThreads: {
      evidenceId: string;
      title: string;
      participants: string[];
      extractedFromDevice: string;
      messages: {
        messageId: string;
        senderId: string;
        senderName: string;
        timestamp: string;
        text: string;
        isDeletedOrRecovered?: boolean;
        readStatus: 'sent' | 'delivered' | 'read';
      }[];
    }[];
    photos: {
      evidenceId: string;
      title: string;
      locationFound: string;
      timestamp: string;
      imagePrompt: string;
      imageUrl: string;
      forensicNote: string;
      hotspots: {
        xPercent: number;
        yPercent: number;
        label: string;
        detail: string;
      }[];
    }[];
    cctvRecordings: {
      evidenceId: string;
      cameraId: string;
      location: string;
      timeRange: string;
      technicalStatus: string;
      videoUrl?: string;
      frames: {
        frameId: string;
        timestamp: string;
        cameraName: string;
        visualDescription: string;
        detectedEntities: string[];
        anomalyFlag: boolean;
        snapshotSvgOrUrl: string;
      }[];
    }[];
  };
  solution: {
    culpritSuspectId: string;
    motiveSummary: string;
    alibiContradiction: string;
    keyEvidenceIds: string[];
    fullReconstruction: string;
  };
  status: 'unsolved' | 'solved' | 'failed';
  attemptsCount: number;
  createdAt: Date;
};

export type PublicCase = Omit<MysteryCase, 'solution'>;
