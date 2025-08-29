// src/components/TaskCard.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';
import FullscreenTimer from './FullscreenTimer';

export default function TaskCard({ task, currentUser, onEdit, onChange }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = currentUser?.id === task.created_by;

  // helper to compute live remaining (returns seconds)
  function computeLiveRemaining(t) {
    const base = Number(t.remaining_seconds ?? (t.duration_minutes ? t.duration_minutes * 60 : 0));
    if (t.is_running && t.last_started_at) {
      const elapsed = Math.floor((Date.now() - new Date(t.last_started_at).getTime()) / 1000);
      return Math.max(0, base - elapsed);
    }
    return Math.max(0, base);
  }

  const liveRemaining = computeLiveRemaining(task);

  const formattedStart = task.start_time ? dayjs(task.start_time).format('YYYY-MM-DD HH:mm') : '-';
  const formattedEnd = task.end_time ? dayjs(task.end_time).format('YYYY-MM-DD HH:mm') : '-';
  const duration = task.duration_minutes || (task.end_time && task.start_time ? Math.max(1, Math.round((new Date(task.end_time) - new Date(task.start_time))/60000)) : 25);
  
  async function markComplete() {
    setBusy(true);
    try {
      const { error } = await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString(), is_running: false, remaining_seconds: 0 }).eq('id', task.id);
      if (error) throw error;
      if (onChange) onChange();
    } catch (err) {
      console.error('markComplete error', err);
      alert('Could not mark complete: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) return setConfirmingDelete(true);
    setBusy(true);
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
      if (onChange) onChange();
    } catch (err) {
      console.error('delete task error', err);
      alert('Delete failed: ' + (err.message || err));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  // Start or resume timer: set is_running true, set last_started_at = now, initialize remaining_seconds if null
  async function startOrResume() {
    setBusy(true);
    try {
      const initRemaining = task.remaining_seconds ?? (task.duration_minutes ? task.duration_minutes * 60 : duration * 60);
      const payload = {
        is_running: true,
        last_started_at: new Date().toISOString(),
        remaining_seconds: initRemaining
      };
      const { error } = await supabase.from('tasks').update(payload).eq('id', task.id);
      if (error) throw error;
      if (onChange) onChange();
      setTimerOpen(true);
    } catch (err) {
      console.error('start/resume error', err);
      alert('Could not start/resume: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  }

  // Pause timer: compute current remaining and persist, set is_running false
  async function pauseTimer() {
    setBusy(true);
    try {
      const live = computeLiveRemaining(task);
      const payload = { is_running: false, last_started_at: null, remaining_seconds: live };
      const { error } = await supabase.from('tasks').update(payload).eq('id', task.id);
      if (error) throw error;
      if (onChange) onChange();
    } catch (err) {
      console.error('pauseTimer error', err);
      alert('Pause failed: ' + (err.message || err));
    } finally {
      setBusy(false);
    }
  }

  // show readable remaining
  function fmtSeconds(s) {
    if (s == null) return '-';
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2,'0');
    return `${m}:${sec}`;
  }

  return (
    <div style={{
      border: '1px solid #e8eef6', padding: 14, borderRadius: 10, display: 'flex', gap: 14, alignItems: 'center', background: '#fff'
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {task.title} {task.status === 'completed' && <span style={{ color: '#10b981', marginLeft: 8, fontWeight: 700 }}>(Completed)</span>}
            </div>
            <div style={{ color: '#555', marginTop: 6 }}>{task.description}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#666' }}>
            <div>By: {task.created_by}</div>
            <div>{dayjs(task.created_at).format('YYYY-MM-DD HH:mm')}</div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 16, color: '#444', fontSize: 13 }}>
          <div><strong>Duration:</strong> {duration} mins</div>
          <div><strong>Remaining:</strong> {fmtSeconds(liveRemaining)}</div>
          <div><strong>Start:</strong> {formattedStart}</div>
          <div><strong>End:</strong> {formattedEnd}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!task.is_running && task.status !== 'completed' && (
          <button onClick={startOrResume} style={actionBtn} disabled={busy}>Start/Resume</button>
        )}
        {task.is_running && (
          <>
            <button onClick={() => setTimerOpen(true)} style={actionBtn}>Open Timer</button>
            <button onClick={pauseTimer} style={secondaryBtn} disabled={busy}>Pause</button>
          </>
        )}

        <button onClick={markComplete} style={successBtn} disabled={busy || task.status === 'completed'}>Mark complete</button>
        {owner && <button onClick={() => onEdit && onEdit(task)} style={actionBtn}>Edit</button>}
        {owner && <button onClick={handleDelete} style={{ ...actionBtn, background: confirmingDelete ? '#f87171' : undefined }}>{confirmingDelete ? 'Confirm delete' : 'Delete'}</button>}
      </div>

      {timerOpen && (
        <FullscreenTimer
          task={task}
          // compute initial seconds at open
          initialSeconds={computeLiveRemaining(task)}
          onClose={() => { setTimerOpen(false); if (onChange) onChange(); }}
          onFinish={async () => {
            try {
              await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString(), is_running: false, remaining_seconds: 0 }).eq('id', task.id);
            } catch (err) {
              console.error('error marking task complete at finish', err);
            } finally {
              if (onChange) onChange();
            }
          }}
        />
      )}
    </div>
  );
}

const actionBtn = { padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: '#2563eb', color: 'white', border: 'none' };
const secondaryBtn = { padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: '#f3f4f6', color: '#111', border: 'none' };
const successBtn = { padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: '#10b981', color: 'white', border: 'none' };
