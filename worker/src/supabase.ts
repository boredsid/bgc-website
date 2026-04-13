import { createClient } from '@supabase/supabase-js';

export function getSupabase(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
