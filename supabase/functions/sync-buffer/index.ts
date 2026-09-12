// supabase/functions/sync-buffer/index.ts
// Handles Buffer social media posting & profile discovery for Mainra Games.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const { admin, user, message } = await requireAdmin(req);
  if (!admin) return json(401, { message });

  const bufferToken = (Deno.env.get("BUFFER_ACCESS_TOKEN") || "").trim();

  try {
    const payload = await req.json().catch(() => ({}));
    const action = payload.action || "get_profiles";

    // 1. Get connected Buffer channels / profiles
    if (action === "get_profiles") {
      if (!bufferToken) {
        return json(200, {
          configured: false,
          profiles: [],
          message: "BUFFER_ACCESS_TOKEN belum disetel di Supabase Secrets.",
        });
      }

      const res = await fetch("https://api.bufferapp.com/1/profiles.json", {
        headers: { Authorization: `Bearer ${bufferToken}` },
      });

      if (!res.ok) {
        const err = await res.text();
        return json(res.status, {
          configured: true,
          profiles: [],
          message: `Buffer API error: ${err}`,
        });
      }

      const profiles = await res.json();
      const mapped = (profiles || []).map((p: any) => ({
        id: p.id,
        service: p.service, // facebook, twitter, instagram, linkedin, etc.
        formatted_service: p.formatted_service,
        service_username: p.service_username || p.service_name || p.id,
        avatar: p.avatar,
        schedules: p.schedules || [],
      }));

      return json(200, {
        configured: true,
        profiles: mapped,
      });
    }

    // 2. Publish a new update to Buffer and record into social_broadcasts
    if (action === "publish") {
      const { title, text, imageUrl, targetLink, profileIds } = payload;
      if (!text || !text.trim()) {
        return json(400, { message: "Teks postingan tidak boleh kosong." });
      }

      let bufferResults = [];
      if (bufferToken && Array.isArray(profileIds) && profileIds.length > 0) {
        for (const pid of profileIds) {
          const bodyParams = new URLSearchParams();
          bodyParams.append("profile_ids[]", pid);
          bodyParams.append("text", text);
          bodyParams.append("now", "true"); // broadcast immediately

          if (imageUrl && imageUrl.trim()) {
            bodyParams.append("media[photo]", imageUrl.trim());
          }
          if (targetLink && targetLink.trim()) {
            bodyParams.append("media[link]", targetLink.trim());
          }

          const bRes = await fetch("https://api.bufferapp.com/1/updates/create.json", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bufferToken}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: bodyParams.toString(),
          });

          const bData = await bRes.json().catch(() => ({}));
          bufferResults.push({
            profile_id: pid,
            status: bRes.ok ? "success" : "failed",
            response: bData,
          });
        }
      }

      // Save to Supabase social_broadcasts table
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
        return json(500, { message: `Gagal menyimpan ke database: ${saveErr.message}`, bufferResults });
      }

      return json(200, {
        message: bufferResults.length > 0 ? "Berhasil diposting ke Buffer dan disimpan ke CMS!" : "Berhasil disimpan ke CMS!",
        broadcast: saved,
        bufferResults,
      });
    }

    return json(400, { message: `Action '${action}' tidak dikenal.` });
  } catch (err: any) {
    return json(500, { message: `Internal server error: ${err.message}` });
  }
});
