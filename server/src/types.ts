export type MysteryCase = {
  _id: string; userPrompt: string; difficulty: 'easy'|'medium'|'hard'; title: string; caseNumber: string; crimeType: string; setting: string; incidentTimestamp: string;
  victim: {name:string;age:number;role:string;causeOfIncident:string;background:string}; briefing:string; timelineSummary:string[];
  suspects:{suspectId:string;name:string;age:number;occupation:string;relationshipToVictim:string;bio:string;motive:string;alibi:string;quirks:string[];avatarUrl:string;interrogationQuote:string}[];
  evidence:{whatsappThreads:{evidenceId:string;title:string;participants:string[];extractedFromDevice:string;messages:{messageId:string;senderId:string;senderName:string;timestamp:string;text:string;isDeletedOrRecovered?:boolean;readStatus:'sent'|'delivered'|'read'}[]}[];photos:{evidenceId:string;title:string;locationFound:string;timestamp:string;imagePrompt:string;imageUrl:string;forensicNote:string;hotspots:{xPercent:number;yPercent:number;label:string;detail:string}[]}[];cctvRecordings:{evidenceId:string;cameraId:string;location:string;timeRange:string;technicalStatus:string;videoUrl?:string;frames:{frameId:string;timestamp:string;cameraName:string;visualDescription:string;detectedEntities:string[];anomalyFlag:boolean;snapshotSvgOrUrl:string}[]}[]};
  solution:{culpritSuspectId:string;motiveSummary:string;alibiContradiction:string;keyEvidenceIds:string[];fullReconstruction:string}; status:'unsolved'|'solved'|'failed';attemptsCount:number;createdAt:Date;
};
export type PublicCase = Omit<MysteryCase, 'solution'>;
