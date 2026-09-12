// supabase/functions/manage-admins/index.ts
// Secure admin management endpoint using Service Role.
// Allows authorized admins to list, add, and remove admin users.
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
  if (!token) return { admin: null, user: null, message: "Missing token" };

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
    const action = payload.action;

    // 1. List all admins
    if (action === "list") {
      const { data: adminRows, error: dbErr } = await admin
        .from("admin_users")
        .select("user_id, email, created_at")
        .order("created_at", { ascending: true });

      if (dbErr) return json(500, { message: dbErr.message });

      // Fetch user details from auth.users (last_sign_in_at, created_at)
      const { data: authUsers, error: authErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const authMap = new Map();
      if (!authErr && authUsers?.users) {
        authUsers.users.forEach((u: any) => {
          authMap.set(u.id, u);
        });
      }

      const enriched = (adminRows || []).map((row: any) => {
        const u = authMap.get(row.user_id);
        return {
          user_id: row.user_id,
          email: row.email || (u ? u.email : ""),
          created_at: row.created_at || (u ? u.created_at : null),
          last_sign_in_at: u ? u.last_sign_in_at : null,
          is_current_user: row.user_id === user.id,
        };
      });

      return json(200, { admins: enriched });
    }

    // 2. Create new admin user
    if (action === "create") {
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "").trim();

      if (!email || !email.includes("@")) {
        return json(400, { message: "Alamat email tidak valid." });
      }
      if (!password || password.length < 6) {
        return json(400, { message: "Password minimal 6 karakter." });
      }

      // Check if user already in auth
      let targetUserId = "";
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createErr) {
        // If already exists in auth, find the user id
        if (createErr.message?.toLowerCase().includes("already") || createErr.message?.toLowerCase().includes("registered")) {
          const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
          const found = existingUsers?.users?.find((u: any) => u.email?.toLowerCase() === email);
          if (found) {
            targetUserId = found.id;
          } else {
            return json(400, { message: createErr.message });
          }
        } else {
          return json(400, { message: createErr.message });
        }
      } else if (created?.user) {
        targetUserId = created.user.id;
      }

      if (!targetUserId) {
        return json(500, { message: "Gagal memproses user id." });
      }

      // Upsert into public.admin_users
      const { error: insErr } = await admin
        .from("admin_users")
        .upsert({ user_id: targetUserId, email }, { onConflict: "user_id" });

      if (insErr) {
        return json(500, { message: "Gagal menambahkan admin ke database: " + insErr.message });
      }

      return json(200, { message: `Admin ${email} berhasil ditambahkan!` });
    }

    // 3. Delete admin user
    if (action === "delete") {
      const targetUserId = String(payload.user_id || "").trim();
      if (!targetUserId) return json(400, { message: "User ID diperlukan." });

      if (targetUserId === user.id) {
        return json(400, { message: "Anda tidak dapat menghapus akun Anda sendiri." });
      }

      // Ensure there is at least one admin remaining
      const { count, error: countErr } = await admin
        .from("admin_users")
        .select("*", { count: "exact", head: true });

      if (countErr) return json(500, { message: countErr.message });
      if ((count || 0) <= 1) {
        return json(400, { message: "Tidak dapat menghapus admin terakhir. Minimal harus ada 1 admin aktif." });
      }

      // Remove from admin_users
      const { error: delDbErr } = await admin
        .from("admin_users")
        .delete()
        .eq("user_id", targetUserId);

      if (delDbErr) return json(500, { message: delDbErr.message });

      // Optionally delete from auth or let it remain without admin rights
      // Removing auth user deletes their login credential entirely
      await admin.auth.admin.deleteUser(targetUserId).catch(() => {});

      return json(200, { message: "Admin berhasil dihapus." });
    }

    return json(400, { message: "Action tidak dikenali." });
  } catch (err: any) {
    return json(500, { message: err?.message || String(err) });
  }
});
