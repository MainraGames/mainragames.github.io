/**
 * Supabase client initialization for Mainra Games.
 *
 * Load this AFTER the supabase-js CDN script.
 * It reads the project URL and anon key from global config
 * set in each HTML page's <head>.
 *
 * After loading, window.supabaseClient is a ready Supabase client.
 * Example usage:
 *   const { data, error } = await window.supabaseClient.from('games').select('*');
 */
(function () {
  var url = window.SUPABASE_URL || '';
  var key = window.SUPABASE_ANON_KEY || '';

  if (!url || !key) {
    console.warn(
      '[supabase-client] SUPABASE_URL or SUPABASE_ANON_KEY is not set. ' +
      'Add them as global variables in your HTML <head> before this script loads.'
    );
    return;
  }

  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    console.error(
      '[supabase-client] Supabase JS library not loaded. ' +
      'Include the CDN script before this file.'
    );
    return;
  }

  window.supabaseClient = window.supabase.createClient(url, key);
  console.log('[supabase-client] Supabase client initialized.');
})();
