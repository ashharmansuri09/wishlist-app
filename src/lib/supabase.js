const { createClient } = require("@supabase/supabase-js");

let client;

// Server-only client. Secret key RLS bypass karti hai, isliye ye key kabhi browser/theme me nahi jaani chahiye.
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL ya SUPABASE_SECRET_KEY set nahi hai");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

module.exports = { getSupabase };
