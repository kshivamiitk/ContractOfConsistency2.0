// src/components/DailyChecklist.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/*
DailyChecklist.jsx
- Builds daily checklist from prefs (theory, sports, classes, random, wake)
- Ensures each saved checklist item includes meta.type (class/theory/sport/etc)
- Saves daily_checks (upsert), deletes previous fines for that daily_check/date, inserts new fines
- Missed-the-contract modal creates a suspension (excuse) and deletes fines for that date
- Dispatches window event 'contract:changed' after changes so the Search page refreshes
*/

function keyFor(prefix, idx) {
  return `${prefix}_${idx}`;
}

function normalizeDaysField(days) {
  if (!days) return [];
  if (Array.isArray(days)) return days.map(d => String(d).toLowerCase().slice(0,3));
  return String(days).split(',').map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase().slice(0,3));
}

export default function DailyChecklist({ user, prefs }) {
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [checks, setChecks] = useState({});
  const [todayFines, setTodayFines] = useState([]);
  const [suspensionForDate, setSuspensionForDate] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  // modal / excuse state
  const [showExcuseModal, setShowExcuseModal] = useState(false);
  const [excuseReason, setExcuseReason] = useState('');
  const [excuseProcessing, setExcuseProcessing] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setStatus('');
      try {
        // load existing daily_check
        const { data: dc, error: dcErr } = await supabase
          .from('daily_checks')
          .select('*')
          .eq('user_id', user.id)
          .eq('date', date)
          .maybeSingle();

        if (dcErr) throw dcErr;

        if (mounted) {
          setChecks(dc ? dc.checks || buildEmptyChecksFromPrefs(prefs, date) : buildEmptyChecksFromPrefs(prefs, date));
        }

        // load fines for this date
        const { data: fines, error: finesErr } = await supabase
          .from('fines')
          .select('*')
          .eq('user_id', user.id)
          .eq('date', date)
          .order('created_at', { ascending: true });

        if (finesErr) throw finesErr;
        if (mounted) setTodayFines(fines || []);

        // load suspension for date (if any)
        const { data: susp, error: suspErr } = await supabase
          .from('suspensions')
          .select('*')
          .eq('user_id', user.id)
          .lte('start_date', date)
          .gte('end_date', date)
          .limit(1);

        if (suspErr) throw suspErr;
        if (mounted) setSuspensionForDate((susp && susp.length > 0) ? susp[0] : null);
      } catch (err) {
        console.error('Error loading checklist data', err);
        setStatus('Error loading data: ' + (err.message || String(err)));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, [date, user.id, prefs]);

  function buildEmptyChecksFromPrefs(prefsObj, dateStr) {
    const result = {};
    const todayWeek = dayjs(dateStr).format('ddd').toLowerCase().slice(0,3); // e.g., 'mon'

    // Theory tasks
    (prefsObj?.theory_tasks || []).forEach((t, idx) => {
      result[keyFor('theory', idx)] = {
        done: false,
        label: `${String(t.topic || 'topic').toUpperCase()} ${String(t.platform || 'platform').toUpperCase()} ${t.count || 1} problems`,
        penalty: t.penalty ?? 10,
        meta: { type: 'theory', ref: t.id || null }
      };
    });

    // Sports tasks
    (prefsObj?.sports_tasks || []).forEach((s, idx) => {
      result[keyFor('sport', idx)] = {
        done: false,
        label: `${s.sport || 'sport'} for ${s.duration_minutes || 60} mins (${s.start_time || '00:00'} - ${s.end_time || '00:00'})`,
        penalty: s.penalty ?? 10,
        meta: { type: 'sport', ref: s.id || null }
      };
    });

    // Classes: only include if this weekday is selected for class
    (prefsObj?.classes_tasks || []).forEach((c, idx) => {
      const days = normalizeDaysField(c.days);
      if (days.includes(todayWeek)) {
        result[keyFor('class', idx)] = {
          done: false,
          label: `Class: ${c.name || 'class'} (${c.start_time || '00:00'} - ${c.end_time || '00:00'})`,
          penalty: c.penalty ?? 10,
          meta: { type: 'class', ref: c.id || null, days }
        };
      }
    });

    // Random implementation
    (prefsObj?.random_implementation || []).forEach((r, idx) => {
      result[keyFor('randimpl', idx)] = {
        done: false,
        label: `Random implementation: ${String(r.platform || 'platform').toUpperCase()} ${r.count || 1} problems`,
        penalty: r.penalty ?? 10,
        meta: { type: 'randimpl', ref: r.id || null }
      };
    });

    // Random thinking
    (prefsObj?.random_thinking || []).forEach((r, idx) => {
      result[keyFor('randthink', idx)] = {
        done: false,
        label: `Random thinking: ${String(r.platform || 'platform').toUpperCase()} ${r.count || 1} problems`,
        penalty: r.penalty ?? 10,
        meta: { type: 'randthink', ref: r.id || null }
      };
    });

    // Wake
    if (prefsObj?.wake_rule && Object.keys(prefsObj.wake_rule || {}).length) {
      const w = prefsObj.wake_rule;
      result['wake'] = {
        done: false,
        label: `Wake up by ${w.target_time || '07:00'} (required ${w.required_count || 1})`,
        penalty: w.penalty ?? 10,
        meta: { type: 'wake' }
      };
    }

    return result;
  }

  function toggleCheck(key) {
    setChecks(prev => {
      const next = { ...prev };
      if (next[key] && typeof next[key] === 'object') next[key] = { ...next[key], done: !next[key].done };
      else next[key] = !next[key];
      return next;
    });
  }

  function doneForKey(key) {
    const v = checks[key];
    if (v === undefined) return false;
    if (typeof v === 'object') return !!v.done;
    return !!v;
  }

  // Save checklist (upsert) and create fines (after deleting existing fines for that date/dc)
  async function submitChecks() {
    setStatus('Saving checklist...');
    setLoading(true);
    try {
      const payload = {
        user_id: user.id,
        date,
        checks
      };

      const { data, error } = await supabase
        .from('daily_checks')
        .upsert(payload, { onConflict: ['user_id', 'date'], returning: 'representation' })
        .select()
        .maybeSingle();

      if (error) throw error;
      const savedDc = data;
      if (!savedDc) {
        setStatus('Saved but could not read saved row; aborting fines creation.');
        return;
      }

      // delete previous fines for this daily_check and legacy date-only fines
      try {
        if (savedDc.id) {
          await supabase.from('fines').delete().eq('user_id', user.id).eq('daily_check_id', savedDc.id);
        }
        await supabase.from('fines').delete().eq('user_id', user.id).is('daily_check_id', null).eq('date', date);
      } catch (delErr) {
        console.error('Error deleting previous fines:', delErr);
      }

      // check suspensions (excuse)
      const { data: susp, error: suspErr } = await supabase
        .from('suspensions')
        .select('*')
        .eq('user_id', user.id)
        .lte('start_date', date)
        .gte('end_date', date);

      if (suspErr) throw suspErr;
      const isSuspended = (susp && susp.length > 0);

      // create fines for unchecked items (skip if suspended)
      const finesToInsert = [];
      const now = dayjs();
      const dateStart = dayjs(date).startOf('day');
      const diffHours = now.diff(dateStart, 'hour');
      const late = diffHours > 24;

      if (!isSuspended) {
        Object.entries(checks).forEach(([k, v]) => {
          const done = (typeof v === 'object') ? !!v.done : !!v;
          if (!done) {
            const penalty = (v && v.penalty) ? Number(v.penalty) : 10;
            const amount = late ? penalty * 2 : penalty;
            const reason = (v && v.label) ? `Missed: ${v.label}` : `Missed item ${k}`;
            finesToInsert.push({
              user_id: user.id,
              daily_check_id: savedDc.id ?? null,
              date,
              amount,
              reason
            });
          }
        });
      }

      if (finesToInsert.length > 0) {
        const { error: finesError } = await supabase.from('fines').insert(finesToInsert);
        if (finesError) throw finesError;
        setStatus('Saved checklist and recorded fines for missed items.');
      } else {
        setStatus(isSuspended ? 'Saved — rules suspended for this date (no fines).' : 'Saved checklist — no fines for this date.');
      }

      // reload fines and suspension
      const { data: finesReload } = await supabase
        .from('fines')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', date);
      setTodayFines(finesReload || []);

      const { data: suspReload } = await supabase
        .from('suspensions')
        .select('*')
        .eq('user_id', user.id)
        .lte('start_date', date)
        .gte('end_date', date)
        .limit(1);

      setSuspensionForDate((suspReload && suspReload.length > 0) ? suspReload[0] : null);

      // notify other views
      try {
        window.dispatchEvent(new CustomEvent('contract:changed', { detail: { userId: user.id, date } }));
      } catch (evErr) {
        // ignore if dispatch fails
        console.warn('contract:changed dispatch failed', evErr);
      }
    } catch (err) {
      console.error('submitChecks error', err);
      setStatus('Error saving checklist: ' + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  // Missed contract - create a one-day suspension, delete fines for that date
  async function confirmMissedContract() {
    if (!excuseReason || excuseReason.trim().length < 3) {
      setStatus('Please provide a short reason (3+ chars).');
      return;
    }
    setExcuseProcessing(true);
    setStatus('Applying missed-contract excuse...');
    try {
      const { data: insData, error: insErr } = await supabase
        .from('suspensions')
        .insert([{
          user_id: user.id,
          start_date: date,
          end_date: date,
          reason: excuseReason.trim()
        }])
        .select()
        .maybeSingle();

      if (insErr) throw insErr;

      // delete fines for this date (linked and legacy)
      try {
        const { data: dc } = await supabase
          .from('daily_checks')
          .select('id')
          .eq('user_id', user.id)
          .eq('date', date)
          .maybeSingle();

        if (dc && dc.id) {
          await supabase.from('fines').delete().eq('user_id', user.id).eq('daily_check_id', dc.id);
        }
        await supabase.from('fines').delete().eq('user_id', user.id).is('daily_check_id', null).eq('date', date);
      } catch (delErr) {
        console.error('Error deleting fines after excuse', delErr);
      }

      const { data: fines } = await supabase.from('fines').select('*').eq('user_id', user.id).eq('date', date);
      setTodayFines(fines || []);

      const { data: newSusp } = await supabase
        .from('suspensions')
        .select('*')
        .eq('user_id', user.id)
        .lte('start_date', date)
        .gte('end_date', date)
        .limit(1);

      setSuspensionForDate((newSusp && newSusp.length > 0) ? newSusp[0] : null);
      setStatus('This date has been excused — no fines will be applied.');
      setShowExcuseModal(false);
      setExcuseReason('');

      // notify other views
      try {
        window.dispatchEvent(new CustomEvent('contract:changed', { detail: { userId: user.id, date } }));
      } catch (evErr) {
        console.warn('Could not dispatch contract:changed event', evErr);
      }
    } catch (err) {
      console.error('confirmMissedContract error', err);
      setStatus('Error creating excuse: ' + (err.message || String(err)));
    } finally {
      setExcuseProcessing(false);
    }
  }

  async function revokeSuspension() {
    if (!suspensionForDate) {
      setStatus('No suspension to revoke.');
      return;
    }
    setStatus('Revoking excuse...');
    setLoading(true);
    try {
      const { error } = await supabase.from('suspensions').delete().eq('id', suspensionForDate.id);
      if (error) throw error;
      const { data: fines } = await supabase.from('fines').select('*').eq('user_id', user.id).eq('date', date);
      setTodayFines(fines || []);
      setSuspensionForDate(null);
      setStatus('Excuse revoked; if there are unchecked items saving the checklist again will recreate fines.');

      // notify other views
      try {
        window.dispatchEvent(new CustomEvent('contract:changed', { detail: { userId: user.id, date } }));
      } catch (evErr) {
        console.warn('dispatch failed', evErr);
      }
    } catch (err) {
      console.error('revokeSuspension error', err);
      setStatus('Error revoking excuse: ' + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  const keys = Object.keys(checks || {});

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <label>Date:</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {loading && <span style={{ marginLeft: 8, color: '#666' }}>Loading...</span>}
      </div>

      {suspensionForDate ? (
        <div style={{ padding: 12, background: '#eef9ee', border: '1px solid #c8e6c9', marginBottom: 12 }}>
          <strong>This date is excused.</strong>
          <div>Reason: {suspensionForDate.reason}</div>
          <div style={{ marginTop: 8 }}>
            <button onClick={revokeSuspension} disabled={loading}>Revoke excuse</button>
          </div>
        </div>
      ) : (
        <div style={{ padding: 12, background: '#fff7e6', border: '1px solid #ffecb3', marginBottom: 12 }}>
          <strong>Not excused</strong>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={() => setShowExcuseModal(true)} disabled={loading}>Missed the contract</button>
            <span style={{ color: '#666' }}>Click to excuse this day (asks for reason). No fines will be applied for this date.</span>
          </div>
        </div>
      )}

      <div style={{ padding: 12, border: '1px solid #ddd', marginBottom: 12 }}>
        <h3>Checklist for {date}</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {keys.length === 0 && <div>No checklist items for this date (check your preferences)</div>}
          {keys.map(k => {
            const v = checks[k];
            const label = v && v.label ? v.label : k;
            const penalty = v && v.penalty ? v.penalty : 10;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 6, borderBottom: '1px solid #f0f0f0' }}>
                <input type="checkbox" checked={doneForKey(k)} onChange={() => toggleCheck(k)} disabled={!!suspensionForDate || loading} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>Penalty if missed: ₹{penalty}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={submitChecks} disabled={loading}>{loading ? 'Saving...' : 'Save today\'s checklist & generate fines'}</button>
          <div style={{ color: '#333' }}>{status}</div>
        </div>
      </div>

      <div>
        <h4>Fines for {date}</h4>
        <ul>
          {todayFines.length === 0 && <li>No fines for this date</li>}
          {todayFines.map(f => (
            <li key={f.id}>₹{f.amount} — {f.reason} — {new Date(f.created_at).toLocaleString()} {f.paid ? '(paid)' : '(unpaid)'}</li>
          ))}
        </ul>
      </div>

      {/* Excuse modal */}
      {showExcuseModal && (
        <div style={{
          position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)', zIndex: 9999
        }}>
          <div style={{ width: 520, background: 'white', padding: 20, borderRadius: 8 }}>
            <h3>Missed the contract — provide reason</h3>
            <textarea
              placeholder="Short reason (why the contract was missed) — e.g., medical emergency..."
              value={excuseReason}
              onChange={(e) => setExcuseReason(e.target.value)}
              style={{ width: '100%', height: 100, padding: 8 }}
              disabled={excuseProcessing}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={confirmMissedContract} disabled={excuseProcessing}>{excuseProcessing ? 'Processing...' : 'Confirm excuse'}</button>
              <button onClick={() => { setShowExcuseModal(false); setExcuseReason(''); }} disabled={excuseProcessing}>Cancel</button>
            </div>
            <div style={{ marginTop: 8, color: '#666' }}>
              Creating an excuse will ensure no fines are applied for this date. You can revoke the excuse from this page.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
