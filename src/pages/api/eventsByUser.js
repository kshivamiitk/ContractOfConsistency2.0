// pages/api/eventsByUser.js
import dayjs from 'dayjs';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req, res) {
  try {
    const { user_id, start, end } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles').select('id, full_name, public_profile').eq('id', user_id).maybeSingle();
    if (pErr) return res.status(500).json({ error: pErr.message });

    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const isPublic = profile.public_profile === null || profile.public_profile === undefined ? true : Boolean(profile.public_profile);
    if (!isPublic) return res.status(403).json({ error: 'Profile is private' });

    const startIso = start || dayjs().startOf('week').toISOString();
    const endIso = end || dayjs().endOf('week').toISOString();

    const { data: events, error: eErr } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('user_id', user_id)
      .gte('start_ts', startIso)
      .lte('start_ts', endIso)
      .order('start_ts', { ascending: true });

    if (eErr) return res.status(500).json({ error: eErr.message });
    return res.status(200).json({ profile, events: events || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'unexpected' });
  }
}
