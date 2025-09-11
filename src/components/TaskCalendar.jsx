// src/components/TaskCalendar.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/**
 * TaskCalendar - displays a compact heatmap of completed tasks over the last `days`.
 * Hover a day to see the titles. Click to expand the list below.
 */

export default function TaskCalendar({ days = 30, userId: propUserId = null }) {
  const [data, setData] = useState([]); // array of { date, count, tasks }
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTasks, setSelectedTasks] = useState([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // fetch completed tasks for last N days (server-side)
        const since = dayjs().subtract(days - 1, 'day').startOf('day').toISOString();
        const q = supabase.from('tasks').select('id,title,completed_at').gte('completed_at', since).order('completed_at', { ascending: true });
        if (propUserId) q.eq('created_by', propUserId);
        const { data: rows, error } = await q;
        if (error) throw error;

        // group by date
        const map = {};
        (rows || []).forEach(r => {
          const d = r.completed_at ? dayjs(r.completed_at).format('YYYY-MM-DD') : 'unknown';
          map[d] = map[d] || [];
          map[d].push(r);
        });

        const out = [];
        for (let i = days - 1; i >= 0; i--) {
          const day = dayjs().subtract(i, 'day');
          const key = day.format('YYYY-MM-DD');
          const tasks = map[key] || [];
          out.push({ date: key, label: day.format('MMM D'), count: tasks.length, tasks });
        }

        if (!cancel) setData(out);
      } catch (err) {
        console.error('TaskCalendar load', err);
        if (!cancel) setData([]);
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [days, propUserId]);

  const maxCount = useMemo(() => Math.max(1, ...(data.map(d => d.count))), [data]);

  function colorForCount(c) {
    if (c === 0) return '#f3f6fb';
    // graded blue
    const ratio = Math.min(1, c / maxCount);
    const light = Math.round(230 - ratio * 80); // 230 -> 150
    return `rgb(220,${240 - Math.round(ratio*60)},255)`; // subtle
  }

  return (
    <div style={{ padding: 12, borderRadius: 10, background: '#fff', border: '1px solid #eef4fb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Last {days} days — completed tasks</strong>
        <div style={{ color: '#666', fontSize: 13 }}>{loading ? 'Loading...' : `${data.reduce((s,d)=>s+d.count,0)} completed`}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, 1fr)`, gap: 8 }}>
        {data.map(d => (
          <div
            key={d.date}
            title={`${d.label} — ${d.count} completed`}
            onClick={() => { setSelectedDate(d.date); setSelectedTasks(d.tasks); }}
            style={{
              padding: 10,
              borderRadius: 8,
              textAlign: 'center',
              cursor: 'pointer',
              border: selectedDate === d.date ? '2px solid #3b82f6' : '1px solid #f0f5fb',
              background: colorForCount(d.count),
              minHeight: 64,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center'
            }}
          >
            <div style={{ fontSize: 12, color: '#333', fontWeight: 600 }}>{d.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{d.count}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        {selectedDate ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><strong>{dayjs(selectedDate).format('dddd, MMM D')}</strong></div>
              <div style={{ color: '#666' }}>{selectedTasks.length} completed</div>
            </div>
            <div style={{ marginTop: 8 }}>
              {selectedTasks.length === 0 ? <div style={{ color: '#999' }}>No tasks completed on this date</div> : (
                <ul style={{ paddingLeft: 16 }}>
                  {selectedTasks.map(t => <li key={t.id} style={{ marginBottom: 6 }}>{dayjs(t.completed_at).format('HH:mm')} — {t.title}</li>)}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: '#666' }}>Click a day to view completed tasks for that day.</div>
        )}
      </div>
    </div>
  );
}
