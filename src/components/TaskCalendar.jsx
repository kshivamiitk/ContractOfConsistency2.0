// src/components/TaskCalendar.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/**
 * TaskCalendar (updated)
 * - Shows heatmap of completed tasks over `days`
 * - Choose user from profiles dropdown (or "All users")
 * - Hover a day/task to see quick details (tooltip)
 * - Click a task to edit (owner only) — inline modal editor
 *
 * Expects tasks table to contain: id, title, created_by, completed_at, start_time, end_time,
 * duration_minutes, remaining_seconds, status, description
 */

export default function TaskCalendar({ days = 30, userId: propUserId = null }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedUser, setSelectedUser] = useState(propUserId ?? 'all');
  const [data, setData] = useState([]); // [{ date, label, count, tasks }]
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [hoverCard, setHoverCard] = useState(null); // { x,y, task or day info }
  const [editingTask, setEditingTask] = useState(null); // task object for modal
  const [currentUserId, setCurrentUserId] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // load session user id
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setCurrentUserId(data?.session?.user?.id ?? null);
      } catch (e) { /* ignore */ }

      // fetch profiles for selector
      try {
        const { data: pRows, error } = await supabase.from('profiles').select('id,full_name');
        if (!mounted) return;
        if (error) {
          console.warn('profiles fetch', error);
          setProfiles([]);
        } else {
          setProfiles(pRows || []);
        }
      } catch (e) {
        console.error('profiles unexpected', e);
        setProfiles([]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // load calendar when selectedUser or days change
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const since = dayjs().subtract(days - 1, 'day').startOf('day').toISOString();
        let q = supabase.from('tasks').select('id,title,description,created_by,completed_at,start_time,end_time,duration_minutes,remaining_seconds,status').gte('completed_at', since).order('completed_at', { ascending: true });
        if (selectedUser && selectedUser !== 'all') {
          q = q.eq('created_by', selectedUser);
        }
        const { data: rows, error } = await q;
        if (error) throw error;

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
          const tasks = (map[key] || []).sort((a,b) => new Date(a.completed_at) - new Date(b.completed_at));
          out.push({ date: key, label: day.format('MMM D'), count: tasks.length, tasks });
        }

        if (!cancelled) {
          setData(out);
          // reset selected date view if not present
          if (selectedDate) {
            const exists = out.find(d => d.date === selectedDate);
            if (!exists) {
              setSelectedDate(null);
              setSelectedTasks([]);
            }
          }
        }
      } catch (err) {
        console.error('TaskCalendar load err', err);
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // subscribe to changes to refresh relevant days
    const channelName = `tasks-calendar-${selectedUser || 'all'}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        // naive refresh — lightweight
        load();
      })
      .subscribe();

    return () => {
      channel.unsubscribe().catch(()=>{});
      cancelled = true;
    };
  }, [selectedUser, days, selectedDate]);

  const maxCount = useMemo(() => Math.max(1, ...(data.map(d => d.count))), [data]);

  function colorForCount(c) {
    if (c === 0) return '#f3f6fb';
    // nicer graded blue palette based on ratio
    const ratio = Math.min(1, c / maxCount);
    const alpha = 0.12 + ratio * 0.6;
    return `rgba(59,130,246,${alpha})`;
  }

  // hover handlers for tasks and days
  function onTaskHover(e, task) {
    const rect = (containerRef.current || document.body).getBoundingClientRect();
    setHoverCard({
      type: 'task',
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top + 12,
      task
    });
  }
  function onTaskLeave() {
    setHoverCard(null);
  }
  function onDayHover(e, day) {
    const rect = (containerRef.current || document.body).getBoundingClientRect();
    setHoverCard({
      type: 'day',
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top + 12,
      day
    });
  }
  function onDayLeave() {
    setHoverCard(null);
  }

  // click day -> show details
  function handleDayClick(dayObj) {
    setSelectedDate(dayObj.date);
    setSelectedTasks(dayObj.tasks || []);
    // scroll into view of container
    setTimeout(() => {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }

  // EDIT modal helpers
  function openEditModal(task) {
    // only owner can edit
    if (!currentUserId) return alert('Not signed in');
    if (currentUserId !== task.created_by) return alert('You can only edit your own tasks.');
    setEditingTask({ ...task });
  }

  function closeEditModal() { setEditingTask(null); }

  async function saveEdit(changes) {
    if (!editingTask) return;
    const payload = { ...changes };
    // normalize datetimes if provided as strings
    if (payload.start_time === '') payload.start_time = null;
    if (payload.end_time === '') payload.end_time = null;
    try {
      const { error } = await supabase.from('tasks').update(payload).eq('id', editingTask.id);
      if (error) throw error;
      // optimistic UI refresh: update local data arrays
      setData(prev => prev.map(d => ({ ...d, tasks: d.tasks.map(t => t.id === editingTask.id ? { ...t, ...payload } : t) })));
      closeEditModal();
    } catch (err) {
      console.error('saveEdit err', err);
      alert('Save failed: ' + (err.message || String(err)));
    }
  }

  // delete task (owner only)
  async function deleteTask(task) {
    if (!currentUserId) return alert('Not signed in');
    if (currentUserId !== task.created_by) return alert('You can only delete your own tasks.');
    if (!confirm('Delete this task?')) return;
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
      // remove from local
      setData(prev => prev.map(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== task.id), count: Math.max(0, d.count - 1) })));
      if (selectedTasks.some(t => t.id === task.id)) setSelectedTasks(prev => prev.filter(t => t.id !== task.id));
    } catch (err) {
      console.error('deleteTask err', err);
      alert('Delete failed');
    }
  }

  // small inline editor UI component (keeps this one-file for simplicity)
  function EditModal({ task, onClose, onSave, onDelete }) {
    const [title, setTitle] = useState(task.title || '');
    const [description, setDescription] = useState(task.description || '');
    const [startTime, setStartTime] = useState(task.start_time ? dayjs(task.start_time).format('YYYY-MM-DDTHH:mm') : '');
    const [endTime, setEndTime] = useState(task.end_time ? dayjs(task.end_time).format('YYYY-MM-DDTHH:mm') : '');
    const [duration, setDuration] = useState(task.duration_minutes ?? 25);
    const [status, setStatus] = useState(task.status || 'pending');
    const [saving, setSaving] = useState(false);

    async function handleSave(e) {
      e?.preventDefault();
      setSaving(true);
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        start_time: startTime ? new Date(startTime).toISOString() : null,
        end_time: endTime ? new Date(endTime).toISOString() : null,
        duration_minutes: duration ? Number(duration) : null,
        status,
      };
      try {
        await onSave(payload);
      } catch (err) {
        console.error('edit save', err);
        alert('Save failed');
      } finally { setSaving(false); }
    }

    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)', zIndex: 1200, padding: 12
      }}>
        <form onSubmit={handleSave} style={{ width: 720, maxWidth: '100%', background: '#fff', borderRadius: 10, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Edit task</div>
            <div>
              <button type="button" onClick={onClose} style={{ marginRight: 8 }}>Close</button>
              <button type="button" onClick={() => onDelete && onDelete(task)} style={{ background: '#fee2e2', borderRadius: 8 }}>Delete</button>
            </div>
          </div>

          <label style={{ display: 'block', marginTop: 8 }}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e6eef6' }} />

          <label style={{ display: 'block', marginTop: 8 }}>Description</label>
          <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e6eef6' }} />

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Start</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e6eef6' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label>End</label>
              <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e6eef6' }} />
            </div>
            <div style={{ width: 120 }}>
              <label>Duration (min)</label>
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e6eef6' }} />
            </div>
            <div style={{ width: 160 }}>
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e6eef6' }}>
                <option value="pending">pending</option>
                <option value="in_progress">in_progress</option>
                <option value="completed">completed</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 12px', borderRadius: 8 }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '8px 12px', borderRadius: 8, background: '#2563eb', color: '#fff' }}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    );
  }

  // render tooltip card
  function HoverCard() {
    if (!hoverCard) return null;
    const style = {
      position: 'absolute',
      left: hoverCard.x,
      top: hoverCard.y,
      zIndex: 900,
      background: '#fff',
      border: '1px solid rgba(20,30,60,0.06)',
      boxShadow: '0 6px 18px rgba(12,25,50,0.08)',
      padding: 10,
      borderRadius: 8,
      maxWidth: 360,
      pointerEvents: 'none'
    };

    if (hoverCard.type === 'day') {
      const d = hoverCard.day;
      return (
        <div style={style}>
          <div style={{ fontWeight: 700 }}>{dayjs(d.date).format('dddd, MMM D')}</div>
          <div style={{ color: '#666', fontSize: 13, marginTop: 6 }}>{d.count} completed</div>
          {d.count > 0 && (
            <ul style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto', paddingLeft: 18 }}>
              {(d.tasks || []).slice(0,8).map(t => <li key={t.id} style={{ fontSize: 13 }}>{dayjs(t.completed_at).format('HH:mm')} — {t.title}</li>)}
            </ul>
          )}
        </div>
      );
    }

    // task tooltip
    const t = hoverCard.task;
    return (
      <div style={style}>
        <div style={{ fontWeight: 800 }}>{t.title}</div>
        <div style={{ color: '#666', fontSize: 12, marginTop: 6 }}>{t.status || ''} • {t.created_by}</div>
        <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', color: '#222' }}>{t.description || <em style={{ color: '#666' }}>No description</em>}</div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
          {t.start_time ? `${dayjs(t.start_time).format('YYYY-MM-DD HH:mm')} — ` : ''}{t.end_time ? dayjs(t.end_time).format('YYYY-MM-DD HH:mm') : ''}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #eef4fb', position: 'relative' }}>
      {/* header: user selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong>Past {days} days — completed tasks</strong>
          <div style={{ color: '#666', fontSize: 13 }}>{loading ? 'Loading...' : `${data.reduce((s,d)=>s+d.count,0)} completed`}</div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#444' }}>View:</label>
          <select value={selectedUser || 'all'} onChange={(e) => setSelectedUser(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
            <option value="all">All users</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.id}</option>)}
          </select>
        </div>
      </div>

      {/* heatmap grid */}
      <div ref={containerRef} style={{ display: 'grid', gridTemplateColumns: `repeat(7, 1fr)`, gap: 10, marginTop: 12 }}>
        {data.map(d => (
          <div key={d.date}
               onMouseEnter={(e) => onDayHover(e, d)}
               onMouseMove={(e) => onDayHover(e, d)}
               onMouseLeave={onDayLeave}
               onClick={() => handleDayClick(d)}
               style={{
                 padding: 12, borderRadius: 8, textAlign: 'center', cursor: 'pointer',
                 border: selectedDate === d.date ? '2px solid #3b82f6' : '1px solid #f0f5fb',
                 background: colorForCount(d.count), minHeight: 72, display: 'flex', flexDirection: 'column', justifyContent: 'center'
               }}>
            <div style={{ fontSize: 12, color: '#073c5b', fontWeight: 700 }}>{d.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{d.count}</div>

            {/* miniature list of tasks (clickable, hover for tooltip) */}
            {d.tasks && d.tasks.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                {d.tasks.slice(0,3).map(t => (
                  <div key={t.id}
                       onMouseEnter={(e) => onTaskHover(e, t)}
                       onMouseMove={(e) => onTaskHover(e, t)}
                       onMouseLeave={onTaskLeave}
                       onClick={(ev) => { ev.stopPropagation(); openEditModal(t); }}
                       style={{ padding: '4px 8px', borderRadius: 999, background: '#ffffffaa', cursor: 'pointer', fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </div>
                ))}
                {d.tasks.length > 3 && <div style={{ padding: '4px 8px', borderRadius: 999, background: '#ffffffaa', fontSize: 12 }}>+{d.tasks.length-3}</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* selected day details */}
      <div style={{ marginTop: 12 }}>
        {selectedDate ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><strong>{dayjs(selectedDate).format('dddd, MMM D')}</strong></div>
              <div style={{ color: '#666' }}>{selectedTasks.length} completed</div>
            </div>

            <div style={{ marginTop: 8 }}>
              {selectedTasks.length === 0 ? <div style={{ color: '#999' }}>No tasks completed on this date</div> : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {selectedTasks.map(t => (
                    <div key={t.id} style={{ padding: 10, borderRadius: 8, border: '1px solid #f3f7fb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{t.title}</div>
                        <div style={{ color: '#666', fontSize: 13 }}>{t.description || <em>No description</em>}</div>
                        <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>{t.start_time ? dayjs(t.start_time).format('HH:mm') : '-'} — {t.end_time ? dayjs(t.end_time).format('HH:mm') : '-'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => openEditModal(t)} style={{ padding: '6px 10px', borderRadius: 8 }}>Edit</button>
                        <button onClick={() => deleteTask(t)} style={{ padding: '6px 10px', borderRadius: 8, background: '#fee2e2' }}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: '#666' }}>Click a day to see completed tasks for that day.</div>
        )}
      </div>

      {/* hover tooltip */}
      {hoverCard && <HoverCard />}

      {/* edit modal */}
      {editingTask && <EditModal task={editingTask} onClose={closeEditModal} onSave={saveEdit} onDelete={deleteTask} /> }
    </div>
  );
}

// small hover card component pulled out so it can use the hoverCard state
function HoverCard() {
  // this placeholder is replaced by parent-bound HoverCard via closure in this component file
  return null;
}
