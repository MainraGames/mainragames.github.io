// supabase/functions/process-review-queue/index.ts
// Worker Edge Function to process review_replies_queue (pgmq)
// 1. Reads a batch of 5-star reviews from pgmq
// 2. Generates warm, polite, localized developer replies via Gemini API (gemini-2.5-flash)
// 3. Posts the reply to Google Play Store using Google Play Developer API (if GOOGLE_SERVICE_ACCOUNT_JSON set)
// 4. Updates public.game_reviews with the posted reply and archives/deletes message from pgmq
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
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

function b64url(buf: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePrivateKey(pem: string): Uint8Array {
  const clean = pem.replace(/-----BEGIN[^-]+-----/g, "").replace(/-----END[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function signJwt(sa: any) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePrivateKey(sa.private_key) as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

async function accessToken(sa: any) {
  const jwt = await signJwt(sa);
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function generateReplyWithGemini(geminiKeys: string[], review: any, gameTitle: string) {
  const targetLang = review.lang || "id";

  const prompt = `Kamu adalah Customer Relations & Game Community Manager profesional dari studio game indie "Mainra Games" (email: mainragames@gmail.com).
Tugasmu adalah membuat balasan resmi developer di Google Play Store untuk seorang pemain yang memberikan rating 5 BINTANG.

Konteks Ulasan:
- Nama Pengulas: ${review.author_name || "Pemain"}
- Judul Game: ${gameTitle || "Game Mainra"}
- Bintang/Rating: 5 dari 5 bintang
- Bahasa Pengguna: ${targetLang}
- Isi Ulasan Pemain: "${review.content || "Game seru!"}"

Instruksi Wajib:
1. Tulis balasan dalam BAHASA ASLI PENGGUNA (${targetLang}) secara ramah, sopan, hangat, dan profesional.
2. WAJIB HANYA 1 PARAGRAF / 1 LINE (SATU BARIS TUNGGAL). DILARANG menggunakan baris baru (newline \\n) dan dilarang membuat poin-poin/bullet points.
3. Karena pemain memberikan ulasan bintang 5: ucapkan terima kasih yang tulus, sampaikan apresiasi bahwa developer senang mereka menyukai gamenya, dan update seru baru sedang disiapkan.
4. Panjang balasan MAKSIMAL 320 karakter (karena batas Google Play Store adalah 350 karakter).
5. Jangan gunakan tanda kutip pembungkus. Langsung teks balasan 1 baris yang siap diposting ke Play Store.`;

  const candidateModels = [
    "gemini-2.5-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-1.5-flash"
  ];

  for (const geminiKey of geminiKeys) {
    for (const m of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`;
      try {
        let res = await fetch(url, {
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

        // Retry without thinkingConfig if 400 (unsupported feature)
        if (!res.ok && res.status === 400) {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 500 },
            }),
          });
        }

        if (res.ok) {
          const data = await res.json();
          let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          text = text.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/^["']|["']$/g, "");
          if (text) {
            if (text.length > 350) text = text.slice(0, 320).trim();
            return text;
          }
        } else {
          const errText = await res.text();
          console.warn(`Gemini worker key[${geminiKeys.indexOf(geminiKey)}] model ${m} returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
          // If 429 quota, skip to next key
          if (res.status === 429) break;
          // If 403 invalid key, skip to next key
          if (res.status === 403) break;
        }
      } catch (e: any) {
        console.warn(`Gemini worker key[${geminiKeys.indexOf(geminiKey)}] model ${m} fetch error:`, e.message || e);
      }
    }
  }

  // Safe offline fallback reply if all Gemini free-tier quotas are exhausted
  const politeThankYouByLang: Record<string, string> = {
    id: "Halo! Terima kasih banyak atas ulasan bintang 5 Anda dan dukungannya untuk Mainra Games. Kami senang Anda menyukai game ini!",
    en: "Hi! Thank you so much for your 5-star rating and support for Mainra Games. We are delighted you are enjoying the game!",
    fa: "سلام! از نظر ۵ ستاره و حمایت شما از بازی بسیار سپاسگزاریم. خوشحالیم که از بازی لذت می‌برید!",
    ar: "أهلاً بك! شكراً جزيلاً على تقييم الـ 5 نجوم ودعمك الرائع لنا. يسعدنا جداً أن اللعبة نالت إعجابك!",
    es: "¡Hola! ¡Muchísimas gracias por tu valoración de 5 estrellas y tu apoyo a Mainra Games! Nos alegra que disfrutes el juego.",
    pt: "Olá! Muito obrigado pela avaliação 5 estrelas e pelo apoio à Mainra Games. Ficamos muito felizes que esteja gostando!",
    ru: "Здравствуйте! Большое спасибо за оценку 5 звезд и вашу поддержку. Мы очень рады, что вам нравится игра!",
    tr: "Merhaba! 5 yıldızlı değerlendirmeniz ve desteğiniz için çok teşekkürler. Oyunu beğenmenize çok sevindik!"
  };

  return politeThankYouByLang[targetLang] || politeThankYouByLang.en;
}

Deno.serve(async (req: Request) => {
  console.log("=== process-review-queue request received ===", req.method);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  console.log("Creating admin client with url:", supabaseUrl);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Resolve Gemini keys (multi-key rolling support)
  let geminiKeys: string[] = [];

  // 1. Check env var first
  const envKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (envKey) geminiKeys.push(envKey);

  // 2. Load from DB (new multi-key format or legacy single key)
  const { data: dbSetting } = await admin.from("site_settings").select("value").eq("key", "gemini_api_key").maybeSingle();
  if (dbSetting?.value) {
    const val = dbSetting.value;
    if (typeof val === "string" && val.trim()) {
      if (!geminiKeys.includes(val.trim())) geminiKeys.push(val.trim());
    } else if (Array.isArray(val)) {
      // Sort: primary first, then active keys only
      const sorted = [...val].sort((a: any, b: any) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return 0;
      });
      for (const entry of sorted) {
        if (entry.key?.trim() && entry.status !== "invalid" && !geminiKeys.includes(entry.key.trim())) {
          geminiKeys.push(entry.key.trim());
        }
      }
    }
  }

  if (geminiKeys.length === 0) {
    return json(200, { success: false, message: "Gemini API key is not configured yet. Queue will wait." });
  }

  const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
  let playToken = "";
  if (saRaw) {
    try {
      playToken = await accessToken(JSON.parse(saRaw));
    } catch (e: any) {
      console.warn("Could not obtain Google Play access token:", e.message);
    }
  }

  // Read queue batch using RPC helpers
  const { data: messages, error: readError } = await admin.rpc("read_review_queue", {
    p_count: 5,
    p_vt: 120,
  });

  if (readError || !messages || messages.length === 0) {
    return json(200, { success: true, processed: 0, message: "Queue is empty." });
  }

  // Pre-load games map for titles
  const { data: games } = await admin.from("games").select("id, appId, title");
  const gamesMap = new Map();
  for (const g of games || []) {
    if (g.appId) gamesMap.set(g.appId, g.title);
    if (g.id) gamesMap.set(g.id, g.title);
  }

  const results = [];

  for (const msg of messages) {
    const msgId = msg.msg_id;
    const review = msg.message;
    if (!review || !review.review_id || !review.game_id) {
      // Delete corrupted queue item
      await admin.rpc("delete_review_queue", { p_msg_id: msgId }).catch(() => {});
      continue;
    }

    // Safety check: ensure review is still unreplied in public.game_reviews and is indeed 5 stars
    const { data: currentReview } = await admin
      .from("game_reviews")
      .select("review_id, reply_text, replySentAt, star_rating")
      .eq("review_id", review.review_id)
      .maybeSingle();

    if (!currentReview || currentReview.star_rating !== 5 || (currentReview.reply_text && currentReview.reply_text.trim())) {
      // Already replied or not 5-star, archive/delete from queue
      await admin.rpc("archive_review_queue", { p_msg_id: msgId }).catch(() => {});
      continue;
    }

    try {
      const gameTitle = gamesMap.get(review.game_id) || "Mainra Games";
      // 1. Generate reply with Gemini
      const replyText = await generateReplyWithGemini(geminiKeys, review, gameTitle);

      let replySentAt = null;

      // 2. Post to Google Play Store if service account token is ready
      if (playToken && review.source === "playstore") {
        try {
          const gRes = await fetch(`${API}/applications/${review.game_id}/reviews/${review.review_id}:reply`, {
            method: "POST",
            headers: { Authorization: `Bearer ${playToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ replyText }),
          });
          if (gRes.ok) {
            replySentAt = new Date().toISOString();
          } else {
            console.error(`Google Play reply failed for ${review.review_id}: HTTP ${gRes.status} ${await gRes.text()}`);
          }
        } catch (postErr: any) {
          console.error("Error calling Google Play reviews:reply:", postErr);
        }
      }

      // 3. Update database
      const updatePayload: any = {
        reply_text: replyText,
        reply_timestamp: Date.now(),
      };
      if (replySentAt) {
        updatePayload.replySentAt = replySentAt;
      }
      await admin.from("game_reviews").update(updatePayload).eq("review_id", review.review_id);

      // 4. Archive message from pgmq
      await admin.rpc("archive_review_queue", { p_msg_id: msgId }).catch(() => {
        admin.rpc("delete_review_queue", { p_msg_id: msgId }).catch(() => {});
      });

      results.push({ review_id: review.review_id, status: "success", replyText, published: !!replySentAt });

      // Small sequential delay to strictly respect Gemini rate limits
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (processErr: any) {
      console.error(`Error processing review ${review.review_id}:`, processErr);
      results.push({ review_id: review.review_id, status: "error", error: processErr.message });
    }
  }

  return json(200, {
    success: true,
    processed: results.length,
    results,
  });
});
