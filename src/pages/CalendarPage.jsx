// src/pages/CalendarPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { supabase } from '../supabaseClient';

dayjs.extend(utc);

function fmtTime(ts) {
  return dayjs(ts).format('HH:mm');
}

/**
 * Given events for a single day (start_ts/end_ts inside same day),
 * compute column index/columns count for overlap layout.
 */
function layoutDayEvents(events) {
  // events: [{id, start_ts, end_ts, ...}] with start/end as ISO strings
  // Convert to numeric
  const evs = events.map(ev => ({
    ...ev,
    s: +dayjs(ev.start_ts),
    e: +dayjs(ev.end_ts),
  })).sort((a, b) => a.s - b.s || a.e - b.e);

  const columns = []; // array of arrays of events per column

  evs.forEach(ev => {
    // try place in an existing column
    let placed = false;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const last = col[col.length - 1];
      if (ev.s >= last.e) { // no overlap with last event in this column
        col.push(ev);
        ev._col = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      ev._col = columns.length;
      columns.push([ev]);
    }
  });

  const totalCols = columns.length || 1;
  return {
    events: evs.map(ev => ({ ...ev, col: ev._col ?? 0, cols: totalCols })),
    columnsCount: totalCols,
  };
}

export default function CalendarPage({ session }) {
  const userId = session?.user?.id;
  const [anchorDate, setAnchorDate] = useState(dayjs().startOf('day')); // base date for view
  const [view, setView] = useState('week'); // 'day' or 'week'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  // Add / edit form state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null for new, or event object for edit
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const descRef = useRef('');

  // derive visible range
  const range = useMemo(() => {
    if (view === 'day') {
      const start = anchorDate.startOf('day');
      const end = anchorDate.endOf('day');
      return { start, end, days: [start] };
    }
    // week view: 7 days from startOf('week')
    const start = anchorDate.startOf('week');
    const days = Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
    const end = days[days.length - 1].endOf('day');
    return { start, end, days };
  }, [anchorDate, view]);

  useEffect(() => {
    if (!userId) return;
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, anchorDate, view]);

  async function fetchEvents() {
    setLoading(true);
    const dayStart = range.start.toISOString();
    const dayEnd = range.end.toISOString();
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .gte('start_ts', dayStart)
      .lte('start_ts', dayEnd)
      .order('start_ts', { ascending: true });

    if (error) {
      console.error('fetch events', error);
      setEvents([]);
    } else {
      setEvents(data || []);
    }
    setLoading(false);
  }

  function openNewModal(forDate) {
    setEditing(null);
    setTitle('');
    setAllDay(false);
    const s = forDate ? dayjs(forDate) : anchorDate.hour(9);
    const e = s.add(1, 'hour');
    setStartTime(s.format('HH:mm'));
    setEndTime(e.format('HH:mm'));
    descRef.current = '';
    setModalOpen(true);
  }

  function openEditModal(ev) {
    setEditing(ev);
    setTitle(ev.title || '');
    setAllDay(Boolean(ev.all_day));
    setStartTime(dayjs(ev.start_ts).format('HH:mm'));
    setEndTime(dayjs(ev.end_ts).format('HH:mm'));
    descRef.current = ev.description || '';
    setModalOpen(true);
  }

  async function saveEvent(e) {
    e.preventDefault();
    if (!title) return alert('Title required');

    // Build start/end ISO using the selected day for new event (editing keeps same day)
    const baseDate = editing ? dayjs(editing.start_ts).format('YYYY-MM-DD') : anchorDate.format('YYYY-MM-DD');
    const startIso = allDay ? dayjs(baseDate).startOf('day').toISOString() : dayjs(`${baseDate}T${startTime}`).toISOString();
    const endIso = allDay ? dayjs(baseDate).endOf('day').toISOString() : dayjs(`${baseDate}T${endTime}`).toISOString();

    if (!allDay && dayjs(endIso).isBefore(dayjs(startIso))) {
      return alert('End time must be after start time');
    }

    setLoading(true);
    if (editing) {
      const { error } = await supabase
        .from('events')
        .update({
          title,
          description: descRef.current,
          start_ts: startIso,
          end_ts: endIso,
          all_day: allDay,
        })
        .eq('id', editing.id);
      if (error) alert(error.message);
      else {
        setModalOpen(false);
        fetchEvents();
      }
    } else {
      const payload = {
        user_id: userId,
        title,
        description: descRef.current,
        start_ts: startIso,
        end_ts: endIso,
        all_day: allDay,
      };
      const { error } = await supabase.from('events').insert(payload);
      if (error) alert(error.message);
      else {
        setModalOpen(false);
        fetchEvents();
      }
    }
    setLoading(false);
  }

  async function deleteEvent(id) {
    if (!confirm('Delete event?')) return;
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) alert(error.message);
    else fetchEvents();
  }

  // group events by day (YYYY-MM-DD)
  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const d = dayjs(ev.start_ts).format('YYYY-MM-DD');
      if (!map[d]) map[d] = [];
      map[d].push(ev);
    }
    return map;
  }, [events]);

  // Render helpers for hourly grid
  const hours = Array.from({ length: 24 }, (_, i) => i);

  if (!userId) {
    return <div style={{ padding: 20, background: '#fff', borderRadius: 6 }}>Please login to use the calendar.</div>;
  }

  return (
    <div style={{ background: '#fff', padding: 16, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{view === 'week' ? 'Week Calendar' : 'Daily Calendar'}</h2>

        <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
          <button onClick={() => setView('day')} style={{ padding: '6px 10px', borderRadius: 6, border: view === 'day' ? '2px solid #333' : '1px solid #ddd' }}>Day</button>
          <button onClick={() => setView('week')} style={{ padding: '6px 10px', borderRadius: 6, border: view === 'week' ? '2px solid #333' : '1px solid #ddd' }}>Week</button>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setAnchorDate(anchorDate.subtract(view === 'day' ? 1 : 7, 'day'))}>◀</button>
          <button onClick={() => setAnchorDate(dayjs())}>Today</button>
          <button onClick={() => setAnchorDate(anchorDate.add(view === 'day' ? 1 : 7, 'day'))}>▶</button>
          <button onClick={() => openNewModal(null)} style={{ padding: '6px 10px', borderRadius: 6 }}>+ New</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {/* left hours column (only show once) */}
        <div style={{ width: 70, flexShrink: 0 }}>
          <div style={{ height: 40, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>All day</div>
          {hours.map(h => (
            <div key={h} style={{ height: 60, borderBottom: '1px solid #f3f3f3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#666' }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* main grid: one column per day */}
        <div style={{ flex: 1, display: 'flex', gap: 8, overflowX: 'auto' }}>
          {range.days.map(day => {
            const dayKey = day.format('YYYY-MM-DD');
            const dayEvents = eventsByDay[dayKey] || [];
            const allDayEvents = dayEvents.filter(e => e.all_day);
            const timedEvents = dayEvents.filter(e => !e.all_day);
            const { events: laidEvents } = layoutDayEvents(timedEvents);

            return (
              <div key={dayKey} style={{ minWidth: 220, borderLeft: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa', padding: 6, boxSizing: 'border-box' }}>
                <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px' }}>
                  <div>
                    <div style={{ fontWeight: '600' }}>{day.format('ddd')}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{day.format('MMM D')}</div>
                  </div>
                  <div>
                    <button onClick={() => openNewModal(day.format('YYYY-MM-DD'))} style={{ fontSize: 12 }}>+ slot</button>
                  </div>
                </div>

                {/* all-day row */}
                <div style={{ minHeight: 40, borderBottom: '1px solid #eee', marginBottom: 6, padding: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {allDayEvents.length === 0 ? <div style={{ color: '#999', fontSize: 12 }}>No all-day</div> : allDayEvents.map(ev => (
                    <div key={ev.id} style={{ padding: '6px 8px', background: '#e9f5ff', borderRadius: 6, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontWeight: 600 }}>{ev.title}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>
                        <button onClick={() => openEditModal(ev)} style={{ marginLeft: 6, fontSize: 11 }}>Edit</button>
                        <button onClick={() => deleteEvent(ev.id)} style={{ marginLeft: 4, fontSize: 11 }}>Del</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* timeline container */}
                <div style={{ position: 'relative', height: 24 * 60 / 15 * 15, /* ~1440px scaled down by 1 */ overflow: 'hidden' }}>
                  {/* absolute-positioned events */}
                  {laidEvents.map(ev => {
                    // compute top and height as percentage of day (0-24h)
                    const dayStartMs = +day.startOf('day');
                    const minutesFromStart = (ev.s - dayStartMs) / 60000;
                    const minutesLength = Math.max(15, (ev.e - ev.s) / 60000); // min height
                    const top = (minutesFromStart / (24 * 60)) * 100;
                    const height = (minutesLength / (24 * 60)) * 100;
                    const widthPercent = 100 / ev.cols;
                    const leftPercent = ev.col * widthPercent;

                    return (
                      <div
                        key={ev.id}
                        onClick={() => openEditModal(ev)}
                        style={{
                          position: 'absolute',
                          top: `${top}%`,
                          left: `${leftPercent}%`,
                          width: `calc(${widthPercent}% - 6px)`,
                          height: `${height}%`,
                          padding: 6,
                          boxSizing: 'border-box',
                          background: '#dbefff',
                          border: '1px solid #c2ddff',
                          borderRadius: 6,
                          overflow: 'hidden',
                          cursor: 'pointer',
                        }}
                        title={`${ev.title} — ${fmtTime(ev.start_ts)}-${fmtTime(ev.end_ts)}`}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
                        <div style={{ fontSize: 11, color: '#333' }}>{fmtTime(ev.start_ts)} — {fmtTime(ev.end_ts)}</div>
                      </div>
                    );
                  })}

                  {/* invisible hour separators to keep height consistent */}
                  <div style={{ position: 'absolute', inset: 0 }}>
                    {hours.map((h, idx) => (
                      <div key={h} style={{ height: '60px', borderBottom: '1px dashed rgba(0,0,0,0.04)' }} />
                    ))}
                  </div>
                </div>

                {/* small list at bottom for quick view */}
                <div style={{ marginTop: 8 }}>
                  {timedEvents.length === 0 ? <div style={{ color: '#999', fontSize: 12 }}>No events</div> :
                    timedEvents.map(ev => (
                      <div key={ev.id} style={{ padding: 6, borderRadius: 6, border: '1px solid #eee', marginBottom: 6, background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <div style={{ fontWeight: 600 }}>{ev.title}</div>
                          <div style={{ fontSize: 12, color: '#666' }}>{fmtTime(ev.start_ts)} — {fmtTime(ev.end_ts)}</div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* modal for add/edit */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.35)', zIndex: 60
        }}>
          <form onSubmit={saveEvent} style={{ background: '#fff', padding: 16, borderRadius: 8, width: 480, boxShadow: '0 6px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{editing ? 'Edit event' : 'New event'}</h3>
              <div>
                {editing && <button type="button" onClick={() => { if (confirm('Delete event?')) deleteEvent(editing.id); }} style={{ marginRight: 8 }}>Delete</button>}
                <button type="button" onClick={() => setModalOpen(false)}>Close</button>
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexDirection: 'column' }}>
              <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ padding: 8, fontSize: 14 }} />

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
                  All day
                </label>
                {!allDay && (
                  <>
                    <label>Start <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></label>
                    <label>End <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} /></label>
                  </>
                )}
              </div>

              <textarea placeholder="Description" defaultValue={editing?.description || ''} onChange={e => descRef.current = e.target.value} style={{ minHeight: 80, padding: 8 }} />
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="submit">{loading ? 'Saving…' : (editing ? 'Save' : 'Add')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
