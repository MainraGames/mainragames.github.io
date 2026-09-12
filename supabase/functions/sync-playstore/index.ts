// supabase/functions/sync-playstore/index.ts
// Scrapes the Mainra Games developer page and upserts games into Supabase.
// Called from the admin dashboard ("Sync from Play Store") with the admin JWT.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import gplayMod from "npm:google-play-scraper@10.1.3";

const gplay: any = (gplayMod as any).default ?? gplayMod;
const DEVELOPER_ID = "6814346565652097883";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { admin: null, message: "Unauthorized" };
  const { data: adm } = await admin.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!adm) return { admin: null, message: "Not an admin" };
  return { admin, message: "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type,x-client-info",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  }

  const { admin, message } = await requireAdmin(req);
  if (!admin) return json(401, { message });

  try {
    let apps: any[] = [];
    const devFn = gplay.dev || gplay.developer;
    if (typeof devFn === "function") {
      apps = await devFn({ devId: DEVELOPER_ID, lang: "en", country: "us", fullDetail: true });
    } else if (typeof gplay.list === "function") {
      apps = await gplay.list({ num: 60, fullDetail: true });
      apps = apps.filter((a: any) => a.developerId === DEVELOPER_ID || a.developer === "Mainra Games");
    }
    if (!apps || apps.length === 0) return json(502, { message: "No apps found on developer page" });

    const rows = apps.map((app: any, i: number) => ({
      id: app.appId,
      title: app.title,
      description: app.summary || app.description || "",
      image: app.icon || (app.screenshots && app.screenshots[0]) || "",
      screenshots: app.screenshots || [],
      playLink: app.url || `https://play.google.com/store/apps/details?id=${app.appId}`,
      category: app.genre || "Casual",
      status: "Released",
      releaseDate: app.updated ? new Date(app.updated).toISOString().split("T")[0] : null,
      featured: i < 3,
      platform: "Android",
      rating: typeof app.score === "number" ? app.score : null,
      installs: app.installs || null,
      appId: app.appId,
      sort_order: i,
    }));

    // Do not let scraping overwrite admin-managed fields on existing rows.
    const { data: existing } = await admin.from("games").select("id,featured,sort_order");
    const existingById = new Map((existing || []).map((g: any) => [g.id, g]));
    for (const row of rows) {
      const prev: any = existingById.get(row.id);
      if (prev) {
        row.featured = prev.featured;
        row.sort_order = prev.sort_order;
      }
    }

    // Merge only content fields; admin-owned columns (featured, sort_order)
    // are set on insert and left untouched on updates.
    const { error } = await admin
      .from("games")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: false });
    if (error) return json(500, { message: "DB write failed: " + error.message });

    return json(200, { message: `Synced ${rows.length} games from Play Store`, count: rows.length });
  } catch (err) {
    return json(500, { message: String((err as Error).message || err) });
  }
});
