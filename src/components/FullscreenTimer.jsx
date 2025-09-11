// src/components/FullscreenTimer.jsx
import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

/**
 * FullscreenTimer (robust production-level)
 *
 * Props:
 *  - task: object (expects id, title, description, remaining_seconds, is_running, last_started_at)
 *  - initialSeconds: fallback seconds if task doesn't provide remaining_seconds
 *  - onClose(): called when user requests close of overlay (not called automatically except finish)
 *  - onFinish(): called when timer reaches zero (caller should mark task completed if desired)
 *  - persistIntervalMs: how often to persist while running (default 10000)
 *  - autoCloseOnFinish: boolean, close overlay automatically after finish (default true)
 */
export default function FullscreenTimer({
  task,
  initialSeconds = 25 * 60,
  onClose,
  onFinish,
  persistIntervalMs = 10000,
  autoCloseOnFinish = true,
}) {
  const providedRemaining = Number(task?.remaining_seconds ?? initialSeconds);
  const taskRunning = Boolean(task?.is_running);
  const lastStartedAtMs = task?.last_started_at ? Date.parse(task.last_started_at) : null;

  // baseRemaining = remaining_seconds at the moment we consider "start point" (seconds)
  const baseRemainingRef = useRef(providedRemaining); // seconds
  const startTsRef = useRef(taskRunning && lastStartedAtMs ? lastStartedAtMs : null); // ms epoch when run started
  const [running, setRunning] = useState(taskRunning);
  const [remaining, setRemaining] = useState(() => {
    if (taskRunning && lastStartedAtMs) {
      const elapsed = Math.max(0, (Date.now() - lastStartedAtMs) / 1000);
      return Math.max(0, providedRemaining - elapsed);
    }
    return Math.max(0, providedRemaining);
  });

  const lastPersistRef = useRef(0);
  const intervalRef = useRef(null);
  const subRef = useRef(null);
  const unmountedRef = useRef(false);

  // play short beep
  const playBeep = () => {
    try {
      const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=');
      a.play().catch(()=>{});
    } catch (e) {}
  };

  // compute current remaining from refs
  const computeRemainingNow = () => {
    const base = Number(baseRemainingRef.current ?? providedRemaining);
    const startMs = startTsRef.current;
    if (running && startMs) {
      const elapsed = Math.max(0, (Date.now() - startMs) / 1000);
      return Math.max(0, base - elapsed);
    }
    return Math.max(0, base);
  };

  // set up accurate UI tick (only updates UI, value computed from timestamps)
  useEffect(() => {
    // render tick ~4 times / sec for smooth UI, but calculations use timestamps
    function startTicker() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        const nowRem = computeRemainingNow();
        setRemaining(nowRem);
        lastPersistRef.current = lastPersistRef.current || 0;
        // if running and it's time to persist, do it
        if (running && Date.now() - lastPersistRef.current >= persistIntervalMs) {
          persistToDb(false).catch(e => console.warn('persist periodic failed', e));
          lastPersistRef.current = Date.now();
        }
      }, 250);
    }
    startTicker();
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, task?.id, persistIntervalMs]);

  // on mount: subscribe to remote changes to the task row so overlay follows canonical state
  useEffect(() => {
    if (!task?.id) return;
    const channel = supabase
      .channel(`timer-task-${task.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${task.id}` }, (payload) => {
        const latest = payload.new;
        if (!latest) return;
        // avoid stomping local updates if we recently persisted; check updated_at timestamp
        // simply apply canonical fields that matter:
        // - remaining_seconds
        // - is_running
        // - last_started_at
        const remoteRem = Number(latest.remaining_seconds ?? providedRemaining);
        const remoteRunning = Boolean(latest.is_running);
        const remoteLastStart = latest.last_started_at ? Date.parse(latest.last_started_at) : null;

        // update refs/state to reflect remote if they differ meaningfully
        // if remoteRunning changed from local running, adopt remote
        if (remoteRunning !== running) {
          baseRemainingRef.current = remoteRem;
          startTsRef.current = remoteRunning && remoteLastStart ? remoteLastStart : null;
          setRunning(remoteRunning);
          setRemaining(() => {
            if (remoteRunning && remoteLastStart) {
              const elapsed = Math.max(0, (Date.now() - remoteLastStart) / 1000);
              return Math.max(0, remoteRem - elapsed);
            }
            return remoteRem;
          });
        } else {
          // same running state: update numbers if remote shows a newer 'remaining_seconds' (e.g. other client corrected)
          // Only override if the remote remaining differs significantly (>2s)
          const localNow = computeRemainingNow();
          if (Math.abs(localNow - remoteRem) > 2) {
            baseRemainingRef.current = remoteRem;
            startTsRef.current = remoteRunning && remoteLastStart ? remoteLastStart : null;
            setRemaining(() => {
              if (remoteRunning && remoteLastStart) {
                const elapsed = Math.max(0, (Date.now() - remoteLastStart) / 1000);
                return Math.max(0, remoteRem - elapsed);
              }
              return remoteRem;
            });
          }
        }
      })
      .subscribe();

    subRef.current = channel;
    return () => {
      try { channel.unsubscribe(); } catch (e) {}
      subRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  // persist helpers
  async function persistToDb(forceStop = false) {
    // forceStop: if true, write is_running=false, last_started_at=null. Otherwise if running write is_running true and last_started_at as startTsRef
    if (!task?.id) return;
    try {
      const cur = computeRemainingNow();
      const payload = {
        remaining_seconds: Math.max(0, Math.floor(cur)),
      };
      if (forceStop || !running) {
        payload.is_running = false;
        payload.last_started_at = null;
      } else {
        payload.is_running = true;
        // use startTsRef if present; otherwise set now and adjust baseRemainingRef accordingly
        if (startTsRef.current) {
          payload.last_started_at = new Date(startTsRef.current).toISOString();
        } else {
          payload.last_started_at = new Date().toISOString();
        }
      }
      const { error } = await supabase.from('tasks').update(payload).eq('id', task.id);
      if (error) throw error;
      lastPersistRef.current = Date.now();
    } catch (err) {
      // don't block UI on persist errors, but log them
      console.warn('persistToDb failed', err);
    }
  }

  // persist when page hidden or unloading
  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        // persist, but do not close overlay
        await persistToDb(false).catch(e => console.warn('persist on hide failed', e));
      } else {
        // when coming back, recompute remaining from DB canonical state (best effort)
        // fetch latest row
        if (task?.id) {
          try {
            const { data, error } = await supabase.from('tasks').select('remaining_seconds,is_running,last_started_at').eq('id', task.id).single();
            if (!error && data) {
              baseRemainingRef.current = Number(data.remaining_seconds ?? baseRemainingRef.current);
              startTsRef.current = data.is_running && data.last_started_at ? Date.parse(data.last_started_at) : (data.is_running ? Date.now() : null);
              setRunning(Boolean(data.is_running));
              setRemaining(() => {
                if (data.is_running && data.last_started_at) {
                  const elapsed = Math.max(0, (Date.now() - Date.parse(data.last_started_at)) / 1000);
                  return Math.max(0, Number(data.remaining_seconds ?? baseRemainingRef.current) - elapsed);
                }
                return Number(data.remaining_seconds ?? baseRemainingRef.current);
              });
            }
          } catch (e) { /* ignore */ }
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onBefore = async (e) => {
      // persist (synchronously is not reliable, but we do our best)
      await persistToDb(false).catch(()=>{});
      // allow unload
    };
    window.addEventListener('beforeunload', onBefore);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBefore);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, running]);

  // handle finish
  useEffect(() => {
    if (remaining <= 0 && running) {
      // stop and invoke onFinish
      setRunning(false);
      baseRemainingRef.current = 0;
      startTsRef.current = null;
      // persist final zero
      (async () => {
        await persistToDb(true).catch(()=>{});
      })();
      playBeep();
      try { if (typeof window !== 'undefined') window.navigator.vibrate?.(200); } catch (e) {}
      if (typeof onFinish === 'function') {
        onFinish();
      }
      if (autoCloseOnFinish && typeof onClose === 'function') {
        // small delay to let UI show 00:00 and beep
        setTimeout(() => { if (!unmountedRef.current) onClose(); }, 700);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  // cleanup marker
  useEffect(() => {
    return () => { unmountedRef.current = true; };
  }, []);

  // start/resume click
  async function handleResume() {
    // set baseRemaining = current remaining (if paused) and set startTs to now
    const curNow = computeRemainingNow();
    baseRemainingRef.current = Math.max(0, curNow);
    startTsRef.current = Date.now();
    setRunning(true);
    lastPersistRef.current = 0;
    await persistToDb(false).catch(e => console.warn('persist resume failed', e));
  }

  // pause click
  async function handlePause() {
    // compute remaining and persist
    const curNow = computeRemainingNow();
    baseRemainingRef.current = Math.max(0, curNow);
    startTsRef.current = null;
    setRunning(false);
    await persistToDb(true).catch(e => console.warn('persist pause failed', e));
  }

  // user stops (close overlay) - persist as paused
  async function handleStop() {
    // persist pause then call onClose
    await persistToDb(true).catch(e => console.warn('persist stop failed', e));
    if (typeof onClose === 'function') onClose();
  }

  // manual finish (user clicks "Finish now")
  async function handleFinishNow() {
    // set to zero and persist, then call onFinish
    baseRemainingRef.current = 0;
    startTsRef.current = null;
    setRemaining(0);
    setRunning(false);
    await persistToDb(true).catch(()=>{});
    playBeep();
    if (typeof onFinish === 'function') onFinish();
    if (autoCloseOnFinish && typeof onClose === 'function') {
      setTimeout(() => { if (!unmountedRef.current) onClose(); }, 350);
    }
  }

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.code === 'Space') {
        e.preventDefault();
        running ? handlePause() : handleResume();
      } else if (e.key === 'Escape') {
        if (typeof onClose === 'function') onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, task?.id]);

  // format mm:ss
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  }

  // progress percent
  const totalForMode = Number(task?.duration_minutes ? task.duration_minutes * 60 : (providedRemaining || initialSeconds));
  const percent = Math.min(100, Math.max(0, Math.round(((totalForMode - remaining) / (totalForMode || 1)) * 100)));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2147483647,
      background: 'linear-gradient(180deg,#071024,#021028)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: 'white', padding: 18
    }}>
      <div style={{ width: 'min(980px, 96%)', textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{task?.title || 'Focus Timer'}</div>
        <div style={{ marginTop: 6, color: '#9fb0d7' }}>{task?.description || ''}</div>

        <div style={{ marginTop: 30 }}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: '1px' }}>{formatTime(remaining)}</div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
            <div style={{ width: 240, background: '#08314a', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${percent}%`, height: 12, background: '#06b6d4', transition: 'width .2s linear' }} />
            </div>
            <div style={{ color: '#9fb0d7' }}>{percent}%</div>
          </div>
        </div>

        <div style={{ marginTop: 30, display: 'flex', gap: 12, justifyContent: 'center' }}>
          {running ? (
            <button onClick={handlePause} style={primaryBtn}>Pause</button>
          ) : (
            <button onClick={handleResume} style={primaryBtn}>Resume</button>
          )}
          <button onClick={handleStop} style={secondaryBtn}>Stop</button>
          <button onClick={handleFinishNow} style={dangerBtn}>Finish now</button>
        </div>

        <div style={{ marginTop: 18, color: '#9fb0d7', fontSize: 13 }}>
          Progress is periodically saved — you can switch tabs or close the browser and resume later.
        </div>

        <div style={{ marginTop: 10, color: '#9fb0d7', fontSize: 12 }}>
          Shortcuts: <strong>Space</strong> = pause/resume · <strong>Esc</strong> = close
        </div>
      </div>
    </div>
  );
}

// simple button styles
const primaryBtn = { padding: '12px 20px', borderRadius: 12, background: '#06b6d4', color: '#012028', fontWeight: 700, border: 'none', cursor: 'pointer' };
const secondaryBtn = { padding: '12px 20px', borderRadius: 12, background: '#0b1b2b', color: '#9fb0d7', border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' };
const dangerBtn = { padding: '12px 20px', borderRadius: 12, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' };
