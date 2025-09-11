// src/components/ConsistencyPlot.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

function buildDays(n = 30) {
  const arr = [];
  for (let i = n-1; i >= 0; i--) arr.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
  return arr;
}

export default function ConsistencyPlot({ userId, days = 30 }) {
  const [data, setData] = useState([]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const start = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD');
      const { data: rows, error } = await supabase.from('consistency_activity').select('date, completed').eq('user_id', userId).gte('date', start);
      if (error) { console.error(error); setData([]); return; }
      const map = {};
      (rows || []).forEach(r => {
        const d = r.date;
        map[d] = map[d] ? map[d] + (r.completed ? 1 : 0) : (r.completed ? 1 : 0);
      });
      const daysArr = buildDays(days).map(d => ({ day: d, count: map[d] || 0 }));
      setData(daysArr);
    })();
  }, [userId, days]);

  if (!userId) return null;
  if (!data || data.length === 0) return <div>No data</div>;

  const w = 720, h = 160;
  const max = Math.max(1, ...data.map(d => d.count));
  const stepX = w / data.length;

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <div style={{ fontWeight:800 }}>Consistency (last {days} days)</div>
        <div className="small text-muted">completed items per day</div>
      </div>
      <svg width={w} height={h} style={{ maxWidth:'100%', marginTop:8 }}>
        {data.map((d,i) => {
          const barH = Math.round((d.count / max) * (h - 30));
          const x = i * stepX;
          const y = h - barH - 20;
          const color = d.count === 0 ? '#e5e7eb' : '#06b6d4';
          return <rect key={d.day} x={x+2} y={y} width={Math.max(4, stepX - 6)} height={barH} fill={color} rx={3} />;
        })}
        {data.map((d,i) => {
          if (i % Math.ceil(data.length / 6) !== 0) return null;
          const x = i * stepX;
          return <text key={d.day} x={x+6} y={h-4} fontSize="10" fill="#6b7280">{d.day.slice(5)}</text>;
        })}
      </svg>
    </div>
  );
}
