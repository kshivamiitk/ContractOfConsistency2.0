// src/components/Navbar.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function Navbar({ session }) {
  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <nav style={{ display: 'flex', gap: 16, padding: 12, borderBottom: '1px solid #eee' }}>
      <Link to="/preferences">Preferences</Link>
      <Link to="/checklist">Checklist</Link>
      <Link to="/search">Search</Link>
      <Link to="/fines">My fines</Link>
      <div style={{ marginLeft: 'auto' }}>
        {session ? (
          <>
            <span style={{ marginRight: 12 }}>{session.user?.email}</span>
            <button onClick={logout}>Logout</button>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </div>
    </nav>
  );
}
