// supabase/functions/ai-social-assistant/index.ts
// AI assistant for social media posts powered by Google Gemini API.
// Supports dynamic API key input from client or Supabase Secrets / Settings.
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

  try {
    const payload = await req.json().catch(() => ({}));
    const action = payload.action || "generate";

    // Retrieve Gemini API Key with priority:
    // 1. Explicit key sent from dashboard client (saved in browser/form)
    // 2. Stored key in public.site_settings (key: 'gemini_api_key')
    // 3. Environment Secret GEMINI_API_KEY
    let geminiKey = (payload.apiKey || "").trim();

    if (!geminiKey) {
      const { data: settingRow } = await admin
        .from("site_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .maybeSingle();
      if (settingRow && settingRow.value) {
        geminiKey = typeof settingRow.value === "string" ? settingRow.value : settingRow.value.key || "";
      }
    }

    if (!geminiKey) {
      geminiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();
    }

    // Action: Save API key to site_settings so all admins can use it
    if (action === "save_key") {
      const newKey = (payload.newKey || "").trim();
      if (!newKey) {
        return json(400, { message: "API key tidak boleh kosong." });
      }
      const { error: upsertErr } = await admin.from("site_settings").upsert({
        key: "gemini_api_key",
        value: newKey,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      if (upsertErr) return json(500, { message: upsertErr.message });
      return json(200, { message: "Gemini API Key berhasil disimpan ke sistem! ✓" });
    }

    // Action: Test Model Connection
    if (action === "test") {
      if (!geminiKey) {
        return json(400, { message: "Gemini API Key belum diisi. Masukkan API key terlebih dahulu." });
      }

      const modelName = payload.model || "gemini-1.5-flash";
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      const res = await fetch(testUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Ketik 'OK' jika koneksi berhasil." }] }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return json(res.status, { message: `Gagal terhubung ke Gemini API (${res.status}): ${errText}` });
      }

      const testData = await res.json();
      const reply = testData?.candidates?.[0]?.content?.parts?.[0]?.text || "OK";

      return json(200, {
        message: `Koneksi ke model ${modelName} berhasil! Respon: "${reply.trim()}"`,
        model: modelName,
      });
    }

    // Action: Generate Post Content
    if (action === "generate") {
      if (!geminiKey) {
        return json(400, {
          message: "Gemini API Key belum dikonfigurasi. Masukkan API key Anda di panel pengaturan AI.",
        });
      }

      const { gameTitle, topic, tone, targetLink, customPrompt } = payload;
      const modelName = payload.model || "gemini-1.5-flash";

      const systemInstruction = `Kamu adalah Social Media Manager & Copywriter profesional untuk studio game indie "Mainra Games".
Tugasmu adalah menulis postingan media sosial yang menarik, kreatif, dan mengundang interaksi pemain (engagement) untuk Facebook, Twitter/X, Instagram, Threads, dan TikTok.
Tulis teks yang padat, penuh energi, gunakan emoji yang relevan, serta sertakan hashtag resmi studio seperti #MainraGames #IndieGame #GameDev #AndroidGames.
Sertakan call-to-action (CTA) yang jelas agar pembaca mendownload atau mencoba game.`;

      const userPrompt = `Game: ${gameTitle || "Game Mainra Games"}
Topik / Pesan: ${topic || "Pemberitahuan update game terbaru dan ajakan bermain"}
Tone of voice: ${tone || "Antusias, ramah komunitas gamer, kasual"}
Link Tujuan: ${targetLink || "https://mainragames.com"}
${customPrompt ? `Catatan Tambahan: ${customPrompt}` : ""}

Format Output JSON persis seperti ini (hanya JSON, tanpa markdown formatting backtick):
{
  "title": "Judul singkat untuk berita web",
  "caption": "Teks caption lengkap dengan emoji, link, dan hashtag",
  "hashtags": ["#MainraGames", "#IndieGame"]
}`;

      const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      const res = await fetch(genUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: systemInstruction + "\n\n" + userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return json(res.status, { message: `Gemini API error (${res.status}): ${errText}` });
      }

      const genData = await res.json();
      const rawOutput = genData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Clean markdown code fence if returned
      const cleanJson = rawOutput.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      let parsed = null;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        parsed = {
          title: `Update Seru ${gameTitle || "Mainra Games"}`,
          caption: rawOutput.trim(),
        };
      }

      return json(200, {
        success: true,
        result: parsed,
      });
    }

    return json(400, { message: `Aksi '${action}' tidak dikenali.` });
  } catch (err: any) {
    return json(500, { message: `Internal server error: ${err.message}` });
  }
});
