// src/components/TaskCard.jsx
import React, { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { supabase } from '../supabaseClient';
import FullscreenTimer from './FullscreenTimer';

export default function TaskCard({ task, currentUser, onEdit, onChange }) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);

  const owner = currentUser?.id === task.created_by;

  // compute remaining seconds based on last_started_at if running
  const liveRemaining = useMemo(() => {
    const base = Number(task.remaining_seconds ?? (task.duration_minutes ? task.duration_minutes * 60 : 0));
    if (task.is_running && task.last_started_at) {
      const elapsed = Math.floor((Date.now() - new Date(task.last_started_at).getTime()) / 1000);
      return Math.max(0, base - elapsed);
    }
    return Math.max(0, base);
  }, [task]);

  const percentDone = useMemo(() => {
    const total = (task.duration_minutes ?? 0) * 60 || 1;
    const done = Math.max(0, total - (liveRemaining ?? total));
    return Math.round((done / total) * 100);
  }, [task, liveRemaining]);

  const duration = task.duration_minutes ?? (task.end_time && task.start_time ? Math.max(1, Math.round((new Date(task.end_time) - new Date(task.start_time))/60000)) : 25);

  function fmtSec(s) {
    if (s == null) return '-';
    const m = Math.floor(s / 60).toString().padStart(2,'0');
    const sec = Math.floor(s % 60).toString().padStart(2,'0');
    return `${m}:${sec}`;
  }

  async function toggleStart() {
    setBusy(true);
    try {
      const initRemaining = task.remaining_seconds ?? (task.duration_minutes ? task.duration_minutes * 60 : duration * 60);
      const payload = task.is_running
        ? { is_running: false, last_started_at: null, remaining_seconds: liveRemaining }
        : { is_running: true, last_started_at: new Date().toISOString(), remaining_seconds: initRemaining };
      const { error } = await supabase.from('tasks').update(payload).eq('id', task.id);
      if (error) throw error;
      if (onChange) onChange();
      if (!task.is_running) setTimerOpen(true);
    } catch (err) {
      console.error('toggleStart', err);
      alert(err.message || 'Action failed');
    } finally { setBusy(false); }
  }

  async function markComplete() {
    if (!confirm('Mark this task as completed?')) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString(), is_running: false, remaining_seconds: 0 }).eq('id', task.id);
      if (error) throw error;
      if (onChange) onChange();
    } catch (err) {
      console.error('markComplete', err);
      alert(err.message || 'Failed');
    } finally { setBusy(false); }
  }

  async function doDelete() {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
      if (onChange) onChange();
    } catch (err) {
      console.error('delete', err);
      alert(err.message || 'Delete failed');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #eef4fb',
      padding: 14,
      boxShadow: '0 4px 14px rgba(30,40,60,0.03)',
      display: 'flex',
      gap: 12,
      alignItems: 'stretch'
    }}>
      <div style={{ width: 8, borderRadius: 8, background: task.status === 'completed' ? '#10b981' : (task.is_running ? '#f59e0b' : '#3b82f6') }} />

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{task.title}</div>
            <div style={{ color: '#556', fontSize: 13, whiteSpace: 'pre-wrap' }}>{task.description}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: '#666' }}>Dur: <strong>{duration}m</strong></div>
              <div style={{ fontSize: 12, color: '#666' }}>Remaining: <strong>{fmtSec(liveRemaining)}</strong></div>
              <div style={{ fontSize: 12, color: '#666' }}>Status: <strong>{task.status}</strong></div>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#666' }}>{task.created_by}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{dayjs(task.created_at).format('MMM D, HH:mm')}</div>
          </div>
        </div>

        {/* progress */}
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 8, background: '#f3f6fb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: `${percentDone}%`, height: '100%', background: task.status === 'completed' ? '#10b981' : (task.is_running ? '#f59e0b' : '#3b82f6'), transition: 'width .35s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: '#666' }}>
            <div>{percentDone}%</div>
            <div>{task.completed_at ? dayjs(task.completed_at).format('HH:mm') : '-'}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 140, alignItems: 'stretch' }}>
        <button onClick={toggleStart} disabled={busy} style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background: task.is_running ? '#ef4444' : '#3b82f6', color: '#fff', cursor: 'pointer' }}>
          {task.is_running ? 'Pause' : 'Start'}
        </button>

        <button onClick={() => { if (onEdit) onEdit(task); }} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6eef6', background: '#fff', cursor: 'pointer' }}>Edit</button>

        <button onClick={markComplete} disabled={busy || task.status === 'completed'} style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background: '#10b981', color: '#fff' }}>Complete</button>

        <button onClick={doDelete} disabled={busy} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ffd7d7', background: confirmDelete ? '#ef4444' : '#fff', color: confirmDelete ? '#fff' : '#b91c1c' }}>
          {confirmDelete ? 'Confirm Delete' : 'Delete'}
        </button>
      </div>

      {timerOpen && (
        <FullscreenTimer
          task={task}
          initialSeconds={liveRemaining}
          onClose={() => { setTimerOpen(false); if (onChange) onChange(); }}
          onFinish={async () => {
            try {
              await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString(), is_running: false, remaining_seconds: 0 }).eq('id', task.id);
            } catch (err) {
              console.error('finish error', err);
            } finally { if (onChange) onChange(); }
          }}
        />
      )}
    </div>
  );
}
