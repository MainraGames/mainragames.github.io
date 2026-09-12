// supabase/functions/ai-social-assistant/index.ts
// AI assistant for social media posts powered by Google Gemini API.
// Features: Dynamic Model Listing from Google API, Model Connectivity Test,
// Post Generation with multi-tone presets, and secure key persistence.
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

    // 1. Resolve Gemini API Key with hierarchy:
    // a. Explicit key sent from dashboard client
    // b. Stored key in public.site_settings (key: 'gemini_api_key')
    // c. Supabase secret GEMINI_API_KEY
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

    // Action: Save API key to site_settings
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
      return json(200, { message: "Gemini API Key berhasil disimpan ke database CMS! ✓" });
    }

    // Action: Fetch Key Status (checks if a key is already configured)
    if (action === "get_status") {
      return json(200, {
        hasKey: Boolean(geminiKey),
        maskedKey: geminiKey ? (geminiKey.slice(0, 4) + "••••••••" + geminiKey.slice(-4)) : null,
      });
    }

    // Action: List Available Models dynamically from Google Gemini API
    if (action === "list_models") {
      if (!geminiKey) {
        return json(400, { message: "API key belum diisi. Masukkan API key untuk mengambil daftar model." });
      }

      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=100`;
      const res = await fetch(listUrl);

      if (!res.ok) {
        const errText = await res.text();
        return json(res.status, {
          message: `Gagal mengambil daftar model dari Google API (${res.status}): ${errText}`,
        });
      }

      const listData = await res.json();
      const rawModels = listData.models || [];

      // Filter models that support content generation (exclude embeddings, etc.)
      const textModels = rawModels
        .filter((m: any) => {
          const methods = m.supportedGenerationMethods || [];
          return methods.includes("generateContent");
        })
        .map((m: any) => {
          const rawId = m.name.replace(/^models\//, "");
          return {
            id: rawId,
            name: m.name,
            displayName: m.displayName || rawId,
            description: m.description || "",
            inputTokenLimit: m.inputTokenLimit,
            outputTokenLimit: m.outputTokenLimit,
          };
        });

      // Priority ranking: prioritize modern 2.0 and 1.5 flash/pro models
      textModels.sort((a: any, b: any) => {
        const getScore = (id: string) => {
          if (id === "gemini-2.0-flash") return 100;
          if (id === "gemini-2.0-flash-lite" || id === "gemini-2.0-flash-lite-preview-02-05") return 95;
          if (id === "gemini-1.5-flash") return 90;
          if (id === "gemini-1.5-flash-latest") return 85;
          if (id === "gemini-1.5-pro") return 80;
          if (id === "gemini-1.5-pro-latest") return 75;
          if (id.includes("2.0")) return 70;
          if (id.includes("1.5")) return 60;
          return 10;
        };
        return getScore(b.id) - getScore(a.id);
      });

      return json(200, {
        models: textModels,
        total: textModels.length,
      });
    }

    // Action: Test Model Connection
    if (action === "test") {
      if (!geminiKey) {
        return json(400, { message: "Gemini API Key belum diisi. Masukkan API key terlebih dahulu." });
      }

      let modelName = (payload.model || "gemini-2.0-flash").replace(/^models\//, "");
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      const res = await fetch(testUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Respond only with 'OK' if you can read this." }] }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return json(res.status, { message: `Gagal terhubung ke Gemini (${res.status}): ${errText}` });
      }

      const testData = await res.json();
      const reply = testData?.candidates?.[0]?.content?.parts?.[0]?.text || "OK";

      return json(200, {
        message: `Koneksi ke model '${modelName}' sukses! Respon Google: "${reply.trim()}"`,
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
      let modelName = (payload.model || "gemini-2.0-flash").replace(/^models\//, "");

      const systemInstruction = `Kamu adalah Social Media Manager & Copywriter profesional untuk studio game indie "Mainra Games".
Tugasmu adalah menulis postingan media sosial yang menarik, kreatif, dan mengundang interaksi pemain (engagement) untuk Facebook, Twitter/X, Instagram, Threads, dan TikTok.
Tulis teks yang padat, penuh energi, gunakan emoji yang relevan, serta sertakan hashtag resmi studio seperti #MainraGames #IndieGame #GameDev #AndroidGames.
Sertakan call-to-action (CTA) yang jelas agar pembaca mendownload atau mencoba game di Google Play Store.`;

      const userPrompt = `Game: ${gameTitle || "Game Mainra Games"}
Topik / Pesan: ${topic || "Pemberitahuan update game terbaru dan ajakan bermain"}
Tone of voice: ${tone || "Antusias, ramah komunitas gamer, kasual"}
Link Tujuan: ${targetLink || "https://mainragames.com"}
${customPrompt ? `Catatan Tambahan: ${customPrompt}` : ""}

Format Output JSON persis seperti ini (hanya JSON murni, tanpa markdown formatting atau backtick):
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
            maxOutputTokens: 1000,
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
        modelUsed: modelName,
        result: parsed,
      });
    }

    return json(400, { message: `Aksi '${action}' tidak dikenali.` });
  } catch (err: any) {
    return json(500, { message: `Internal server error: ${err.message}` });
  }
});
