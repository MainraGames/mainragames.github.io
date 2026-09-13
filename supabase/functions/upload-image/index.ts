// supabase/functions/upload-image/index.ts
// Handles image uploads to Supabase Storage with Admin verification & Service Role bypass
// Supports: Raw multipart/form-data & Base64 Data URL payload
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, data: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(200, { success: false, error: true, message: "Unauthorized" });

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return json(200, { success: false, error: true, message: "Sesi tidak valid." });
  }

  const { data: adm } = await adminClient.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!adm) {
    return json(200, { success: false, error: true, message: "Hanya akun admin yang berhak mengupload gambar." });
  }

  try {
    const body = await req.json();
    const { base64Data, mimeType } = body;
    if (!base64Data || typeof base64Data !== "string") {
      return json(200, { success: false, error: true, message: "Data gambar kosong." });
    }

    // Allowlist: a client-chosen content type could park arbitrary files in a public bucket.
    const ALLOWED_MIME: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };
    const contentType = String(mimeType || "image/png").split(";")[0].trim().toLowerCase();
    const cleanExt = ALLOWED_MIME[contentType];
    if (!cleanExt) {
      return json(200, { success: false, error: true, message: "Format gambar harus PNG, JPEG, atau WebP." });
    }

    // Strip base64 data prefix if present (e.g. data:image/png;base64,...)
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
    const binary = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));

    if (binary.length === 0) {
      return json(200, { success: false, error: true, message: "Data gambar kosong." });
    }
    if (binary.length > 5 * 1024 * 1024) {
      return json(200, { success: false, error: true, message: "Ukuran gambar maksimal 5 MB." });
    }

    // The object name is generated server-side. A client-supplied name combined
    // with upsert:true let any admin request overwrite any object in the bucket.
    const finalName = `broadcast-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${cleanExt}`;

    const uploadRes = await adminClient.storage
      .from("broadcast-images")
      .upload(finalName, binary, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadRes.error) {
      return json(200, { success: false, error: true, message: "Storage error: " + uploadRes.error.message });
    }

    const { data: pubData } = adminClient.storage.from("broadcast-images").getPublicUrl(finalName);
    return json(200, {
      success: true,
      publicUrl: pubData?.publicUrl || "",
      fileName: finalName,
    });
  } catch (err: any) {
    console.error("upload-image failed:", err?.message || err);
    return json(200, { success: false, error: true, message: "Upload gambar gagal." });
  }
});
