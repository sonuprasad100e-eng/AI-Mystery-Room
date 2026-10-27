import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clapperboard,
  Clock3, FileText, Fingerprint, Image as ImageIcon, Lightbulb,
  LoaderCircle, MessageCircle, Search, Shield, Skull, Sparkles, Target, X,
} from 'lucide-react';
import type { MysteryCase, Suspect } from './types/mystery';

const API = '/api';
type Page = 'home' | 'room' | 'archive';
type Summary = {
  id: string; title: string; caseNumber: string; crimeType: string;
  difficulty: string; status: string; createdAt?: string;
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
  const [tab, setTab] = useState<'chats' | 'photos' | 'cctv'>('chats');
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
    return item ? evidenceTitle(item) : id;
  };

  const resetInvestigation = (nextCase: MysteryCase) => {
    setGame(nextCase);
    setPage('room');
    setTab('chats');
    setThread(0);
    setPhoto(0);
    setHotspot(null);
    setCamera(0);
    setFrame(0);
    setVerdict(null);
    setPinned([]);
    setAccused('');
    setHints([]);
    setError('');
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
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setModal(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal]);

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
      setError(reason instanceof Error ? reason.message : 'Case generation failed.');
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
      const response = await fetch(`${API}/cases/${game._id}/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: hints.length + 1 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not retrieve a hint.');
      setHints((current) => [...current, data.hint]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not retrieve a hint.');
    }
  };

  const togglePin = (id: string) => setPinned((current) => (
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  ));

  const openDemo = () => loadCase('CASE-2026-001').catch((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : 'Could not open the demo case.');
  });

  return (
    <div className="app-shell">
      <Header page={page} onHome={() => { setPage('home'); setError(''); }} onArchive={() => { setPage('archive'); setError(''); }} />

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
          onTogglePin={togglePin} onHint={requestHint} onAccuse={() => setModal(true)}
          onClearHints={() => setHints([])} onBack={() => { setPage('archive'); setError(''); }}
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
    'Blackout at the Louvre Vault', 'Poisoned Espresso at a Tech IPO',
    'Disappearance on the Orient Express', 'Sabotage at a Deep-Sea Station',
  ];
  return (
    <main className="home-page page-width">
      <section className="home-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-rule" /> AN INVESTIGATION STARTS HERE</div>
          <h1>Every case has<br />a <em>missing piece.</em></h1>
          <p>Read the room. Follow the evidence. Find the detail that changes everything.</p>
          <div className="hero-note"><Shield size={15} /><span>Three suspects. One truth. Your call.</span></div>
        </div>
        <div className="hero-scene" aria-hidden="true">
          <div className="scene-glow" />
          <div className="scene-card scene-card-back"><span>FIELD NOTE</span><div className="note-lines" /></div>
          <div className="scene-card scene-card-main">
            <div className="scene-card-top"><span>CASE STUDY</span><span>NO. 01</span></div>
            <div className="scene-seal"><Fingerprint size={34} strokeWidth={1.2} /></div>
            <div className="scene-rule" />
            <div className="scene-caption">THE EVIDENCE<br /><b>IS NEVER SILENT.</b></div>
            <div className="scene-coordinates">47° 36′ 12″ N&nbsp;&nbsp; 122° 20′ 31″ W</div>
          </div>
          <div className="scene-tag">ARCHIVE / ACTIVE</div>
        </div>
      </section>

      <section className="intake-grid">
        <form className="generator panel" onSubmit={onGenerate}>
          <div className="panel-heading">
            <div><span className="section-index">01</span><h2>Open a new case</h2></div>
            <span className="panel-kicker"><Sparkles size={14} /> CASE INTAKE</span>
          </div>
          <label htmlFor="scenario">What happened?</label>
          <textarea id="scenario" value={prompt} onChange={(event) => setPrompt(event.target.value)}
            placeholder="A priceless artifact vanished during a blackout…" maxLength={600} />
          <div className="quick-start-head"><b>Start with a lead</b><span>Or write your own scenario</span></div>
          <div className="presets">
            {presets.map((preset) => <button type="button" key={preset} onClick={() => setPrompt(preset)}>{preset}</button>)}
          </div>
          <div className="generator-footer">
            <label className="difficulty-control" htmlFor="difficulty">Difficulty
              <span className="select-wrap"><select id="difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </select><ChevronDown size={14} /></span>
            </label>
            <button className="primary-button" type="submit" disabled={loading || prompt.trim().length < 10}>
              {loading ? <><LoaderCircle className="spin" size={17} /> Building the case…</> : <>Generate mystery <ArrowRight size={16} /></>}
            </button>
          </div>
          {error && <ErrorMessage>{error}</ErrorMessage>}
        </form>

        <aside className="demo-card panel">
          <div className="demo-art"><BookOpen size={26} strokeWidth={1.35} /><span>PLAYABLE FILE</span></div>
          <div className="demo-copy"><span className="eyebrow">READY WHEN YOU ARE</span>
            <h2>Step into the archive.</h2>
            <p>Explore a complete case with messages, forensic photos, and camera records.</p>
            <button className="text-action" onClick={onOpenDemo}>Open the demo case <ArrowRight size={15} /></button>
          </div>
          <div className="demo-stamp">CASE<br /><b>001</b></div>
        </aside>
      </section>
      <footer className="page-footer"><span>FICTIONAL CASES · REAL DEDUCTION</span><span>01 — CASE INTAKE</span></footer>
    </main>
  );
}

function ArchivePage({ cases, query, setQuery, loading, error, onOpen, onNew }: {
  cases: Summary[]; query: string; setQuery: (value: string) => void;
  loading: boolean; error: string; onOpen: (id: string) => void; onNew: () => void;
}) {
  const filtered = cases.filter((item) => `${item.title} ${item.caseNumber} ${item.crimeType}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <main className="content-page page-width">
      <div className="eyebrow"><span className="eyebrow-rule" /> RECORDS & INVESTIGATIONS</div>
      <div className="page-heading"><div><h1>Case archive</h1><p>Return to an open file or begin a new investigation.</p></div>
        <button className="primary-button" onClick={onNew}>New investigation <ArrowRight size={16} /></button>
      </div>
      <div className="archive-toolbar"><div className="archive-count"><FileText size={16} /><span>{loading ? 'Checking the records…' : `${cases.length} ${cases.length === 1 ? 'case' : 'cases'} on file`}</span></div>
        <label className="searchbox"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case files" aria-label="Search case files" />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {loading ? <div className="archive-state"><LoaderCircle className="spin" size={20} /><span>Retrieving case files</span></div> : (
        <div className="archive-grid">
          {filtered.map((item, index) => (
            <button className="archive-card" key={item.id} onClick={() => onOpen(item.id)}>
              <div className="archive-card-head"><span className="archive-file-icon"><FileText size={18} /></span>
                <span className={`status-badge status-${item.status}`}>{item.status}</span></div>
              <span className="archive-number">{item.caseNumber || `FILE ${String(index + 1).padStart(3, '0')}`}</span>
              <b className="archive-title">{item.title}</b>
              <span className="archive-type">{item.crimeType || 'Investigation'} <i /> {item.difficulty} difficulty</span>
              <span className="archive-open">Open file <ArrowRight size={15} /></span>
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="archive-empty"><span className="empty-mark"><Search size={20} /></span>
              <h2>{cases.length ? 'No matching files' : 'The archive is quiet.'}</h2>
              <p>{cases.length ? 'Try a different title, case number, or incident type.' : 'Create your first mystery and it will appear here.'}</p>
              {!cases.length && <button className="secondary-button" onClick={onNew}>Create a case <ArrowRight size={15} /></button>}
            </div>
          )}
        </div>
      )}
      <footer className="page-footer"><span>CASE RECORDS · PRIVATE SESSION</span><span>02 — ARCHIVE</span></footer>
    </main>
  );
}

function InvestigationPage({
  game, tab, setTab, thread, setThread, photo, setPhoto, hotspot, setHotspot,
  camera, setCamera, frame, setFrame, notes, setNotes, pinned, accused, setAccused,
  verdict, hints, loading, error, evidence, titleForId, onTogglePin, onHint, onClearHints, onAccuse, onBack,
}: {
  game: MysteryCase; tab: 'chats' | 'photos' | 'cctv'; setTab: (tab: 'chats' | 'photos' | 'cctv') => void;
  thread: number; setThread: (index: number) => void; photo: number; setPhoto: (index: number) => void;
  hotspot: number | null; setHotspot: (index: number | null) => void; camera: number; setCamera: (index: number) => void;
  frame: number; setFrame: (index: number) => void; notes: string; setNotes: (value: string) => void;
  pinned: string[]; accused: string; setAccused: (id: string) => void; verdict: any; hints: string[];
  loading: boolean; error: string; evidence: EvidenceRecord[]; titleForId: (id: string) => string;
  onTogglePin: (id: string) => void; onHint: () => void; onClearHints: () => void; onAccuse: () => void; onBack: () => void;
}) {
  const tabs = [
    { id: 'chats' as const, label: 'Messages', Icon: MessageCircle, count: game.evidence.whatsappThreads.length },
    { id: 'photos' as const, label: 'Forensics', Icon: ImageIcon, count: game.evidence.photos.length },
    { id: 'cctv' as const, label: 'CCTV', Icon: Clapperboard, count: game.evidence.cctvRecordings.length },
  ];
  const currentCamera = game.evidence.cctvRecordings[camera];
  const currentFrame = currentCamera?.frames[frame];
  return (
    <main className="investigation-page page-width">
      <div className="case-toolbar"><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Case archive</button>
        <div className="case-actions"><button className="hint-button" onClick={onHint}><Lightbulb size={16} /> Request hint{hints.length > 0 && <span>{hints.length}</span>}</button>
          <button className="primary-button accuse-button" onClick={onAccuse}><Target size={16} /> Make accusation</button></div>
      </div>
      <header className="case-heading">
        <div className="eyebrow"><span className="eyebrow-rule" /> {game.caseNumber} <span className="difficulty-badge">{game.difficulty}</span></div>
        <h1>{game.title}</h1>
        <div className="case-meta"><span><Shield size={14} /> {game.crimeType}</span><i />
          <span>{game.setting}</span><i /><span><Clock3 size={14} /> {game.incidentTimestamp}</span></div>
      </header>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {hints.length > 0 && <div className="hint-callout"><span className="hint-icon"><Lightbulb size={17} /></span>
        <div><b>Investigator’s note <small>HINT {String(hints.length).padStart(2, '0')}</small></b><p>{hints[hints.length - 1]}</p></div>
        <button onClick={onClearHints} aria-label="Dismiss hints"><X size={15} /></button>
      </div>}

      {verdict && <VerdictPanel verdict={verdict} game={game} titleForId={titleForId} />}

      <div className="investigation-grid">
        <aside className="case-sidebar">
          <BriefingCard game={game} />
          <section className="suspect-section">
            <div className="section-heading"><div><span className="section-index">02</span><h2>Persons of interest</h2></div><span className="item-count">{game.suspects.length} DOSSIERS</span></div>
            <div className="suspect-list">{game.suspects.map((suspect, index) => (
              <SuspectCard key={suspect.suspectId} suspect={suspect} number={index + 1}
                selected={accused === suspect.suspectId} onSelect={() => setAccused(suspect.suspectId)} />
            ))}</div>
          </section>
          <section className="notes-card panel">
            <div className="notes-heading"><div><FileText size={16} /><h2>Investigator’s notes</h2></div><span className="session-label">THIS SESSION</span></div>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record a timestamp, question an alibi, connect a clue…" aria-label="Investigator's notes" />
            <div className="pinned-heading"><span>Pinned evidence</span><span className="pin-count">{pinned.length}</span></div>
            {pinned.length > 0 ? <div className="pinned-list">{pinned.map((id) => <div className="pinned-item" key={id}>
              <span><Fingerprint size={13} />{titleForId(id)}</span><button onClick={() => onTogglePin(id)} aria-label={`Remove ${titleForId(id)} from pinned evidence`}><X size={14} /></button>
            </div>)}</div> : <p className="empty-pins">Pin useful messages, photographs, or camera records as you investigate.</p>}
          </section>
        </aside>

        <section className="evidence-locker panel" aria-label="Evidence locker">
          <div className="locker-heading"><div><span className="section-index">03</span><div><span className="locker-kicker">COLLECTED RECORDS</span><h2>Evidence locker</h2></div></div>
            <span className="locker-total">{evidence.length} ITEMS</span></div>
          <div className="evidence-tabs" role="tablist" aria-label="Evidence categories">
            {tabs.map(({ id, label, Icon, count }) => <button key={id} role="tab" aria-selected={tab === id}
              className={tab === id ? 'evidence-tab active' : 'evidence-tab'} onClick={() => setTab(id)}>
              <Icon size={16} /><span>{label}</span><small>{String(count).padStart(2, '0')}</small>
            </button>)}
          </div>
          <div className="evidence-content">
            {tab === 'chats' && <MessagesEvidence threads={game.evidence.whatsappThreads} thread={thread} setThread={setThread} pinned={pinned} onTogglePin={onTogglePin} />}
            {tab === 'photos' && <PhotoEvidence photos={game.evidence.photos} photo={photo} setPhoto={setPhoto} hotspot={hotspot} setHotspot={setHotspot} pinned={pinned} onTogglePin={onTogglePin} />}
            {tab === 'cctv' && <CctvEvidence recordings={game.evidence.cctvRecordings} camera={camera} setCamera={setCamera} frame={frame} setFrame={setFrame} currentCamera={currentCamera} currentFrame={currentFrame} pinned={pinned} onTogglePin={onTogglePin} />}
          </div>
        </section>
      </div>
      <footer className="investigation-footer"><span>INVESTIGATION FILE · {game.caseNumber}</span><button onClick={onAccuse}>Ready to make your accusation <ArrowRight size={15} /></button></footer>
    </main>
  );
}

function BriefingCard({ game }: { game: MysteryCase }) {
  return (
    <section className="briefing-card panel">
      <div className="section-heading"><div><span className="section-index">01</span><h2>Incident briefing</h2></div><Skull size={18} className="briefing-mark" /></div>
      <div className="victim-block"><span className="small-label">VICTIM</span><h3>{game.victim.name}</h3><p>{game.victim.age} · {game.victim.role}</p></div>
      <div className="incident-summary"><span className="small-label">INCIDENT SUMMARY</span><p>{game.briefing}</p></div>
      <div className="briefing-facts"><div><span className="small-label">CAUSE</span><p>{game.victim.causeOfIncident}</p></div><div><span className="small-label">BACKGROUND</span><p>{game.victim.background}</p></div></div>
      <div className="timeline-block"><div className="timeline-heading"><span className="small-label">CASE TIMELINE</span><span>{game.timelineSummary.length} EVENTS</span></div>
        <ol className="timeline">{game.timelineSummary.map((item, index) => <li key={`${index}-${item}`}><span className="timeline-marker" /><span>{item}</span></li>)}</ol>
      </div>
    </section>
  );
}

function SuspectCard({ suspect, number, selected, onSelect }: { suspect: Suspect; number: number; selected: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={`suspect-card ${selected ? 'suspect-selected' : ''}`}>
      <button className="suspect-summary" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
        <Portrait src={suspect.avatarUrl} name={suspect.name} />
        <span className="suspect-identity"><b>{suspect.name}</b><small>{suspect.occupation}</small></span>
        <span className="dossier-number">D-{String(number).padStart(2, '0')}</span>
        <ChevronDown size={16} className={expanded ? 'chevron expanded' : 'chevron'} />
      </button>
      {expanded && <div className="suspect-details">
        <span className="relationship-label">{suspect.relationshipToVictim}</span>
        <p>{suspect.bio}</p>
        <div className="suspect-fact"><b>STATED ALIBI</b><p>{suspect.alibi}</p></div>
        <div className="suspect-fact"><b>POSSIBLE MOTIVE</b><p>{suspect.motive}</p></div>
        {suspect.quirks.length > 0 && <div className="quirks">{suspect.quirks.map((quirk) => <span key={quirk}>{quirk}</span>)}</div>}
        <blockquote>“{suspect.interrogationQuote}”</blockquote>
        <button className={selected ? 'select-suspect selected' : 'select-suspect'} onClick={onSelect}>
          {selected ? <><Check size={14} /> Selected for accusation</> : <><Target size={14} /> Mark as prime suspect</>}
        </button>
      </div>}
    </article>
  );
}

function MessagesEvidence({ threads, thread, setThread, pinned, onTogglePin }: {
  threads: MysteryCase['evidence']['whatsappThreads']; thread: number; setThread: (index: number) => void;
  pinned: string[]; onTogglePin: (id: string) => void;
}) {
  const current = threads[thread];
  if (!threads.length) return <EmptyEvidence title="No message records" detail="No chat threads were attached to this case." />;
  return <div className="messages-view">
    <aside className="thread-rail"><div className="thread-rail-heading"><span>DEVICE EXTRACTS</span><span>{String(threads.length).padStart(2, '0')}</span></div>
      {threads.map((item, index) => <button key={item.evidenceId} className={index === thread ? 'thread-option selected' : 'thread-option'} onClick={() => setThread(index)}>
        <span className="thread-icon"><MessageCircle size={16} /></span><span className="thread-copy"><b>{item.title}</b><small>{item.extractedFromDevice}</small></span><ArrowRight size={13} className="thread-arrow" />
      </button>)}
    </aside>
    {current && <div className="message-record">
      <div className="record-heading"><div><span className="record-type">COMMUNICATION TRANSCRIPT</span><h3>{current.title}</h3><p>{current.participants.join(' · ')}</p></div>
        <span className="record-seal"><Shield size={16} /> VERIFIED</span></div>
      <div className="message-list" aria-label="Messages">
        {current.messages.map((message) => <article className={message.isDeletedOrRecovered ? 'message-record-row recovered-message' : 'message-record-row'} key={message.messageId}>
          <time>{message.timestamp}</time><div className="message-entry"><div className="message-entry-top"><b>{message.senderName}</b>
            {message.isDeletedOrRecovered && <span className="recovered-tag">RECOVERED</span>}</div><p>{message.text}</p>
            <small>{message.isDeletedOrRecovered ? 'Recovered from device backup' : `Read status: ${message.readStatus}`}</small></div>
        </article>)}
      </div>
      <div className="record-footer"><span>EXTRACTED FROM {current.extractedFromDevice.toUpperCase()}</span>
        <PinAction id={current.evidenceId} pinned={pinned} onTogglePin={onTogglePin} /></div>
    </div>}
  </div>;
}

function PhotoEvidence({ photos, photo, setPhoto, hotspot, setHotspot, pinned, onTogglePin }: {
  photos: MysteryCase['evidence']['photos']; photo: number; setPhoto: (index: number) => void;
  hotspot: number | null; setHotspot: (index: number | null) => void; pinned: string[]; onTogglePin: (id: string) => void;
}) {
  const current = photos[photo];
  if (!photos.length) return <EmptyEvidence title="No forensic photographs" detail="No photo evidence was attached to this case." />;
  return <div className="forensic-view">
    <div className="forensic-list"><div className="thread-rail-heading"><span>PHOTO LOG</span><span>{String(photos.length).padStart(2, '0')}</span></div>
      {photos.map((item, index) => <button className={index === photo ? 'forensic-option selected' : 'forensic-option'} key={item.evidenceId} onClick={() => { setPhoto(index); setHotspot(null); }}>
        <ImageWithFallback src={item.imageUrl} alt="" label={item.title} variant="thumbnail" />
        <span><b>{item.title}</b><small>{item.locationFound}</small></span><ArrowRight size={13} />
      </button>)}
    </div>
    {current && <div className="forensic-report">
      <div className="forensic-image-wrap"><ImageWithFallback src={current.imageUrl} alt={current.title} label={current.title} variant="forensic-image" />
        <div className="photo-stamp">EXHIBIT {String(photo + 1).padStart(2, '0')}</div>
        {current.hotspots.map((item, index) => <button key={`${item.label}-${index}`} className={hotspot === index ? 'hotspot active' : 'hotspot'} style={{ left: `${item.xPercent}%`, top: `${item.yPercent}%` }} onClick={() => setHotspot(hotspot === index ? null : index)} aria-label={`Inspect clue: ${item.label}`} aria-pressed={hotspot === index}>{String(index + 1).padStart(2, '0')}</button>)}
      </div>
      <div className="report-caption"><div><span className="record-type">FORENSIC EXHIBIT · {current.timestamp}</span><h3>{current.title}</h3><p className="report-location">Recovered at {current.locationFound}</p></div>
        <PinAction id={current.evidenceId} pinned={pinned} onTogglePin={onTogglePin} /></div>
      <div className="forensic-note"><span className="note-mark"><Fingerprint size={15} /></span><p>{hotspot !== null && current.hotspots[hotspot] ? <><b>{current.hotspots[hotspot].label}.</b> {current.hotspots[hotspot].detail}</> : current.forensicNote}</p></div>
      {current.hotspots.length > 0 && <div className="clue-index"><span>OBSERVATIONS</span>{current.hotspots.map((item, index) => <button key={`${item.label}-${index}`} className={hotspot === index ? 'clue-chip active' : 'clue-chip'} onClick={() => setHotspot(hotspot === index ? null : index)}><i>{String(index + 1).padStart(2, '0')}</i>{item.label}</button>)}</div>}
      {photos.length > 1 && <div className="forensic-pagination"><button onClick={() => { setPhoto((photo + photos.length - 1) % photos.length); setHotspot(null); }}><ArrowLeft size={14} /> Previous exhibit</button><span>{String(photo + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</span><button onClick={() => { setPhoto((photo + 1) % photos.length); setHotspot(null); }}>Next exhibit <ArrowRight size={14} /></button></div>}
    </div>}
  </div>;
}

function CctvEvidence({ recordings, camera, setCamera, frame, setFrame, currentCamera, currentFrame, pinned, onTogglePin }: {
  recordings: MysteryCase['evidence']['cctvRecordings']; camera: number; setCamera: (index: number) => void;
  frame: number; setFrame: (index: number) => void; currentCamera: MysteryCase['evidence']['cctvRecordings'][number] | undefined;
  currentFrame: MysteryCase['evidence']['cctvRecordings'][number]['frames'][number] | undefined;
  pinned: string[]; onTogglePin: (id: string) => void;
}) {
  if (!recordings.length) return <EmptyEvidence title="No camera records" detail="No CCTV recordings were attached to this case." />;
  return <div className="cctv-evidence">
    <div className="cctv-toolbar"><div><span className="record-type">CAMERA FEED</span><b>{currentCamera?.location}</b></div>
      <div className="camera-options">{recordings.map((item, index) => <button key={item.evidenceId} className={camera === index ? 'camera-option active' : 'camera-option'} onClick={() => { setCamera(index); setFrame(0); }}>{item.cameraId}</button>)}</div>
    </div>
    {currentCamera && currentFrame ? <>
      <div className="cctv-screen">{currentCamera.videoUrl
        ? <VideoWithFallback src={currentCamera.videoUrl} label={currentCamera.cameraId} />
        : <ImageWithFallback src={currentFrame.snapshotSvgOrUrl} alt={currentFrame.visualDescription} label={currentFrame.cameraName} variant="camera-image" />}
        <div className="cctv-overlay"><span>{currentFrame.cameraName}</span><span>{currentFrame.timestamp}</span></div>
        {!currentCamera.videoUrl && <span className="rec-label static-label">STATIC FRAME</span>}
        {currentCamera.videoUrl && <span className="rec-label"><i /> VIDEO FILE</span>}
        {!currentCamera.videoUrl && <div className="camera-scan" />}
      </div>
      {!currentCamera.videoUrl && <p className="media-notice">No playable video file is attached. Review the timestamped frame records below.</p>}
      <div className="cctv-details"><div className="cctv-description"><span className={currentFrame.anomalyFlag ? 'anomaly-label flagged' : 'anomaly-label'}>{currentFrame.anomalyFlag ? 'ANOMALY MARKED' : 'FRAME RECORD'}</span><p>{currentFrame.visualDescription}</p>
        <div className="entity-list">{currentFrame.detectedEntities.map((entity) => <span key={entity}>{entity}</span>)}</div></div>
        <PinAction id={currentCamera.evidenceId} pinned={pinned} onTogglePin={onTogglePin} />
      </div>
      <div className="camera-footage-info"><span>{currentCamera.timeRange}</span><span>{currentCamera.technicalStatus}</span></div>
      <div className="frame-timeline"><div className="frame-timeline-head"><span>FOOTAGE INDEX</span><span>{String(currentCamera.frames.length).padStart(2, '0')} FRAMES</span></div>
        <div className="frame-track">{currentCamera.frames.map((item, index) => <button key={item.frameId} className={frame === index ? 'frame-point active' : 'frame-point'} onClick={() => setFrame(index)} aria-label={`Show frame ${index + 1} at ${item.timestamp}`}><i className={item.anomalyFlag ? 'point-anomaly' : ''} /><span>{item.timestamp}</span></button>)}</div>
      </div>
      <div className="frame-controls"><button onClick={() => setFrame(Math.max(0, frame - 1))} disabled={frame === 0}><ArrowLeft size={14} /> Previous frame</button><span>{String(frame + 1).padStart(2, '0')} / {String(currentCamera.frames.length).padStart(2, '0')}</span><button onClick={() => setFrame((frame + 1) % currentCamera.frames.length)}>Next frame <ArrowRight size={14} /></button></div>
    </> : <EmptyEvidence title="No frames in this recording" detail="Choose another camera or return to the case file." />}
  </div>;
}

function VerdictPanel({ verdict, game, titleForId }: { verdict: any; game: MysteryCase; titleForId: (id: string) => string }) {
  const culprit = game.suspects.find((suspect) => suspect.suspectId === verdict.solution.culpritSuspectId);
  return <section className={`verdict-panel ${verdict.correct ? 'verdict-correct' : 'verdict-wrong'}`}>
    <div className="verdict-emblem">{verdict.correct ? <Check size={22} /> : <X size={22} />}</div>
    <div className="verdict-main"><span className="verdict-kicker">{verdict.correct ? 'CASE RESOLVED' : 'ACCUSATION REJECTED'} · INVESTIGATION SCORE {verdict.score}/100</span>
      <h2>{verdict.correct ? 'The evidence holds together.' : 'One piece of the story is still missing.'}</h2>
      <p><b>{culprit?.name}</b> — {verdict.solution.motiveSummary}</p>
      <div className="verdict-details"><div><span>THE CONTRADICTION</span><p>{verdict.solution.alibiContradiction}</p></div><div><span>FULL RECONSTRUCTION</span><p>{verdict.solution.fullReconstruction}</p></div></div>
      <div className="verdict-evidence"><span>KEY EXHIBITS</span>{verdict.solution.keyEvidenceIds.map((id: string) => <span className="verdict-exhibit" key={id}>{titleForId(id)}</span>)}</div>
    </div>
  </section>;
}

function AccusationDialog({ suspects, evidence, pinned, accused, setAccused, reasoning, setReasoning, titleForId, loading, error, onTogglePin, onClose, onSubmit }: {
  suspects: Suspect[]; evidence: EvidenceRecord[]; pinned: string[]; accused: string; setAccused: (id: string) => void;
  reasoning: string; setReasoning: (value: string) => void; titleForId: (id: string) => string;
  loading: boolean; error: string; onTogglePin: (id: string) => void; onClose: () => void; onSubmit: () => void;
}) {
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="accusation-dialog" role="dialog" aria-modal="true" aria-labelledby="accusation-title">
      <button className="dialog-close" onClick={onClose} aria-label="Close accusation dialog"><X size={18} /></button>
      <div className="eyebrow"><span className="eyebrow-rule" /> FINAL DEDUCTION</div><h2 id="accusation-title">Who is responsible?</h2>
      <p className="dialog-intro">Choose the suspect and the records that support your conclusion.</p>
      <div className="dialog-section"><div className="dialog-section-heading"><span>01 · SELECT A SUSPECT</span><small>{suspects.length} DOSSIERS</small></div>
        <div className="suspect-choices">{suspects.map((suspect, index) => <button key={suspect.suspectId} className={accused === suspect.suspectId ? 'suspect-choice chosen' : 'suspect-choice'} onClick={() => setAccused(suspect.suspectId)} aria-pressed={accused === suspect.suspectId}>
          <Portrait src={suspect.avatarUrl} name={suspect.name} /><span><b>{suspect.name}</b><small>D-{String(index + 1).padStart(2, '0')} · {suspect.occupation}</small></span>{accused === suspect.suspectId && <Check size={16} />}
        </button>)}</div>
      </div>
      <div className="dialog-section evidence-select-section"><div className="dialog-section-heading"><span>02 · SELECT EVIDENCE</span><small>{pinned.length} SELECTED</small></div>
        <p className="selection-help">Select the records that best support your theory. You can change your selections.</p>
        {evidence.length ? <div className="evidence-choices">{evidence.map((item) => {
          const selected = pinned.includes(item.evidenceId);
          return <button key={item.evidenceId} className={selected ? 'evidence-choice selected' : 'evidence-choice'} onClick={() => onTogglePin(item.evidenceId)} aria-pressed={selected}>
            <span className="choice-check">{selected && <Check size={13} />}</span><span><b>{evidenceTitle(item)}</b><small>{evidenceType(item)} · {evidenceDetail(item)}</small></span>
          </button>;
        })}</div> : <p className="selection-help">This case has no evidence records to select.</p>}
      </div>
      <label className="reasoning-label" htmlFor="reasoning">YOUR DEDUCTION <span>OPTIONAL</span></label>
      <textarea id="reasoning" value={reasoning} onChange={(event) => setReasoning(event.target.value)} placeholder="What detail convinced you?" />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="dialog-footer"><span><Shield size={14} /> Your verdict reveals the case solution.</span>
        <button className="primary-button" disabled={!accused || loading} onClick={onSubmit}>{loading ? <LoaderCircle className="spin" size={16} /> : <Target size={16} />} Submit accusation</button>
      </div>
    </section>
  </div>;
}

function Portrait({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(!src);
  useEffect(() => setFailed(!src), [src]);
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <span className="portrait">{!failed && <img src={src} alt={`${name} portrait`} onError={() => setFailed(true)} />}
    {failed && <span aria-label={`${name} portrait placeholder`}>{initials}</span>}</span>;
}

function ImageWithFallback({ src, alt, label, variant }: { src: string; alt: string; label: string; variant: string }) {
  const [failed, setFailed] = useState(!src || src.startsWith('data:image/svg'));
  const [loading, setImageLoading] = useState(Boolean(src) && !src.startsWith('data:image/svg'));
  useEffect(() => {
    const unavailable = !src || src.startsWith('data:image/svg');
    setFailed(unavailable);
    setImageLoading(!unavailable);
  }, [src]);
  return <div className={`image-fallback ${variant} ${failed ? 'fallback-active' : ''}`}>
    {!failed && <img src={src} alt={alt} loading="lazy" onLoad={() => setImageLoading(false)} onError={() => { setFailed(true); setImageLoading(false); }} />}
    {loading && <div className="media-loading" role="status"><LoaderCircle className="spin" size={20} /><span>Loading image…</span></div>}
    {failed && <div className="media-unavailable"><ImageIcon size={24} strokeWidth={1.2} /><span>NO IMAGE AVAILABLE</span><b>{label}</b><small>No real image file is attached to this exhibit.</small></div>}
  </div>;
}

function VideoWithFallback({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return <div className="video-unavailable" role="status"><Clapperboard size={24} /><b>VIDEO COULD NOT BE LOADED</b><span>{label}</span></div>;
  return <video className="cctv-video" src={src} controls preload="metadata" aria-label={`${label} footage`} onError={() => setFailed(true)} />;
}

function PinAction({ id, pinned, onTogglePin }: { id: string; pinned: string[]; onTogglePin: (id: string) => void }) {
  const selected = pinned.includes(id);
  return <button className={selected ? 'pin-action pinned' : 'pin-action'} onClick={() => onTogglePin(id)} aria-pressed={selected}>
    {selected ? <><Check size={14} /> Pinned</> : <><Fingerprint size={14} /> Pin evidence</>}
  </button>;
}

function EmptyEvidence({ title, detail }: { title: string; detail: string }) {
  return <div className="evidence-empty"><span><Search size={18} /></span><h3>{title}</h3><p>{detail}</p></div>;
}

function ErrorMessage({ children }: { children: string }) {
  return <div className="error-message" role="alert"><span><X size={14} /></span>{children}</div>;
}
