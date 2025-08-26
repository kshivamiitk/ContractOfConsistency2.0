import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import UserTable from '../components/UserTable';

export default function SearchPage() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name', { ascending: true });

      if (error) {
        console.error('Error fetching users', error);
        setUsers([]);
      } else {
        setUsers(data || []);
      }
      setLoading(false);
    };
    fetchUsers();
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <h2>Search Participants</h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <input
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ padding: 8, width: 360 }}
        />
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 300, border: '1px solid #eee', padding: 12, borderRadius: 6 }}>
          <h4>Participants</h4>
          {loading && <div>Loading...</div>}
          {!loading && users.length === 0 && <div>No participants found.</div>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {users
              .filter(u => !query || (u.full_name || '').toLowerCase().includes(query.toLowerCase()))
              .map(u => (
                <li key={u.id} style={{ marginBottom: 8 }}>
                  <button
                    onClick={() => setSelectedUserId(u.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: selectedUserId === u.id ? '2px solid #333' : '1px solid #ddd',
                      background: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    {u.full_name || u.id}
                  </button>
                </li>
              ))}
          </ul>
        </div>

        <div style={{ flex: 1 }}>
          {selectedUserId ? (
            <UserTable userId={selectedUserId} />
          ) : (
            <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 6 }}>
              Select a user to view their history in table form.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
