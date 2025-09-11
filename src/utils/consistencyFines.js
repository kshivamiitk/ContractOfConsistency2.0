// src/utils/consistencyFines.js
import { supabase } from '../supabaseClient';

const todayStr = (d = new Date()) => d.toISOString().slice(0,10);
export const computeAmount = (base, mult) => (Number(base || 0) * Number(mult || 1));

export async function getOrCreateFine(userId, domain, baseFine = 10) {
  const { data, error } = await supabase.from('consistency_fines').select('*').eq('user_id', userId).eq('domain', domain).maybeSingle();
  if (error) throw error;
  if (data) return data;

  const payload = {
    user_id: userId,
    domain,
    base_fine: baseFine,
    multiplier: 1,
    consecutive_misses: 0,
    last_miss_date: null,
    last_paid: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { data: created, error: e2 } = await supabase.from('consistency_fines').insert([payload]).select().maybeSingle();
  if (e2) throw e2;

  await supabase.from('consistency_fines_history').insert([{
    fine_id: created.id, user_id, domain, event_type: 'created', amount_before: 0,
    amount_after: computeAmount(created.base_fine, created.multiplier),
    multiplier_before: 0, multiplier_after: created.multiplier,
    consecutive_before: 0, consecutive_after: created.consecutive_misses,
    note: 'created'
  }]);

  return created;
}

export async function recordMiss(userId, domain, baseFine = 10, missDate = todayStr()) {
  const f = await getOrCreateFine(userId, domain, baseFine);
  const last = f.last_miss_date ? String(f.last_miss_date).slice(0,10) : null;
  const yesterday = new Date(Date.now() - 24*3600*1000).toISOString().slice(0,10);

  let newConsec = 1;
  let newMult = 2;
  if (last === yesterday) {
    newConsec = (Number(f.consecutive_misses) || 0) + 1;
    newMult = (Number(f.multiplier) || 1) * 2;
  }

  const amountBefore = computeAmount(f.base_fine, f.multiplier);

  const { data: updated, error } = await supabase.from('consistency_fines').update({
    multiplier: newMult,
    consecutive_misses: newConsec,
    last_miss_date: missDate,
    last_paid: false,
    updated_at: new Date().toISOString()
  }).eq('id', f.id).select().maybeSingle();

  if (error) throw error;

  await supabase.from('consistency_fines_history').insert([{
    fine_id: updated.id, user_id, domain, event_type: 'miss', amount_before: amountBefore,
    amount_after: computeAmount(updated.base_fine, updated.multiplier),
    multiplier_before: f.multiplier, multiplier_after: updated.multiplier,
    consecutive_before: f.consecutive_misses, consecutive_after: updated.consecutive_misses,
    note: `miss ${missDate}`
  }]);

  return updated;
}

export async function recordSuccess(userId, domain, baseFine = 10, successDate = todayStr()) {
  const f = await getOrCreateFine(userId, domain, baseFine);
  const amountBefore = computeAmount(f.base_fine, f.multiplier);
  let newMult = Number(f.multiplier) || 1;
  if (newMult > 1) newMult = Math.max(1, Math.floor(newMult / 2));

  const { data: updated, error } = await supabase.from('consistency_fines').update({
    multiplier: newMult,
    consecutive_misses: 0,
    updated_at: new Date().toISOString()
  }).eq('id', f.id).select().maybeSingle();

  if (error) throw error;

  await supabase.from('consistency_fines_history').insert([{
    fine_id: updated.id, user_id, domain, event_type: 'reduced', amount_before: amountBefore,
    amount_after: computeAmount(updated.base_fine, updated.multiplier),
    multiplier_before: f.multiplier, multiplier_after: updated.multiplier,
    consecutive_before: f.consecutive_misses, consecutive_after: updated.consecutive_misses,
    note: `reduced ${successDate}`
  }]);

  return updated;
}

export async function markFinePaid(fineId, byUser = null) {
  const { data: before } = await supabase.from('consistency_fines').select('*').eq('id', fineId).maybeSingle();
  if (!before) throw new Error('fine not found');
  const amountBefore = computeAmount(before.base_fine, before.multiplier);

  const { data: updated, error } = await supabase.from('consistency_fines').update({
    last_paid: true,
    updated_at: new Date().toISOString()
  }).eq('id', fineId).select().maybeSingle();

  if (error) throw error;

  await supabase.from('consistency_fines_history').insert([{
    fine_id: fineId, user_id: updated.user_id, domain: updated.domain, event_type: 'paid',
    amount_before: amountBefore, amount_after: computeAmount(updated.base_fine, updated.multiplier),
    multiplier_before: before.multiplier, multiplier_after: updated.multiplier,
    consecutive_before: before.consecutive_misses, consecutive_after: before.consecutive_misses,
    note: `paid by ${byUser ?? updated.user_id}`
  }]);

  return updated;
}

export async function getFinesForUser(userId) {
  const { data, error } = await supabase.from('consistency_fines').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
