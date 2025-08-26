import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import PreferenceForm from '../components/PreferenceForm';

export default function PreferencesPage() {
  const [loading, setLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // get session
        const { data: sData } = await supabase.auth.getSession();
        const session = sData?.session ?? null;
        if (!session) {
          setSessionUser(null);
          setLoading(false);
          return;
        }
        const user = session.user;
        setSessionUser(user);

        // ensure a row in profiles exists
        const { data: profRow, error: profErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (profErr) throw profErr;

        if (!profRow) {
          // create profile if not exists
          const { error: insProfErr } = await supabase
            .from('profiles')
            .insert({ id: user.id, full_name: user.email });
          if (insProfErr) throw insProfErr;
          setProfile({ id: user.id, full_name: user.email });
        } else {
          setProfile(profRow);
        }

        // load preferences if any
        const { data: prefRow, error: prefErr } = await supabase
          .from('preferences')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        if (prefErr) throw prefErr;
        setPreferences(prefRow || null);

        // load templates (if any) to populate dropdown
        const { data: templRows, error: templErr } = await supabase
          .from('templates')
          .select('*');
        if (templErr) throw templErr;
        setTemplates(templRows || []);
      } catch (ex) {
        console.error('Error loading preferences page', ex);
        setError(ex?.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!sessionUser) return <div style={{ padding: 20 }}>Please login first to edit preferences.</div>;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 20 }}>
      <h1>Your Preferences</h1>
      {error && <div style={{ color: 'crimson', marginBottom: 12 }}>Error: {error}</div>}
      <PreferenceForm
        user={sessionUser}
        initialPrefs={preferences}
        templates={templates}
      />
      <div style={{ marginTop: 24, color: '#444' }}>
        <small>
          Tip: choose platforms (codeforces, leetcode, interviewbit etc), classes you attend (it will be used to auto-create class-related checklist items),
          and sports (gym, running, yoga). If you change the DB later to add a unique constraint on preferences.user_id, the fast upsert path will work.
        </small>
      </div>
    </div>
  );
}
