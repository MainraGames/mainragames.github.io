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
    const { base64Data, mimeType, fileName } = body;
    if (!base64Data) {
      return json(200, { success: false, error: true, message: "Data gambar kosong." });
    }

    // Strip base64 data prefix if present (e.g. data:image/png;base64,...)
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
    const binary = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));

    const ext = (mimeType || "image/png").split("/")[1] || "png";
    const cleanExt = ext === "jpeg" ? "jpg" : ext;
    const finalName = fileName || `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${cleanExt}`;

    const uploadRes = await adminClient.storage
      .from("broadcast-images")
      .upload(finalName, binary, {
        contentType: mimeType || "image/png",
        cacheControl: "3600",
        upsert: true,
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
    return json(200, { success: false, error: true, message: "Upload failed: " + (err.message || String(err)) });
  }
});
