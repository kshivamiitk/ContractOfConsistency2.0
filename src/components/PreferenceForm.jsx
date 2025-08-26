// src/components/PreferenceForm.jsx
// Drop-in replacement for your existing PreferenceForm.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const TOPICS = ['dp', 'graphs', 'trees', 'mathematics', 'bitmasking', 'sorting', 'two-pointer', 'greedy', 'number-theory'];
const PLATFORMS = ['cses', 'codeforces', 'leetcode', 'codechef', 'atcoder', 'interviewbit', 'geeksforgeeks'];
const QUESTION_COUNTS = [1,2,3,4,5,6,7,8,9,10];
const WEEKDAYS = ['mon','tue','wed','thu','fri','sat','sun'];

function generateId() {
  // simple id for client-side stability; replace with UUID if you want
  return `${Date.now().toString(36)}-${Math.floor(Math.random()*100000).toString(36)}`;
}

function emptyTheory() { return { id: generateId(), topic: 'dp', platform: 'cses', count: 3, penalty: 10 }; }
function emptySport() { return { id: generateId(), sport: 'gym', duration_minutes: 60, start_time: '07:00', end_time: '08:00', penalty: 10 }; }
function emptyClass() { return { id: generateId(), name: '', days: ['mon'], start_time: '09:00', end_time: '10:00', penalty: 10 }; }
function emptyRandom() { return { id: generateId(), platform: 'codeforces', count: 3, penalty: 10 }; }
function emptyWake() { return { target_time: '07:00', required_count: 1, penalty: 10 }; }

function normalizeDaysField(days) {
  if (!days) return [];
  if (Array.isArray(days)) return days.map(d => String(d).toLowerCase().slice(0,3));
  // if it's a string like 'mon,tue' or 'mon' etc
  return String(days)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase().slice(0,3));
}

export default function PreferenceForm({ user, initialPrefs = {}, templates = [] }) {
  const userId = user.id;

  // state with robust defaults
  const [theoryTasks, setTheoryTasks] = useState([]);
  const [sportsTasks, setSportsTasks] = useState([]);
  const [classesTasks, setClassesTasks] = useState([]);
  const [randomImpl, setRandomImpl] = useState([]);
  const [randomThink, setRandomThink] = useState([]);
  const [wakeRule, setWakeRule] = useState(emptyWake());

  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  // normalize incoming initialPrefs on load
  useEffect(() => {
    if (!initialPrefs) return;

    // helper to ensure each item has id and normalized days
    const normalizeList = (arr, type) => {
      if (!Array.isArray(arr)) return [];
      return arr.map(item => {
        const copy = { ...(item || {}) };
        // ensure id
        if (!copy.id) copy.id = generateId();
        // if class type, normalize days
        if (type === 'class') {
          copy.days = normalizeDaysField(copy.days);
        }
        return copy;
      });
    };

    setTheoryTasks(normalizeList(initialPrefs.theory_tasks || [], 'theory').map(x => ({ id: x.id, topic: x.topic || 'dp', platform: x.platform || 'cses', count: x.count || 3, penalty: x.penalty ?? 10 })));
    setSportsTasks(normalizeList(initialPrefs.sports_tasks || [], 'sport').map(x => ({ id: x.id, sport: x.sport || 'gym', duration_minutes: x.duration_minutes || 60, start_time: x.start_time || '07:00', end_time: x.end_time || '08:00', penalty: x.penalty ?? 10 })));
    setClassesTasks(normalizeList(initialPrefs.classes_tasks || [], 'class').map(x => ({ id: x.id, name: x.name || '', days: x.days || ['mon'], start_time: x.start_time || '09:00', end_time: x.end_time || '10:00', penalty: x.penalty ?? 10 })));
    setRandomImpl(normalizeList(initialPrefs.random_implementation || [], 'randimpl').map(x => ({ id: x.id, platform: x.platform || 'codeforces', count: x.count || 3, penalty: x.penalty ?? 10 })));
    setRandomThink(normalizeList(initialPrefs.random_thinking || [], 'randthink').map(x => ({ id: x.id, platform: x.platform || 'interviewbit', count: x.count || 3, penalty: x.penalty ?? 10 })));
    if (initialPrefs.wake_rule && Object.keys(initialPrefs.wake_rule).length) {
      setWakeRule({ target_time: initialPrefs.wake_rule.target_time || '07:00', required_count: initialPrefs.wake_rule.required_count || 1, penalty: initialPrefs.wake_rule.penalty ?? 10 });
    } else {
      setWakeRule(emptyWake());
    }
  }, [initialPrefs]);

  // ---------- Theory handlers ----------
  function addTheory() { setTheoryTasks(prev => [...prev, emptyTheory()]); }
  function updateTheory(id, patch) { setTheoryTasks(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i)); }
  function removeTheory(id) { setTheoryTasks(prev => prev.filter(i => i.id !== id)); }

  // ---------- Sports handlers ----------
  function addSport() { setSportsTasks(prev => [...prev, emptySport()]); }
  function updateSport(id, patch) { setSportsTasks(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i)); }
  function removeSport(id) { setSportsTasks(prev => prev.filter(i => i.id !== id)); }

  // ---------- Classes handlers (fixed multi-day selection) ----------
  function addClass() { setClassesTasks(prev => [...prev, emptyClass()]); }
  function updateClass(id, patch) { setClassesTasks(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i)); }
  function removeClassTask(id) { setClassesTasks(prev => prev.filter(i => i.id !== id)); }

  function toggleClassDay(classId, day) {
    setClassesTasks(prev => {
      return prev.map(cls => {
        if (cls.id !== classId) return cls;
        const daysArr = Array.isArray(cls.days) ? [...cls.days] : normalizeDaysField(cls.days);
        const idx = daysArr.indexOf(day);
        if (idx === -1) {
          daysArr.push(day);
        } else {
          daysArr.splice(idx, 1);
        }
        return { ...cls, days: daysArr };
      });
    });
  }

  // ---------- Random handlers ----------
  function addRandomImpl() { setRandomImpl(prev => [...prev, emptyRandom()]); }
  function updateRandomImpl(id, patch) { setRandomImpl(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i)); }
  function removeRandomImpl(id) { setRandomImpl(prev => prev.filter(i => i.id !== id)); }

  function addRandomThink() { setRandomThink(prev => [...prev, emptyRandom()]); }
  function updateRandomThink(id, patch) { setRandomThink(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i)); }
  function removeRandomThink(id) { setRandomThink(prev => prev.filter(i => i.id !== id)); }

  // wake rule
  function setWakeField(field, val) { setWakeRule(prev => ({ ...prev, [field]: val })); }

  // ---------- Save preferences (unchanged robust upsert/fallback) ----------
  const save = async () => {
    setSaving(true);
    setStatus('Saving preferences...');
    const payload = {
      user_id: userId,
      theory_tasks: theoryTasks,
      sports_tasks: sportsTasks,
      classes_tasks: classesTasks,
      random_implementation: randomImpl,
      random_thinking: randomThink,
      wake_rule: wakeRule,
      updated_at: new Date().toISOString()
    };

    try {
      const { data, error } = await supabase
        .from('preferences')
        .upsert(payload, { onConflict: ['user_id'], returning: 'representation' })
        .select()
        .maybeSingle();

      if (!error) {
        setStatus('Saved (upsert).');
        setSaving(false);
        return;
      }

      const errMsg = (error && error.message) ? error.message.toLowerCase() : '';
      if (errMsg.includes('on conflict') || errMsg.includes('unique') || errMsg.includes('exclusion')) {
        setStatus('Upsert not supported on DB, using fallback...');
        const { data: existing, error: selErr } = await supabase
          .from('preferences')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (selErr) { setStatus('Error reading existing preferences: ' + selErr.message); setSaving(false); return; }

        if (existing) {
          const { error: updErr } = await supabase
            .from('preferences')
            .update(payload)
            .eq('user_id', userId);
          if (updErr) setStatus('Error updating prefs: ' + updErr.message);
          else setStatus('Saved (updated).');
        } else {
          const { error: insErr } = await supabase
            .from('preferences')
            .insert(payload);
          if (insErr) setStatus('Error inserting prefs: ' + insErr.message);
          else setStatus('Saved (inserted).');
        }
        setSaving(false);
        return;
      }

      setStatus('Error saving prefs: ' + (error.message || JSON.stringify(error)));
    } catch (ex) {
      console.error('Save prefs error', ex);
      setStatus('Unexpected error: ' + (ex.message || ex));
    } finally {
      setSaving(false);
    }
  };

  // ---------- Render UI ----------
  return (
    <div style={{ padding: 16, border: '1px solid #eee', borderRadius: 6 }}>
      <h3>Theory tasks</h3>
      {theoryTasks.map(t => (
        <div key={t.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <label>Select Topic:</label>
          <select value={t.topic} onChange={e => updateTheory(t.id, { topic: e.target.value })}>
            {TOPICS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <label>Select Platform:</label>
          <select value={t.platform} onChange={e => updateTheory(t.id, { platform: e.target.value })}>
            {PLATFORMS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <lablel>number of questions:</lablel>
          <select value={t.count} onChange={e => updateTheory(t.id, { count: Number(e.target.value) })}>
            {QUESTION_COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label>fine:</label>
          <input type="number" min="0" value={t.penalty} onChange={e => updateTheory(t.id, { penalty: Number(e.target.value) })} style={{ width: 90 }} />
          <button type="button" onClick={() => removeTheory(t.id)}>remove</button>
        </div>
      ))}
      <button type="button" onClick={addTheory}>Add theory</button>

      <hr />

      <h3>Sports tasks</h3>
      {sportsTasks.map(s => (
        <div key={s.id} style={{ marginBottom: 8, padding: 8, border: '1px solid #ddd' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>Sports:</label>
            <input placeholder="sport" value={s.sport} onChange={e => updateSport(s.id, { sport: e.target.value })} />
            <label>duration:</label>
            <input type="number" min="1" value={s.duration_minutes} onChange={e => updateSport(s.id, { duration_minutes: Number(e.target.value) })} style={{ width: 110 }} />
            
            <label style={{ fontSize: 12 }}>mins</label>
            <label>Time Start</label>
            <input type="time" value={s.start_time} onChange={e => updateSport(s.id, { start_time: e.target.value })} />
            <label>Time Ends</label>
            <input type="time" value={s.end_time} onChange={e => updateSport(s.id, { end_time: e.target.value })} />
            <label>fine:</label>
            <input type="number" min="0" value={s.penalty} onChange={e => updateSport(s.id, { penalty: Number(e.target.value) })} style={{ width: 90 }} />
            <button type="button" onClick={() => removeSport(s.id)}>remove</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={addSport}>Add sport</button>

      <hr />

      <h3>Classes Mandatory to Attend</h3>
      {classesTasks.map(c => (
        <div key={c.id} style={{ marginBottom: 8, padding: 8, border: '1px solid #eee' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>class name:</label>
            <input placeholder="class name" value={c.name} onChange={e => updateClass(c.id, { name: e.target.value })} />
            <label>Time Start</label>
            <input type="time" value={c.start_time} onChange={e => updateClass(c.id, { start_time: e.target.value })} />
            <label>Time Ends</label>
            <input type="time" value={c.end_time} onChange={e => updateClass(c.id, { end_time: e.target.value })} />
            <label>fine:</label>
            <input type="number" min="0" value={c.penalty} onChange={e => updateClass(c.id, { penalty: Number(e.target.value) })} style={{ width: 90 }} />

            <button type="button" onClick={() => removeClassTask(c.id)}>remove</button>
          </div>
          <div style={{ marginTop: 8 }}>
            {WEEKDAYS.map(d => (
              <label key={d} style={{ marginRight: 8 }}>
                <input
                  type="checkbox"
                  checked={Array.isArray(c.days) ? c.days.includes(d) : normalizeDaysField(c.days).includes(d)}
                  onChange={() => toggleClassDay(c.id, d)}
                /> {d}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button type="button" onClick={addClass}>Add class</button>

      <hr />

      <h3>Random Implementation problems (count)</h3>
      {randomImpl.map(r => (
        <div key={r.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <label>platform:</label>
          <select value={r.platform} onChange={e => updateRandomImpl(r.id, { platform: e.target.value })}>
            {PLATFORMS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <label>count</label>
          <select value={r.count} onChange={e => updateRandomImpl(r.id, { count: Number(e.target.value) })}>
            {QUESTION_COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label>fine: </label>
          <input type="number" min="0" value={r.penalty} onChange={e => updateRandomImpl(r.id, { penalty: Number(e.target.value) })} style={{ width: 90 }} />
          <button type="button" onClick={() => removeRandomImpl(r.id)}>remove</button>
        </div>
      ))}
      <button type="button" onClick={addRandomImpl}>Add random implementation</button>

      <hr />

      <h3>Random Thinking problems (count)</h3>
      {randomThink.map(r => (
        <div key={r.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <label>platform: </label>
          <select value={r.platform} onChange={e => updateRandomThink(r.id, { platform: e.target.value })}>
            {PLATFORMS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <label>count:</label>
          <select value={r.count} onChange={e => updateRandomThink(r.id, { count: Number(e.target.value) })}>
            {QUESTION_COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label>fine:</label>
          <input text="fine" type="number" min="0" value={r.penalty} onChange={e => updateRandomThink(r.id, { penalty: Number(e.target.value) })} style={{ width: 90 }} />
          <button type="button" onClick={() => removeRandomThink(r.id)}>remove</button>
        </div>
      ))}
      <button type="button" onClick={addRandomThink}>Add random thinking</button>

      <hr />

      <h3>Wake rule</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>Target wake time:</label>
        <input type="time" value={wakeRule.target_time} onChange={e => setWakeField('target_time', e.target.value)} />
        <label>Required count:</label>
        <select value={wakeRule.required_count} onChange={e => setWakeField('required_count', Number(e.target.value))}>
          {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <label>Penalty:</label>
        <input type="number" min="0" value={wakeRule.penalty} onChange={e => setWakeField('penalty', Number(e.target.value))} style={{ width: 90 }} />
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save preferences'}</button>
        <span style={{ marginLeft: 12 }}>{status}</span>
      </div>
    </div>
  );
}
