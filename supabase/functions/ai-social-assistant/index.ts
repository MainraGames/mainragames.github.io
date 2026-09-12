// supabase/functions/ai-social-assistant/index.ts
// Robust AI assistant for social media posts powered by Google Gemini API.
// Features: Multi-Key Rolling, Auto-Model Probe, Thinking Budget Control,
// Pure Text Truncation and Adaptation without leaking JSON tokens.
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

// ─── Multi-Key Resolution ───────────────────────────────────────────
// site_settings.gemini_api_key can be:
//   - Legacy: a plain string "AIzaSy..."
//   - New: an array of objects [{key, label, status, lastChecked, isPrimary}]
// This function returns all valid keys in rolling order (primary first).

interface GeminiKeyEntry {
  key: string;
  label: string;
  status: string;      // "active" | "quota_exhausted" | "invalid" | "unchecked"
  lastChecked: string | null;
  isPrimary: boolean;
}

async function resolveGeminiKeys(admin: any, clientKey?: string): Promise<GeminiKeyEntry[]> {
  const keys: GeminiKeyEntry[] = [];

  // 1. If caller sends a key directly, prepend it
  if (clientKey) {
    keys.push({ key: clientKey, label: "Client-Provided", status: "unchecked", lastChecked: null, isPrimary: false });
  }

  // 2. Load from database
  const { data: settingRow } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", "gemini_api_key")
    .maybeSingle();

  if (settingRow && settingRow.value) {
    const val = settingRow.value;
    if (typeof val === "string") {
      // Legacy single key
      if (val.trim()) {
        keys.push({ key: val.trim(), label: "Default", status: "active", lastChecked: null, isPrimary: true });
      }
    } else if (Array.isArray(val)) {
      // New multi-key format
      // Sort: primary first, then by lastChecked (most recently checked first)
      const sorted = [...val].sort((a: any, b: any) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return 0;
      });
      for (const entry of sorted) {
        if (entry.key && entry.key.trim() && entry.status !== "invalid") {
          keys.push({
            key: entry.key.trim(),
            label: entry.label || "Key",
            status: entry.status || "unchecked",
            lastChecked: entry.lastChecked || null,
            isPrimary: !!entry.isPrimary,
          });
        }
      }
    }
  }

  // 3. Fallback to env var
  const envKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (envKey && !keys.some(k => k.key === envKey)) {
    keys.push({ key: envKey, label: "Environment", status: "active", lastChecked: null, isPrimary: false });
  }

  // Deduplicate by key value
  const seen = new Set<string>();
  return keys.filter(k => {
    if (seen.has(k.key)) return false;
    seen.add(k.key);
    return true;
  });
}

// Try calling Gemini with key rolling + model cascade
async function callGeminiWithRolling(
  keys: GeminiKeyEntry[],
  models: string[],
  requestBodyFn: (model: string) => any,
  fallbackBodyFn?: (model: string) => any
): Promise<{ data: any; model: string; keyLabel: string; error?: string }> {
  let lastError = "";

  for (const keyEntry of keys) {
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyEntry.key}`;
      try {
        let res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBodyFn(model)),
        });

        // If 400 (unsupported feature), retry with fallback body
        if (!res.ok && res.status === 400 && fallbackBodyFn) {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fallbackBodyFn(model)),
          });
        }

        if (res.ok) {
          const data = await res.json();
          return { data, model, keyLabel: keyEntry.label };
        }

        const errBody = await res.text();
        lastError = `[${keyEntry.label}] Model ${model} HTTP ${res.status}: ${errBody.slice(0, 200)}`;

        // If 429 (quota), skip this key entirely for remaining models
        if (res.status === 429) break;
        // If 403 (key invalid), skip this key entirely
        if (res.status === 403) break;
      } catch (e: any) {
        lastError = `[${keyEntry.label}] Model ${model} fetch: ${e.message || e}`;
      }
    }
  }

  return { data: null, model: "", keyLabel: "", error: lastError };
}

// ─── Caption Helpers ────────────────────────────────────────────────

function cleanCaptionText(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (s.startsWith("{") && s.includes('"caption"')) {
    try {
      const parsed = JSON.parse(s);
      if (parsed.caption) return String(parsed.caption).trim();
    } catch (_) {
      const m = s.match(/"caption"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (m) {
        try { return JSON.parse('"' + m[1] + '"').trim(); } catch (_) {
          return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
        }
      }
      const incomplete = s.match(/"caption"\s*:\s*"([\s\S]+)/i);
      if (incomplete) {
        let val = incomplete[1].replace(/"\s*\}?\s*$/, "");
        return val.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
      }
    }
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length > 2) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function extractStructuredPost(rawText: string, defaultGameTitle: string) {
  if (!rawText) {
    return { title: `Update Seru ${defaultGameTitle || "Mainra Games"}`, caption: "", hashtags: ["#MainraGames", "#IndieGame"] };
  }
  let cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      let title = (parsed.title || "").trim();
      let caption = (parsed.caption || "").trim();
      let hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
      if (!caption && parsed.text) caption = String(parsed.text).trim();
      if (!caption && parsed.body) caption = String(parsed.body).trim();
      if (title || caption) {
        return {
          title: title || `Update Seru ${defaultGameTitle || "Mainra Games"}`,
          caption: cleanCaptionText(caption || rawText.trim()),
          hashtags,
        };
      }
    }
  } catch (_e) {}
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && (parsed.title || parsed.caption)) {
        return {
          title: (parsed.title || `Update Seru ${defaultGameTitle || "Mainra Games"}`).trim(),
          caption: cleanCaptionText(parsed.caption || ""),
          hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
        };
      }
    } catch (_e2) {
      const titleMatch = cleaned.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      const captionMatch = cleaned.match(/"caption"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (titleMatch || captionMatch) {
        let extractedTitle = defaultGameTitle ? `Update Seru ${defaultGameTitle}` : "Update Seru Mainra Games";
        let extractedCaption = "";
        if (titleMatch) { try { extractedTitle = JSON.parse('"' + titleMatch[1] + '"'); } catch { extractedTitle = titleMatch[1]; } }
        if (captionMatch) { try { extractedCaption = JSON.parse('"' + captionMatch[1] + '"'); } catch { extractedCaption = captionMatch[1]; } }
        return { title: extractedTitle.trim(), caption: cleanCaptionText(extractedCaption.trim()), hashtags: ["#MainraGames", "#IndieGame"] };
      }
    }
  }
  return { title: `Update Seru ${defaultGameTitle || "Mainra Games"}`, caption: cleanCaptionText(cleaned), hashtags: ["#MainraGames", "#IndieGame"] };
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const { admin, user, message } = await requireAdmin(req);
  if (!admin) return json(401, { message });

  try {
    const payload = await req.json().catch(() => ({}));
    const action = payload.action || "generate";

    // Resolve client-provided key
    const clientKey = (
      payload.client_gemini_key || payload.client_token || payload.geminiKey || payload.clientApiKey || payload.apiKey || ""
    ).trim();

    // ── Action: save_keys (multi-key) ──────────────────────────────
    if (action === "save_keys") {
      const keysPayload = payload.keys; // Array of {key, label, isPrimary}
      if (!Array.isArray(keysPayload) || keysPayload.length === 0) {
        return json(200, { success: false, error: true, message: "Minimal 1 API key diperlukan." });
      }

      // Validate and format
      const formatted = keysPayload.map((k: any, i: number) => ({
        key: String(k.key || "").trim(),
        label: String(k.label || `Key ${i + 1}`).trim(),
        status: k.status || "unchecked",
        lastChecked: k.lastChecked || null,
        isPrimary: !!k.isPrimary,
      })).filter((k: any) => k.key.length > 0);

      if (formatted.length === 0) {
        return json(200, { success: false, error: true, message: "Tidak ada key yang valid." });
      }

      // Ensure exactly one primary
      const hasPrimary = formatted.some((k: any) => k.isPrimary);
      if (!hasPrimary) formatted[0].isPrimary = true;

      const { error: upsertErr } = await admin.from("site_settings").upsert({
        key: "gemini_api_key",
        value: formatted,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      if (upsertErr) return json(200, { success: false, error: true, message: upsertErr.message });
      return json(200, { success: true, keys: formatted, message: `${formatted.length} API Key berhasil disimpan! ✓` });
    }

    // ── Action: save_key (legacy single key — backward compat) ─────
    if (action === "save_key") {
      const newKey = (payload.newKey || "").trim();
      if (!newKey) return json(200, { success: false, error: true, message: "API key tidak boleh kosong." });

      // Migrate: load existing keys and add/update
      const keys = await resolveGeminiKeys(admin);
      const existing = keys.find(k => k.key === newKey);
      if (existing) {
        return json(200, { success: true, message: "Key sudah terdaftar." });
      }

      // Save as new format
      const newEntry = { key: newKey, label: "Default", status: "unchecked", lastChecked: null, isPrimary: keys.length === 0 };
      const allKeys = [...keys.filter(k => k.label !== "Client-Provided" && k.label !== "Environment"), newEntry];

      const { error: upsertErr } = await admin.from("site_settings").upsert({
        key: "gemini_api_key",
        value: allKeys,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      if (upsertErr) return json(200, { success: false, error: true, message: upsertErr.message });
      return json(200, { success: true, message: "Gemini API Key berhasil disimpan ke sistem! ✓" });
    }

    // ── Action: load_keys ──────────────────────────────────────────
    if (action === "load_keys") {
      const { data: settingRow } = await admin
        .from("site_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .maybeSingle();

      if (!settingRow || !settingRow.value) {
        return json(200, { success: true, keys: [], message: "Belum ada key yang terdaftar." });
      }

      const val = settingRow.value;
      let keys: GeminiKeyEntry[] = [];

      if (typeof val === "string") {
        // Legacy single key — migrate format for display
        keys = [{ key: val, label: "Default", status: "unchecked", lastChecked: null, isPrimary: true }];
      } else if (Array.isArray(val)) {
        keys = val;
      }

      // Mask keys for security (show only last 8 chars)
      const masked = keys.map((k: any) => ({
        ...k,
        keyMasked: k.key.length > 8 ? "•••" + k.key.slice(-8) : k.key,
        keyFull: k.key, // sent only to admin
      }));

      return json(200, { success: true, keys: masked });
    }

    // ── Action: probe_keys (test all keys + discover models) ──────
    if (action === "probe_keys") {
      const { data: settingRow } = await admin
        .from("site_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .maybeSingle();

      if (!settingRow || !settingRow.value) {
        return json(200, { success: false, keys: [], models: [], message: "Belum ada key yang terdaftar." });
      }

      const val = settingRow.value;
      let keys: any[] = [];
      if (typeof val === "string") {
        keys = [{ key: val, label: "Default", status: "unchecked", lastChecked: null, isPrimary: true }];
      } else if (Array.isArray(val)) {
        keys = [...val];
      }

      const now = new Date().toISOString();
      let allModels: any[] = [];
      let firstValidKey = "";

      // Probe each key
      for (const entry of keys) {
        try {
          const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${entry.key}&pageSize=100`;
          const res = await fetch(listUrl);

          if (res.ok) {
            entry.status = "active";
            entry.lastChecked = now;

            if (!firstValidKey) {
              firstValidKey = entry.key;
              const listData = await res.json();
              allModels = (listData.models || [])
                .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
                .map((m: any) => {
                  const rawId = m.name.replace(/^models\//, "");
                  return {
                    id: rawId,
                    displayName: m.displayName || rawId,
                    description: m.description || "",
                    inputTokenLimit: m.inputTokenLimit,
                    outputTokenLimit: m.outputTokenLimit,
                  };
                });
            } else {
              await res.text(); // consume body
            }
          } else {
            const errText = await res.text();
            if (res.status === 400 || res.status === 403) {
              entry.status = "invalid";
            } else if (res.status === 429) {
              entry.status = "quota_exhausted";
            } else {
              entry.status = "error";
            }
            entry.lastChecked = now;
            entry.lastError = `HTTP ${res.status}`;
          }
        } catch (e: any) {
          entry.status = "error";
          entry.lastChecked = now;
          entry.lastError = e.message || String(e);
        }
      }

      // Sort models by relevance
      allModels.sort((a: any, b: any) => {
        const getScore = (id: string) => {
          if (id.includes("2.5-flash") && !id.includes("lite")) return 150;
          if (id.includes("2.5-pro")) return 140;
          if (id.includes("2.5-flash-lite")) return 135;
          if (id.match(/3\.\d+-flash/)) {
            const ver = parseFloat(id.match(/(\d+\.\d+)/)?.[1] || "0");
            return 100 + ver * 10;
          }
          if (id.includes("1.5-flash")) return 80;
          if (id.includes("1.5-pro")) return 70;
          return 10;
        };
        return getScore(b.id) - getScore(a.id);
      });

      // Save updated statuses back to DB
      const { error: saveErr } = await admin.from("site_settings").upsert({
        key: "gemini_api_key",
        value: keys,
        updated_at: now,
      }, { onConflict: "key" });

      // Return masked keys
      const masked = keys.map((k: any) => ({
        ...k,
        keyMasked: k.key.length > 8 ? "•••" + k.key.slice(-8) : k.key,
      }));

      return json(200, {
        success: true,
        keys: masked,
        models: allModels,
        totalModels: allModels.length,
        activeKeys: keys.filter((k: any) => k.status === "active").length,
        message: `${keys.filter((k: any) => k.status === "active").length}/${keys.length} key aktif, ${allModels.length} model tersedia.`,
      });
    }

    // ── Action: delete_key ─────────────────────────────────────────
    if (action === "delete_key") {
      const targetKey = (payload.targetKey || "").trim();
      if (!targetKey) return json(200, { success: false, error: true, message: "Key target tidak ditemukan." });

      const { data: settingRow } = await admin
        .from("site_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .maybeSingle();

      if (!settingRow || !Array.isArray(settingRow.value)) {
        return json(200, { success: false, error: true, message: "Tidak ada key yang terdaftar." });
      }

      let keys = settingRow.value.filter((k: any) => k.key !== targetKey);
      // If deleted key was primary, set first remaining as primary
      if (keys.length > 0 && !keys.some((k: any) => k.isPrimary)) {
        keys[0].isPrimary = true;
      }

      const { error: saveErr } = await admin.from("site_settings").upsert({
        key: "gemini_api_key",
        value: keys,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      if (saveErr) return json(200, { success: false, error: true, message: saveErr.message });
      return json(200, { success: true, remaining: keys.length, message: "Key berhasil dihapus." });
    }

    // ── Action: set_primary_key ────────────────────────────────────
    if (action === "set_primary_key") {
      const targetKey = (payload.targetKey || "").trim();
      if (!targetKey) return json(200, { success: false, error: true, message: "Key target tidak ditemukan." });

      const { data: settingRow } = await admin
        .from("site_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .maybeSingle();

      if (!settingRow || !Array.isArray(settingRow.value)) {
        return json(200, { success: false, error: true, message: "Tidak ada key yang terdaftar." });
      }

      const keys = settingRow.value.map((k: any) => ({
        ...k,
        isPrimary: k.key === targetKey,
      }));

      const { error: saveErr } = await admin.from("site_settings").upsert({
        key: "gemini_api_key",
        value: keys,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      if (saveErr) return json(200, { success: false, error: true, message: saveErr.message });
      return json(200, { success: true, message: "Key utama berhasil diubah." });
    }

    // ── Resolve keys for generation actions ────────────────────────
    const allKeys = await resolveGeminiKeys(admin, clientKey);

    // ── Action: list_models ────────────────────────────────────────
    if (action === "list_models") {
      if (allKeys.length === 0) {
        return json(200, { success: false, error: true, models: [], message: "API key belum diisi." });
      }

      // Try each key until one works
      for (const keyEntry of allKeys) {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${keyEntry.key}&pageSize=100`;
        const res = await fetch(listUrl);
        if (res.ok) {
          const listData = await res.json();
          const textModels = (listData.models || [])
            .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
            .map((m: any) => ({
              id: m.name.replace(/^models\//, ""),
              name: m.name,
              displayName: m.displayName || m.name.replace(/^models\//, ""),
              description: m.description || "",
              inputTokenLimit: m.inputTokenLimit,
              outputTokenLimit: m.outputTokenLimit,
            }));

          textModels.sort((a: any, b: any) => {
            const getScore = (id: string) => {
              if (id === "gemini-2.5-flash") return 150;
              if (id === "gemini-2.5-pro") return 140;
              if (id.includes("2.5-flash-lite")) return 135;
              if (id.match(/3\.\d+-flash/)) {
                const ver = parseFloat(id.match(/(\d+\.\d+)/)?.[1] || "0");
                return 100 + ver * 10;
              }
              if (id === "gemini-1.5-flash") return 80;
              if (id === "gemini-1.5-pro") return 70;
              return 10;
            };
            return getScore(b.id) - getScore(a.id);
          });

          return json(200, { success: true, models: textModels, total: textModels.length, keyUsed: keyEntry.label });
        }
        await res.text(); // consume body
      }

      return json(200, { success: false, error: true, models: [], message: "Semua key gagal mengambil daftar model." });
    }

    // ── Action: test ───────────────────────────────────────────────
    if (action === "test") {
      if (allKeys.length === 0) {
        return json(200, { success: false, error: true, message: "Gemini API Key belum diisi." });
      }

      const modelName = (payload.model || "gemini-2.5-flash").replace(/^models\//, "");
      const result = await callGeminiWithRolling(
        allKeys, [modelName],
        () => ({
          contents: [{ parts: [{ text: "Ketik 'OK' jika koneksi berhasil." }] }],
          generationConfig: { maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 0 } },
        }),
        () => ({
          contents: [{ parts: [{ text: "Ketik 'OK' jika koneksi berhasil." }] }],
          generationConfig: { maxOutputTokens: 100 },
        })
      );

      if (!result.data) {
        return json(200, { success: false, error: true, message: `Gagal terhubung: ${result.error}` });
      }

      const reply = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || "OK";
      return json(200, {
        success: true,
        message: `Koneksi ke model ${result.model} berhasil! Respon: "${reply.trim()}"`,
        model: result.model,
        keyUsed: result.keyLabel,
      });
    }

    // ── Action: translate ──────────────────────────────────────────
    if (action === "translate") {
      const textToTranslate = payload.text || "";
      const target = payload.targetLang || "id";
      if (!textToTranslate.trim()) return json(200, { success: true, translatedText: "", detectedLang: "" });
      if (allKeys.length === 0) return json(200, { success: false, error: true, message: "Gemini API Key belum dikonfigurasi untuk AI translation." });

      const prompt = `Terjemahkan teks ulasan atau balasan game berikut secara natural, ramah, dan akurat ke dalam bahasa target: "${target}".
JANGAN menambahkan kalimat pengantar, penutup, atau tanda kutip pembungkus. Kembalikan HANYA teks hasil terjemahannya saja:

${textToTranslate}`;

      const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-1.5-flash"];
      const result = await callGeminiWithRolling(
        allKeys, models,
        () => ({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
        }),
        () => ({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1000 },
        })
      );

      if (result.data) {
        const translatedOut = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return json(200, { success: true, translatedText: translatedOut.trim(), detectedLang: payload.sourceLang || target, modelUsed: result.model, keyUsed: result.keyLabel });
      }
      return json(200, { success: false, error: true, message: "Gagal menerjemahkan via AI." });
    }

    // ── Action: localize_reply ─────────────────────────────────────
    if (action === "localize_reply") {
      const { reviewText, rating, playerLang, authorName, gameTitle, replyDraft, model } = payload;
      if (allKeys.length === 0) return json(200, { success: false, error: true, message: "Gemini API Key belum dikonfigurasi." });

      const targetLang = playerLang || "id";
      const prompt = `Kamu adalah Customer Relations & Game Community Manager profesional dari studio game indie "Mainra Games" (email: mainragames@gmail.com).
Tugasmu adalah membuat atau menerjemahkan balasan resmi developer di Google Play Store untuk seorang pemain.

Konteks Ulasan:
- Nama Pengulas: ${authorName || "Pemain"}
- Judul Game: ${gameTitle || "Game Mainra"}
- Bintang/Rating: ${rating || 5} dari 5 bintang
- Bahasa Pengguna: ${targetLang}
- Isi Ulasan Pemain: "${reviewText || "Bagus"}"
${replyDraft ? `- Konsep Balasan Admin (Bahasa Indonesia/Inggris): "${replyDraft}"` : ""}

Instruksi Wajib:
1. Tulis balasan dalam BAHASA ASLI PENGGUNA (${targetLang}) secara sopan, hangat, ramah, dan profesional.
2. WAJIB HANYA 1 PARAGRAF / 1 LINE (SATU BARIS TUNGGAL). DILARANG menggunakan baris baru (line breaks / enter / newline \\n), dilarang membuat poin-poin/bullet points.
3. Jika pemain memberikan rating 5 bintang atau ulasan positif: ucapkan terima kasih yang tulus, sampaikan bahwa developer senang mereka menikmati gamenya, dan update baru sedang disiapkan.
4. Jika pemain memberikan rating 1-3 bintang atau keluhan bug: minta maaf atas ketidaknyamanannya, jelaskan bahwa tim developer mencatat masalah tersebut dan perbaikan akan hadir di update berikutnya, serta cantumkan email mainragames@gmail.com.
5. Panjang balasan MAKSIMAL 320 karakter (karena batas Google Play Store adalah 350 karakter).
6. Jangan gunakan tanda kutip pembungkus, jangan ada salam robotik yang kaku. Langsung teks balasan 1 baris yang siap diposting ke Play Store.`;

      const candidateModels = [
        model ? model.replace(/^models\//, "") : "",
        "gemini-2.5-flash-lite", "gemini-3.7-flash", "gemini-3.8-flash",
        "gemini-2.5-flash", "gemini-3.5-flash", "gemini-1.5-flash"
      ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

      const result = await callGeminiWithRolling(
        allKeys, candidateModels,
        () => ({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
        }),
        () => ({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500 },
        })
      );

      if (!result.data) {
        return json(200, { success: false, error: true, message: `Semua model Gemini sedang limit/terkendala: ${result.error}` });
      }

      let localizedText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      localizedText = localizedText.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/^["']|["']$/g, "");
      return json(200, { success: true, localizedReply: localizedText, targetLang, modelUsed: result.model, keyUsed: result.keyLabel });
    }

    // ── Action: generate ───────────────────────────────────────────
    if (action === "generate") {
      if (allKeys.length === 0) return json(200, { success: false, error: true, message: "Gemini API Key belum dikonfigurasi." });

      const { gameTitle, topic, tone, targetLink, customPrompt } = payload;
      let modelName = (payload.model || "gemini-2.5-flash").replace(/^models\//, "");

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

      const candidateModels = [modelName, "gemini-2.5-flash", "gemini-3.7-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-1.5-flash"]
        .filter((v, i, a) => a.indexOf(v) === i);

      const result = await callGeminiWithRolling(
        allKeys, candidateModels,
        () => ({
          contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + userPrompt }] }],
          generationConfig: {
            temperature: 0.7, maxOutputTokens: 2500,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                caption: { type: "STRING" },
                hashtags: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["title", "caption"],
            },
          },
        }),
        () => ({
          contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + userPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2500 },
        })
      );

      if (!result.data) {
        return json(200, { success: false, error: true, message: `Semua model Gemini mengalami kendala: ${result.error}` });
      }

      const rawOutput = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const finalResult = extractStructuredPost(rawOutput, gameTitle);
      return json(200, { success: true, modelUsed: result.model, keyUsed: result.keyLabel, result: finalResult });
    }

    // ── Action: adapt_limits ───────────────────────────────────────
    if (action === "adapt_limits") {
      if (allKeys.length === 0) return json(200, { success: false, error: true, message: "Gemini API Key belum dikonfigurasi." });

      const { text, targetLimit, platform } = payload;
      if (!text || !text.trim()) return json(200, { success: false, error: true, message: "Teks tidak boleh kosong." });

      const limit = Number(targetLimit) || 280;
      let modelName = (payload.model || "gemini-2.5-flash").replace(/^models\//, "");

      const adaptPrompt = `Kamu adalah Social Media Editor profesional.
Tugasmu adalah meringkas dan menulis ulang teks postingan berikut agar panjang totalnya TEPAT ATAU KURANG DARI ${limit} KARAKTER untuk platform ${platform || "Twitter / Threads"}.

Syarat WAJIB:
1. Output WAJIB HANYA berupa teks caption siap posting (JANGAN sertakan format JSON, tanda kurung kurawal {}, atau kutip JSON).
2. Panjang total teks hasil ringkasan TIDAK BOLEH lebih dari ${limit} karakter.
3. Pertahankan nama game, pesan penting, link jika ada, dan minimal hashtag #MainraGames.

Teks yang diringkas:
${text.trim()}`;

      const result = await callGeminiWithRolling(
        allKeys, [modelName, "gemini-2.5-flash", "gemini-3.5-flash"],
        () => ({
          contents: [{ role: "user", parts: [{ text: adaptPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1500, thinkingConfig: { thinkingBudget: 0 } },
        }),
        () => ({
          contents: [{ role: "user", parts: [{ text: adaptPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
        })
      );

      if (!result.data) {
        return json(200, { success: false, error: true, message: `Gemini API error: ${result.error}` });
      }

      const rawRes = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let adaptedCaption = cleanCaptionText(rawRes);

      if (adaptedCaption.length > limit) {
        const parts = adaptedCaption.split("http");
        if (parts.length > 1) {
          const mainText = parts[0];
          const linkAndTag = "http" + parts.slice(1).join("http");
          const allowedMain = limit - linkAndTag.length - 2;
          if (allowedMain > 10) {
            adaptedCaption = mainText.slice(0, allowedMain).trim() + "… " + linkAndTag;
          } else {
            adaptedCaption = adaptedCaption.slice(0, limit - 1).trim() + "…";
          }
        } else {
          adaptedCaption = adaptedCaption.slice(0, limit - 1).trim() + "…";
        }
      }

      return json(200, { success: true, caption: adaptedCaption, charCount: adaptedCaption.length, modelUsed: result.model, keyUsed: result.keyLabel });
    }

    return json(200, { success: false, error: true, message: `Aksi '${action}' tidak dikenali.` });
  } catch (err: any) {
    return json(200, { success: false, error: true, message: `Internal server error: ${err.message}` });
  }
});
