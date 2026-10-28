import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clapperboard,
  Clock3, Cpu, FileText, Fingerprint, Image as ImageIcon, Lightbulb,
  LoaderCircle, MessageCircle, MessageSquareQuote, Pause, Play, Printer, RefreshCw, RotateCcw, Search, Send, Shield, Skull, Sparkles, Target, X,
} from 'lucide-react';
import type { CaseClue, InvestigationReportData, MysteryCase, Suspect } from './types/mystery';
import { API_BASE_URL as API, resolveMediaUrl } from './config/api';

type Page = 'home' | 'room' | 'archive';
type Summary = {
  id: string; title: string; caseNumber: string; crimeType: string;
  difficulty: string; status: string; createdAt?: string;
  discoveredCluesCount?: number; totalCluesCount?: number; score?: number | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'suspect';
  text: string;
  timestamp: string;
};

type EvidenceRecord =
  | MysteryCase['evidence']['whatsappThreads'][number]
  | MysteryCase['evidence']['photos'][number]
  | MysteryCase['evidence']['cctvRecordings'][number];

function evidenceTitle(item: EvidenceRecord) {
  return 'title' in item ? item.title : `${item.cameraId} · ${item.location}`;
}

function evidenceType(item: EvidenceRecord) {
  if ('messages' in item) return 'Message thread';
  if ('hotspots' in item) return 'Forensic photograph';
  return 'CCTV recording';
}

function evidenceDetail(item: EvidenceRecord) {
  if ('messages' in item) return item.extractedFromDevice;
  if ('hotspots' in item) return `${item.locationFound} · ${item.timestamp}`;
  return `${item.cameraId} · ${item.timeRange}`;
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [game, setGame] = useState<MysteryCase | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [tab, setTab] = useState<'clues' | 'chats' | 'photos' | 'cctv' | 'interrogate'>('clues');
  const [interrogatedSuspectId, setInterrogatedSuspectId] = useState<string>('');
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});
  const [thread, setThread] = useState(0);
  const [photo, setPhoto] = useState(0);
  const [hotspot, setHotspot] = useState<number | null>(null);
  const [camera, setCamera] = useState(0);
  const [frame, setFrame] = useState(0);
  const [notes, setNotes] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [reportData, setReportData] = useState<InvestigationReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [accused, setAccused] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [verdict, setVerdict] = useState<any>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [cases, setCases] = useState<Summary[]>([]);
  const [query, setQuery] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState('');

  const allEvidence = useMemo<EvidenceRecord[]>(() => game ? [
    ...game.evidence.whatsappThreads,
    ...game.evidence.photos,
    ...game.evidence.cctvRecordings,
  ] : [], [game]);

  const titleForId = (id: string) => {
    const item = allEvidence.find((entry) => entry.evidenceId === id);
    if (item) return evidenceTitle(item);
    const clueItem = game?.clues?.find((c) => c.clueId === id);
    if (clueItem) return clueItem.title;
    return id;
  };

  const resetInvestigation = (nextCase: MysteryCase) => {
    setGame(nextCase);
    setPage('room');
    setTab('clues');
    setThread(0);
    setPhoto(0);
    setHotspot(null);
    setCamera(0);
    setFrame(0);
    setVerdict(nextCase.finalVerdict || null);
    setPinned([]);
    setAccused(nextCase.finalVerdict?.accusedSuspectId || '');
    setHints([]);
    setError('');
    setConversations({});
    setReportModal(false);
    setReportData(null);
    setInterrogatedSuspectId(nextCase.suspects[0]?.suspectId || '');
  };

  const startNewInvestigation = () => {
    setGame(null);
    setVerdict(null);
    setHints([]);
    setPinned([]);
    setAccused('');
    setNotes('');
    setReportModal(false);
    setReportData(null);
    setError('');
    setPage('home');
  };

  const appendToNotes = (statement: string) => {
    setNotes((current) => (current ? `${current}\n\n${statement}` : statement));
  };

  const addInterrogationMessage = (suspectId: string, message: ChatMessage) => {
    setConversations((current) => ({
      ...current,
      [suspectId]: [...(current[suspectId] || []), message],
    }));
  };

  const loadCase = async (id: string) => {
    setError('');
    const response = await fetch(`${API}/cases/${id}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to open this case.');
    resetInvestigation(data.case);
  };

  useEffect(() => {
    if (page !== 'archive') return;
    let active = true;
    setArchiveLoading(true);
    setArchiveError('');
    fetch(`${API}/cases`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load the archive.');
        if (active) setCases(data.cases || []);
      })
      .catch((reason: unknown) => {
        if (active) setArchiveError(reason instanceof Error ? reason.message : 'Could not load the archive.');
      })
      .finally(() => { if (active) setArchiveLoading(false); });
    return () => { active = false; };
  }, [page]);

  useEffect(() => {
    if (!modal && !reportModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal(false);
        setReportModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, reportModal]);

  const generate = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/cases/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, difficulty }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Case generation failed.');
      resetInvestigation(data.case);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Case generation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const solve = async () => {
    if (!game || !accused) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/cases/${game._id}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspectId: accused, selectedEvidenceIds: pinned, reasoning }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit your accusation.');
      setVerdict(data);
      setModal(false);
      setGame((current) => current ? {
        ...current,
        status: data.correct ? 'solved' : 'failed',
        score: data.score,
        finalVerdict: data.finalVerdict,
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not submit your accusation.');
    } finally {
      setLoading(false);
    }
  };

  const requestHint = async () => {
    if (!game) return;
    setError('');
    try {
      const nextStep = hints.length + 1;
      const response = await fetch(`${API}/cases/${game._id}/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: nextStep }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not retrieve a hint.');
      setHints((current) => [...current, data.hint]);
      setGame((current) => current ? {
        ...current,
        hintsUsed: (current.hintsUsed || 0) + 1,
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not retrieve a hint.');
    }
  };

  const handleDiscoverClue = async (clueId: string) => {
    if (!game || !clueId) return;
    try {
      const response = await fetch(`${API}/cases/${game._id}/clues/${encodeURIComponent(clueId)}/discover`, {
        method: 'POST',
      });
      const data = await response.json();
      if (response.ok && data.discoveredClues) {
        setGame((current) => current ? {
          ...current,
          discoveredClues: data.discoveredClues,
          investigationProgress: data.investigationProgress,
        } : current);
      }
    } catch {
      // Local optimistic update
      setGame((current) => current ? {
        ...current,
        discoveredClues: Array.from(new Set([...(current.discoveredClues || []), clueId])),
      } : current);
    }
  };

  const openReport = async () => {
    if (!game) return;
    setReportLoading(true);
    setReportModal(true);
    try {
      const response = await fetch(`${API}/cases/${game._id}/report`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to retrieve investigation report.');
      setReportData(data.report);
    } catch (err: any) {
      setError(err?.message || 'Failed to load investigation report.');
    } finally {
      setReportLoading(false);
    }
  };

  const togglePin = (id: string) => setPinned((current) => (
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  ));

  const openDemo = () => loadCase('CASE-2026-001').catch((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : 'Could not open the demo case.');
  });

  const updatePhotoUrl = (evidenceId: string, newUrl: string) => {
    setGame((current) => {
      if (!current) return current;
      return {
        ...current,
        evidence: {
          ...current.evidence,
          photos: current.evidence.photos.map((p) =>
            p.evidenceId === evidenceId ? { ...p, imageUrl: newUrl } : p
          ),
        },
      };
    });
  };

  const updateVideoUrl = (evidenceId: string, newUrl: string) => {
    setGame((current) => {
      if (!current) return current;
      return {
        ...current,
        evidence: {
          ...current.evidence,
          cctvRecordings: current.evidence.cctvRecordings.map((r) =>
            r.evidenceId === evidenceId ? { ...r, videoUrl: newUrl } : r
          ),
        },
      };
    });
  };

  return (
    <div className="app-shell">
      <Header
        page={page}
        onHome={() => { setPage('home'); setError(''); }}
        onArchive={() => { setPage('archive'); setError(''); }}
      />

      {page === 'home' && (
        <HomePage
          prompt={prompt} setPrompt={setPrompt} difficulty={difficulty} setDifficulty={setDifficulty}
          loading={loading} error={error} onGenerate={generate} onOpenDemo={openDemo}
        />
      )}

      {page === 'archive' && (
        <ArchivePage
          cases={cases} query={query} setQuery={setQuery} loading={archiveLoading}
          error={archiveError} onOpen={(id) => loadCase(id).catch((reason: unknown) => {
            setArchiveError(reason instanceof Error ? reason.message : 'Could not open this case.');
          })} onNew={() => setPage('home')}
        />
      )}

      {page === 'room' && game && (
        <InvestigationPage
          game={game} tab={tab} setTab={setTab} thread={thread} setThread={setThread}
          photo={photo} setPhoto={setPhoto} hotspot={hotspot} setHotspot={setHotspot}
          camera={camera} setCamera={setCamera} frame={frame} setFrame={setFrame}
          notes={notes} setNotes={setNotes} pinned={pinned} accused={accused}
          setAccused={setAccused} verdict={verdict} hints={hints} loading={loading}
          error={error} evidence={allEvidence} titleForId={titleForId}
          interrogatedSuspectId={interrogatedSuspectId}
          setInterrogatedSuspectId={setInterrogatedSuspectId}
          conversations={conversations}
          onAddInterrogationMessage={addInterrogationMessage}
          onAddToNotes={appendToNotes}
          onTogglePin={togglePin}
          onHint={requestHint}
          onDiscoverClue={handleDiscoverClue}
          onOpenReport={openReport}
          onNewInvestigation={startNewInvestigation}
          onAccuse={() => setModal(true)}
          onClearHints={() => setHints([])}
          onRetry={() => setVerdict(null)}
          onBack={() => { setPage('archive'); setError(''); }}
          onUpdatePhotoUrl={updatePhotoUrl}
          onUpdateVideoUrl={updateVideoUrl}
        />
      )}

      {modal && game && (
        <AccusationDialog
          suspects={game.suspects} evidence={allEvidence} pinned={pinned}
          accused={accused} setAccused={setAccused} reasoning={reasoning}
          setReasoning={setReasoning} titleForId={titleForId} loading={loading}
          error={error} onTogglePin={togglePin} onClose={() => setModal(false)} onSubmit={solve}
        />
      )}

      {reportModal && (
        <InvestigationReportModal
          report={reportData}
          loading={reportLoading}
          onClose={() => setReportModal(false)}
        />
      )}
    </div>
  );
}

function Header({ page, onHome, onArchive }: { page: Page; onHome: () => void; onArchive: () => void }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="AI Mystery Room home">
        <span className="brand-mark"><Fingerprint size={20} strokeWidth={1.6} /></span>
        <span className="brand-copy"><b>CASEFILE</b><span>AI MYSTERY ROOM</span></span>
      </button>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={page === 'home' ? 'nav-active' : ''} onClick={onHome}>New investigation</button>
        <button className={page === 'archive' || page === 'room' ? 'nav-active' : ''} onClick={onArchive}>Case archive</button>
      </nav>
      <div className="system-status"><span className="status-dot" /> Case desk online</div>
    </header>
  );
}

function HomePage({
  prompt, setPrompt, difficulty, setDifficulty, loading, error, onGenerate, onOpenDemo,
}: {
  prompt: string; setPrompt: (value: string) => void; difficulty: string;
  setDifficulty: (value: string) => void; loading: boolean; error: string;
  onGenerate: (event?: FormEvent) => void; onOpenDemo: () => void;
}) {
  const presets = [
    'The Starling Emerald Heist at Mumbai Gold Souk',
    'Poisoned Filter Coffee at a Bengaluru Tech Startup',
    'Midnight Blackout at a Heritage Haveli in Jaipur',
    'Sabotage on the Konkan Railway Express',
  ];

  const genStages = [
    'Synthesizing crime facts, scene setting & timeline...',
    'Forging distinct suspect profiles, alibis & hidden motives...',
    'Generating forensic evidence exhibits, communication intercepts & surveillance...',
    'Crafting progressive investigative hints & sealing the culprit...',
    'Verifying logical consistency with Zod and arming casefile...',
  ];
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    if (!loading) { setStageIdx(0); return; }
    const timer = setInterval(() => {
      setStageIdx((prev) => (prev + 1) % genStages.length);
    }, 2200);
    return () => clearInterval(timer);
  }, [loading]);

  return (
    <main className="home-page page-width">
      <section className="home-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-rule" /> AN INVESTIGATION STARTS HERE</div>
          <h1>Every case has<br />a <em>missing piece.</em></h1>
          <p>Read the room. Interrogate suspects. Follow the evidence. Find the contradiction that cracks the case.</p>
          <div className="hero-note"><Shield size={15} /><span>Backend-shielded culprit. Genuine evidence trail. Your deduction.</span></div>
        </div>
        <div className="hero-scene" aria-hidden="true">
          <div className="scene-glow" />
          <div className="scene-card scene-card-back"><span>FIELD NOTE</span><div className="note-lines" /></div>
          <div className="scene-card scene-card-main">
            <div className="scene-card-top"><span>CASE STUDY</span><span>DEMO FILE</span></div>
            <p className="scene-card-title">The Midnight Gallery Heist</p>
            <div className="scene-tags"><span>4 Suspects</span><span>7 Clues</span><span>3 Hints</span></div>
          </div>
        </div>
      </section>

      <section className="intake-grid">
        <form className="generator panel" onSubmit={onGenerate}>
          <div className="panel-heading">
            <div><span className="section-index">01</span><h2>Open a new case</h2></div>
            <span className="panel-kicker"><Sparkles size={14} /> CASE INTAKE</span>
          </div>
          <label htmlFor="scenario">Case premise or crime scenario</label>
          <textarea
            id="scenario"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="A diamond necklace vanished during a Diwali party at a South Mumbai penthouse…"
            maxLength={600}
          />
          <div className="quick-start-head"><b>Start with a scenario lead</b><span>Or create your own custom crime</span></div>
          <div className="presets">
            {presets.map((preset) => (
              <button type="button" key={preset} onClick={() => setPrompt(preset)}>{preset}</button>
            ))}
          </div>

          <div className="generator-footer">
            <label className="difficulty-control" htmlFor="difficulty">
              Difficulty
              <span className="select-wrap">
                <select id="difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                  <option value="easy">Easy (3 suspects · 5 clues · 2 hints)</option>
                  <option value="medium">Medium (4 suspects · 7 clues · 3 hints)</option>
                  <option value="hard">Hard (5 suspects · 9 clues · 3 hints)</option>
                </select>
                <ChevronDown size={14} />
              </span>
            </label>
            <button className="primary-button" type="submit" disabled={loading || prompt.trim().length < 10}>
              {loading ? <><LoaderCircle className="spin" size={17} /> Synthesizing mystery…</> : <>Generate case <ArrowRight size={16} /></>}
            </button>
          </div>

          {loading && (
            <div className="generation-progress-card">
              <LoaderCircle className="spin" size={18} />
              <div>
                <b>AI Forensic Engine Active</b>
                <span>{genStages[stageIdx]}</span>
              </div>
            </div>
          )}

          {error && <ErrorMessage>{error}</ErrorMessage>}
        </form>

        <aside className="demo-card panel">
          <div className="demo-art"><BookOpen size={26} strokeWidth={1.35} /><span>PLAYABLE DEMO</span></div>
          <div className="demo-copy">
            <span className="eyebrow">READY TO INVESTIGATE</span>
            <h2>Step into the archive.</h2>
            <p>Explore an offline-ready murder mystery case with WhatsApp logs, forensic photo schematics, CCTV surveillance, and suspect interrogation.</p>
            <button className="text-action" onClick={onOpenDemo}>Open the demo case <ArrowRight size={15} /></button>
          </div>
          <div className="demo-stamp">CASE<br /><b>001</b></div>
        </aside>
      </section>
      <footer className="page-footer"><span>PROCEDURAL FORENSIC CASES · REAL DEDUCTION</span><span>01 — INTAKE</span></footer>
    </main>
  );
}

function ArchivePage({ cases, query, setQuery, loading, error, onOpen, onNew }: {
  cases: Summary[]; query: string; setQuery: (value: string) => void;
  loading: boolean; error: string; onOpen: (id: string) => void; onNew: () => void;
}) {
  const filtered = cases.filter((item) =>
    `${item.title} ${item.caseNumber} ${item.crimeType}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <main className="content-page page-width">
      <div className="eyebrow"><span className="eyebrow-rule" /> RECORDS & INVESTIGATIONS</div>
      <div className="page-heading">
        <div><h1>Case archive</h1><p>Return to an open case file or begin a new mystery investigation.</p></div>
        <button className="primary-button" onClick={onNew}>New investigation <ArrowRight size={16} /></button>
      </div>
      <div className="archive-toolbar">
        <div className="archive-count">
          <FileText size={16} />
          <span>{loading ? 'Checking records…' : `${cases.length} ${cases.length === 1 ? 'case' : 'cases'} on file`}</span>
        </div>
        <label className="searchbox">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search case files by title, id, or crime type"
            aria-label="Search case files"
          />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {loading ? (
        <div className="archive-state"><LoaderCircle className="spin" size={20} /><span>Retrieving case archives…</span></div>
      ) : (
        <div className="archive-grid">
          {filtered.map((item, index) => (
            <button className="archive-card" key={item.id} onClick={() => onOpen(item.id)}>
              <div className="archive-card-head">
                <span className="archive-file-icon"><FileText size={18} /></span>
                <span className={`status-badge status-${item.status}`}>{item.status}</span>
              </div>
              <span className="archive-number">{item.caseNumber || `FILE ${String(index + 1).padStart(3, '0')}`}</span>
              <b className="archive-title">{item.title}</b>
              <span className="archive-type">
                {item.crimeType || 'Investigation'} <i /> {item.difficulty} difficulty
              </span>
              {typeof item.score === 'number' && (
                <small className="text-gold font-mono">Score: {item.score} pts</small>
              )}
              <span className="archive-open">Open file <ArrowRight size={15} /></span>
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="archive-empty">
              <span className="empty-mark"><Search size={20} /></span>
              <h2>{cases.length ? 'No matching files found' : 'The archive is currently empty.'}</h2>
              <p>{cases.length ? 'Try a different search query or filter.' : 'Generate your first mystery and it will appear here.'}</p>
              {!cases.length && <button className="secondary-button" onClick={onNew}>Create a case <ArrowRight size={15} /></button>}
            </div>
          )}
        </div>
      )}
      <footer className="page-footer"><span>SECURE CASE ARCHIVE</span><span>02 — RECORDS</span></footer>
    </main>
  );
}

function InvestigationPage({
  game, tab, setTab, thread, setThread, photo, setPhoto, hotspot, setHotspot,
  camera, setCamera, frame, setFrame, notes, setNotes, pinned, accused, setAccused,
  verdict, hints, loading, error, evidence, titleForId,
  interrogatedSuspectId, setInterrogatedSuspectId, conversations,
  onAddInterrogationMessage, onAddToNotes,
  onTogglePin, onHint, onDiscoverClue, onOpenReport, onNewInvestigation, onClearHints, onRetry, onAccuse, onBack, onUpdatePhotoUrl, onUpdateVideoUrl,
}: {
  game: MysteryCase;
  tab: 'clues' | 'chats' | 'photos' | 'cctv' | 'interrogate';
  setTab: (tab: 'clues' | 'chats' | 'photos' | 'cctv' | 'interrogate') => void;
  thread: number; setThread: (index: number) => void;
  photo: number; setPhoto: (index: number) => void;
  hotspot: number | null; setHotspot: (index: number | null) => void;
  camera: number; setCamera: (index: number) => void;
  frame: number; setFrame: Dispatch<SetStateAction<number>>;
  notes: string; setNotes: (value: string) => void;
  pinned: string[]; accused: string; setAccused: (id: string) => void;
  verdict: any; hints: string[]; loading: boolean; error: string;
  evidence: EvidenceRecord[]; titleForId: (id: string) => string;
  interrogatedSuspectId: string; setInterrogatedSuspectId: (id: string) => void;
  conversations: Record<string, ChatMessage[]>;
  onAddInterrogationMessage: (suspectId: string, message: ChatMessage) => void;
  onAddToNotes: (statement: string) => void;
  onTogglePin: (id: string) => void;
  onHint: () => void;
  onDiscoverClue: (clueId: string) => void;
  onOpenReport: () => void;
  onNewInvestigation: () => void;
  onClearHints: () => void;
  onRetry: () => void;
  onAccuse: () => void;
  onBack: () => void;
  onUpdatePhotoUrl?: (evidenceId: string, newUrl: string) => void;
  onUpdateVideoUrl?: (evidenceId: string, newUrl: string) => void;
}) {
  const cluesList = game.clues || [];
  const discoveredClues = game.discoveredClues || [];
  const totalClues = cluesList.length || (game.difficulty === 'easy' ? 5 : game.difficulty === 'hard' ? 9 : 7);
  const discoveredCount = discoveredClues.length;
  const progressPercent = Math.min(100, Math.round((discoveredCount / totalClues) * 100));

  const totalHintsAllowed = game.hints?.length || (game.difficulty === 'easy' ? 2 : 3);
  const hintsUsedCount = typeof game.hintsUsed === 'number' ? game.hintsUsed : hints.length;

  const difficultyBase = game.difficulty === 'easy' ? 100 : game.difficulty === 'hard' ? 200 : 150;

  const tabs = [
    { id: 'clues' as const, label: 'Clues', Icon: Search, count: totalClues },
    { id: 'chats' as const, label: 'Messages', Icon: MessageCircle, count: game.evidence.whatsappThreads.length },
    { id: 'photos' as const, label: 'Forensics', Icon: ImageIcon, count: game.evidence.photos.length },
    { id: 'cctv' as const, label: 'CCTV', Icon: Clapperboard, count: game.evidence.cctvRecordings.length },
    { id: 'interrogate' as const, label: 'Interrogation', Icon: MessageSquareQuote, count: game.suspects.length },
  ];

  const currentCamera = game.evidence.cctvRecordings[camera];
  const currentFrame = currentCamera?.frames[frame];

  return (
    <main className="investigation-page page-width">
      <div className="case-toolbar">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={15} /> Case archive
        </button>
        <div className="case-actions">
          <button className="secondary-button" onClick={onOpenReport}>
            <FileText size={16} /> Investigation report
          </button>
          <button className="hint-button" onClick={onHint}>
            <Lightbulb size={16} /> Request hint
            {hints.length > 0 && <span>{hints.length}</span>}
          </button>
          <button className="primary-button accuse-button" onClick={onAccuse}>
            <Target size={16} /> Make accusation
          </button>
        </div>
      </div>

      <header className="case-heading">
        <div className="eyebrow">
          <span className="eyebrow-rule" /> {game.caseNumber}{' '}
          <span className="difficulty-badge">{game.difficulty.toUpperCase()}</span>
        </div>
        <h1>{game.title}</h1>
        <div className="case-meta">
          <span><Shield size={14} /> {game.crimeType}</span>
          <i />
          <span>{game.setting}</span>
          <i />
          <span><Clock3 size={14} /> {game.incidentTimestamp}</span>
        </div>

        {/* Live Investigation Progress Meter */}
        <div className="progress-card">
          <div className="progress-header">
            <b>Investigation Progress ({progressPercent}%)</b>
            <span>
              Clues: {discoveredCount}/{totalClues} · Hints Used: {hintsUsedCount}/{totalHintsAllowed}
            </span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="progress-metrics">
            <span>Base points for correct solve: {difficultyBase} pts</span>
            <span>+5 pts per discovered clue</span>
            <span>-10 pts per hint used</span>
          </div>
        </div>
      </header>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {hints.length > 0 && (
        <div className="hint-callout">
          <span className="hint-icon"><Lightbulb size={17} /></span>
          <div>
            <b>Investigator’s Guidance <small>HINT {String(hints.length).padStart(2, '0')}</small></b>
            <p>{hints[hints.length - 1]}</p>
          </div>
          <button onClick={onClearHints} aria-label="Dismiss hints"><X size={15} /></button>
        </div>
      )}

      {verdict && (
        <VerdictPanel
          verdict={verdict}
          game={game}
          titleForId={titleForId}
          onRetry={onRetry}
          onOpenReport={onOpenReport}
          onNewInvestigation={onNewInvestigation}
          onArchive={onBack}
        />
      )}

      <div className="investigation-grid">
        <aside className="case-sidebar">
          <BriefingCard game={game} />
          <section className="suspect-section">
            <div className="section-heading">
              <div><span className="section-index">02</span><h2>Persons of interest</h2></div>
              <span className="item-count">{game.suspects.length} DOSSIERS</span>
            </div>
            <div className="suspect-list">
              {game.suspects.map((suspect, index) => (
                <SuspectCard
                  key={suspect.suspectId}
                  suspect={suspect}
                  number={index + 1}
                  selected={accused === suspect.suspectId}
                  onSelect={() => setAccused(suspect.suspectId)}
                  onInterrogate={() => {
                    setTab('interrogate');
                    setInterrogatedSuspectId(suspect.suspectId);
                  }}
                />
              ))}
            </div>
          </section>

          <section className="notes-card panel">
            <div className="notes-heading">
              <div><FileText size={16} /><h2>Investigator’s notes</h2></div>
              <span className="session-label">THIS SESSION</span>
            </div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Record a timestamp, question an alibi, connect a clue…"
              aria-label="Investigator's notes"
            />
            <div className="pinned-heading">
              <span>Pinned evidence</span>
              <span className="pin-count">{pinned.length}</span>
            </div>
            {pinned.length > 0 ? (
              <div className="pinned-list">
                {pinned.map((id) => (
                  <div className="pinned-item" key={id}>
                    <span><Fingerprint size={13} />{titleForId(id)}</span>
                    <button onClick={() => onTogglePin(id)} aria-label={`Remove ${titleForId(id)}`}><X size={14} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-pins">Pin useful messages, photographs, clues, or camera records as you investigate.</p>
            )}
          </section>
        </aside>

        <section className="evidence-locker panel" aria-label="Evidence locker">
          <div className="locker-heading">
            <div>
              <span className="section-index">03</span>
              <div><span className="locker-kicker">COLLECTED RECORDS & LEADS</span><h2>Evidence locker</h2></div>
            </div>
            <span className="locker-total">{evidence.length + cluesList.length} ITEMS</span>
          </div>
          <div className="evidence-tabs" role="tablist" aria-label="Evidence categories">
            {tabs.map(({ id, label, Icon, count }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'evidence-tab active' : 'evidence-tab'}
                onClick={() => setTab(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
                <small>{String(count).padStart(2, '0')}</small>
              </button>
            ))}
          </div>

          <div className="evidence-content">
            {tab === 'clues' && (
              <CluesEvidence
                clues={cluesList}
                discoveredClues={discoveredClues}
                pinned={pinned}
                onTogglePin={onTogglePin}
                onDiscoverClue={onDiscoverClue}
              />
            )}
            {tab === 'chats' && (
              <MessagesEvidence
                threads={game.evidence.whatsappThreads}
                thread={thread}
                setThread={setThread}
                pinned={pinned}
                onTogglePin={onTogglePin}
              />
            )}
            {tab === 'photos' && (
              <PhotoEvidence
                caseId={game._id}
                photos={game.evidence.photos}
                photo={photo}
                setPhoto={setPhoto}
                hotspot={hotspot}
                setHotspot={(idx) => {
                  setHotspot(idx);
                  if (idx !== null && game.evidence.photos[photo]) {
                    onDiscoverClue(`clue_hs_${game.evidence.photos[photo].evidenceId}_${idx + 1}`);
                  }
                }}
                pinned={pinned}
                onTogglePin={onTogglePin}
                onUpdatePhotoUrl={onUpdatePhotoUrl}
              />
            )}
            {tab === 'cctv' && (
              <CctvEvidence
                caseId={game._id}
                recordings={game.evidence.cctvRecordings}
                camera={camera}
                setCamera={setCamera}
                frame={frame}
                setFrame={setFrame}
                currentCamera={currentCamera}
                currentFrame={currentFrame}
                pinned={pinned}
                onTogglePin={onTogglePin}
                onUpdateVideoUrl={onUpdateVideoUrl}
                onInspectFrame={(fIndex) => {
                  if (currentCamera?.frames[fIndex]?.anomalyFlag) {
                    onDiscoverClue(`clue_fr_${currentCamera.evidenceId}_${fIndex + 1}`);
                  }
                }}
              />
            )}
            {tab === 'interrogate' && (
              <InterrogationEvidence
                suspects={game.suspects}
                selectedSuspectId={interrogatedSuspectId || game.suspects[0]?.suspectId || ''}
                onSelectSuspect={setInterrogatedSuspectId}
                conversations={conversations}
                onAddMessage={onAddInterrogationMessage}
                caseId={game._id}
                onAddToNotes={onAddToNotes}
              />
            )}
          </div>
        </section>
      </div>

      <footer className="investigation-footer">
        <span>INVESTIGATION FILE · {game.caseNumber}</span>
        <button onClick={onAccuse}>
          Ready to make your accusation <ArrowRight size={15} />
        </button>
      </footer>
    </main>
  );
}

function BriefingCard({ game }: { game: MysteryCase }) {
  return (
    <section className="briefing-card panel">
      <div className="section-heading">
        <div><span className="section-index">01</span><h2>Incident briefing</h2></div>
        <Skull size={18} className="briefing-mark" />
      </div>
      <div className="victim-block">
        <span className="small-label">VICTIM</span>
        <h3>{game.victim.name}</h3>
        <p>{game.victim.age} · {game.victim.role}</p>
      </div>
      <div className="incident-summary">
        <span className="small-label">INCIDENT SUMMARY</span>
        <p>{game.story || game.briefing}</p>
      </div>
      <div className="briefing-facts">
        <div><span className="small-label">CAUSE</span><p>{game.victim.causeOfIncident}</p></div>
        <div><span className="small-label">BACKGROUND</span><p>{game.victim.background}</p></div>
      </div>
      <div className="timeline-block">
        <div className="timeline-heading">
          <span className="small-label">CASE TIMELINE</span>
          <span>{game.timelineSummary.length} EVENTS</span>
        </div>
        <ol className="timeline">
          {game.timelineSummary.map((item, index) => (
            <li key={`${index}-${item}`}>
              <span className="timeline-marker" />
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SuspectCard({ suspect, number, selected, onSelect, onInterrogate }: {
  suspect: Suspect; number: number; selected: boolean; onSelect: () => void; onInterrogate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={`suspect-card ${selected ? 'suspect-selected' : ''}`}>
      <button className="suspect-summary" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
        <Portrait src={suspect.avatarUrl} name={suspect.name} />
        <span className="suspect-identity"><b>{suspect.name}</b><small>{suspect.occupation}</small></span>
        <span className="dossier-number">D-{String(number).padStart(2, '0')}</span>
        <ChevronDown size={16} className={expanded ? 'chevron expanded' : 'chevron'} />
      </button>
      {expanded && (
        <div className="suspect-details">
          <span className="relationship-label">{suspect.relationshipToVictim}</span>
          <p>{suspect.bio}</p>
          <div className="suspect-fact"><b>STATED ALIBI</b><p>{suspect.alibi}</p></div>
          <div className="suspect-fact"><b>POSSIBLE MOTIVE</b><p>{suspect.motive}</p></div>
          {suspect.quirks.length > 0 && (
            <div className="quirks">
              {suspect.quirks.map((quirk) => <span key={quirk}>{quirk}</span>)}
            </div>
          )}
          <blockquote>“{suspect.interrogationQuote}”</blockquote>
          <div className="suspect-card-actions">
            {onInterrogate && (
              <button className="interrogate-suspect-btn" onClick={onInterrogate}>
                <MessageSquareQuote size={13} /> Question this person
              </button>
            )}
            <button className={selected ? 'select-suspect selected' : 'select-suspect'} onClick={onSelect}>
              {selected ? <><Check size={14} /> Selected for accusation</> : <><Target size={14} /> Mark as prime suspect</>}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function CluesEvidence({
  clues,
  discoveredClues,
  pinned,
  onTogglePin,
  onDiscoverClue,
}: {
  clues: CaseClue[];
  discoveredClues: string[];
  pinned: string[];
  onTogglePin: (id: string) => void;
  onDiscoverClue: (clueId: string) => void;
}) {
  if (!clues || clues.length === 0) {
    return <EmptyEvidence title="No clues listed" detail="No clues are currently attached to this case file." />;
  }

  return (
    <div className="clues-view">
      <div className="thread-rail-heading">
        <span>INVESTIGATIVE CLUE REGISTER (+5 PTS EACH)</span>
        <span>{discoveredClues.length} / {clues.length} DISCOVERED</span>
      </div>
      {clues.map((clue, index) => {
        const isDiscovered = discoveredClues.includes(clue.clueId);
        return (
          <article key={clue.clueId} className={`clue-card ${isDiscovered ? 'discovered' : 'undiscovered'}`}>
            <div className="clue-card-head">
              <span className="clue-type-tag">CLUE #{index + 1} · {clue.type}</span>
              <span className={`clue-badge ${isDiscovered ? 'discovered' : 'undiscovered'}`}>
                {isDiscovered ? <><Check size={11} /> Discovered (+5 pts)</> : 'Undiscovered'}
              </span>
            </div>
            <h4>{isDiscovered ? clue.title : `Unexamined Forensic Lead #${index + 1}`}</h4>
            <p>
              {isDiscovered
                ? clue.description
                : 'Examine crime-scene photographs, examine WhatsApp intercepts, inspect CCTV surveillance, or click below to analyze this lead.'}
            </p>
            <div className="clue-card-footer">
              {!isDiscovered ? (
                <button className="clue-action-btn" onClick={() => onDiscoverClue(clue.clueId)}>
                  <Search size={12} /> Inspect and discover clue (+5 pts)
                </button>
              ) : (
                <PinAction id={clue.clueId} pinned={pinned} onTogglePin={onTogglePin} />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MessagesEvidence({ threads, thread, setThread, pinned, onTogglePin }: {
  threads: MysteryCase['evidence']['whatsappThreads']; thread: number; setThread: (index: number) => void;
  pinned: string[]; onTogglePin: (id: string) => void;
}) {
  const current = threads[thread];
  if (!threads.length) return <EmptyEvidence title="No message records" detail="No chat threads were attached to this case." />;
  return (
    <div className="messages-view">
      <aside className="thread-rail">
        <div className="thread-rail-heading"><span>DEVICE EXTRACTS</span><span>{String(threads.length).padStart(2, '0')}</span></div>
        {threads.map((item, index) => (
          <button key={item.evidenceId} className={index === thread ? 'thread-option selected' : 'thread-option'} onClick={() => setThread(index)}>
            <span className="thread-icon"><MessageCircle size={16} /></span>
            <span className="thread-copy"><b>{item.title}</b><small>{item.extractedFromDevice}</small></span>
            <ArrowRight size={13} className="thread-arrow" />
          </button>
        ))}
      </aside>
      {current && (
        <div className="message-record">
          <div className="record-heading">
            <div>
              <span className="record-type">COMMUNICATION TRANSCRIPT</span>
              <h3>{current.title}</h3>
              <p>{current.participants.join(' · ')}</p>
            </div>
            <span className="record-seal"><Shield size={16} /> VERIFIED</span>
          </div>
          <div className="message-list" aria-label="Messages">
            {current.messages.map((message) => (
              <article className={message.isDeletedOrRecovered ? 'message-record-row recovered-message' : 'message-record-row'} key={message.messageId}>
                <time>{message.timestamp}</time>
                <div className="message-entry">
                  <div className="message-entry-top">
                    <b>{message.senderName}</b>
                    {message.isDeletedOrRecovered && <span className="recovered-tag">RECOVERED</span>}
                  </div>
                  <p>{message.text}</p>
                  <small>{message.isDeletedOrRecovered ? 'Recovered from device backup' : `Read status: ${message.readStatus}`}</small>
                </div>
              </article>
            ))}
          </div>
          <div className="record-footer">
            <span>EXTRACTED FROM {current.extractedFromDevice.toUpperCase()}</span>
            <PinAction id={current.evidenceId} pinned={pinned} onTogglePin={onTogglePin} />
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoEvidence({
  caseId, photos, photo, setPhoto, hotspot, setHotspot, pinned, onTogglePin, onUpdatePhotoUrl,
}: {
  caseId?: string;
  photos: MysteryCase['evidence']['photos'];
  photo: number;
  setPhoto: (index: number) => void;
  hotspot: number | null;
  setHotspot: (index: number | null) => void;
  pinned: string[];
  onTogglePin: (id: string) => void;
  onUpdatePhotoUrl?: (evidenceId: string, newUrl: string) => void;
}) {
  const current = photos[photo];
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  if (!photos.length) return <EmptyEvidence title="No forensic photographs" detail="No photo evidence was attached to this case." />;

  const isSvg = Boolean(current?.imageUrl && (current.imageUrl.startsWith('data:image/svg') || current.imageUrl.endsWith('.svg')));
  const isAi = Boolean(current?.imageUrl && (current.imageUrl.startsWith('/api/media') || current.imageUrl.startsWith('http') || current.imageUrl.startsWith('data:image/jpeg') || current.imageUrl.startsWith('data:image/png')) && !isSvg);
  const isMissing = !current?.imageUrl;

  const handleGenerate = async (evidenceId: string) => {
    if (!caseId) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`${API}/cases/${caseId}/evidence/${evidenceId}/generate-image`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate evidence photograph.');
      }
      if (data.imageUrl && onUpdatePhotoUrl) {
        onUpdatePhotoUrl(evidenceId, data.imageUrl);
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate image.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="forensic-view">
      <div className="forensic-list">
        <div className="thread-rail-heading"><span>PHOTO LOG</span><span>{String(photos.length).padStart(2, '0')}</span></div>
        {photos.map((item, index) => {
          const itemSvg = Boolean(item.imageUrl && (item.imageUrl.startsWith('data:image/svg') || item.imageUrl.endsWith('.svg')));
          const itemAi = Boolean(item.imageUrl && !itemSvg);
          return (
            <button
              className={index === photo ? 'forensic-option selected' : 'forensic-option'}
              key={item.evidenceId}
              onClick={() => { setPhoto(index); setHotspot(null); setGenError(null); }}
            >
              <ImageWithFallback src={item.imageUrl} alt="" label={item.title} variant="thumbnail" />
              <span>
                <b>{item.title}</b>
                <small>{itemAi ? 'AI Photo' : itemSvg ? 'Schematic' : 'No image'} · {item.locationFound}</small>
              </span>
              <ArrowRight size={13} />
            </button>
          );
        })}
      </div>
      {current && (
        <div className="forensic-report">
          <div className="forensic-image-wrap">
            <ImageWithFallback src={current.imageUrl} alt={current.title} label={current.title} variant="forensic-image" />
            <div className="photo-stamp">EXHIBIT {String(photo + 1).padStart(2, '0')}</div>
            <div className="photo-media-type-badge">
              {isAi && <span className="media-tag ai-tag"><Sparkles size={11} /> AI SCENE PHOTOGRAPH</span>}
              {isSvg && <span className="media-tag schematic-tag"><Cpu size={11} /> FORENSIC SCHEMATIC // NOT A REAL PHOTOGRAPH</span>}
              {isMissing && <span className="media-tag missing-tag"><AlertTriangle size={11} /> NO IMAGE ATTACHED</span>}
            </div>
            {generating && (
              <div className="generating-overlay" role="status">
                <LoaderCircle className="spin" size={30} />
                <b>SYNTHESIZING CRIME-SCENE PHOTOGRAPH</b>
                <span>Requesting AI image provider & saving to local evidence archive…</span>
                <small>Takes 5–15 seconds via free provider</small>
              </div>
            )}
            {current.hotspots.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                className={hotspot === index ? 'hotspot active' : 'hotspot'}
                style={{ left: `${item.xPercent}%`, top: `${item.yPercent}%` }}
                onClick={() => setHotspot(hotspot === index ? null : index)}
                aria-label={`Inspect clue: ${item.label}`}
                aria-pressed={hotspot === index}
              >
                {String(index + 1).padStart(2, '0')}
              </button>
            ))}
          </div>

          <div className="forensic-action-bar">
            <div className="forensic-status-info">
              {isAi && <span><Sparkles size={13} className="text-gold" /> AI photograph generated from case evidence prompt. Numbered markers highlight recovered clues.</span>}
              {isSvg && <span><Cpu size={13} className="text-blue" /> Procedural vector schematic fallback. Click to synthesize a realistic AI photograph using the free provider.</span>}
              {isMissing && <span><AlertTriangle size={13} className="text-red" /> No image attached. Click to synthesize a realistic AI photograph.</span>}
            </div>
            {caseId && (
              <button
                className={`forensic-gen-btn ${isAi ? 'secondary' : 'primary'}`}
                disabled={generating}
                onClick={() => handleGenerate(current.evidenceId)}
                aria-label={isAi ? 'Regenerate photograph' : 'Generate AI photograph'}
              >
                {generating ? (
                  <><LoaderCircle className="spin" size={13} /> Generating…</>
                ) : isAi ? (
                  <><RefreshCw size={13} /> Regenerate photo</>
                ) : (
                  <><Sparkles size={13} /> Generate AI photo</>
                )}
              </button>
            )}
          </div>

          {genError && (
            <div className="forensic-error-alert" role="alert">
              <AlertTriangle size={14} />
              <span>{genError}</span>
              <button onClick={() => handleGenerate(current.evidenceId)}><RefreshCw size={12} /> Retry generation</button>
            </div>
          )}

          <div className="report-caption">
            <div>
              <span className="record-type">FORENSIC EXHIBIT · {current.timestamp}</span>
              <h3>{current.title}</h3>
              <p className="report-location">Recovered at {current.locationFound}</p>
            </div>
            <PinAction id={current.evidenceId} pinned={pinned} onTogglePin={onTogglePin} />
          </div>

          <div className="forensic-note">
            <span className="note-mark"><Fingerprint size={15} /></span>
            <p>
              {hotspot !== null && current.hotspots[hotspot] ? (
                <><b>{current.hotspots[hotspot].label}.</b> {current.hotspots[hotspot].detail}</>
              ) : (
                current.forensicNote
              )}
            </p>
          </div>

          {current.hotspots.length > 0 && (
            <div className="clue-index">
              <span>OBSERVATIONS</span>
              {current.hotspots.map((item, index) => (
                <button
                  key={`${item.label}-${index}`}
                  className={hotspot === index ? 'clue-chip active' : 'clue-chip'}
                  onClick={() => setHotspot(hotspot === index ? null : index)}
                >
                  <i>{String(index + 1).padStart(2, '0')}</i>{item.label}
                </button>
              ))}
            </div>
          )}

          {photos.length > 1 && (
            <div className="forensic-pagination">
              <button onClick={() => { setPhoto((photo + photos.length - 1) % photos.length); setHotspot(null); setGenError(null); }}>
                <ArrowLeft size={14} /> Previous exhibit
              </button>
              <span>{String(photo + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</span>
              <button onClick={() => { setPhoto((photo + 1) % photos.length); setHotspot(null); setGenError(null); }}>
                Next exhibit <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CctvEvidence({
  caseId,
  recordings,
  camera,
  setCamera,
  frame,
  setFrame,
  currentCamera,
  currentFrame,
  pinned,
  onTogglePin,
  onUpdateVideoUrl,
  onInspectFrame,
}: {
  caseId?: string;
  recordings: MysteryCase['evidence']['cctvRecordings'];
  camera: number;
  setCamera: (index: number) => void;
  frame: number;
  setFrame: Dispatch<SetStateAction<number>>;
  currentCamera: MysteryCase['evidence']['cctvRecordings'][number] | undefined;
  currentFrame: MysteryCase['evidence']['cctvRecordings'][number]['frames'][number] | undefined;
  pinned: string[];
  onTogglePin: (id: string) => void;
  onUpdateVideoUrl?: (evidenceId: string, newUrl: string) => void;
  onInspectFrame?: (frameIndex: number) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerateVideo = async (force = false) => {
    if (!caseId || !currentCamera || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`${API}/cases/${encodeURIComponent(caseId)}/cctv/${encodeURIComponent(currentCamera.evidenceId)}/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.videoUrl) {
        throw new Error(data.error || 'Failed to synthesize CCTV footage.');
      }
      onUpdateVideoUrl?.(currentCamera.evidenceId, data.videoUrl);
      setIsPlaying(false);
    } catch (err: any) {
      setGenError(err.message || 'Video synthesis failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!isPlaying || !currentCamera || currentCamera.frames.length <= 1) return;
    const timer = setInterval(() => {
      setFrame((prev) => {
        const next = (prev + 1) % currentCamera.frames.length;
        onInspectFrame?.(next);
        return next;
      });
    }, 1400);
    return () => clearInterval(timer);
  }, [isPlaying, currentCamera, setFrame, onInspectFrame]);

  if (!recordings.length) return <EmptyEvidence title="No camera records" detail="No CCTV recordings were attached to this case." />;
  return (
    <div className="cctv-evidence">
      <div className="cctv-toolbar">
        <div><span className="record-type">CAMERA FEED</span><b>{currentCamera?.location}</b></div>
        <div className="camera-options">
          {recordings.map((item, index) => (
            <button
              key={item.evidenceId}
              className={camera === index ? 'camera-option active' : 'camera-option'}
              onClick={() => { setIsPlaying(false); setCamera(index); setFrame(0); setGenError(null); }}
            >
              {item.cameraId}
            </button>
          ))}
        </div>
      </div>
      {currentCamera && currentFrame ? (
        <>
          <div className="cctv-screen">
            {currentCamera.videoUrl ? (
              <VideoWithFallback src={currentCamera.videoUrl} label={currentCamera.cameraId} />
            ) : (
              <ImageWithFallback src={currentFrame.snapshotSvgOrUrl} alt={currentFrame.visualDescription} label={currentFrame.cameraName} variant="camera-image" />
            )}
            {!currentCamera.videoUrl && (
              <div className="cctv-overlay"><span>{currentFrame.cameraName}</span><span>{currentFrame.timestamp}</span></div>
            )}
            {!currentCamera.videoUrl && <span className="rec-label static-label">SIMULATED CCTV FRAME</span>}
            {currentCamera.videoUrl && <span className="rec-label"><i /> SYNTHESIZED CCTV CLIP</span>}
            {!currentCamera.videoUrl && <div className="camera-scan" />}
          </div>

          <div className="cctv-action-bar">
            <div className="cctv-status-info">
              {currentCamera.videoUrl ? (
                <span className="text-emerald"><Check size={13} /> CCTV footage rendered (H.264 MP4 via FFmpeg filtergraph). Use player controls to inspect.</span>
              ) : (
                <span><Clapperboard size={13} className="text-amber" /> Simulated frame sequence. Synthesize a 6-second CCTV video with slow zoom, timestamps & scanlines.</span>
              )}
            </div>
            {caseId && (
              <button
                className={`cctv-gen-btn ${currentCamera.videoUrl ? 'secondary' : 'primary'}`}
                disabled={generating}
                onClick={() => handleGenerateVideo(Boolean(currentCamera.videoUrl))}
                aria-label={currentCamera.videoUrl ? 'Regenerate CCTV video' : 'Generate CCTV video'}
              >
                {generating ? (
                  <><LoaderCircle className="spin" size={13} /> Synthesizing video…</>
                ) : currentCamera.videoUrl ? (
                  <><RefreshCw size={13} /> Regenerate CCTV video</>
                ) : (
                  <><Clapperboard size={13} /> Generate CCTV video</>
                )}
              </button>
            )}
          </div>

          {genError && (
            <div className="forensic-error-alert" role="alert">
              <AlertTriangle size={14} />
              <span>{genError}</span>
              <button onClick={() => handleGenerateVideo(true)}><RefreshCw size={12} /> Retry</button>
            </div>
          )}

          <div className="cctv-details">
            <div className="cctv-description">
              <span className={currentFrame.anomalyFlag ? 'anomaly-label flagged' : 'anomaly-label'}>
                {currentFrame.anomalyFlag ? 'ANOMALY MARKED' : 'FRAME RECORD'}
              </span>
              <p>{currentFrame.visualDescription}</p>
              <div className="entity-list">
                {currentFrame.detectedEntities.map((entity) => <span key={entity}>{entity}</span>)}
              </div>
            </div>
            <PinAction id={currentCamera.evidenceId} pinned={pinned} onTogglePin={onTogglePin} />
          </div>
          <div className="camera-footage-info">
            <span>{currentCamera.timeRange}</span>
            <span>{currentCamera.technicalStatus}</span>
          </div>
          <div className="frame-timeline">
            <div className="frame-timeline-head">
              <span>FOOTAGE INDEX</span>
              <span>{String(currentCamera.frames.length).padStart(2, '0')} FRAMES</span>
            </div>
            <div className="frame-track">
              {currentCamera.frames.map((item, index) => (
                <button
                  key={item.frameId}
                  className={frame === index ? 'frame-point active' : 'frame-point'}
                  onClick={() => {
                    setIsPlaying(false);
                    setFrame(index);
                    onInspectFrame?.(index);
                  }}
                  aria-label={`Show frame ${index + 1} at ${item.timestamp}`}
                >
                  <i className={item.anomalyFlag ? 'point-anomaly' : ''} />
                  <span>{item.timestamp}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="frame-controls">
            <button
              onClick={() => {
                setIsPlaying(false);
                const prev = Math.max(0, frame - 1);
                setFrame(prev);
                onInspectFrame?.(prev);
              }}
              disabled={frame === 0}
            >
              <ArrowLeft size={14} /> Previous frame
            </button>
            <button
              className={`loop-toggle-btn ${isPlaying ? 'active' : ''}`}
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? 'Pause frame loop' : 'Play frame loop'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              <span>{isPlaying ? 'Pause loop' : 'Auto loop'}</span>
            </button>
            <span>{String(frame + 1).padStart(2, '0')} / {String(currentCamera.frames.length).padStart(2, '0')}</span>
            <button
              onClick={() => {
                setIsPlaying(false);
                const next = (frame + 1) % currentCamera.frames.length;
                setFrame(next);
                onInspectFrame?.(next);
              }}
            >
              Next frame <ArrowRight size={14} />
            </button>
          </div>
        </>
      ) : (
        <EmptyEvidence title="No frames in this recording" detail="Choose another camera or return to the case file." />
      )}
    </div>
  );
}

function InterrogationEvidence({
  suspects,
  selectedSuspectId,
  onSelectSuspect,
  conversations,
  onAddMessage,
  caseId,
  onAddToNotes,
}: {
  suspects: Suspect[];
  selectedSuspectId: string;
  onSelectSuspect: (id: string) => void;
  conversations: Record<string, ChatMessage[]>;
  onAddMessage: (suspectId: string, message: ChatMessage) => void;
  caseId: string;
  onAddToNotes: (statement: string) => void;
}) {
  const activeSuspect = suspects.find((s) => s.suspectId === selectedSuspectId) || suspects[0];
  const messages = activeSuspect ? (conversations[activeSuspect.suspectId] || []) : [];
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async (qToSend?: string) => {
    const text = (qToSend || question).trim();
    if (!text || loading || !activeSuspect) return;

    setError(null);
    setLastQuestion(null);
    setLoading(true);
    if (!qToSend) setQuestion('');

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    onAddMessage(activeSuspect.suspectId, userMsg);

    const historyPayload = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.text,
    }));

    try {
      const res = await fetch(`${API}/cases/${caseId}/suspects/${activeSuspect.suspectId}/interrogate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, history: historyPayload }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'The suspect could not be reached.');
      }

      const suspectMsg: ChatMessage = {
        id: `s-${Date.now()}`,
        role: 'suspect',
        text: data.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      onAddMessage(activeSuspect.suspectId, suspectMsg);
    } catch (err: any) {
      setError(err?.message || 'Could not send question. Please try asking again.');
      setLastQuestion(text);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    'Where were you during the incident?',
    'Did you see or hear anyone suspicious?',
    'What was your relationship with the victim?',
    'Can anyone confirm your stated alibi?',
  ];

  return (
    <div className="interrogation-view">
      <aside className="suspect-rail">
        <div className="thread-rail-heading">
          <span>SUSPECT LIST</span>
          <span>{String(suspects.length).padStart(2, '0')} PERSONS</span>
        </div>
        {suspects.map((suspect) => {
          const count = (conversations[suspect.suspectId] || []).filter((m) => m.role === 'suspect').length;
          const isSelected = suspect.suspectId === activeSuspect?.suspectId;
          return (
            <button
              key={suspect.suspectId}
              className={isSelected ? 'suspect-rail-item selected' : 'suspect-rail-item'}
              onClick={() => {
                onSelectSuspect(suspect.suspectId);
                setError(null);
                setLastQuestion(null);
              }}
            >
              <Portrait src={suspect.avatarUrl} name={suspect.name} />
              <span className="suspect-rail-info">
                <b>{suspect.name}</b>
                <small>{suspect.occupation}</small>
                {count > 0 && <span className="interrogation-count">{count} {count === 1 ? 'reply' : 'replies'}</span>}
              </span>
              <ArrowRight size={13} className="thread-arrow" />
            </button>
          );
        })}
      </aside>

      {activeSuspect ? (
        <div className="interrogation-chamber">
          <header className="chamber-header">
            <div className="chamber-profile">
              <Portrait src={activeSuspect.avatarUrl} name={activeSuspect.name} />
              <div>
                <span className="record-type">FORMAL QUESTIONING</span>
                <h3>{activeSuspect.name}</h3>
                <p>{activeSuspect.occupation} · {activeSuspect.relationshipToVictim}</p>
              </div>
            </div>
            <div className="chamber-alibi-pill">
              <b>Stated Alibi:</b> {activeSuspect.alibi}
            </div>
          </header>

          <div className="interrogation-stream" ref={chatScrollRef} aria-label="Interrogation conversation">
            <div className="interrogation-opening-quote">
              <span className="quote-mark">“</span>
              <p>{activeSuspect.interrogationQuote}</p>
              <small>Initial statement recorded in preliminary case file</small>
            </div>

            {messages.map((msg) => (
              <div key={msg.id} className={`interrogation-bubble-wrap ${msg.role === 'user' ? 'user-turn' : 'suspect-turn'}`}>
                {msg.role === 'suspect' && (
                  <div className="bubble-speaker">
                    <Portrait src={activeSuspect.avatarUrl} name={activeSuspect.name} />
                  </div>
                )}
                <div className="interrogation-bubble">
                  <div className="bubble-header">
                    <b>{msg.role === 'user' ? 'Investigator' : activeSuspect.name}</b>
                    <time>{msg.timestamp}</time>
                  </div>
                  <p>{msg.text}</p>
                  {msg.role === 'suspect' && (
                    <div className="bubble-actions">
                      <button
                        className="save-statement-action"
                        onClick={() => {
                          onAddToNotes(`[Statement from ${activeSuspect.name}]: "${msg.text}"`);
                          setSavedId(msg.id);
                          setTimeout(() => setSavedId(null), 2500);
                        }}
                      >
                        <FileText size={12} />
                        {savedId === msg.id ? 'Saved to notes!' : 'Save statement'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="interrogation-bubble-wrap suspect-turn">
                <div className="bubble-speaker">
                  <Portrait src={activeSuspect.avatarUrl} name={activeSuspect.name} />
                </div>
                <div className="interrogation-bubble typing-bubble">
                  <div className="bubble-header">
                    <b>{activeSuspect.name}</b>
                    <span>Thinking…</span>
                  </div>
                  <div className="typing-dots">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="interrogation-error-bar" role="alert">
              <AlertTriangle size={15} />
              <span>{error}</span>
              {lastQuestion && (
                <button onClick={() => handleSend(lastQuestion)}>
                  <RefreshCw size={12} /> Retry question
                </button>
              )}
            </div>
          )}

          <div className="chamber-input-area">
            <div className="quick-inquiries">
              <span>COMMON QUESTIONS</span>
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  className="quick-question-chip"
                  disabled={loading}
                  onClick={() => handleSend(q)}
                >
                  {q}
                </button>
              ))}
            </div>

            <form
              className="chamber-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, 300))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={`Ask ${activeSuspect.name} a question in simple English...`}
                aria-label={`Ask ${activeSuspect.name} a question`}
                rows={2}
                disabled={loading}
              />
              <div className="chamber-form-footer">
                <span className="char-count">{question.length}/300</span>
                <button
                  type="submit"
                  className="send-question-btn"
                  disabled={loading || !question.trim()}
                  aria-label="Send question"
                >
                  {loading ? <LoaderCircle className="spin" size={13} /> : <Send size={13} />}
                  <span>Ask suspect</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <EmptyEvidence title="No suspect selected" detail="Select a suspect on the left to begin questioning." />
      )}
    </div>
  );
}

function VerdictPanel({
  verdict, game, titleForId, onRetry, onOpenReport, onNewInvestigation, onArchive,
}: {
  verdict: any; game: MysteryCase; titleForId: (id: string) => string;
  onRetry: () => void; onOpenReport: () => void; onNewInvestigation: () => void; onArchive: () => void;
}) {
  const culprit = game.suspects.find((suspect) => suspect.suspectId === verdict.solution?.culpritSuspectId);
  const breakdown = verdict.scoreBreakdown;

  return (
    <section className={`verdict-panel ${verdict.correct ? 'verdict-correct' : 'verdict-wrong'}`}>
      <div className="verdict-emblem">{verdict.correct ? <Check size={22} /> : <X size={22} />}</div>
      <div className="verdict-main">
        <span className="verdict-kicker">
          {verdict.correct ? 'CASE RESOLVED' : 'ACCUSATION REJECTED'} · INVESTIGATION SCORE: {verdict.score} POINTS
        </span>
        <h2>{verdict.correct ? 'The evidence holds together. Accusation verified!' : 'One piece of the story is still missing.'}</h2>
        <p><b>{culprit?.name || 'Culprit'}</b> — {verdict.solution?.motiveSummary}</p>

        {breakdown && (
          <div className="score-breakdown-box">
            <span className="score-item">
              Difficulty Base: <b>+{breakdown.difficultyBasePoints} pts</b>
            </span>
            <span className="score-item">
              Clues Discovered ({breakdown.discoveredCluesCount}): <b>+{breakdown.clueBonus} pts</b>
            </span>
            <span className="score-item">
              Hints Used ({breakdown.hintsUsedCount}): <b>-{breakdown.hintPenalty} pts</b>
            </span>
            <span className="score-item">
              Total Score: <b>{breakdown.totalScore} pts</b>
            </span>
          </div>
        )}

        <div className="verdict-details">
          <div><span>THE CONTRADICTION</span><p>{verdict.solution?.alibiContradiction}</p></div>
          <div><span>FULL RECONSTRUCTION</span><p>{verdict.solution?.fullReconstruction}</p></div>
        </div>
        <div className="verdict-evidence">
          <span>KEY EXHIBITS</span>
          {verdict.solution?.keyEvidenceIds?.map((id: string) => (
            <span className="verdict-exhibit" key={id}>{titleForId(id)}</span>
          ))}
        </div>
        <div className="verdict-actions">
          {!verdict.correct && (
            <button className="primary-button retry-btn" onClick={onRetry}>
              <RotateCcw size={15} /> Re-examine clues & Try again
            </button>
          )}
          <button className="secondary-button" onClick={onOpenReport}>
            <FileText size={15} /> View Full Investigation Report
          </button>
          <button className="primary-button" onClick={onNewInvestigation}>
            <Sparkles size={15} /> Start Another Investigation
          </button>
          <button className="secondary-button" onClick={onArchive}>
            <BookOpen size={15} /> Return to Case Archive
          </button>
        </div>
      </div>
    </section>
  );
}

function InvestigationReportModal({
  report,
  loading,
  onClose,
}: {
  report: InvestigationReportData | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
        <button className="dialog-close" onClick={onClose} aria-label="Close report"><X size={18} /></button>

        {loading || !report ? (
          <div className="archive-state">
            <LoaderCircle className="spin" size={24} />
            <span>Compiling formal forensic investigation dossier…</span>
          </div>
        ) : (
          <div>
            <header className="report-header-banner">
              <div>
                <span className="eyebrow"><span className="eyebrow-rule" /> OFFICIAL FORENSIC DOSSIER</span>
                <h2 id="report-modal-title" style={{ margin: '6px 0', fontSize: '24px' }}>
                  {report.caseSummary.title}
                </h2>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  CASE #{report.caseSummary.caseNumber} · {report.caseSummary.crimeType} · {report.caseSummary.setting}
                </span>
              </div>
              <div>
                <span className={`report-seal-badge ${report.isSolutionShielded ? 'classified' : 'resolved'}`}>
                  {report.isSolutionShielded ? 'CLASSIFIED // ACTIVE CASE' : 'CASE CLOSED // VERDICT LOGGED'}
                </span>
              </div>
            </header>

            {/* Section 1: Case Summary */}
            <section className="report-section">
              <div className="report-section-title">1. Case Summary & Incident Details</div>
              <div className="report-grid-two">
                <div className="report-box">
                  <b>INCIDENT BRIEFING</b>
                  <p style={{ marginTop: '4px' }}>{report.caseSummary.story || report.caseSummary.briefing}</p>
                  <b style={{ display: 'block', marginTop: '8px' }}>VICTIM PROFILE</b>
                  <p style={{ marginTop: '2px' }}>
                    {report.caseSummary.victim.name} ({report.caseSummary.victim.age} · {report.caseSummary.victim.role})
                  </p>
                  <p style={{ margin: '2px 0 0' }}>Cause: {report.caseSummary.victim.causeOfIncident}</p>
                </div>
                <div className="report-box">
                  <b>INCIDENT TIMELINE</b>
                  <ol style={{ paddingLeft: '16px', margin: '4px 0 0' }}>
                    {report.caseSummary.timeline.map((event, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}>{event}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </section>

            {/* Section 2: Investigation Progress */}
            <section className="report-section">
              <div className="report-section-title">2. Investigation Progress & Scoring Metrics</div>
              <div className="report-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span>Discovered Clues: <b>{report.investigationProgress.discoveredCount} / {report.investigationProgress.totalClues}</b></span>
                  <span>Hints Requested: <b>{report.investigationProgress.hintsUsedCount}</b></span>
                  <span>Completion: <b>{report.investigationProgress.progressPercent}%</b></span>
                </div>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${report.investigationProgress.progressPercent}%` }} />
                </div>
              </div>
            </section>

            {/* Section 3: Discovered Clues & Evidence */}
            <section className="report-section">
              <div className="report-section-title">3. Discovered Forensic Clues & Exhibits</div>
              <div className="report-box">
                <div style={{ marginBottom: '8px', fontSize: '10px', color: '#94a3b8' }}>
                  EXHIBITS RECORDED: {report.evidenceExhibits.messageThreadsCount} message transcripts · {report.evidenceExhibits.photosCount} photographic exhibits · {report.evidenceExhibits.cctvRecordingsCount} surveillance feeds
                </div>
                {report.discoveredClues.length > 0 ? (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {report.discoveredClues.map((clue) => (
                      <div key={clue.clueId} style={{ padding: '6px 8px', background: '#162332', borderRadius: '4px' }}>
                        <span style={{ fontSize: '9px', color: '#d9a441', textTransform: 'uppercase' }}>[{clue.type}]</span>{' '}
                        <b>{clue.title}</b>: {clue.description}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontStyle: 'italic', color: '#64748b' }}>
                    No forensic clues marked as discovered yet. Inspect evidence exhibits in the investigation locker.
                  </p>
                )}
              </div>
            </section>

            {/* Section 4: Relevant Suspect Statements */}
            <section className="report-section">
              <div className="report-section-title">4. Relevant Suspect Statements</div>
              <div className="report-box">
                {report.relevantSuspectStatements.length > 0 ? (
                  <div style={{ display: 'grid', gap: '6px' }}>
                    {report.relevantSuspectStatements.map((stmt, idx) => (
                      <div key={idx} style={{ padding: '6px 8px', background: '#162332', borderRadius: '4px' }}>
                        <b style={{ color: '#93c5fd' }}>{stmt.suspectName}:</b> “{stmt.answer}”
                        <span style={{ display: 'block', fontSize: '9px', color: '#64748b', marginTop: '2px' }}>
                          In response to: “{stmt.question}”
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontStyle: 'italic', color: '#64748b' }}>
                    No suspect interrogation statements logged yet.
                  </p>
                )}
              </div>
            </section>

            {/* Section 5: Important Contradictions */}
            <section className="report-section">
              <div className="report-section-title">5. Evidence-Supported Contradictions</div>
              <div className="report-box">
                {report.importantContradictions.map((c, i) => (
                  <p key={i} style={{ margin: '0 0 4px', color: report.isSolutionShielded ? '#94a3b8' : '#fca5a5' }}>
                    {c}
                  </p>
                ))}
              </div>
            </section>

            {/* Section 6: Final Accusation & Verdict */}
            <section className="report-section">
              <div className="report-section-title">6. Accusation & Case Verdict</div>
              <div className="report-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span>Verdict Status: </span>
                    <b style={{ color: report.finalAccusationAndVerdict.verdict === 'CORRECT DEDUCTION' ? '#4ade80' : '#f59e0b' }}>
                      {report.finalAccusationAndVerdict.verdict}
                    </b>
                  </div>
                  {typeof report.finalAccusationAndVerdict.score === 'number' && (
                    <div className="text-gold font-mono">
                      Final Score: <b>{report.finalAccusationAndVerdict.score} points</b>
                    </div>
                  )}
                </div>
                {report.finalAccusationAndVerdict.accusedSuspect && (
                  <p style={{ marginTop: '6px' }}>
                    Suspect Accused: <b>{report.finalAccusationAndVerdict.accusedSuspect.name}</b> ({report.finalAccusationAndVerdict.accusedSuspect.occupation})
                  </p>
                )}
                {report.finalAccusationAndVerdict.feedback && (
                  <p style={{ margin: '4px 0 0', color: '#cbd5e1' }}>
                    Evaluation: {report.finalAccusationAndVerdict.feedback}
                  </p>
                )}
              </div>
            </section>

            {/* Section 7: Explanation Supported by Case Evidence */}
            <section className="report-section">
              <div className="report-section-title">7. Evidence-Backed Crime Reconstruction</div>
              <div className="report-box" style={{ background: '#14202e', borderLeft: '3px solid #d9a441' }}>
                <p style={{ margin: 0, fontStyle: report.isSolutionShielded ? 'italic' : 'normal' }}>
                  {report.explanation}
                </p>
              </div>
            </section>

            <footer className="report-actions">
              <button className="secondary-button" onClick={() => window.print()}>
                <Printer size={15} /> Print / Save Dossier
              </button>
              <button className="primary-button" onClick={onClose}>
                Return to Investigation
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}

function AccusationDialog({
  suspects, evidence, pinned, accused, setAccused, reasoning, setReasoning,
  titleForId, loading, error, onTogglePin, onClose, onSubmit,
}: {
  suspects: Suspect[]; evidence: EvidenceRecord[]; pinned: string[]; accused: string; setAccused: (id: string) => void;
  reasoning: string; setReasoning: (value: string) => void; titleForId: (id: string) => string;
  loading: boolean; error: string; onTogglePin: (id: string) => void; onClose: () => void; onSubmit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const chosenSuspect = suspects.find((s) => s.suspectId === accused);

  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="accusation-dialog" role="dialog" aria-modal="true" aria-labelledby="accusation-title">
        <button className="dialog-close" onClick={onClose} aria-label="Close accusation dialog"><X size={18} /></button>
        <div className="eyebrow"><span className="eyebrow-rule" /> FINAL DEDUCTION</div>
        <h2 id="accusation-title">Who is responsible?</h2>
        <p className="dialog-intro">Choose the suspect and the records that support your conclusion.</p>

        <div className="dialog-section">
          <div className="dialog-section-heading"><span>01 · SELECT A SUSPECT</span><small>{suspects.length} DOSSIERS</small></div>
          <div className="suspect-choices">
            {suspects.map((suspect, index) => (
              <button
                key={suspect.suspectId}
                className={accused === suspect.suspectId ? 'suspect-choice chosen' : 'suspect-choice'}
                onClick={() => { setAccused(suspect.suspectId); setConfirming(false); }}
                aria-pressed={accused === suspect.suspectId}
              >
                <Portrait src={suspect.avatarUrl} name={suspect.name} />
                <span><b>{suspect.name}</b><small>D-{String(index + 1).padStart(2, '0')} · {suspect.occupation}</small></span>
                {accused === suspect.suspectId && <Check size={16} />}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog-section evidence-select-section">
          <div className="dialog-section-heading"><span>02 · SELECT EVIDENCE</span><small>{pinned.length} SELECTED</small></div>
          <p className="selection-help">Select the records that best support your theory. You can change your selections.</p>
          {evidence.length ? (
            <div className="evidence-choices">
              {evidence.map((item) => {
                const selected = pinned.includes(item.evidenceId);
                return (
                  <button
                    key={item.evidenceId}
                    className={selected ? 'evidence-choice selected' : 'evidence-choice'}
                    onClick={() => onTogglePin(item.evidenceId)}
                    aria-pressed={selected}
                  >
                    <span className="choice-check">{selected && <Check size={13} />}</span>
                    <span><b>{evidenceTitle(item)}</b><small>{evidenceType(item)} · {evidenceDetail(item)}</small></span>
                  </button>
                );
              })}
            </div>
          ) : <p className="selection-help">This case has no evidence records to select.</p>}
        </div>

        <label className="reasoning-label" htmlFor="reasoning">YOUR DEDUCTION <span>OPTIONAL</span></label>
        <textarea id="reasoning" value={reasoning} onChange={(event) => setReasoning(event.target.value)} placeholder="What detail convinced you?" />

        {confirming && chosenSuspect && (
          <div className="confirmation-callout" role="alert">
            <AlertTriangle size={18} className="warn-icon" />
            <div>
              <b>Confirm Final Accusation</b>
              <p>Are you ready to accuse <b>{chosenSuspect.name}</b>? Submitting will evaluate your deduction on the backend and reveal the crime reconstruction.</p>
            </div>
          </div>
        )}

        {error && <ErrorMessage>{error}</ErrorMessage>}

        <div className="dialog-footer">
          {confirming ? (
            <>
              <button className="secondary-button" onClick={() => setConfirming(false)}>Back to review</button>
              <button className="primary-button accuse-confirm-btn" disabled={loading} onClick={onSubmit}>
                {loading ? <LoaderCircle className="spin" size={16} /> : <Target size={16} />} Confirm & Reveal Solution
              </button>
            </>
          ) : (
            <>
              <span><Shield size={14} /> Accusation requires selecting one prime suspect.</span>
              <button className="primary-button" disabled={!accused || loading} onClick={() => setConfirming(true)}>
                Review & Accuse <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Portrait({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(!src);
  useEffect(() => setFailed(!src), [src]);
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <span className="portrait">
      {!failed && <img src={src} alt={`${name} portrait`} onError={() => setFailed(true)} />}
      {failed && <span aria-label={`${name} portrait placeholder`}>{initials}</span>}
    </span>
  );
}

function ImageWithFallback({ src, alt, label, variant }: { src: string; alt: string; label: string; variant: string }) {
  const resolvedSrc = resolveMediaUrl(src);
  const [failed, setFailed] = useState(!resolvedSrc);
  const [loading, setImageLoading] = useState(Boolean(resolvedSrc) && !resolvedSrc.startsWith('data:image/'));
  useEffect(() => {
    const unavailable = !resolvedSrc;
    setFailed(unavailable);
    setImageLoading(!unavailable && !resolvedSrc.startsWith('data:image/'));
  }, [resolvedSrc]);

  return (
    <div className={`image-fallback ${variant} ${failed ? 'fallback-active' : ''}`}>
      {!failed && <img src={resolvedSrc} alt={alt} loading="lazy" onLoad={() => setImageLoading(false)} onError={() => { setFailed(true); setImageLoading(false); }} />}
      {loading && <div className="media-loading" role="status"><LoaderCircle className="spin" size={20} /><span>Loading exhibit…</span></div>}
      {failed && (
        <div className="media-unavailable">
          <ImageIcon size={24} strokeWidth={1.2} />
          <span>NO IMAGE ATTACHED</span>
          <b>{label}</b>
          <small>No scene photograph is attached to this record.</small>
        </div>
      )}
    </div>
  );
}

function VideoWithFallback({ src, label }: { src: string; label: string }) {
  const resolvedSrc = resolveMediaUrl(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [resolvedSrc]);
  if (failed) return <div className="video-unavailable" role="status"><Clapperboard size={24} /><b>VIDEO COULD NOT BE LOADED</b><span>{label}</span></div>;
  return <video className="cctv-video" src={resolvedSrc} controls preload="metadata" aria-label={`${label} footage`} onError={() => setFailed(true)} />;
}

function PinAction({ id, pinned, onTogglePin }: { id: string; pinned: string[]; onTogglePin: (id: string) => void }) {
  const selected = pinned.includes(id);
  return (
    <button className={selected ? 'pin-action pinned' : 'pin-action'} onClick={() => onTogglePin(id)} aria-pressed={selected}>
      {selected ? <><Check size={14} /> Pinned</> : <><Fingerprint size={14} /> Pin evidence</>}
    </button>
  );
}

function EmptyEvidence({ title, detail }: { title: string; detail: string }) {
  return <div className="evidence-empty"><span><Search size={18} /></span><h3>{title}</h3><p>{detail}</p></div>;
}

function ErrorMessage({ children }: { children: string }) {
  return <div className="error-message" role="alert"><span><X size={14} /></span>{children}</div>;
}
