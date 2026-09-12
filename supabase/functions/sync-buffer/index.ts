// supabase/functions/sync-buffer/index.ts
// Robust, multi-platform Buffer GraphQL API integration.
// Features: Instant Publish (shareNow) & Scheduled Broadcast (customScheduled / dueAt),
// Auto-adaptive per-platform truncation (Twitter 280, Threads 500, IG/FB 2196/5000),
// Instagram post/feed metadata injection, Facebook post type injection,
// and Content Calendar querying.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const BUFFER_GRAPHQL_URL = "https://api.buffer.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { admin: null, user: null, message: "Missing authorization token" };

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { admin: null, user: null, message: "Unauthorized" };

  const { data: adm } = await admin.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!adm) return { admin: null, user: null, message: "Not an admin" };

  return { admin, user: data.user, message: "" };
}

function getBufferTokens(): string[] {
  const raw = [
    Deno.env.get("BUFFER_ACCESS_TOKEN"),
    Deno.env.get("BUFFER_ACCESS_TOKENS"),
    Deno.env.get("BUFFER_ACCESS_TOKEN_1"),
    Deno.env.get("BUFFER_ACCESS_TOKEN_2"),
  ];
  const list = raw
    .filter(Boolean)
    .flatMap((s) => s!.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

async function queryBuffer(token: string, query: string, variables: any = {}) {
  const res = await fetch(BUFFER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  return await res.json();
}

// Adaptive text trimmer ensuring clean boundaries for strict platforms
function adaptTextForPlatform(text: string, service: string): string {
  if (!text) return "";
  const s = service.toLowerCase();

  let maxLen = 5000;
  if (s === "twitter" || s === "x") maxLen = 280;
  else if (s === "threads") maxLen = 500;
  else if (s === "instagram") maxLen = 2196;
  else if (s === "tiktok") maxLen = 2200;

  if (text.length <= maxLen) return text;

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls: string[] = text.match(urlRegex) || [];
  const primaryUrl = urls.length > 0 ? urls[urls.length - 1] : "";

  const hashtagRegex = /(#[a-zA-Z0-9_]+)/g;
  const hashtags: string[] = text.match(hashtagRegex) || [];
  const mainTag = hashtags.includes("#MainraGames") ? "#MainraGames" : (hashtags[0] || "");

  const preserveTrailer = [primaryUrl, mainTag].filter(Boolean).join(" ");
  const availableForBody = maxLen - preserveTrailer.length - 5;

  let body = text;
  if (preserveTrailer) {
    body = body.replace(primaryUrl, "").replace(mainTag, "").trim();
  }

  if (body.length > availableForBody) {
    body = body.slice(0, Math.max(10, availableForBody));
    const lastSpace = body.lastIndexOf(" ");
    if (lastSpace > 10) {
      body = body.slice(0, lastSpace);
    }
    body = body.trim() + "…";
  }

  return preserveTrailer ? `${body}\n${preserveTrailer}`.trim() : body.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const { admin, user, message } = await requireAdmin(req);
  if (!admin) return json(401, { message });

  const tokens = getBufferTokens();

  try {
    const payload = await req.json().catch(() => ({}));
    const action = payload.action || "get_profiles";

    // 1. Discover all channels from all connected Buffer accounts
    if (action === "get_profiles") {
      if (tokens.length === 0) {
        return json(200, {
          configured: false,
          profiles: [],
          message: "BUFFER_ACCESS_TOKEN belum disetel di Supabase Secrets.",
        });
      }

      let allProfiles = [];
      for (const [idx, tok] of tokens.entries()) {
        try {
          const accRes = await queryBuffer(tok, `query GetAccount { account { id email organizations { id name } } }`);
          const orgs = accRes?.data?.account?.organizations || [];
          const accountEmail = accRes?.data?.account?.email || `Buffer Account #${idx + 1}`;

          for (const org of orgs) {
            const chRes = await queryBuffer(tok, `query GetChannels($input: ChannelsInput!) {
              channels(input: $input) {
                id
                name
                service
                avatar
              }
            }`, { input: { organizationId: org.id } });

            const channels = chRes?.data?.channels || [];
            for (const c of channels) {
              allProfiles.push({
                id: c.id,
                service: c.service,
                formatted_service: c.service ? c.service.charAt(0).toUpperCase() + c.service.slice(1) : "Social",
                service_username: c.name || c.id,
                avatar: c.avatar,
                account_email: accountEmail,
                token_index: idx,
              });
            }
          }
        } catch (err) {
          console.error(`Error querying Buffer token #${idx + 1}:`, err);
        }
      }

      return json(200, {
        configured: true,
        profiles: allProfiles,
        total_accounts: tokens.length,
      });
    }

    // 2. Publish OR Schedule post via Buffer GraphQL API
    if (action === "publish") {
      const { title, text, imageUrl, targetLink, profileIds, scheduleTime } = payload;
      if (!text || !text.trim()) {
        return json(400, { message: "Teks postingan tidak boleh kosong." });
      }

      const isScheduled = Boolean(scheduleTime && scheduleTime.trim());
      let scheduledIso: string | null = null;
      if (isScheduled) {
        try {
          const d = new Date(scheduleTime);
          if (!isNaN(d.getTime())) {
            scheduledIso = d.toISOString();
          }
        } catch (_) {}
      }

      let bufferResults = [];
      if (tokens.length > 0 && Array.isArray(profileIds) && profileIds.length > 0) {
        // Map channelId to owning token and service
        const channelTokenMap = new Map();
        const channelServiceMap = new Map();

        for (const tok of tokens) {
          try {
            const accRes = await queryBuffer(tok, `query GetAccount { account { organizations { id } } }`);
            const orgs = accRes?.data?.account?.organizations || [];
            for (const org of orgs) {
              const chRes = await queryBuffer(tok, `query GetChannels($input: ChannelsInput!) {
                channels(input: $input) { id service }
              }`, { input: { organizationId: org.id } });
              const chs = chRes?.data?.channels || [];
              for (const c of chs) {
                channelTokenMap.set(c.id, tok);
                channelServiceMap.set(c.id, (c.service || "").toLowerCase());
              }
            }
          } catch (e) {
            console.error("Error building channel maps:", e);
          }
        }

        for (const pid of profileIds) {
          const tok = channelTokenMap.get(pid) || tokens[0];
          const service = channelServiceMap.get(pid) || "generic";

          // Adapt text per platform rules
          const tailoredText = adaptTextForPlatform(text, service);

          let postInput: any = {
            channelId: pid,
            text: tailoredText,
            schedulingType: "automatic",
            mode: isScheduled && scheduledIso ? "customScheduled" : "shareNow",
          };

          if (isScheduled && scheduledIso) {
            postInput.dueAt = scheduledIso;
          }

          if (imageUrl && imageUrl.trim()) {
            postInput.assets = [{ image: { url: imageUrl.trim() } }];
          }

          // Metadata rules
          postInput.metadata = {};
          if (service === "facebook") {
            postInput.metadata.facebook = { type: "post" };
          } else if (service === "instagram") {
            postInput.metadata.instagram = { type: "post", shouldShareToFeed: true };
          } else if (service === "threads") {
            postInput.metadata.threads = { type: "post" };
          }

          if (Object.keys(postInput.metadata).length === 0) {
            delete postInput.metadata;
          }

          const mutation = `mutation CreatePost($input: CreatePostInput!) {
            createPost(input: $input) {
              ... on PostActionSuccess {
                post {
                  id
                  status
                  dueAt
                }
              }
              ... on MutationError {
                message
              }
            }
          }`;

          try {
            const mRes = await queryBuffer(tok, mutation, { input: postInput });
            const success = mRes?.data?.createPost?.post;
            const errMsg = mRes?.data?.createPost?.message || mRes?.errors?.[0]?.message;

            bufferResults.push({
              channel_id: pid,
              service: service,
              text_used: tailoredText,
              char_count: tailoredText.length,
              status: success ? "success" : "failed",
              post_id: success?.id || null,
              scheduled_due: success?.dueAt || scheduledIso || null,
              message: errMsg || (success ? (isScheduled ? "Terjadwal di Buffer" : "Published successfully") : "Unknown error"),
            });
          } catch (e: any) {
            bufferResults.push({
              channel_id: pid,
              service: service,
              status: "failed",
              message: e.message,
            });
          }
        }
      }

      // Record in Supabase social_broadcasts
      const statusValue = isScheduled ? "scheduled" : "published";
      const { data: saved, error: saveErr } = await admin.from("social_broadcasts").insert([{
        title: title || text.slice(0, 50),
        content: text,
        image_url: imageUrl || null,
        target_link: targetLink || null,
        channels: profileIds || [],
        buffer_updates: bufferResults,
        status: statusValue,
        scheduled_at: scheduledIso,
        published_at: isScheduled ? null : new Date().toISOString(),
        created_by: user.id,
      }]).select().single();

      if (saveErr) {
        return json(500, { message: `Gagal mencatat di database: ${saveErr.message}`, bufferResults });
      }

      const successCount = bufferResults.filter((r: any) => r.status === "success").length;
      return json(200, {
        message: isScheduled
          ? `Berhasil dijadwalkan tayang pada ${new Date(scheduledIso!).toLocaleString("id-ID")} (${successCount}/${bufferResults.length} channel terhubung)! 📅`
          : `Diproses: ${successCount} berhasil dari ${bufferResults.length} channel!`,
        broadcast: saved,
        bufferResults,
      });
    }

    return json(400, { message: `Action '${action}' tidak dikenal.` });
  } catch (err: any) {
    return json(500, { message: `Internal server error: ${err.message}` });
  }
});
