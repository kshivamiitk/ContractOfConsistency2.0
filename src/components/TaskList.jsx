// src/components/TaskList.jsx
import React from 'react';
import TaskCard from './TaskCard';

export default function TaskList({ tasks = [], currentUser, onEdit, onChange }) {
  const pending = tasks.filter(t => t.status !== 'completed').sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  const completed = tasks.filter(t => t.status === 'completed').sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ borderRadius: 10, padding: 12, background: '#f8fafc' }}>
        <h4 style={{ marginTop: 0 }}>Pending tasks ({pending.length})</h4>
        {pending.length === 0 ? <div style={{ color: '#666' }}>No pending tasks</div> : (
          <div style={{ display: 'grid', gap: 12 }}>
            {pending.map(t => <TaskCard key={t.id} task={t} currentUser={currentUser} onEdit={onEdit} onChange={onChange} />)}
          </div>
        )}
      </div>

      <div style={{ borderRadius: 10, padding: 12, background: '#f8fafc' }}>
        <h4 style={{ marginTop: 0 }}>Completed tasks ({completed.length})</h4>
        {completed.length === 0 ? <div style={{ color: '#666' }}>No completed tasks yet</div> : (
          <div style={{ display: 'grid', gap: 12 }}>
            {completed.map(t => <TaskCard key={t.id} task={t} currentUser={currentUser} onEdit={onEdit} onChange={onChange} />)}
          </div>
        )}
      </div>
    </div>
  );
}
