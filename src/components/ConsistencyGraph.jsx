// src/components/ConsistencyGraphGlobal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

/* Improved responsive layout + nicer ticks/labels
   - responsive stacking on narrow screens
   - controlled tick frequency on x axis
   - friendly user label fallback ("You")
   - collapsible debug panel
*/

const COLORS = {
  done: '#16a34a',
  partial: '#f59e0b',
  missed: '#ef4444',
  excused: '#fb923c',
  none: '#94a3b8'
};

function dateRange(days) {
  const arr = [];
  const today = dayjs().startOf('day');
  for (let i = days - 1; i >= 0; i--) arr.push(today.subtract(i, 'day').format('YYYY-MM-DD'));
  return arr;
}

export default function ConsistencyGraphGlobal({ initialDays = 30 }) {
  const [days, setDays] = useState(initialDays);
  const [includeExcusedAsDone, setIncludeExcusedAsDone] = useState(true);

  const [rawRows, setRawRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [selectedUserId, setSelectedUserId] = useState('all');
  const [userOptions, setUserOptions] = useState([{ id: 'all', label: 'All users' }]);

  const [activeTerms, setActiveTerms] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const containerRef = useRef(null);

  const [showDebug, setShowDebug] = useState(true);
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 900 : false);

  // watch resize for responsive layout
  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 900);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // try preselect current user if logged in (friendly "You" label applied later)
  useEffect(() => {
    let mounted = true;
    async function getCurrent() {
      try {
        let userId = null;
        if (supabase.auth && typeof supabase.auth.getUser === 'function') {
          const res = await supabase.auth.getUser();
          userId = res?.data?.user?.id || null;
        } else if (supabase.auth && typeof supabase.auth.user === 'function') {
          const u = supabase.auth.user();
          userId = u?.id || null;
        } else if (supabase.auth && supabase.auth.user) {
          const u = supabase.auth.user;
          userId = u?.id || null;
        }
        if (mounted && userId) {
          // only auto-select if currently 'all'
          setSelectedUserId(prev => (prev === 'all' ? userId : prev));
        }
      } catch (err) {
        // ignore
      }
    }
    getCurrent();
    return () => { mounted = false; };
  }, []);

  // fetch user options and rows (re-run when days or selected user changes)
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const start = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD');
        const end = dayjs().format('YYYY-MM-DD');

        // fetch distinct user_ids in range
        const { data: userRows, error: userErr } = await supabase
          .from('daily_checks')
          .select('user_id')
          .gte('date', start)
          .lte('date', end);

        if (userErr) {
          console.warn('user options fetch error', userErr);
        }
        const ids = Array.from(new Set((userRows || []).map(r => r.user_id).filter(Boolean)));

        // attempt to resolve nicer labels from profiles table
        let options = [{ id: 'all', label: 'All users' }];
        if (ids.length > 0) {
          try {
            const { data: profiles, error: profErr } = await supabase
              .from('profiles')
              .select('id, full_name, username')
              .in('id', ids);
            if (profErr) {
              options = [{ id: 'all', label: 'All users' }, ...ids.map(id => ({ id, label: id }))];
            } else {
              const byId = (profiles || []).reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
              options = [{ id: 'all', label: 'All users' }, ...ids.map(id => {
                const p = byId[id];
                return { id, label: p ? (p.full_name || p.username || id) : id };
              })];
            }
          } catch (err) {
            options = [{ id: 'all', label: 'All users' }, ...ids.map(id => ({ id, label: id }))];
          }
        }
        if (mounted) setUserOptions(options);

        // fetch rows for the selected user (or all)
        let q = supabase
          .from('daily_checks')
          .select('id, user_id, date, checks, created_at')
          .gte('date', start)
          .lte('date', end)
          .order('date', { ascending: true });

        if (selectedUserId && selectedUserId !== 'all') q = q.eq('user_id', selectedUserId);

        const { data, error } = await q;
        if (error) throw error;
        if (!mounted) return;
        setRawRows(data || []);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [days, selectedUserId]);

  // helpers
  function normalizeChecks(checks) {
    if (!checks) return [];
    if (Array.isArray(checks)) return checks;
    if (typeof checks === 'object') return Object.values(checks);
    return [];
  }
  function detectItemType(item) {
    return (
      item?.meta?.type ||
      item?.type ||
      item?.term ||
      item?.category ||
      item?.meta?.category ||
      item?.name ||
      'other'
    );
  }

  // aggregated map: date -> term -> stats
  const aggregated = useMemo(() => {
    const map = {};
    rawRows.forEach(r => {
      const rawDate = r.date || r.created_at;
      const date = rawDate ? dayjs(rawDate).format('YYYY-MM-DD') : null;
      if (!date) return;
      const checks = normalizeChecks(r.checks);
      if (!map[date]) map[date] = {};
      checks.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const t = detectItemType(item) || 'other';
        if (!map[date][t]) map[date][t] = { total: 0, done: 0, excused: 0 };
        map[date][t].total += 1;
        const isDone = !!item.done || item.done === true || item.done === 'true';
        const isExcused = !!item.excused || item.excused === true || item.excused === 'true';
        if (isDone) map[date][t].done += 1;
        if (isExcused) map[date][t].excused += 1;
      });
    });
    return map;
  }, [rawRows]);

  // detected terms in stable order
  const detectedTerms = useMemo(() => {
    const s = new Set();
    rawRows.forEach(r => {
      const checks = normalizeChecks(r.checks);
      checks.forEach(item => {
        if (!item || typeof item !== 'object') return;
        s.add(detectItemType(item) || 'other');
      });
    });
    const preferred = ['theory','sport','class','randimpl','randthink','wake','other'];
    const arr = [];
    preferred.forEach(p => { if (s.has(p)) { arr.push(p); s.delete(p); }});
    Array.from(s).sort().forEach(x => arr.push(x));
    return arr;
  }, [rawRows]);

  // init activeTerms robustly
  useEffect(() => {
    if (!detectedTerms || detectedTerms.length === 0) return;
    if (activeTerms === null || (Array.isArray(activeTerms) && activeTerms.length === 0)) {
      setActiveTerms(Array.from(detectedTerms));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(detectedTerms)]);

  // per-term summary (percent)
  const perTermSummary = useMemo(() => {
    const terms = detectedTerms || [];
    const summary = {};
    terms.forEach(term => {
      let total = 0, done = 0, excused = 0;
      Object.keys(aggregated).forEach(date => {
        const s = aggregated[date] && aggregated[date][term];
        if (!s) return;
        total += s.total || 0;
        done += s.done || 0;
        excused += s.excused || 0;
      });
      const effectiveDone = includeExcusedAsDone ? (done + excused) : done;
      const pct = total === 0 ? null : Math.round((effectiveDone / total) * 100);
      summary[term] = { total, done, excused, pct };
    });
    return summary;
  }, [aggregated, detectedTerms, includeExcusedAsDone]);

  // grid data
  const grid = useMemo(() => {
    const dates = dateRange(days);
    const terms = (Array.isArray(activeTerms) && activeTerms.length > 0) ? activeTerms : detectedTerms || [];
    const rows = terms.map(term => {
      const points = dates.map(date => {
        const stats = (aggregated[date] && aggregated[date][term]) || null;
        if (!stats) return { date, total: 0, done: 0, excused: 0, status: 'none' };
        const { total, done, excused } = stats;
        const effectiveDone = includeExcusedAsDone ? (done + excused) : done;
        const status =
          total === 0 ? 'none' :
          (excused === total ? 'excused' :
            effectiveDone === 0 ? 'missed' :
            effectiveDone === total ? 'done' : 'partial'
          );
        return { date, total, done, excused, status };
      });
      return { term, points };
    });
    return { dates, rows };
  }, [aggregated, days, activeTerms, detectedTerms, includeExcusedAsDone]);

  // tooltip handlers
  function handleDotEnter(e, data) {
    const rect = containerRef.current?.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;
    // avoid tooltip going off-right edge
    const x = rect ? Math.min(clientX - rect.left + 8, Math.max(8, rect.width - 280)) : clientX;
    const y = rect ? Math.max(8, clientY - rect.top + 8) : clientY;
    setTooltip({ x, y, ...data });
  }
  function handleDotLeave() { setTooltip(null); }

  // layout & ticks
  const marginLeft = 180;
  const colWidth = 18;
  const rowHeight = 36;
  const width = Math.max(560, (grid.dates?.length || 1) * colWidth + marginLeft + 40);
  const height = (grid.rows?.length || 1) * rowHeight + 40;

  // compute tick interval so labels are readable (max ~7-9 ticks)
  const tickInterval = Math.max(1, Math.ceil((grid.dates?.length || 1) / (isNarrow ? 6 : 9)));

  // friendly user label fallback
  const selectedUserLabel = (() => {
    const opt = userOptions.find(u => u.id === selectedUserId);
    if (opt) return opt.label;
    // if current user, show 'You'
    try {
      const u = supabase.auth && (supabase.auth.user ? supabase.auth.user() : (supabase.auth.getUser ? null : null));
      if (u && u.id === selectedUserId) return 'You';
    } catch (err) {}
    return selectedUserId;
  })();

  if (loading) return <div style={{ padding: 12 }}>Loading global consistency...</div>;
  if (error) return <div style={{ padding: 12, color: 'red' }}>{error}</div>;

  return (
    <div ref={containerRef} style={{ padding: 12, background: '#fff', border: '1px solid #eee', borderRadius: 10, maxWidth: Math.min(width + 420, 1300), overflow: 'auto', position: 'relative' }}>
      {/* collapsible diagnostic */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700 }}>Debug — data summary</div>
          <button onClick={() => setShowDebug(v => !v)} style={{ cursor: 'pointer', padding: '6px 10px' }}>{showDebug ? 'Hide' : 'Show'}</button>
        </div>
        {showDebug && (
          <div style={{ marginTop: 10, padding: 12, border: '1px dashed #ddd', borderRadius: 8, background: '#fafafa' }}>
            <div><strong>Query range:</strong> {dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD')} → {dayjs().format('YYYY-MM-DD')}</div>
            <div><strong>Rows fetched:</strong> {rawRows.length}</div>
            <div><strong>Selected user:</strong> {selectedUserLabel}</div>
            <div><strong>Distinct dates:</strong> {Object.keys(aggregated).length ? Object.keys(aggregated).join(', ') : '— none —'}</div>
            <div><strong>Detected terms:</strong> {(detectedTerms && detectedTerms.length) ? detectedTerms.join(', ') : '— none —'}</div>
            <div style={{ marginTop: 8 }}>
              <strong>Sample row (first):</strong>
              <pre style={{ maxHeight: 180, overflow: 'auto', background: '#fff', padding: 8, borderRadius: 6, border: '1px solid #eee' }}>
                {rawRows[0] ? JSON.stringify(rawRows[0], null, 2) : '— no rows —'}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>Global consistency — last {days} days</div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>Days:</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>

          <label style={{ fontSize: 13 }}>User:</label>
          <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
            {userOptions.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>

          <label style={{ fontSize: 13 }}>Excused as done:</label>
          <input type="checkbox" checked={includeExcusedAsDone} onChange={e => setIncludeExcusedAsDone(e.target.checked)} />
        </div>
      </div>

      {/* main area: uses responsive stacking */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexDirection: isNarrow ? 'column' : 'row' }}>
        {/* left: term labels & percent */}
        <div style={{ width: isNarrow ? '100%' : marginLeft - 24, minWidth: 160 }}>
          <div style={{ padding: '8px 6px' }}>
            {grid.rows.map((r, i) => {
              const pct = perTermSummary[r.term]?.pct;
              return (
                <div key={r.term} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 6px' }}>
                  <div>
                    <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{r.term}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{pct === null ? '— no items —' : `${pct}% done`}</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#222' }}>{pct === null ? '—' : `${pct}%`}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* center: svg chart */}
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <svg width={Math.max(width, 320)} height={height}>
            <rect x={0} y={0} width={marginLeft} height={height} fill="#fff" />

            {/* date columns */}
            {grid.dates.map((d, di) => {
              const x = marginLeft + di * colWidth + colWidth / 2;
              return (
                <g key={d}>
                  <line x1={x} x2={x} y1={8} y2={height - 10} stroke="#f3f4f6" />
                  { (di === 0 || di === grid.dates.length - 1 || di % tickInterval === 0) && (
                    <text x={x} y={height - 4} fontSize={11} textAnchor="middle" fill="#333">{dayjs(d).format('MM-DD')}</text>
                  )}
                </g>
              );
            })}

            {/* term rows */}
            {grid.rows.map((r, ri) => {
              const cy = 8 + ri * rowHeight + rowHeight / 2;
              return (
                <g key={r.term}>
                  {r.points.map((p, pi) => {
                    const cx = marginLeft + pi * colWidth + colWidth / 2;
                    let color = COLORS.none;
                    let radius = 6;
                    if (p.status === 'done') { color = COLORS.done; radius = 7; }
                    else if (p.status === 'partial') { color = COLORS.partial; radius = 6; }
                    else if (p.status === 'missed') { color = COLORS.missed; radius = 6; }
                    else if (p.status === 'excused') { color = COLORS.excused; radius = 6; }
                    else { color = COLORS.none; radius = 4; }

                    const visible = !activeTerms || activeTerms.includes(r.term);
                    return (
                      <g key={r.term + '_' + p.date}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={radius}
                          fill={color}
                          stroke="#fff"
                          strokeWidth={1}
                          opacity={visible ? 1 : 0.16}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={(e) => handleDotEnter(e, {
                            term: r.term,
                            date: p.date,
                            done: p.done,
                            total: p.total,
                            excused: p.excused,
                            status: p.status
                          })}
                          onMouseLeave={handleDotLeave}
                        />
                        {p.status === 'missed' && <circle cx={cx} cy={cy} r={radius + 1.6} fill="none" stroke="#fff" strokeWidth={0.9} opacity={visible ? 0.35 : 0.1} />}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>

        {/* right: legend + term toggles */}
        <div style={{ width: isNarrow ? '100%' : 320 }}>
          <div style={{ borderRadius: 10, background: '#fff', padding: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Legend</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <LegendBadge color={COLORS.done} text="All done" />
              <LegendBadge color={COLORS.partial} text="Partial" />
              <LegendBadge color={COLORS.missed} text="Missed" />
              <LegendBadge color={COLORS.excused} text="Excused" />
              <LegendBadge color={COLORS.none} text="No items" />
            </div>

            <div style={{ fontWeight: 700, marginBottom: 6 }}>Terms</div>
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              {grid.rows.map((r) => {
                const enabled = !activeTerms || activeTerms.includes(r.term);
                const pct = perTermSummary[r.term]?.pct;
                return (
                  <button key={r.term} onClick={() => {
                    setActiveTerms(prev => {
                      if (!prev) return grid.rows.map(x => x.term);
                      if (prev.includes(r.term)) return prev.filter(x => x !== r.term);
                      return [...prev, r.term];
                    });
                  }} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 10px', borderRadius: 8, border: '1px solid #eee', background: enabled ? '#fff' : '#fafafa', cursor: 'pointer'
                  }}>
                    <span style={{ textTransform: 'capitalize' }}>{r.term}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ width: 12, height: 12, borderRadius: 12, background: enabled ? '#111' : '#ddd' }} />
                      <div style={{ fontSize: 12, color: '#444' }}>{pct === null ? '—' : `${pct}%`}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.x,
          top: tooltip.y,
          background: 'white',
          border: '1px solid rgba(0,0,0,0.08)',
          padding: 8,
          borderRadius: 8,
          boxShadow: '0 6px 18px rgba(20,28,48,0.08)',
          pointerEvents: 'none',
          zIndex: 9999,
          minWidth: 200
        }}>
          <div style={{ fontWeight: 700 }}>{tooltip.term} — {dayjs(tooltip.date).format('YYYY-MM-DD')}</div>
          <div style={{ marginTop: 6 }}>
            <div><strong>status:</strong> <span style={{ textTransform: 'capitalize' }}>{tooltip.status}</span></div>
            <div><strong>done:</strong> {tooltip.done}/{tooltip.total}</div>
            <div><strong>excused:</strong> {tooltip.excused}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendBadge({ color, text }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 10, border: '1px solid #f1f5f9', background: '#fff' }}>
      <div style={{ width: 12, height: 12, borderRadius: 6, background: color, boxShadow: '0 0 0 2px rgba(0,0,0,0.03)' }} />
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}
