const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isSupabaseConfigured = Boolean(supabaseUrl && serviceRoleKey);

const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

if (!isSupabaseConfigured) {
  console.warn("[Supabase] Nao configurado. O historico em nuvem ficara desativado.");
}

module.exports = {
  supabase,
  isSupabaseConfigured
};
