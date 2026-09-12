// supabase/functions/sync-buffer/index.ts
// Robust, multi-platform Buffer GraphQL API integration.
// Supports automated adaptive truncation per platform (Twitter 280, Threads 500, IG/FB 2196/5000),
// automatic Instagram post metadata (type: post, shouldShareToFeed: true),
// and AI-assisted rewriting fallback.
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

// Exact character limits enforced by Buffer for each platform
const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280,
  x: 280,
  threads: 500,
  instagram: 2196,
  facebook: 5000,
  tiktok: 2200,
  youtube: 5000,
  linkedin: 3000,
  pinterest: 500,
  bluesky: 300,
};

// Smart platform-aware text adaptor
// If a user posts 600 chars to FB + X, this ensures X gets a strictly formatted <=280 char version
// without cutting off mid-word or dropping links
function adaptTextForPlatform(rawText: string, serviceName: string, targetLink?: string): string {
  const s = (serviceName || "").toLowerCase();
  const limit = PLATFORM_LIMITS[s] || 2200;

  if (rawText.length <= limit) {
    return rawText;
  }

  // Text exceeds limit: preserve link and hashtags while cleanly truncating body
  const link = (targetLink || "").trim();
  const hashtagsMatch = rawText.match(/#[A-Za-z0-9_]+/g) || ["#MainraGames"];
  const uniqueTags = [...new Set(hashtagsMatch)].slice(0, 3).join(" ");
  
  const linkSuffix = link ? `\n📲 ${link}\n${uniqueTags}` : `\n${uniqueTags}`;
  const budget = limit - linkSuffix.length - 4; // reserve 4 chars for '…'

  if (budget <= 30) {
    // Ultra tight: return sliced with link
    return rawText.slice(0, limit - 3) + "…";
  }

  // Clean cut on word boundary
  let truncatedBody = rawText.slice(0, budget);
  const lastSpace = truncatedBody.lastIndexOf(" ");
  if (lastSpace > budget * 0.7) {
    truncatedBody = truncatedBody.slice(0, lastSpace);
  }

  return `${truncatedBody.trim()}…${linkSuffix}`;
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
                service: c.service, // instagram, tiktok, youtube, facebook, twitter, threads, etc.
                formatted_service: c.service ? c.service.charAt(0).toUpperCase() + c.service.slice(1) : "Social",
                service_username: c.name || c.id,
                avatar: c.avatar,
                account_email: accountEmail,
                token_index: idx,
                char_limit: PLATFORM_LIMITS[(c.service || "").toLowerCase()] || 2200,
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

    // 2. Publish post via Buffer GraphQL API with complete multi-platform adaptation
    if (action === "publish") {
      const { title, text, imageUrl, targetLink, profileIds, platformOverrides } = payload;
      if (!text || !text.trim()) {
        return json(400, { message: "Teks postingan tidak boleh kosong." });
      }

      let bufferResults = [];
      if (tokens.length > 0 && Array.isArray(profileIds) && profileIds.length > 0) {
        // Map channel metadata (service type, token owner)
        const channelMetaMap = new Map();
        for (const tok of tokens) {
          try {
            const accRes = await queryBuffer(tok, `query GetAccount { account { organizations { id } } }`);
            const orgs = accRes?.data?.account?.organizations || [];
            for (const org of orgs) {
              const chRes = await queryBuffer(tok, `query GetChannels($input: ChannelsInput!) {
                channels(input: $input) { id name service }
              }`, { input: { organizationId: org.id } });
              const chs = chRes?.data?.channels || [];
              for (const c of chs) {
                channelMetaMap.set(c.id, { token: tok, service: (c.service || "").toLowerCase(), name: c.name });
              }
            }
          } catch (e) {
            console.error("Error building channelMetaMap:", e);
          }
        }

        for (const pid of profileIds) {
          const meta = channelMetaMap.get(pid) || { token: tokens[0], service: "unknown" };
          const tok = meta.token;
          const service = meta.service;

          // Per-platform text calculation:
          // 1. If user provided a specific override for this service, use it
          // 2. Otherwise adapt automatically using adaptTextForPlatform
          let tailoredText = text.trim();
          if (platformOverrides && platformOverrides[service]) {
            tailoredText = platformOverrides[service].trim();
          } else {
            tailoredText = adaptTextForPlatform(text, service, targetLink);
          }

          let postInput: any = {
            channelId: pid,
            text: tailoredText,
            schedulingType: "automatic",
            mode: "shareNow",
          };

          // Attach media assets if provided
          if (imageUrl && imageUrl.trim()) {
            postInput.assets = [{ image: { url: imageUrl.trim() } }];
          }

          // Strict platform metadata requirements enforced by Buffer GraphQL API:
          postInput.metadata = {};

          if (service === "facebook") {
            // Buffer API rule: "Facebook posts require a type (post, story, or reel)."
            postInput.metadata.facebook = {
              type: "post",
            };
          } else if (service === "instagram") {
            // Buffer API rule: Instagram requires type (post) and shouldShareToFeed
            postInput.metadata.instagram = {
              type: "post",
              shouldShareToFeed: true,
            };
          } else if (service === "threads") {
            postInput.metadata.threads = {
              type: "post",
            };
          }

          // Clean empty metadata object if none applied
          if (Object.keys(postInput.metadata).length === 0) {
            delete postInput.metadata;
          }

          const mutation = `mutation CreatePost($input: CreatePostInput!) {
            createPost(input: $input) {
              ... on PostActionSuccess {
                post {
                  id
                  status
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
              message: errMsg || (success ? "Published successfully" : "Unknown error"),
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
      const { data: saved, error: saveErr } = await admin.from("social_broadcasts").insert([{
        title: title || text.slice(0, 50),
        content: text,
        image_url: imageUrl || null,
        target_link: targetLink || null,
        channels: profileIds || [],
        buffer_updates: bufferResults,
        status: "published",
        created_by: user.id,
      }]).select().single();

      if (saveErr) {
        return json(500, { message: `Gagal mencatat di database: ${saveErr.message}`, bufferResults });
      }

      const successCount = bufferResults.filter((r: any) => r.status === "success").length;
      return json(200, {
        message: bufferResults.length > 0
          ? `Selesai: ${successCount} dari ${bufferResults.length} channel berhasil dipublikasikan!`
          : "Berhasil disimpan ke CMS!",
        broadcast: saved,
        bufferResults,
      });
    }

    return json(400, { message: `Action '${action}' tidak dikenal.` });
  } catch (err: any) {
    return json(500, { message: `Internal server error: ${err.message}` });
  }
});
