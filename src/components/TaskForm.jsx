// src/components/TaskForm.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

export default function TaskForm({ user, task, onSaved, onCancel }) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [startTime, setStartTime] = useState(task?.start_time ? dayjs(task.start_time).format('YYYY-MM-DDTHH:mm') : '');
  const [endTime, setEndTime] = useState(task?.end_time ? dayjs(task.end_time).format('YYYY-MM-DDTHH:mm') : '');
  const [duration, setDuration] = useState(task?.duration_minutes ?? 25);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(task?.title || '');
    setDescription(task?.description || '');
    setStartTime(task?.start_time ? dayjs(task.start_time).format('YYYY-MM-DDTHH:mm') : '');
    setEndTime(task?.end_time ? dayjs(task.end_time).format('YYYY-MM-DDTHH:mm') : '');
    setDuration(task?.duration_minutes ?? 25);
  }, [task]);

  async function handleSubmit(e) {
    e?.preventDefault();
    setError('');
    if (!user) return setError('You must be logged in to create tasks.');
    if (!title.trim()) return setError('Title required.');

    // if both times given, ensure end > start
    if (startTime && endTime && new Date(endTime) <= new Date(startTime)) {
      return setError('End time must be after start time.');
    }
    setSaving(true);

    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        start_time: startTime ? new Date(startTime).toISOString() : null,
        end_time: endTime ? new Date(endTime).toISOString() : null,
        duration_minutes: duration ? Number(duration) : null,
        created_by: user.id,
      };

      if (task && task.id) {
        const { error } = await supabase.from('tasks').update(payload).eq('id', task.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('tasks').insert([payload]);
        if (error) throw error;
      }

      if (onSaved) onSaved();
      setTitle(''); setDescription(''); setStartTime(''); setEndTime(''); setDuration(25);
    } catch (err) {
      console.error('TaskForm save error', err);
      setError(err.message || String(err));
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 13 }}>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />

      <label style={{ fontSize: 13 }}>Description</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle, height: 96 }} />

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 13 }}>Start time (optional)</label>
          <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 13 }}>End time (optional)</label>
          <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div>
        <label style={{ fontSize: 13 }}>Duration (minutes)</label>
        <input type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)} style={{ ...inputStyle, width: 140 }} />
      </div>

      {error && <div style={{ color: 'crimson' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ padding: '8px 12px', borderRadius: 8 }}>{saving ? 'Saving...' : (task ? 'Update' : 'Create')}</button>
        {onCancel && <button type="button" onClick={onCancel} style={{ padding: '8px 12px', borderRadius: 8, background: '#f3f4f6' }}>Cancel</button>}
      </div>
    </form>
  );
}

const inputStyle = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e6eef6', boxSizing: 'border-box' };
