// src/components/UserTable.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/*
UserTable.jsx
- Loads daily_checks, fines, suspensions for the selected user
- Classifies checklist items into columns; has robust fallback to detect class items
- If a date is excused (suspension covers date) it shows Excused badge and sets fines total to 0
- Listens for 'contract:changed' events and can Refresh
*/

export default function UserTable({ userId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    try {
      // daily_checks
      const { data: checksData, error: checksErr } = await supabase
        .from('daily_checks')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false });
      if (checksErr) throw checksErr;

      // fines
      const { data: finesData, error: finesErr } = await supabase
        .from('fines')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false });
      if (finesErr) throw finesErr;

      // suspensions
      const { data: suspData, error: suspErr } = await supabase
        .from('suspensions')
        .select('*')
        .eq('user_id', userId);
      if (suspErr) throw suspErr;

      const fines = finesData || [];
      const suspensions = suspData || [];

      // group fines
      const finesByDailyId = {};
      const finesByDate = {};
      fines.forEach(f => {
        if (f.daily_check_id) {
          finesByDailyId[f.daily_check_id] = finesByDailyId[f.daily_check_id] || [];
          finesByDailyId[f.daily_check_id].push(f);
        } else {
          const d = String(f.date);
          finesByDate[d] = finesByDate[d] || [];
          finesByDate[d].push(f);
        }
      });

      // group suspensions into a map date->suspension (handles multi-day)
      const suspByDate = {};
      suspensions.forEach(s => {
        const start = dayjs(s.start_date);
        const end = dayjs(s.end_date);
        const diffDays = Math.max(0, end.diff(start, 'day'));
        for (let i = 0; i <= diffDays; i++) {
          const d = start.add(i, 'day');
          suspByDate[d.format('YYYY-MM-DD')] = s;
        }
      });

      // transform checks into rows
      const transformed = (checksData || []).map(dc => {
        const ch = dc.checks || {};
        const theory = [];
        const sports = [];
        const classes = [];
        const randImpl = [];
        const randThink = [];
        const wake = [];
        const missedLabelsFallback = [];

        Object.entries(ch).forEach(([k, v]) => {
          let done = false;
          let label = String(k);
          let penalty = 0;
          let metaType = null;
          if (v && typeof v === 'object') {
            done = !!v.done;
            label = v.label || label;
            penalty = Number(v.penalty || 0);
            metaType = (v.meta && v.meta.type) ? v.meta.type : null;
          } else {
            done = !!v;
          }

          const short = `${label} ${done ? '✓' : '✗'}`;

          // classification: prefer explicit meta.type, then key prefix, then label heuristics
          if (metaType === 'theory' || k.startsWith('theory')) theory.push(short);
          else if (metaType === 'sport' || k.startsWith('sport')) sports.push(short);
          else if (metaType === 'class' || k.startsWith('class')) classes.push(short);
          else if (metaType === 'randimpl' || k.startsWith('randimpl')) randImpl.push(short);
          else if (metaType === 'randthink' || k.startsWith('randthink')) randThink.push(short);
          else if (metaType === 'wake' || k === 'wake') wake.push(short);
          else {
            const low = (label || '').toLowerCase();
            if (low.includes('class')) classes.push(short); // fallback
            else if (low.includes('wake')) wake.push(short);
            else if (low.includes('random') || low.includes('implementation')) randImpl.push(short);
            else theory.push(short);
          }

          if (!done) {
            missedLabelsFallback.push({ label, penalty });
          }
        });

        const dateStr = String(dc.date);
        const suspension = suspByDate[dateStr] || null;
        const isExcused = !!suspension;

        const finesForThisDc = isExcused ? [] : (finesByDailyId[dc.id] || finesByDate[dateStr] || []);
        const finesTotal = finesForThisDc.reduce((s, f) => s + (Number(f.amount) || 0), 0);

        const missedDetails = [];
        if (isExcused) {
          missedDetails.push({ label: `Excused — ${suspension.reason || 'no reason provided'}`, amount: 0, paid: true });
        } else if (finesForThisDc.length > 0) {
          finesForThisDc.forEach(f => missedDetails.push({ label: f.reason || 'Missed item', amount: Number(f.amount || 0), paid: !!f.paid }));
        } else {
          missedLabelsFallback.forEach(m => missedDetails.push({ label: m.label, amount: m.penalty || 0, paid: m.penalty ? false : true }));
        }

        const paid = isExcused ? true : (finesForThisDc.length === 0 ? true : finesForThisDc.every(f => !!f.paid));

        return {
          id: dc.id,
          date: dateStr,
          dateDisplay: dayjs(dc.date).format('YYYY-MM-DD (ddd)'),
          theory: theory.join('; '),
          sports: sports.join('; '),
          classes: classes.join('; '),
          randImpl: randImpl.join('; '),
          randThink: randThink.join('; '),
          wake: wake.join('; '),
          finesTotal,
          missedDetails,
          paid,
          excused: isExcused,
          excuseReason: suspension ? suspension.reason : null
        };
      });

      setRows(transformed);
    } catch (err) {
      console.error('UserTable load error', err);
      setErrorMsg(err.message || String(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();

    const handler = (ev) => {
      try {
        const detail = ev?.detail;
        if (!detail) {
          load();
          return;
        }
        if (detail.userId === userId) load();
      } catch (e) {
        console.warn('contract:changed handler error', e);
        load();
      }
    };

    window.addEventListener('contract:changed', handler);
    return () => window.removeEventListener('contract:changed', handler);
  }, [userId, load]);

  if (!userId) return <div>Please select a user.</div>;

  return (
    <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>History (table)</h4>
        <div>
          <button onClick={load} style={{ marginRight: 8 }}>Refresh</button>
          {loading && <span style={{ color: '#666' }}>Loading...</span>}
        </div>
      </div>

      {errorMsg && <div style={{ color: 'crimson', marginTop: 8 }}>Error: {errorMsg}</div>}

      {!loading && rows.length === 0 && <div style={{ marginTop: 12 }}>No history for this user.</div>}

      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Theory</th>
                <th style={thStyle}>Sports</th>
                <th style={thStyle}>Classes</th>
                <th style={thStyle}>Random Impl</th>
                <th style={thStyle}>Random Think</th>
                <th style={thStyle}>Wake</th>
                <th style={thStyle}>Fines (₹)</th>
                <th style={thStyle}>Paid</th>
                <th style={thStyle}>Excused</th>
                <th style={thStyle}>Missed items</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.dateDisplay}</td>
                  <td style={tdStyle}>{r.theory || '-'}</td>
                  <td style={tdStyle}>{r.sports || '-'}</td>
                  <td style={tdStyle}>{r.classes || '-'}</td>
                  <td style={tdStyle}>{r.randImpl || '-'}</td>
                  <td style={tdStyle}>{r.randThink || '-'}</td>
                  <td style={tdStyle}>{r.wake || '-'}</td>
                  <td style={tdStyle}>₹{r.excused ? 0 : r.finesTotal}</td>
                  <td style={tdStyle}><input type="checkbox" checked={!!r.paid} readOnly /></td>
                  <td style={tdStyle}>{r.excused ? <span style={{ color: 'green' }}>Yes — {r.excuseReason || 'no reason'}</span> : <span>-</span>}</td>
                  <td style={tdStyle}>
                    {r.missedDetails.length === 0 ? <span style={{ color: 'green' }}>None</span> : (
                      <ul style={{ margin: 0, paddingLeft: 14 }}>
                        {r.missedDetails.map((m, i) => <li key={i}>{m.label} — ₹{m.amount} {m.paid ? '(paid)' : '(unpaid)'}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && <div style={{ marginTop: 12 }}>Loading data...</div>}
    </div>
  );
}

const thStyle = {
  borderBottom: '1px solid #ddd',
  textAlign: 'left',
  padding: '8px',
  whiteSpace: 'nowrap'
};

const tdStyle = {
  padding: '8px',
  borderBottom: '1px solid #f5f5f5',
  verticalAlign: 'top'
};
