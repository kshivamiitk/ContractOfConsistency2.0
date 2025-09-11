import React, { useEffect, useRef, useState } from 'react';

// Professional Pomodoro component
// Features included:
// - Circular progress ring + large time display
// - Presets, custom durations, long-break interval setting
// - Auto-start next session toggle
// - Desktop notifications + gentle beep on finish
// - History log (stored in localStorage) and simple stats
// - Keyboard shortcuts: Space = start/pause, N = skip/next, R = reset
// - Accessible buttons and responsive layout
// - Accurate interval using expected-time technique to avoid drift

const DEFAULTS = {
  work: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
  longEvery: 4,
  autoStartNext: false,
  sound: true,
};

function secToMMSS(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function useAccurateInterval(onTick, intervalMs, running) {
  const expectedRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      expectedRef.current = null;
      return;
    }
    expectedRef.current = performance.now() + intervalMs;
    function step() {
      const drift = performance.now() - expectedRef.current;
      onTick();
      expectedRef.current += intervalMs;
      const next = Math.max(0, intervalMs - drift);
      timerRef.current = setTimeout(step, next);
    }
    timerRef.current = setTimeout(step, intervalMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onTick, intervalMs, running]);
}

export default function Pomodoro({ storageKey = 'pomodoro:professional:v1' }) {
  const [workDur, setWorkDur] = useState(DEFAULTS.work);
  const [shortDur, setShortDur] = useState(DEFAULTS.short);
  const [longDur, setLongDur] = useState(DEFAULTS.long);
  const [longEvery, setLongEvery] = useState(DEFAULTS.longEvery);
  const [autoStartNext, setAutoStartNext] = useState(DEFAULTS.autoStartNext);
  const [soundEnabled, setSoundEnabled] = useState(DEFAULTS.sound);

  const [mode, setMode] = useState('work'); // 'work' | 'short' | 'long'
  const [secondsLeft, setSecondsLeft] = useState(DEFAULTS.work);
  const [running, setRunning] = useState(false);

  const [cyclesCompleted, setCyclesCompleted] = useState(0); // number of completed work sessions
  const [sessionCount, setSessionCount] = useState(0); // consecutive short breaks done

  const [history, setHistory] = useState([]); // { mode, duration, endedAt }
  const tickAudioRef = useRef(null);

  // initialize from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) {
          setWorkDur(parsed.workDur ?? DEFAULTS.work);
          setShortDur(parsed.shortDur ?? DEFAULTS.short);
          setLongDur(parsed.longDur ?? DEFAULTS.long);
          setLongEvery(parsed.longEvery ?? DEFAULTS.longEvery);
          setAutoStartNext(parsed.autoStartNext ?? DEFAULTS.autoStartNext);
          setSoundEnabled(parsed.soundEnabled ?? DEFAULTS.sound);
          setMode(parsed.mode ?? 'work');
          setSecondsLeft(parsed.secondsLeft ?? (parsed.mode === 'work' ? parsed.workDur : parsed.shortDur));
          setCyclesCompleted(parsed.cyclesCompleted ?? 0);
          setSessionCount(parsed.sessionCount ?? 0);
          setHistory(parsed.history ?? []);
        }
      }
    } catch (e) {
      console.warn('pomodoro load failed', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist to storage
  useEffect(() => {
    const payload = {
      workDur,
      shortDur,
      longDur,
      longEvery,
      autoStartNext,
      soundEnabled,
      mode,
      secondsLeft,
      cyclesCompleted,
      sessionCount,
      history,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(payload)); } catch (e) {}
  }, [workDur, shortDur, longDur, longEvery, autoStartNext, soundEnabled, mode, secondsLeft, cyclesCompleted, sessionCount, history, storageKey]);

  // prepare audio (short beep)
  useEffect(() => {
    // short beep via base64 wav (tiny silent-ish beep). Replace with nicer audio URL if desired.
    tickAudioRef.current = typeof Audio !== 'undefined' ? new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=') : null;
  }, []);

  // accurate tick every 1s
  useAccurateInterval(() => {
    setSecondsLeft((s) => {
      if (!running) return s;
      if (s <= 1) {
        // finishing the current session
        handleFinish();
        return 0;
      }
      return s - 1;
    });
  }, 1000, running);

  function notify(title, body) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    } catch (e) {}
  }

  function playSound() {
    try {
      if (!soundEnabled) return;
      tickAudioRef.current?.play().catch(() => {});
    } catch (e) {}
  }

  function recordHistory(entry) {
    const next = [{ ...entry, endedAt: new Date().toISOString() }, ...history].slice(0, 200);
    setHistory(next);
  }

  function handleFinish() {
    // record
    recordHistory({ mode, duration: (mode === 'work' ? workDur : (mode === 'short' ? shortDur : longDur)) });

    playSound();
    notify('Pomodoro', `${mode.toUpperCase()} finished`);

    if (mode === 'work') {
      setCyclesCompleted(c => c + 1);
      setSessionCount(sc => {
        const next = sc + 1;
        if (next >= longEvery) {
          setMode('long');
          setSecondsLeft(longDur);
          return 0;
        } else {
          setMode('short');
          setSecondsLeft(shortDur);
          return next;
        }
      });
    } else {
      // break ended -> go to work
      setMode('work');
      setSecondsLeft(workDur);
      // optionally auto-start next
      if (autoStartNext) setRunning(true); else setRunning(false);
    }
  }

  function start() {
    try { if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') Notification.requestPermission(); } catch(e){}
    setRunning(true);
  }
  function pause() { setRunning(false); }
  function reset() {
    setRunning(false);
    setMode('work');
    setSecondsLeft(workDur);
    setSessionCount(0);
    setCyclesCompleted(0);
    setHistory([]);
  }

  function skipToNext() {
    // immediate transition: cancel current and force finish behaviour
    setRunning(false);
    // perform finish-like transition but without recording duplicate history (we record manual skip too)
    recordHistory({ mode: `${mode} (skipped)`, duration: (mode === 'work' ? workDur : (mode === 'short' ? shortDur : longDur)) });
    if (mode === 'work') {
      setCyclesCompleted(c => c + 1);
      setSessionCount(sc => {
        const next = sc + 1;
        if (next >= longEvery) {
          setMode('long');
          setSecondsLeft(longDur);
          return 0;
        } else {
          setMode('short');
          setSecondsLeft(shortDur);
          return next;
        }
      });
    } else {
      setMode('work');
      setSecondsLeft(workDur);
    }
  }

  // apply durations immediately (keep mode)
  function applyDurations() {
    if (mode === 'work') setSecondsLeft(workDur);
    else if (mode === 'short') setSecondsLeft(shortDur);
    else setSecondsLeft(longDur);
  }

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.key === ' ' && (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA')) {
        e.preventDefault();
        running ? pause() : start();
      }
      if (e.key.toLowerCase() === 'n') skipToNext();
      if (e.key.toLowerCase() === 'r') reset();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, mode, workDur, shortDur, longDur]);

  // small helpers for UI
  const totalForMode = mode === 'work' ? workDur : (mode === 'short' ? shortDur : longDur);
  const percent = Math.max(0, Math.min(100, ((totalForMode - secondsLeft) / totalForMode) * 100));

  // simple stats
  const totalSessions = history.filter(h => h.mode === 'work' || h.mode?.startsWith('work')).length;

  return (
    <div style={{ maxWidth: 520, background: '#fff', padding: 18, borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        {/* Circle progress */}
        <div style={{ width: 160, height: 160, position: 'relative' }}>
          <svg viewBox="0 0 120 120" width="160" height="160">
            <defs>
              <linearGradient id="g1" x1="0%" x2="100%">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="44" stroke="#e6e7ee" strokeWidth="12" fill="none" />
            <circle
              cx="60"
              cy="60"
              r="44"
              stroke="url(#g1)"
              strokeWidth="12"
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${2 * Math.PI * 44}`}
              strokeDashoffset={`${((100 - percent) / 100) * 2 * Math.PI * 44}`}
              transform="rotate(-90 60 60)"
            />
          </svg>

          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{secToMMSS(secondsLeft)}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{mode.toUpperCase()}</div>
          </div>
        </div>

        {/* Controls & settings */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {!running ? <button onClick={start} style={{ padding: '8px 14px', borderRadius: 8 }}>Start</button> : <button onClick={pause} style={{ padding: '8px 14px', borderRadius: 8 }}>Pause</button>}
            <button onClick={skipToNext} style={{ padding: '8px 14px', borderRadius: 8 }}>Next</button>
            <button onClick={reset} style={{ padding: '8px 14px', borderRadius: 8 }}>Reset</button>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#666' }}>Preset:</label>
              <select onChange={(e) => {
                const p = e.target.value;
                if (p === 'classic') { setWorkDur(25*60); setShortDur(5*60); setLongDur(15*60); }
                if (p === 'deep') { setWorkDur(50*60); setShortDur(10*60); setLongDur(30*60); }
                if (p === 'custom') { /* no-op */ }
              }} defaultValue="classic">
                <option value="classic">Classic 25/5</option>
                <option value="deep">Deep Work 50/10</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <label style={{ fontSize: 12, color: '#666', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={autoStartNext} onChange={e => setAutoStartNext(e.target.checked)} /> Auto-start next
            </label>

            <label style={{ fontSize: 12, color: '#666', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={soundEnabled} onChange={e => setSoundEnabled(e.target.checked)} /> Sound
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#666' }}>Work (min)</label>
              <input type="number" min={1} value={Math.round(workDur/60)} onChange={(e)=>setWorkDur(Math.max(1,Number(e.target.value))*60)} style={{ width: 100 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#666' }}>Short Break (min)</label>
              <input type="number" min={1} value={Math.round(shortDur/60)} onChange={(e)=>setShortDur(Math.max(1,Number(e.target.value))*60)} style={{ width: 100 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#666' }}>Long Break (min)</label>
              <input type="number" min={1} value={Math.round(longDur/60)} onChange={(e)=>setLongDur(Math.max(1,Number(e.target.value))*60)} style={{ width: 100 }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#666' }}>Long break every</div>
            <input type="number" min={2} max={10} value={longEvery} onChange={e=>setLongEvery(Math.max(2, Number(e.target.value)))} style={{ width: 60 }} />
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Cycles completed</div>
              <div style={{ fontWeight: 700 }}>{cyclesCompleted}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={applyDurations} style={{ padding: '6px 10px', borderRadius: 8 }}>Apply</button>
            <button onClick={() => { setSecondsLeft(totalForMode); }} style={{ padding: '6px 10px', borderRadius: 8 }}>Reset timer to mode</button>
          </div>
        </div>
      </div>

      {/* History / stats */}
      <div style={{ marginTop: 14, borderTop: '1px solid #f1f1f6', paddingTop: 12, display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Recent sessions</div>
          <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 8 }}>
            {history.length === 0 ? <div style={{ color: '#999' }}>No sessions yet</div> : history.slice(0,10).map((h, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f7f7fb' }}>
                <div style={{ fontSize: 13 }}>{h.mode}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{secToMMSS(h.duration)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ width: 180 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Statistics</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>Total sessions</div><div style={{ fontWeight: 700 }}>{history.length}</div></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><div>Work sessions</div><div style={{ fontWeight: 700 }}>{totalSessions}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}
