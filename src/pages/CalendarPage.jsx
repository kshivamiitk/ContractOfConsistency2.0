// src/pages/CalendarPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { supabase } from '../supabaseClient';
dayjs.extend(utc);

/*
  Google-like calendar:
  - Day / Week view
  - Hover tooltip (title/time/description)
  - Click opens modal to edit/create
  - Drag to move events (starts only after small move threshold)
  - Drag handle to resize events (same threshold)
  - Persists updates to Supabase
  - Visual cues: selected day highlight, "creating for" badge, royal-blue theme
*/

/* Helpers */
function fmtTime(ts) { return dayjs(ts).format('HH:mm'); }
const MIN_SNAP_MINUTES = 15;
const PIXELS_PER_MIN = 1;
const TIMELINE_HEIGHT_PX = 24 * 60 * PIXELS_PER_MIN;
const DRAG_START_THRESHOLD_PX = 6;

function layoutDayEvents(events) {
  const evs = events.map(orig => ({
    orig,
    s: +dayjs(orig.start_ts),
    e: +dayjs(orig.end_ts),
    id: orig.id
  })).sort((a,b) => a.s - b.s || a.e - b.e);

  const cols = [];
  evs.forEach(ev => {
    let placed = false;
    for (let i=0;i<cols.length;i++) {
      const col = cols[i];
      const last = col[col.length - 1];
      if (ev.s >= last.e) {
        col.push(ev);
        ev._col = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      ev._col = cols.length;
      cols.push([ev]);
    }
  });
  const total = Math.max(1, cols.length);
  return { events: evs.map(ev => ({ id: ev.id, s: ev.s, e: ev.e, col: ev._col ?? 0, cols: total, orig: ev.orig })), columnsCount: total };
}

export default function CalendarPage({ session }) {
  const userId = session?.user?.id;
  const [anchorDate, setAnchorDate] = useState(dayjs().startOf('day'));
  const [view, setView] = useState('week'); // 'day' | 'week'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  // The single source-of-truth for "which day this new slot applies to"
  const [selectedDate, setSelectedDate] = useState(anchorDate.startOf('day'));

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tooltip, setTooltip] = useState(null);
  const containerRef = useRef(null);

  const dragState = useRef(null);

  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 900 : false);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const range = useMemo(() => {
    if (view === 'day') {
      const start = anchorDate.startOf('day');
      const end = anchorDate.endOf('day');
      return { start, end, days: [start] };
    }
    const start = anchorDate.startOf('week');
    const days = Array.from({length:7}, (_,i) => start.add(i,'day'));
    const end = days[days.length-1].endOf('day');
    return { start, end, days };
  }, [anchorDate, view]);

  useEffect(() => { setSelectedDate(anchorDate.startOf('day')); }, [anchorDate]);

  useEffect(() => {
    if (!userId) return;
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, anchorDate, view]);

  async function fetchEvents() {
    setLoading(true);
    const dayStart = range.start.toISOString();
    const dayEnd = range.end.toISOString();
    try {
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
      } else setEvents(data || []);
    } catch (err) {
      console.error(err);
      setEvents([]);
    } finally { setLoading(false); }
  }

  // OPEN NEW modal for a day — forDate can be dayjs or 'YYYY-MM-DD' string
  function openNewModal(forDate) {
    setEditing(null);
    setTitle('');
    setDescription('');
    setAllDay(false);

    const dateObj = forDate ? dayjs(forDate) : anchorDate;
    setSelectedDate(dateObj.startOf('day'));

    // set sensible default times relative to that day
    const base = dateObj.startOf('day').hour(9);
    setStartTime(base.format('HH:mm'));
    setEndTime(base.add(1,'hour').format('HH:mm'));
    setModalOpen(true);
  }

  function openEditModal(ev) {
    setEditing(ev);
    setTitle(ev.title || '');
    setDescription(ev.description || '');
    setAllDay(Boolean(ev.all_day));
    setStartTime(dayjs(ev.start_ts).format('HH:mm'));
    setEndTime(dayjs(ev.end_ts).format('HH:mm'));
    // ensure selectedDate shows the day of the event (for clarity)
    setSelectedDate(dayjs(ev.start_ts).startOf('day'));
    setModalOpen(true);
  }

  async function saveEvent(e) {
    e?.preventDefault();
    if (!title.trim()) return alert('Title required');
    setSaving(true);

    // use selectedDate to decide which day this new slot belongs to
    const baseDate = editing ? dayjs(editing.start_ts).format('YYYY-MM-DD') : dayjs(selectedDate).format('YYYY-MM-DD');
    const startIso = allDay ? dayjs(baseDate).startOf('day').toISOString() : dayjs(`${baseDate}T${startTime}`).toISOString();
    const endIso = allDay ? dayjs(baseDate).endOf('day').toISOString() : dayjs(`${baseDate}T${endTime}`).toISOString();
    if (!allDay && dayjs(endIso).isBefore(dayjs(startIso))) { setSaving(false); return alert('End must be after start'); }

    try {
      if (editing) {
        const { error } = await supabase.from('events').update({
          title, description, start_ts: startIso, end_ts: endIso, all_day: allDay
        }).eq('id', editing.id);
        if (error) throw error;
      } else {
        const payload = { user_id: userId, title, description, start_ts: startIso, end_ts: endIso, all_day: allDay };
        const { error } = await supabase.from('events').insert(payload);
        if (error) throw error;
      }
      setModalOpen(false);
      await fetchEvents();
    } catch (err) {
      console.error('save', err);
      alert(err.message || String(err));
    } finally { setSaving(false); }
  }

  // robust delete: use select() to surface errors and close modal on success
  async function deleteEvent(id) {
    if (!confirm('Delete event?')) return;
    try {
      setLoading(true);
      // call delete and select the deleted row to force supabase to return errors if any
      const { data, error } = await supabase.from('events').delete().eq('id', id).select().single();
      if (error) {
        console.error('delete error', error);
        alert('Delete failed: ' + (error.message || String(error)));
      } else {
        // close modal if open and refresh
        if (modalOpen) setModalOpen(false);
        await fetchEvents();
      }
    } catch (err) {
      console.error('delete unexpected', err);
      alert('Delete failed: ' + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const d = dayjs(ev.start_ts).format('YYYY-MM-DD');
      if (!map[d]) map[d] = [];
      map[d].push(ev);
    }
    return map;
  }, [events]);

  const hours = Array.from({length:24}, (_,i) => i);

  if (!userId) return <div style={{padding:20, background:'#fff', borderRadius:6}}>Please login to use the calendar.</div>;

  function showTooltip(e, ev) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(8, e.clientX - rect.left + 12), rect.width - 320);
    const y = Math.max(8, e.clientY - rect.top + 8);
    setTooltip({ x, y, title: ev.title, desc: ev.description, time: ev.all_day ? 'All day' : `${fmtTime(ev.start_ts)} — ${fmtTime(ev.end_ts)}` });
  }
  function moveTooltip(e) {
    if (!tooltip || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(8, e.clientX - rect.left + 12), rect.width - 320);
    const y = Math.max(8, e.clientY - rect.top + 8);
    setTooltip(t => ({ ...t, x, y }));
  }
  function hideTooltip() { setTooltip(null); }

  /* Drag & resize (same as before) */
  function startMove(e, l) {
    if (l.orig.all_day) return;
    dragState.current = {
      mode: 'move',
      eventId: l.id,
      dayKey: dayjs(l.orig.start_ts).format('YYYY-MM-DD'),
      origStartMs: l.s,
      origEndMs: l.e,
      startClientY: e.clientY,
      moved: false
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    document.body.style.userSelect = 'none';
  }

  function startResize(e, l) {
    if (l.orig.all_day) return;
    dragState.current = {
      mode: 'resize',
      eventId: l.id,
      dayKey: dayjs(l.orig.start_ts).format('YYYY-MM-DD'),
      origStartMs: l.s,
      origEndMs: l.e,
      startClientY: e.clientY,
      moved: false
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    document.body.style.userSelect = 'none';
  }

  function onPointerMove(ev) {
    const st = dragState.current;
    if (!st) return;
    const deltaY = ev.clientY - st.startClientY;
    if (!st.moved) {
      if (Math.abs(deltaY) < DRAG_START_THRESHOLD_PX) return;
      st.moved = true;
    }
    const deltaMinutes = Math.round(deltaY / PIXELS_PER_MIN);
    const snap = Math.round(deltaMinutes / MIN_SNAP_MINUTES) * MIN_SNAP_MINUTES;

    if (st.mode === 'move') {
      const newStartMs = st.origStartMs + snap * 60000;
      const newEndMs = st.origEndMs + snap * 60000;
      setEvents(prev => prev.map(evRow => evRow.id === st.eventId ? { ...evRow, __previewStart: newStartMs, __previewEnd: newEndMs } : evRow));
    } else if (st.mode === 'resize') {
      const newEndMs = st.origEndMs + snap * 60000;
      const minEnd = st.origStartMs + MIN_SNAP_MINUTES * 60000;
      const finalEndMs = Math.max(minEnd, newEndMs);
      setEvents(prev => prev.map(evRow => evRow.id === st.eventId ? { ...evRow, __previewEnd: finalEndMs } : evRow));
    }
  }

  async function onPointerUp(ev) {
    const st = dragState.current;
    if (!st) return;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    document.body.style.userSelect = '';

    const previewEv = events.find(x => x.id === st.eventId);
    if (!previewEv) { dragState.current = null; return; }

    if (!st.moved) {
      dragState.current = null;
      openEditModal(previewEv);
      return;
    }

    const newStartMs = previewEv.__previewStart != null ? previewEv.__previewStart : +dayjs(previewEv.start_ts);
    const newEndMs = previewEv.__previewEnd != null ? previewEv.__previewEnd : +dayjs(previewEv.end_ts);

    setEvents(prev => prev.map(evRow => {
      if (evRow.id === st.eventId) {
        const copy = { ...evRow };
        delete copy.__previewStart;
        delete copy.__previewEnd;
        return copy;
      }
      return evRow;
    }));

    const origStart = +dayjs(previewEv.start_ts);
    const origEnd = +dayjs(previewEv.end_ts);
    if (newStartMs !== origStart || newEndMs !== origEnd) {
      try {
        setLoading(true);
        const startIso = dayjs(newStartMs).toISOString();
        const endIso = dayjs(newEndMs).toISOString();
        const { error } = await supabase.from('events').update({ start_ts: startIso, end_ts: endIso }).eq('id', st.eventId);
        if (error) throw error;
        await fetchEvents();
      } catch (err) {
        console.error('drag update error', err);
        alert('Could not update event: ' + (err.message || String(err)));
        await fetchEvents();
      } finally { setLoading(false); }
    }

    dragState.current = null;
  }

  function renderDayColumn(day) {
    const dayKey = day.format('YYYY-MM-DD');
    const dayEvents = eventsByDay[dayKey] || [];
    const allDayEvents = dayEvents.filter(e => e.all_day);
    const timedEvents = dayEvents.filter(e => !e.all_day);
    const { events: laidEvents } = layoutDayEvents(timedEvents);
    const dayStartMs = +day.startOf('day');

    // highlight if this is the selectedDate for creating or editing
    const isSelectedDay = selectedDate && dayjs(selectedDate).format('YYYY-MM-DD') === dayKey;

    return (
      <div key={dayKey} style={{ ...styles.column, boxShadow: isSelectedDay ? 'inset 0 0 0 2px rgba(65,105,225,0.18)' : undefined }}>
        <div style={{ ...styles.dayHeader, borderBottom: isSelectedDay ? '2px solid #4169E1' : '1px solid #eee' }}>
          <div>
            <div style={{fontWeight:700}}>{day.format('ddd')}</div>
            <div style={{fontSize:12,color:'#666'}}>{day.format('MMM D')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => openNewModal(day)} style={styles.slotButton}>+ slot</button>
            {isSelectedDay && modalOpen && !editing && (
              <div style={styles.creatingBadge}>Creating for {day.format('MMM D')}</div>
            )}
          </div>
        </div>

        <div style={styles.allDayRow}>
          {allDayEvents.length === 0 ? <div style={{color:'#999',fontSize:12}}>No all-day</div> :
            allDayEvents.map(ev => (
              <div key={ev.id}
                   role="button" tabIndex={0}
                   onClick={() => openEditModal(ev)}
                   onKeyDown={e => { if (e.key === 'Enter') openEditModal(ev); }}
                   onMouseEnter={e => showTooltip(e, ev)}
                   onMouseMove={moveTooltip}
                   onMouseLeave={hideTooltip}
                   style={styles.allDayChip}
              >
                <div style={{fontWeight:700}}>{ev.title}</div>
              </div>
            ))
          }
        </div>

        <div style={{...styles.timelineContainer, height: TIMELINE_HEIGHT_PX}}>
          {laidEvents.map(l => {
            const evOrig = l.orig;
            const startMs = evOrig.__previewStart ?? +dayjs(evOrig.start_ts) ?? l.s;
            const endMs = evOrig.__previewEnd ?? +dayjs(evOrig.end_ts) ?? l.e;
            const minutesFromStart = Math.max(0, Math.round((startMs - dayStartMs) / 60000));
            const minutesLength = Math.max(15, Math.round((endMs - startMs) / 60000));
            const topPx = minutesFromStart * PIXELS_PER_MIN;
            const heightPx = minutesLength * PIXELS_PER_MIN;
            const widthPercent = 100 / l.cols;
            const leftPercent = l.col * widthPercent;

            return (
              <div key={l.id}
                   role="button" tabIndex={0}
                   onKeyDown={e => { if (e.key === 'Enter') openEditModal(evOrig); }}
                   onMouseEnter={e => showTooltip(e, evOrig)}
                   onMouseMove={moveTooltip}
                   onMouseLeave={hideTooltip}
                   style={{
                     ...styles.eventCard,
                     top: topPx,
                     left: `calc(${leftPercent}% + 6px)`,
                     width: `calc(${widthPercent}% - 12px)`,
                     height: heightPx,
                     borderLeft: '4px solid #4169E1', // royal-blue accent
                     background: '#f4f7ff'
                   }}
                   onPointerDown={(e) => startMove(e, l)}
              >
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                  <div style={{fontWeight:700,fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{evOrig.title}</div>
                  <div
                       style={{width:10, height:10, borderRadius:4, background:'#0008', cursor:'ns-resize'}}
                       onPointerDown={(ev) => { ev.stopPropagation(); startResize(ev, l); }}
                  />
                </div>
                <div style={{fontSize:11, color:'#333'}}>{fmtTime(startMs)} — {fmtTime(endMs)}</div>
              </div>
            );
          })}

          <div style={{position:'absolute', inset:0}}>
            {hours.map(h => <div key={h} style={styles.hourRow} />)}
          </div>
        </div>

        <div style={{marginTop:8}}>
          {timedEvents.length === 0 ? <div style={{color:'#999',fontSize:12}}>No events</div> :
            timedEvents.map(ev => (
              <div key={ev.id}
                   role="button" tabIndex={0}
                   onClick={() => openEditModal(ev)}
                   onKeyDown={e => { if (e.key === 'Enter') openEditModal(ev); }}
                   onMouseEnter={e => showTooltip(e, ev)}
                   onMouseMove={moveTooltip}
                   onMouseLeave={hideTooltip}
                   style={styles.quickListItem}
              >
                <div style={{fontWeight:700}}>{ev.title}</div>
                <div style={{fontSize:12, color:'#666'}}>{fmtTime(ev.start_ts)} — {fmtTime(ev.end_ts)}</div>
              </div>
            ))
          }
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={styles.container}>
      <div style={styles.header}>
        <div style={{fontSize:20,fontWeight:700}}>{view === 'week' ? 'Week Calendar' : 'Day Calendar'}</div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <div style={{display:'flex',gap:6}}>
            <button onClick={() => setView('day')} style={view==='day'?styles.primaryTab:styles.tab}>Day</button>
            <button onClick={() => setView('week')} style={view==='week'?styles.primaryTab:styles.tab}>Week</button>
          </div>
          <div style={{display:'flex',gap:6,marginLeft:6}}>
            <button onClick={() => setAnchorDate(anchorDate.subtract(view === 'day' ? 1 : 7, 'day'))} style={styles.iconBtn}>◀</button>
            <button onClick={() => setAnchorDate(dayjs())} style={styles.btn}>Today</button>
            <button onClick={() => setAnchorDate(anchorDate.add(view === 'day' ? 1 : 7, 'day'))} style={styles.iconBtn}>▶</button>
          </div>
          <button onClick={() => openNewModal(null)} style={styles.addBtn}>+ New</button>
        </div>
      </div>

      <div style={{display:'flex',gap:12}}>
        <div style={styles.leftHours}>
          <div style={styles.allDayLeftHeader}>All day</div>
          {hours.map(h => <div key={h} style={styles.hourLabel}>{String(h).padStart(2,'0')}:00</div>)}
        </div>

        <div style={{flex:1, display:'flex', gap:8, overflowX:'auto', paddingBottom:20}}>
          {range.days.map(d => renderDayColumn(d))}
        </div>
      </div>

      {tooltip && (
        <div style={{
          position:'absolute',
          left: tooltip.x,
          top: tooltip.y,
          background:'#fff',
          border:'1px solid rgba(0,0,0,0.08)',
          padding:10,
          borderRadius:8,
          boxShadow:'0 6px 18px rgba(20,28,48,0.08)',
          pointerEvents:'none',
          zIndex:9999,
          width:320
        }}>
          <div style={{fontWeight:700}}>{tooltip.title}</div>
          <div style={{fontSize:12,color:'#666',marginTop:6}}>{tooltip.time}</div>
          <div style={{marginTop:8,fontSize:13}}>{tooltip.desc || <span style={{color:'#999'}}>No description</span>}</div>
        </div>
      )}

      {modalOpen && (
        <div style={styles.modalBackdrop}>
          <form onSubmit={saveEvent} style={styles.modal}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h3 style={{margin:0}}>{editing ? 'Edit event' : `New event — ${dayjs(selectedDate).format('MMM D, YYYY')}`}</h3>
              <div>
                {editing && <button type="button" onClick={() => { if (confirm('Delete event?')) deleteEvent(editing.id); }} style={styles.dangerBtn}>Delete</button>}
                <button type="button" onClick={() => setModalOpen(false)} style={styles.btn}>Close</button>
              </div>
            </div>

            <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:8}}>
              <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title" style={styles.input} autoFocus />
              <label style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All day</label>
              {!allDay && (
                <div style={{display:'flex',gap:8}}>
                  <div style={{flex:1}}>
                    <label style={{display:'block',marginBottom:4,fontSize:12}}>Start</label>
                    <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} style={styles.input} />
                  </div>
                  <div style={{flex:1}}>
                    <label style={{display:'block',marginBottom:4,fontSize:12}}>End</label>
                    <input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} style={styles.input} />
                  </div>
                </div>
              )}
              <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Description" style={{minHeight:100,padding:8,borderRadius:6}} />
            </div>

            <div style={{marginTop:12,display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button type="button" onClick={()=>setModalOpen(false)} style={styles.btn}>Cancel</button>
              <button type="submit" style={styles.primary}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* Theme: royal-blue accent (#4169E1) */
const styles = {
  container: { background:'#fff', padding:18, borderRadius:10, fontFamily:`Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial`, color:'#111', position:'relative' },
  header: { display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12 },
  tab: { padding:'6px 10px', borderRadius:8, border:'1px solid #e6e6e6', background:'#fff', cursor:'pointer' },
  primaryTab: { padding:'6px 10px', borderRadius:8, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' },
  btn: { padding:'6px 10px', borderRadius:8, border:'1px solid #e6e6e6', background:'#fff', cursor:'pointer' },
  iconBtn: { padding:'6px 8px', borderRadius:8, border:'1px solid #e6e6e6', background:'#fff', cursor:'pointer' },
  addBtn: { padding:'8px 12px', borderRadius:8, border:'none', background:'#4169E1', color:'#fff', cursor:'pointer', boxShadow:'0 6px 18px rgba(65,105,225,0.12)' },
  dangerBtn: { marginRight:8, padding:'6px 8px', borderRadius:8, border:'1px solid #ef9a9a', background:'#fff', color:'#b22' },

  leftHours: { width:80, flexShrink:0 },
  allDayLeftHeader: { height:40, borderBottom:'1px solid #eee', display:'flex',alignItems:'center',justifyContent:'center',fontSize:12, color:'#444' },
  hourLabel: { height:60, borderBottom:'1px solid #f3f3f3', display:'flex',alignItems:'center',justifyContent:'center', color:'#666', fontSize:12 },

  column: { minWidth:260, borderLeft:'1px solid #f0f0f0', borderRight:'1px solid #f0f0f0', borderRadius:6, background:'#fafafa', padding:8, boxSizing:'border-box' },
  dayHeader: { height:56, display:'flex',alignItems:'center',justifyContent:'space-between', padding:'0 8px', borderBottom:'1px solid #eee' },
  slotButton: { padding:'6px 8px', borderRadius:6, border:'1px solid #e6e6e6', background:'#fff', cursor:'pointer', fontSize:12 },
  creatingBadge: { background:'#4169E1', color:'#fff', padding:'4px 8px', borderRadius:6, fontSize:12 },

  allDayRow: { minHeight:48, borderBottom:'1px solid #eee', marginBottom:6, display:'flex', gap:6, alignItems:'center', padding:6, flexWrap:'wrap' },
  allDayChip: { padding:'6px 10px', background:'#fcefe6', borderRadius:8, fontSize:13, cursor:'pointer', border:'1px solid #f3d6c0' },

  timelineContainer: { position:'relative', overflow:'hidden' },
  hourRow: { height:'60px', borderBottom:'1px dashed rgba(0,0,0,0.04)' },

  eventCard: { position:'absolute', padding:8, boxSizing:'border-box', borderRadius:8, overflow:'hidden', cursor:'pointer', background:'#e7f3ff', border:'1px solid #cfe6ff' },

  quickListItem: { padding:8, borderRadius:8, border:'1px solid #eee', marginBottom:6, background:'#fff', cursor:'pointer' },

  modalBackdrop: { position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.35)', zIndex:1000 },
  modal: { background:'#fff', padding:18, borderRadius:10, width:520, boxShadow:'0 10px 40px rgba(2,6,23,0.2)' },
  input: { padding:8, borderRadius:6, border:'1px solid #e6e6e6', width:'100%' },
  primary: { padding:'8px 12px', borderRadius:8, border:'none', background:'#4169E1', color:'#fff', cursor:'pointer' },
};
