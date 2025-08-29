// src/pages/DayProfilePage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/*
DayProfilePage
- Select a user and a date
- Shows all tasks for that user that were CREATED or COMPLETED on that date
- Tabular format with status + remaining + start/pause info
*/

export default function DayProfilePage() {
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    // load profiles (small list)
    let mounted = true;
    const loadProfiles = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.from('profiles').select('id,full_name').order('full_name', { ascending: true });
        if (error) throw error;
        if (!mounted) return;
        setProfiles(data || []);
        if (!selectedUser) setSelectedUser((data && data[0] && data[0].id) || null);
      } catch (err) {
        console.error('loadProfiles', err);
        setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadProfiles();
    return () => { mounted = false; };
  }, []); // run once

  useEffect(() => {
    const load = async () => {
      if (!selectedUser) {
        setTasks([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // fetch all tasks for selected user and filter client-side by date
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('created_by', selectedUser)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const results = (data || []).filter(t => {
          // include if created_at or completed_at is on the chosen date
          const created = t.created_at ? dayjs(t.created_at).isSame(date, 'day') : false;
          const completed = t.completed_at ? dayjs(t.completed_at).isSame(date, 'day') : false;
          return created || completed;
        });

        setTasks(results);
      } catch (err) {
        console.error('load tasks for day', err);
        setError(err.message || String(err));
        setTasks([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedUser, date]);

  function fmtSeconds(s) {
    if (s == null) return '-';
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Profile by Day</h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <label>User:</label>
        <select value={selectedUser || ''} onChange={(e) => setSelectedUser(e.target.value)} style={{ padding: 8, borderRadius: 6 }}>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id}</option>)}
        </select>

        <label>Date:</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 8, borderRadius: 6 }} />
        <button onClick={() => { /* re-run effect by resetting same date */ setDate(date) }} style={{ padding: '8px 10px' }}>Refresh</button>
      </div>

      {loading && <div>Loading...</div>}
      {error && <div style={{ color: 'crimson' }}>Error: {error}</div>}

      {!loading && tasks.length === 0 && <div style={{ color: '#666' }}>No tasks found for this user on this date.</div>}

      {!loading && tasks.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid #eef2f7', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fbfdff' }}>
                <th style={th}>Title</th>
                <th style={th}>Description</th>
                <th style={th}>Duration (min)</th>
                <th style={th}>Remaining</th>
                <th style={th}>Started</th>
                <th style={th}>Is running</th>
                <th style={th}>Status</th>
                <th style={th}>Completed at</th>
                <th style={th}>Created at</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => {
                const remaining = t.is_running && t.last_started_at
                  ? Math.max(0, (t.remaining_seconds ?? (t.duration_minutes * 60)) - Math.floor((Date.now() - new Date(t.last_started_at).getTime()) / 1000))
                  : (t.remaining_seconds ?? (t.duration_minutes ? t.duration_minutes * 60 : null));

                return (
                  <tr key={t.id}>
                    <td style={td}>{t.title}</td>
                    <td style={td}>{t.description || '-'}</td>
                    <td style={td}>{t.duration_minutes ?? '-'}</td>
                    <td style={td}>{remaining == null ? '-' : fmtSeconds(remaining)}</td>
                    <td style={td}>{t.last_started_at ? dayjs(t.last_started_at).format('YYYY-MM-DD HH:mm') : '-'}</td>
                    <td style={td}>{t.is_running ? 'Yes' : 'No'}</td>
                    <td style={td}>{t.status}</td>
                    <td style={td}>{t.completed_at ? dayjs(t.completed_at).format('YYYY-MM-DD HH:mm') : '-'}</td>
                    <td style={td}>{t.created_at ? dayjs(t.created_at).format('YYYY-MM-DD HH:mm') : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: 10, borderBottom: '1px solid #eef2f7', textAlign: 'left' };
const td = { padding: 10, borderBottom: '1px solid #fbfdff' };
