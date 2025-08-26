// src/pages/LoginPage.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const [mode, setMode] = useState('sign-in'); // 'sign-in' | 'sign-up' | 'magic'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // If already signed in, go to preferences
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) navigate('/preferences');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate('/preferences');
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  // Sign up with email+password. After disabling "email confirmations" in Supabase,
  // users will receive an active session immediately.
  const signUpWithPassword = async (ev) => {
    ev?.preventDefault();
    setMessage('');
    if (!email || !password) return setMessage('Provide email and password.');
    if (password !== confirmPassword) return setMessage('Passwords do not match.');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password
      });

      if (error) {
        // Common errors: weak password, email already registered
        setMessage('Error: ' + error.message);
      } else {
        // If your Supabase is configured to NOT require email confirmation,
        // data will contain a session and user and user will be logged in immediately.
        // If confirmations are still required, Supabase will send confirmation email.
        if (data?.session) {
          setMessage('Signed up & logged in.');
          navigate('/preferences');
        } else {
          setMessage('Signed up. If your project requires email confirmation, check your mailbox.');
        }
      }
    } catch (ex) {
      setMessage('Unexpected error: ' + (ex.message || ex));
    } finally {
      setLoading(false);
    }
  };

  // Sign in with email + password
  const signInWithPassword = async (ev) => {
    ev?.preventDefault();
    setMessage('');
    if (!email || !password) return setMessage('Provide email and password.');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setMessage('Error: ' + error.message);
      } else {
        // data.session will be populated on success
        if (data?.session) {
          setMessage('Signed in.');
          navigate('/preferences');
        } else {
          setMessage('Signed in (no session returned).');
        }
      }
    } catch (ex) {
      setMessage('Unexpected error: ' + (ex.message || ex));
    } finally {
      setLoading(false);
    }
  };

  // Optional: magic link fallback if you still want to support it
  const sendMagicLink = async (ev) => {
    ev?.preventDefault();
    setMessage('');
    if (!email) return setMessage('Provide email for magic link.');
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) setMessage('Error sending magic link: ' + error.message);
      else setMessage('Magic link sent — check your email.');
    } catch (ex) {
      setMessage('Unexpected error: ' + (ex.message || ex));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: 20 }}>
      <h2 style={{ marginBottom: 6 }}>Login / Sign up</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode('sign-in')} style={mode === 'sign-in' ? activeBtn : btn}>Sign in</button>
        <button onClick={() => setMode('sign-up')} style={mode === 'sign-up' ? activeBtn : btn}>Sign up (email+password)</button>
        <button onClick={() => setMode('magic')} style={mode === 'magic' ? activeBtn : btn}>Magic link (optional)</button>
      </div>

      {mode === 'sign-in' && (
        <form onSubmit={signInWithPassword}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={inputStyle} />
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
          </div>
        </form>
      )}

      {mode === 'sign-up' && (
        <form onSubmit={signUpWithPassword}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={inputStyle} />
          <label>Confirm password</label>
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required style={inputStyle} />
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={loading}>{loading ? 'Signing up...' : 'Sign up'}</button>
          </div>
          <div style={{ marginTop: 8, color: '#555', fontSize: 13 }}>
            Note: To allow immediate login without clicking verification, disable email confirmations in Supabase Auth settings (Auth → Settings → Email).
          </div>
        </form>
      )}

      {mode === 'magic' && (
        <form onSubmit={sendMagicLink}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} />
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={loading}>{loading ? 'Sending...' : 'Send magic link'}</button>
          </div>
        </form>
      )}

      <div style={{ marginTop: 16, color: message.startsWith('Error') ? 'crimson' : 'green' }}>
        {message}
      </div>

      <div style={{ marginTop: 16, color: '#444', fontSize: 13 }}>
        If you want development convenience (no emails) you can also create test users directly in Supabase Auth (Auth → Users) or use the SQL to insert a user, but for normal usage, using password auth + disabling email confirmation is the best approach.
      </div>
    </div>
  );
}

const btn = { padding: '8px 10px', cursor: 'pointer' };
const activeBtn = { ...btn, border: '2px solid #333', background: '#fafafa' };
const inputStyle = { display: 'block', padding: 8, width: '100%', marginBottom: 8, marginTop: 4 };
