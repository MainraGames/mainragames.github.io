// supabase/functions/ai-social-assistant/index.ts
// AI assistant for social media posts powered by Google Gemini API.
// Robust JSON response parsing with responseSchema, responseMimeType, and heuristic regex recovery.
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

// Resilient parsing to guarantee clean { title, caption, hashtags }
function extractStructuredPost(rawText: string, defaultGameTitle: string) {
  if (!rawText) {
    return {
      title: `Update Seru ${defaultGameTitle || "Mainra Games"}`,
      caption: "",
      hashtags: ["#MainraGames", "#IndieGame"],
    };
  }

  // 1. Strip markdown fences (```json ... ``` or ``` ... ```)
  let cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // 2. Try standard JSON.parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      let title = (parsed.title || "").trim();
      let caption = (parsed.caption || "").trim();
      let hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];

      // If caption somehow is empty but text or body exists
      if (!caption && parsed.text) caption = String(parsed.text).trim();
      if (!caption && parsed.body) caption = String(parsed.body).trim();

      if (title || caption) {
        return {
          title: title || `Update Seru ${defaultGameTitle || "Mainra Games"}`,
          caption: caption || rawText.trim(),
          hashtags,
        };
      }
    }
  } catch (_e) {
    // proceed to heuristic extraction
  }

  // 3. Fallback: Search for embedded JSON object { ... } via Regex
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && (parsed.title || parsed.caption)) {
        return {
          title: (parsed.title || `Update Seru ${defaultGameTitle || "Mainra Games"}`).trim(),
          caption: (parsed.caption || "").trim(),
          hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
        };
      }
    } catch (_e2) {
      // If incomplete or unclosed JSON string (cut off by token limit)
      // Extract "title": "..." and "caption": "..." manually
      const titleMatch = cleaned.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      const captionMatch = cleaned.match(/"caption"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);

      if (titleMatch || captionMatch) {
        const unescape = (str: string) => {
          try {
            return JSON.parse(`"${str}"`);
          } catch {
            return str.replace(/\\n/g, "\n").replace(/\\"/g, '"');
          }
        };

        const extractedTitle = titleMatch ? unescape(titleMatch[1]) : `Update Seru ${defaultGameTitle || "Mainra Games"}`;
        const extractedCaption = captionMatch ? unescape(captionMatch[1]) : "";

        if (extractedCaption) {
          return {
            title: extractedTitle.trim(),
            caption: extractedCaption.trim(),
            hashtags: ["#MainraGames", "#IndieGame"],
          };
        }
      }
    }
  }

  // 4. Ultimate fallback if model purely returned freeform text without JSON
  const lines = rawText.trim().split("\n").filter((l) => l.trim().length > 0);
  let fallbackTitle = `Update Seru ${defaultGameTitle || "Mainra Games"}`;
  let fallbackCaption = rawText.trim();

  if (lines.length > 1 && lines[0].length < 120) {
    fallbackTitle = lines[0].replace(/^[#*>\s]+/, "").trim();
    fallbackCaption = lines.slice(1).join("\n\n").trim();
  }

  return {
    title: fallbackTitle,
    caption: fallbackCaption,
    hashtags: ["#MainraGames", "#IndieGame"],
  };
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
      return json(200, { message: "Gemini API Key berhasil disimpan ke sistem! ✓" });
    }

    // Action: List supported text-generation models from Google API
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

      // Filter models that support generateContent
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

      // Priority ranking: Gemini 3.8/3.7/3.5/2.5/2.0
      textModels.sort((a: any, b: any) => {
        const getScore = (id: string) => {
          if (id === "gemini-3.8-flash") return 150;
          if (id === "gemini-3.7-flash") return 140;
          if (id === "gemini-3.6-flash") return 135;
          if (id === "gemini-3.5-flash") return 130;
          if (id === "gemini-3.1-pro-preview" || id === "gemini-3.1-pro") return 120;
          if (id === "gemini-3-flash-preview") return 115;
          if (id.includes("3.")) return 110;
          if (id === "gemini-2.5-flash") return 100;
          if (id === "gemini-2.5-pro") return 95;
          if (id === "gemini-2.0-flash") return 90;
          if (id === "gemini-2.0-flash-lite") return 85;
          if (id.includes("2.5")) return 80;
          if (id.includes("2.0")) return 70;
          if (id.includes("1.5")) return 50;
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

      let modelName = (payload.model || "gemini-3.8-flash").replace(/^models\//, "");
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
      let modelName = (payload.model || "gemini-3.8-flash").replace(/^models\//, "");

      const systemInstruction = `Kamu adalah Social Media Manager & Copywriter profesional untuk studio game indie "Mainra Games".
Tugasmu adalah menulis postingan media sosial yang menarik, kreatif, dan mengundang interaksi pemain (engagement) untuk Facebook, Twitter/X, Instagram, Threads, dan TikTok.
Tulis teks yang padat, penuh energi, gunakan emoji yang relevan, serta sertakan hashtag resmi studio seperti #MainraGames #IndieGame #GameDev #AndroidGames.
Sertakan call-to-action (CTA) yang jelas agar pembaca mendownload atau mencoba game di Google Play Store.`;

      const userPrompt = `Game: ${gameTitle || "Game Mainra Games"}
Topik / Pesan: ${topic || "Pemberitahuan update game terbaru dan ajakan bermain"}
Tone of voice: ${tone || "Antusias, ramah komunitas gamer, kasual"}
Link Tujuan: ${targetLink || "https://mainragames.com"}
${customPrompt ? `Catatan Tambahan: ${customPrompt}` : ""}

Keluarkan HANYA dokumen JSON dengan schema berikut:
{
  "title": "Judul singkat untuk pengumuman website (maksimal 70 karakter)",
  "caption": "Teks postingan media sosial lengkap dengan emoji, call-to-action link, dan hashtag",
  "hashtags": ["#MainraGames", "#IndieGame"]
}`;

      const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      // Enforce responseMimeType: "application/json" and schema for guaranteed structured output
      const requestBody: any = {
        contents: [
          {
            role: "user",
            parts: [{ text: systemInstruction + "\n\n" + userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1200,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              caption: { type: "STRING" },
              hashtags: {
                type: "ARRAY",
                items: { type: "STRING" },
              },
            },
            required: ["title", "caption"],
          },
        },
      };

      let res = await fetch(genUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      // If model does not support responseSchema (some experimental models), retry without responseSchema but keep responseMimeType
      if (!res.ok && res.status === 400) {
        delete requestBody.generationConfig.responseSchema;
        res = await fetch(genUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        return json(res.status, { message: `Gemini API error (${res.status}): ${errText}` });
      }

      const genData = await res.json();
      const rawOutput = genData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Bulletproof extraction guaranteeing title and caption are cleanly separated
      const finalResult = extractStructuredPost(rawOutput, gameTitle);

      return json(200, {
        success: true,
        modelUsed: modelName,
        result: finalResult,
      });
    }

    // Action: AI Auto-Fit / Adapt Text for Specific Social Media Character Limits
    if (action === "adapt_limits") {
      if (!geminiKey) {
        return json(400, { message: "Gemini API Key belum dikonfigurasi." });
      }

      const { text, targetLimit, platform } = payload;
      if (!text || !text.trim()) {
        return json(400, { message: "Teks tidak boleh kosong." });
      }

      const limit = Number(targetLimit) || 280;
      let modelName = (payload.model || "gemini-3.8-flash").replace(/^models\//, "");

      const adaptPrompt = `Kamu adalah Social Media Editor profesional.
Tugasmu adalah memadatkan dan menulis ulang postingan berikut agar panjangnya MAKSIMAL ${limit} KARAKTER untuk platform ${platform || "Twitter/X dan Threads"}.

Syarat WAJIB:
1. Total panjang caption akhir HARUS KURANG DARI ATAU SAMA DENGAN ${limit} karakter (sangat ketat!).
2. Pertahankan pesan inti, antusiasme, link, dan minimal 1 hashtag penting (#MainraGames).
3. Buang kata-kata bertele-tele dan gunakan emoji secara efisien.

Teks Asli:
"""${text.trim()}"""

Keluarkan HANYA JSON murni dengan format:
{
  "caption": "Teks hasil pemadatan di bawah ${limit} karakter",
  "charCount": 123
}`;

      const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      const reqBody: any = {
        contents: [{ role: "user", parts: [{ text: adaptPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 600,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              caption: { type: "STRING" },
              charCount: { type: "INTEGER" },
            },
            required: ["caption"],
          },
        },
      };

      let res = await fetch(genUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok && res.status === 400) {
        delete reqBody.generationConfig.responseSchema;
        res = await fetch(genUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
      }

      if (!res.ok) {
        const errTxt = await res.text();
        return json(res.status, { message: `Gemini API error (${res.status}): ${errTxt}` });
      }

      const data = await res.json();
      const rawRes = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let adaptedCaption = text;
      try {
        const p = JSON.parse(rawRes.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
        if (p.caption) adaptedCaption = p.caption.trim();
      } catch {
        adaptedCaption = rawRes.trim();
      }

      return json(200, {
        success: true,
        caption: adaptedCaption,
        charCount: adaptedCaption.length,
        modelUsed: modelName,
      });
    }

    return json(400, { message: `Aksi '${action}' tidak dikenali.` });
  } catch (err: any) {
    return json(500, { message: `Internal server error: ${err.message}` });
  }
});
