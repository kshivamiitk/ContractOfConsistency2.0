// src/pages/MyFinesPage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import dayjs from 'dayjs';

export default function MyFinesPage() {
  const [user, setUser] = useState(null);
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingIds, setUpdatingIds] = useState(new Set());

  useEffect(() => {
    const loadSessionAndFines = async () => {
      setLoading(true);
      const { data: s } = await supabase.auth.getSession();
      const session = s?.session ?? null;
      if (!session) {
        setUser(null);
        setLoading(false);
        return;
      }
      setUser(session.user);
      await loadFines(session.user.id);
      setLoading(false);
    };

    loadSessionAndFines();
  }, []);

  const loadFines = async (userId) => {
    const { data, error } = await supabase
      .from('fines')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading fines', error);
      setFines([]);
    } else {
      // show unpaid first, then paid
      const sorted = (data || []).sort((a,b) => {
        if (a.paid === b.paid) return new Date(b.date) - new Date(a.date);
        return a.paid ? 1 : -1;
      });
      setFines(sorted);
    }
  };

  const togglePaid = async (fineId, newVal) => {
    setUpdatingIds(prev => new Set(prev).add(fineId));
    try {
      const { error } = await supabase.from('fines').update({ paid: newVal }).eq('id', fineId);
      if (error) throw error;
      // reload fines
      if (user) await loadFines(user.id);
    } catch (ex) {
      console.error('Error updating fine paid', ex);
      alert('Error updating fine: ' + (ex.message || ex));
    } finally {
      setUpdatingIds(prev => {
        const copy = new Set(prev);
        copy.delete(fineId);
        return copy;
      });
    }
  };

  if (loading) return <div style={{ padding: 16 }}>Loading your fines...</div>;
  if (!user) return <div style={{ padding: 16 }}>Please login to see your fines.</div>;

  const totalUnpaid = fines.reduce((s, f) => s + (!f.paid ? Number(f.amount || 0) : 0), 0);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 20 }}>
      <h2>My fines</h2>
      <div style={{ marginBottom: 12 }}>
        <strong>Total unpaid:</strong> ₹{totalUnpaid}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>Amount (₹)</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Paid</th>
            </tr>
          </thead>
          <tbody>
            {fines.map(f => (
              <tr key={f.id}>
                <td style={tdStyle}>{dayjs(f.date).format('YYYY-MM-DD')}</td>
                <td style={tdStyle}>{f.reason}</td>
                <td style={tdStyle}>₹{f.amount}</td>
                <td style={tdStyle}>{dayjs(f.created_at).format('YYYY-MM-DD HH:mm')}</td>
                <td style={tdStyle}>
                  <input
                    type="checkbox"
                    checked={!!f.paid}
                    disabled={updatingIds.has(f.id)}
                    onChange={(e) => togglePaid(f.id, e.target.checked)}
                  />
                </td>
              </tr>
            ))}
            {fines.length === 0 && (
              <tr><td colSpan="5" style={{ padding: 12 }}>You have no fines.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = {
  borderBottom: '1px solid #ddd',
  textAlign: 'left',
  padding: '8px',
};

const tdStyle = {
  padding: '8px',
  borderBottom: '1px solid #f5f5f5'
};
