// src/components/TaskCalendar.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/*
TaskCalendar
- Shows a tabular view of completed tasks grouped by date (last N days).
- By default shows only tasks for the current logged-in user.
- You may pass userId prop to view another user's calendar (admin/debug).
- Each date row contains a small table of tasks with Time / Title / Status / Duration / Remaining.
*/

export default function TaskCalendar({ days = 30, userId: propUserId = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resolvedUserId, setResolvedUserId] = useState(propUserId);

  // resolve current user if no prop provided
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (propUserId) {
        setResolvedUserId(propUserId);
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        const uid = data?.session?.user?.id ?? null;
        setResolvedUserId(uid);
      } catch (err) {
        console.warn('TaskCalendar: could not resolve session', err);
        setResolvedUserId(null);
      }
    })();
    return () => { mounted = false; };
  }, [propUserId]);

  useEffect(() => {
    if (!resolvedUserId) {
      // not ready yet — clear
      setRows([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const since = dayjs().subtract(days - 1, 'day').startOf('day').toISOString();

        // fetch completed tasks for this user (server-side filter)
        const { data, error } = await supabase
          .from('tasks')
          .select('id,title,created_by,completed_at,status,duration_minutes,remaining_seconds')
          .gte('completed_at', since)
          .eq('created_by', resolvedUserId)
          .order('completed_at', { ascending: true });

        if (error) throw error;

        // group by date
        const map = {};
        (data || []).forEach(t => {
          const d = t.completed_at ? dayjs(t.completed_at).format('YYYY-MM-DD') : 'unknown';
          map[d] = map[d] || [];
          map[d].push(t);
        });

        const output = [];
        for (let i = 0; i < days; i++) {
          const d = dayjs().subtract(i, 'day');
          const ds = d.format('YYYY-MM-DD');
          // sort tasks for the day by completed_at time (if available)
          const dayTasks = (map[ds] || []).sort((a,b) => {
            // completed_at might not be available in selection if it's null; fallback to id
            return new Date(a.completed_at || 0) - new Date(b.completed_at || 0);
          });
          output.push({
            date: ds,
            label: d.format('ddd, MMM D'),
            tasks: dayTasks
          });
        }

        if (!mounted) return;
        setRows(output);
      } catch (err) {
        console.error('TaskCalendar load err', err);
        if (!mounted) return;
        setError(err.message || String(err));
        setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    // optional: subscribe to realtime changes for this user's tasks so calendar refreshes automatically
    const channel = supabase
      .channel(`tasks-calendar-${resolvedUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `created_by=eq.${resolvedUserId}` }, (payload) => {
        // simply reload on change (lightweight)
        if (payload?.eventType) load();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
      mounted = false;
    };
  }, [resolvedUserId, days]);

  function fmtSeconds(s) {
    if (s == null) return '-';
    const sec = Math.max(0, Math.floor(Number(s)));
    const m = Math.floor(sec / 60).toString().padStart(2,'0');
    const ss = Math.floor(sec % 60).toString().padStart(2,'0');
    return `${m}:${ss}`;
  }

  return (
    <div style={{ border: '1px solid #e6eef6', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><strong>Past {days} days — your completed tasks</strong></div>
      </div>

      {loading && <div style={{ marginTop: 8 }}>Loading calendar...</div>}
      {error && <div style={{ color: 'crimson', marginTop: 8 }}>Error: {error}</div>}

      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Tasks completed (time / title / status / duration / remaining)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.date}>
                  <td style={tdDate}>{r.label}</td>
                  <td style={td}>
                    {r.tasks.length === 0 ? (
                      <span style={{ color: '#666' }}>—</span>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={innerTh}>Time</th>
                            <th style={innerTh}>Title</th>
                            <th style={innerTh}>Status</th>
                            <th style={innerTh}>Duration</th>
                            <th style={innerTh}>Remaining</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.tasks.map(t => (
                            <tr key={t.id}>
                              <td style={innerTd}>{t.completed_at ? dayjs(t.completed_at).format('HH:mm') : '-'}</td>
                              <td style={innerTd}>{t.title}</td>
                              <td style={innerTd}>{t.status}</td>
                              <td style={innerTd}>{t.duration_minutes ?? '-'}</td>
                              <td style={innerTd}>{t.remaining_seconds != null ? fmtSeconds(t.remaining_seconds) : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { borderBottom: '1px solid #e6eef6', padding: 8, textAlign: 'left' };
const td = { borderBottom: '1px solid #f3f7fb', padding: 8, verticalAlign: 'top' };
const tdDate = { width: 160, padding: 8, borderBottom: '1px solid #f3f7fb', verticalAlign: 'top', whiteSpace: 'nowrap' };
const innerTh = { padding: 6, borderBottom: '1px solid #eef2f7', textAlign: 'left', fontSize: 13 };
const innerTd = { padding: 6, borderBottom: '1px solid #fbfdff', fontSize: 13 };
