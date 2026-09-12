// supabase/functions/ai-social-assistant/index.ts
// Robust AI assistant for social media posts powered by Google Gemini API.
// Features: Thinking Budget Control (thinkingBudget: 0 to prevent thought token exhaustion),
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

// Clean any JSON debris if returned
function cleanCaptionText(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();

  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // If starts with { and has "caption"
  if (s.startsWith("{") && s.includes('"caption"')) {
    try {
      const parsed = JSON.parse(s);
      if (parsed.caption) return String(parsed.caption).trim();
    } catch (_) {
      // regex fallback
      const m = s.match(/"caption"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (m) {
        try {
          return JSON.parse('"' + m[1] + '"').trim();
        } catch (_) {
          return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
        }
      }
      // If incomplete JSON like {"caption": " ...
      const incomplete = s.match(/"caption"\s*:\s*"([\s\S]+)/i);
      if (incomplete) {
        let val = incomplete[1].replace(/"\s*\}?\s*$/, "");
        return val.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
      }
    }
  }

  // Remove leading / trailing quotes if left
  if (s.startsWith('"') && s.endsWith('"') && s.length > 2) {
    s = s.slice(1, -1).trim();
  }

  return s;
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

        if (titleMatch) {
          try { extractedTitle = JSON.parse('"' + titleMatch[1] + '"'); } catch { extractedTitle = titleMatch[1]; }
        }
        if (captionMatch) {
          try { extractedCaption = JSON.parse('"' + captionMatch[1] + '"'); } catch { extractedCaption = captionMatch[1]; }
        }

        return {
          title: extractedTitle.trim(),
          caption: cleanCaptionText(extractedCaption.trim()),
          hashtags: ["#MainraGames", "#IndieGame"],
        };
      }
    }
  }

  return {
    title: `Update Seru ${defaultGameTitle || "Mainra Games"}`,
    caption: cleanCaptionText(cleaned),
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

    // Priority for Gemini key: payload -> site_settings -> env
    let geminiKey = (
      payload.client_gemini_key ||
      payload.client_token ||
      payload.geminiKey ||
      payload.clientApiKey ||
      payload.apiKey ||
      ""
    ).trim();

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

    // Action: Save API key
    if (action === "save_key") {
      const newKey = (payload.newKey || "").trim();
      if (!newKey) {
        return json(200, { success: false, error: true, message: "API key tidak boleh kosong." });
      }
      const { error: upsertErr } = await admin.from("site_settings").upsert({
        key: "gemini_api_key",
        value: newKey,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

      if (upsertErr) return json(200, { success: false, error: true, message: upsertErr.message });
      return json(200, { success: true, message: "Gemini API Key berhasil disimpan ke sistem! ✓" });
    }

    // Action: List supported Gemini models dynamically
    if (action === "list_models") {
      if (!geminiKey) {
        return json(200, { success: false, error: true, models: [], message: "API key belum diisi." });
      }

      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=100`;
      const res = await fetch(listUrl);

      if (!res.ok) {
        const errText = await res.text();
        return json(200, {
          success: false,
          error: true,
          models: [],
          message: `Gagal mengambil daftar model dari Google API (${res.status}): ${errText}`,
        });
      }

      const listData = await res.json();
      const rawModels = listData.models || [];

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

      // Priority ranking: 2.5-flash / 3.x / 1.5-flash
      textModels.sort((a: any, b: any) => {
        const getScore = (id: string) => {
          if (id === "gemini-2.5-flash") return 150;
          if (id === "gemini-2.5-pro") return 140;
          if (id === "gemini-3.6-flash") return 135;
          if (id === "gemini-3.5-flash") return 130;
          if (id === "gemini-3.8-flash") return 125;
          if (id === "gemini-1.5-flash") return 100;
          if (id === "gemini-1.5-pro") return 90;
          if (id.includes("2.5")) return 80;
          if (id.includes("3.")) return 70;
          return 10;
        };
        return getScore(b.id) - getScore(a.id);
      });

      return json(200, {
        success: true,
        models: textModels,
        total: textModels.length,
      });
    }

    // Action: Translate Review / Text OR Auto-Draft Localized Reply
    if (action === "translate") {
      const textToTranslate = payload.text || "";
      const target = payload.targetLang || "id";
      if (!textToTranslate.trim()) {
        return json(200, { success: true, translatedText: "", detectedLang: "" });
      }

      if (!geminiKey) {
        return json(200, {
          success: false,
          error: true,
          message: "Gemini API Key belum dikonfigurasi untuk AI translation.",
        });
      }

      try {
        const modelName = "gemini-2.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
        const prompt = `Terjemahkan teks ulasan atau balasan game berikut secara natural, ramah, dan akurat ke dalam bahasa target: "${target}".
JANGAN menambahkan kalimat pengantar, penutup, atau tanda kutip pembungkus. Kembalikan HANYA teks hasil terjemahannya saja:

${textToTranslate}`;

        const gRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 1000,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        });

        if (gRes.ok) {
          const gData = await gRes.json();
          const translatedOut = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          return json(200, {
            success: true,
            translatedText: translatedOut.trim(),
            detectedLang: payload.sourceLang || target,
          });
        }
      } catch (err: any) {
        console.error("AI translate error:", err);
      }
      return json(200, { success: false, error: true, message: "Gagal menerjemahkan via AI." });
    }

    // Action: Auto-Localize & Generate Reply tailored to player language
    if (action === "localize_reply") {
      const { reviewText, rating, playerLang, authorName, gameTitle, replyDraft, model } = payload;
      if (!geminiKey) {
        return json(200, {
          success: false,
          error: true,
          message: "Gemini API Key belum dikonfigurasi.",
        });
      }

      try {
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
2. WAJIB HANYA 1 PARAGRAF / 1 LINE (SATU BARIS TUNGGAL). DILARANG menggunakan baris baru (line breaks / enter / newline \n), dilarang membuat poin-poin/bullet points.
3. Jika pemain memberikan rating 5 bintang atau ulasan positif: ucapkan terima kasih yang tulus, sampaikan bahwa developer senang mereka menikmati gamenya, dan update baru sedang disiapkan.
4. Jika pemain memberikan rating 1-3 bintang atau keluhan bug: minta maaf atas ketidaknyamanannya, jelaskan bahwa tim developer mencatat masalah tersebut dan perbaikan akan hadir di update berikutnya, serta cantumkan email mainragames@gmail.com.
5. Panjang balasan MAKSIMAL 320 karakter (karena batas Google Play Store adalah 350 karakter).
6. Jangan gunakan tanda kutip pembungkus, jangan ada salam robotik yang kaku. Langsung teks balasan 1 baris yang siap diposting ke Play Store.`;

        // Multi-model automated cascade fallback to beat free tier 429 quota limits
        const candidateModels = [
          model ? model.replace(/^models\//, "") : "",
          "gemini-2.5-flash-lite",
          "gemini-3.7-flash",
          "gemini-3.8-flash",
          "gemini-2.5-flash",
          "gemini-3.5-flash",
          "gemini-1.5-flash"
        ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

        let localizedText = "";
        let successfulModel = "";
        let lastError = "";

        for (const m of candidateModels) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`;
          try {
            const gRes = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  maxOutputTokens: 500,
                  thinkingConfig: { thinkingBudget: 0 },
                },
              }),
            });

            if (gRes.ok) {
              const gData = await gRes.json();
              localizedText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              successfulModel = m;
              break;
            } else {
              const errBody = await gRes.text();
              lastError = `Model ${m} error (${gRes.status}): ${errBody}`;
            }
          } catch (fetchErr: any) {
            lastError = `Model ${m} fetch failed: ${fetchErr.message || fetchErr}`;
          }
        }

        if (!localizedText) {
          return json(200, {
            success: false,
            error: true,
            message: `Semua model Gemini sedang limit/terkendala: ${lastError}`,
          });
        }

        // Strict formatting: enforce single-line (1 paragraph only) and strip redundant quotes/newlines
        localizedText = localizedText.replace(/[
\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/^["']|["']$/g, "");
        return json(200, {
          success: true,
          localizedReply: localizedText,
          targetLang: targetLang,
          modelUsed: successfulModel,
        });
      } catch (err: any) {
        return json(200, { success: false, error: true, message: err.message || String(err) });
      }
    }

    // Action: Test Model Connection
    if (action === "test") {
      if (!geminiKey) {
        return json(200, { success: false, error: true, message: "Gemini API Key belum diisi." });
      }

      let modelName = (payload.model || "gemini-2.5-flash").replace(/^models\//, "");
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      const res = await fetch(testUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Ketik 'OK' jika koneksi berhasil." }] }],
          generationConfig: {
            maxOutputTokens: 100,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return json(200, {
          success: false,
          error: true,
          message: `Gagal terhubung ke Gemini API (${res.status}): ${errText}`,
        });
      }

      const testData = await res.json();
      const reply = testData?.candidates?.[0]?.content?.parts?.[0]?.text || "OK";

      return json(200, {
        success: true,
        message: `Koneksi ke model ${modelName} berhasil! Respon: "${reply.trim()}"`,
        model: modelName,
      });
    }

    // Action: Generate Post Content
    if (action === "generate") {
      if (!geminiKey) {
        return json(200, {
          success: false,
          error: true,
          message: "Gemini API Key belum dikonfigurasi.",
        });
      }

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

      const requestBody: any = {
        contents: [
          {
            role: "user",
            parts: [{ text: systemInstruction + "\n\n" + userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2500,
          thinkingConfig: { thinkingBudget: 0 },
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

      // Candidate fallback sequence if chosen model fails (e.g. 429 quota, rate-limited, deprecated)
      const candidateModels = [
        modelName,
        "gemini-2.5-flash",
        "gemini-3.7-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.5-flash",
        "gemini-1.5-flash"
      ].filter((v, i, a) => a.indexOf(v) === i);

      let lastError = "";
      let successfulModel = "";
      let genData: any = null;

      for (const m of candidateModels) {
        const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`;
        try {
          let res = await fetch(genUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok && res.status === 400) {
            // Retry without schema/thinkingConfig if model doesn't support them
            const fallbackBody = {
              contents: requestBody.contents,
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2500,
              },
            };
            res = await fetch(genUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(fallbackBody),
            });
          }

          if (res.ok) {
            genData = await res.json();
            successfulModel = m;
            break;
          } else {
            lastError = `Model ${m} returned HTTP ${res.status}: ${await res.text()}`;
          }
        } catch (e: any) {
          lastError = `Model ${m} fetch failed: ${e.message || e}`;
        }
      }

      if (!genData) {
        return json(200, {
          success: false,
          error: true,
          message: `Semua model Gemini mengalami kendala: ${lastError}`,
        });
      }

      const rawOutput = genData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const finalResult = extractStructuredPost(rawOutput, gameTitle);

      return json(200, {
        success: true,
        modelUsed: successfulModel,
        result: finalResult,
      });
    }

    // Action: AI Auto-Fit / Adapt Text for Specific Social Media Character Limits
    if (action === "adapt_limits") {
      if (!geminiKey) {
        return json(200, { success: false, error: true, message: "Gemini API Key belum dikonfigurasi." });
      }

      const { text, targetLimit, platform } = payload;
      if (!text || !text.trim()) {
        return json(200, { success: false, error: true, message: "Teks tidak boleh kosong." });
      }

      const limit = Number(targetLimit) || 280;
      let modelName = (payload.model || "gemini-2.5-flash").replace(/^models\//, "");

      // PURE TEXT instruction without JSON schema: guarantees no JSON leaking or mid-string truncation
      const adaptPrompt = `Kamu adalah Social Media Editor profesional.
Tugasmu adalah meringkas dan menulis ulang teks postingan berikut agar panjang totalnya TEPAT ATAU KURANG DARI ${limit} KARAKTER untuk platform ${platform || "Twitter / Threads"}.

Syarat WAJIB:
1. Output WAJIB HANYA berupa teks caption siap posting (JANGAN sertakan format JSON, tanda kurung kurawal {}, atau kutip JSON).
2. Panjang total teks hasil ringkasan TIDAK BOLEH lebih dari ${limit} karakter.
3. Pertahankan nama game, pesan penting, link jika ada, dan minimal hashtag #MainraGames.

Teks yang diringkas:
${text.trim()}`;

      const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      const reqBody: any = {
        contents: [{ role: "user", parts: [{ text: adaptPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1500,
          thinkingConfig: { thinkingBudget: 0 },
        },
      };

      let res = await fetch(genUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok && res.status === 400) {
        delete reqBody.generationConfig.thinkingConfig;
        res = await fetch(genUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
      }

      if (!res.ok) {
        const errTxt = await res.text();
        return json(200, {
          success: false,
          error: true,
          message: `Gemini API error (${res.status}): ${errTxt}`,
        });
      }

      const data = await res.json();
      const rawRes = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let adaptedCaption = cleanCaptionText(rawRes);

      // If still slightly over limit due to LLM character miscount, mechanically trim cleanly
      if (adaptedCaption.length > limit) {
        // Find safe truncation point
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

      return json(200, {
        success: true,
        caption: adaptedCaption,
        charCount: adaptedCaption.length,
        modelUsed: modelName,
      });
    }

    return json(200, { success: false, error: true, message: `Aksi '${action}' tidak dikenali.` });
  } catch (err: any) {
    return json(200, { success: false, error: true, message: `Internal server error: ${err.message}` });
  }
});
