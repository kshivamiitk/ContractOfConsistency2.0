// src/components/FullscreenTimer.jsx
import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';

/*
FullscreenTimer now:
- Accepts initialSeconds prop (number)
- Shows full-screen overlay, counts down
- Supports pause/resume which persists remaining_seconds and is_running to DB (if task.id provided)
- On start/resume we set is_running=true and last_started_at to now (caller should have done that, but we update again on resume)
- On pause we persist remaining_seconds and set is_running=false
- On finish we call onFinish (caller should mark DB as completed)
*/

export default function FullscreenTimer({ task, initialSeconds = 60 * 25, onClose, onFinish }) {
  const [remaining, setRemaining] = useState(Math.max(0, Number(initialSeconds)));
  const [running, setRunning] = useState(true);
  const intervalRef = useRef(null);

  useEffect(() => {
    // attempt to request fullscreen
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(()=>{});
    } catch (e) {}

    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (!running) return prev;
        return prev - 1;
      });
    }, 1000);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        // do not stop timer — just exit overlay visually
        if (onClose) onClose();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      clearInterval(intervalRef.current);
      window.removeEventListener('keydown', onKey);
      try { if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); } catch(e){}
    };
  }, []);

  useEffect(() => {
    // finish condition
    if (remaining <= 0) {
      setRunning(false);
      if (onFinish) onFinish();
      // close after a short pause
      setTimeout(() => { if (onClose) onClose(); }, 700);
    }
  }, [remaining]);

  async function persistPause() {
    if (!task || !task.id) return;
    const payload = {
      is_running: false,
      last_started_at: null,
      remaining_seconds: Math.max(0, Math.floor(remaining))
    };
    try {
      await supabase.from('tasks').update(payload).eq('id', task.id);
    } catch (err) {
      console.warn('persistPause error', err);
    }
  }

  async function persistResume() {
    if (!task || !task.id) return;
    const payload = {
      is_running: true,
      last_started_at: new Date().toISOString(),
      remaining_seconds: Math.max(0, Math.floor(remaining))
    };
    try {
      await supabase.from('tasks').update(payload).eq('id', task.id);
    } catch (err) {
      console.warn('persistResume error', err);
    }
  }

  async function handleToggle() {
    if (running) {
      // pause: persist current remaining
      setRunning(false);
      clearInterval(intervalRef.current);
      await persistPause();
    } else {
      // resume
      setRunning(true);
      await persistResume();
      intervalRef.current = setInterval(() => {
        setRemaining(prev => prev - 1);
      }, 1000);
    }
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  }

  async function handleStop() {
    // persist paused state and close
    await persistPause();
    if (onClose) onClose();
  }

  async function finishNow() {
    setRemaining(0);
    // persist completed will be handled by caller's onFinish
    if (onFinish) onFinish();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'linear-gradient(180deg,#001f3f,#011627)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: 'white', padding: 24
    }}>
      <div style={{ textAlign: 'center', maxWidth: 900 }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{task?.title || 'Task'}</div>
        <div style={{ marginTop: 8, color: '#cbd5e1' }}>{task?.description || ''}</div>

        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 96, fontWeight: 800 }}>{formatTime(remaining)}</div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={handleToggle} style={{ padding: '12px 18px', borderRadius: 12, fontSize: 16 }}>
            {running ? 'Pause' : 'Resume'}
          </button>
          <button onClick={handleStop} style={{ padding: '12px 18px', borderRadius: 12, fontSize: 16 }}>Stop</button>
          <button onClick={finishNow} style={{ padding: '12px 18px', borderRadius: 12, fontSize: 16 }}>Finish now</button>
        </div>

        <div style={{ marginTop: 18, fontSize: 13, color: '#9fb0d7' }}>
          Timer progress is saved — you can close the browser or sign in from another device to resume.
        </div>
      </div>
    </div>
  );
}
