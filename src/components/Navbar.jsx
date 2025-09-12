// src/components/Navbar.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function Navbar({ session, unreadCount = 0 }) {
  const logout = async () => {
    await supabase.auth.signOut();
  };

  const chatStyle = {
    color: unreadCount > 0 ? '#ef4444' : undefined,
    fontWeight: unreadCount > 0 ? 700 : undefined,
    position: 'relative',
    paddingRight: 10,
  };

  const badge = (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        top: -6,
        right: -6,
        minWidth: 18,
        height: 18,
        padding: '0 6px',
        borderRadius: 18,
        background: '#ef4444',
        color: 'white',
        fontSize: 11,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1
      }}
    >
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );

  return (
    <nav style={{ display: 'flex', gap: 16, padding: 12, borderBottom: '1px solid #eee', alignItems: 'center' }}>
      <Link to="/preferences">Preferences</Link>
      <Link to="/checklist">Checklist</Link>
      <Link to="/search">Search</Link>
      <Link to="/tasks">Task Registry</Link>
      <Link to="/day-profile">Profile by Day</Link>
      <Link to="/diary">Diary</Link>
      <Link to="/calendar">Calendar</Link>

      <div style={{ position: 'relative' }}>
        <Link to="/chat" style={chatStyle}>
          Chat
        </Link>
        {unreadCount > 0 && badge}
      </div>

      <Link to="/pomodoro">Pomodoro</Link>
      {/* <Link to="/today-others">Tasks done today (others)</Link> */}
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
