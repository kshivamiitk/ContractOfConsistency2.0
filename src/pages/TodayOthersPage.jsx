// src/pages/TodayOthersPage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/*
TodayOthersPage
- Shows tasks completed TODAY by other users (not the current logged-in user)
- Tabular, shows user full_name (if profile available), task title, completed time, status, duration
*/

export default function TodayOthersPage() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [profilesMap, setProfilesMap] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUser(data?.session?.user ?? null);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // get tasks with completed_at not null and then filter for today
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false });

        if (error) throw error;

        if (!mounted) return;

        // filter for today & not current user
        const today = dayjs().format('YYYY-MM-DD');
        const filtered = (data || []).filter(t => {
          const c = t.completed_at ? dayjs(t.completed_at).format('YYYY-MM-DD') === today : false;
          const notMe = currentUser ? t.created_by !== currentUser.id : true;
          return c && notMe;
        });

        // collect unique user ids
        const uids = [...new Set(filtered.map(t => t.created_by).filter(Boolean))];
        let profilesMapLocal = {};
        if (uids.length > 0) {
          const { data: pData } = await supabase.from('profiles').select('id,full_name').in('id', uids);
          (pData || []).forEach(p => { profilesMapLocal[p.id] = p.full_name || p.id; });
        }
        setProfilesMap(profilesMapLocal);
        setTasks(filtered);
      } catch (err) {
        console.error('TodayOthers load error', err);
        setError(err.message || String(err));
        setTasks([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [currentUser]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Tasks Done Today — Others</h2>

      {loading && <div>Loading...</div>}
      {error && <div style={{ color: 'crimson' }}>Error: {error}</div>}

      {!loading && tasks.length === 0 && <div style={{ color: '#666' }}>No other users completed tasks today.</div>}

      {!loading && tasks.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid #eef2f7', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fbfdff' }}>
                <th style={th}>Time</th>
                <th style={th}>User</th>
                <th style={th}>Title</th>
                <th style={th}>Duration</th>
                <th style={th}>Remaining</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id}>
                  <td style={td}>{dayjs(t.completed_at).format('HH:mm')}</td>
                  <td style={td}>{profilesMap[t.created_by] || t.created_by}</td>
                  <td style={td}>{t.title}</td>
                  <td style={td}>{t.duration_minutes ?? '-'}</td>
                  <td style={td}>{t.remaining_seconds != null ? Math.floor((t.remaining_seconds)/60) + 'm ' + (t.remaining_seconds%60) + 's' : '-'}</td>
                  <td style={td}>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: 10, borderBottom: '1px solid #eef2f7', textAlign: 'left' };
const td = { padding: 10, borderBottom: '1px solid #fbfdff' };
