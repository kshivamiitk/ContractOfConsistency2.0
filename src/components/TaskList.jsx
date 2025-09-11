// src/components/TaskList.jsx
import React, { useMemo, useState } from 'react';
import TaskCard from './TaskCard';

export default function TaskList({ tasks = [], currentUser, onEdit, onChange }) {
  const [query, setQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [sortBy, setSortBy] = useState('created_at'); // created_at | remaining | duration

  const normalized = useMemo(() => {
    return (tasks || []).map(t => ({
      ...t,
      remaining_seconds: t.remaining_seconds ?? (t.duration_minutes ? t.duration_minutes * 60 : null),
    }));
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    let list = normalized.filter(t => showCompleted ? t.status === 'completed' : t.status !== 'completed');
    if (q) list = list.filter(t => (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    // sorting
    list.sort((a,b) => {
      if (sortBy === 'remaining') {
        const ra = a.remaining_seconds ?? Infinity;
        const rb = b.remaining_seconds ?? Infinity;
        return ra - rb;
      }
      if (sortBy === 'duration') return (b.duration_minutes || 0) - (a.duration_minutes || 0);
      // default created_at descending (most recent first)
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return list;
  }, [normalized, query, showCompleted, sortBy]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <input
          placeholder="Search tasks by title or description..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e8eef6' }}
        />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
          <option value="created_at">Newest</option>
          <option value="remaining">Soonest remaining</option>
          <option value="duration">Longest duration</option>
        </select>

        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />
          Show completed
        </label>

        <div style={{ minWidth: 140, textAlign: 'right', color: '#666' }}>
          {filtered.length} task{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 20, borderRadius: 8, background: '#fbfdff', color: '#666' }}>No tasks match your filters.</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 12
        }}>
          {filtered.map(t => (
            <TaskCard key={t.id} task={t} currentUser={currentUser} onEdit={onEdit} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}
