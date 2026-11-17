// Supabase Edge Function "bank": the owner's BNP Paribas / Crédit Agricole accounts, read-only, via Enable Banking.
// Secrets (Supabase › Edge Functions › Secrets): EB_APP_ID, EB_PRIVATE_KEY (content of the .pem), ALLOWED_USER_ID.
// The private key never leaves Supabase; the app only receives balances and transactions of the signed-in owner.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const EB = "https://api.enablebanking.com";
const APP_ID = Deno.env.get("EB_APP_ID") ?? "";
const KEY_PEM = (Deno.env.get("EB_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
const ALLOWED = (Deno.env.get("ALLOWED_USER_ID") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ORIGIN = "https://annabalaguy.github.io";
const REDIRECT = "https://annabalaguy.github.io/echeancier/";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

class EbError extends Error { constructor(public status: number, public body: unknown) { super("Enable Banking " + status); } }
let keyP: Promise<CryptoKey> | null = null;
async function ebJwt() {
  keyP ??= importPKCS8(KEY_PEM, "RS256") as Promise<CryptoKey>;
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({}).setProtectedHeader({ alg: "RS256", typ: "JWT", kid: APP_ID })
    .setIssuer("enablebanking.com").setAudience("api.enablebanking.com").setIssuedAt(now).setExpirationTime(now + 3600).sign(await keyP);
}
async function eb(path: string, init: RequestInit = {}) {
  const r = await fetch(EB + path, { ...init, headers: { Authorization: "Bearer " + (await ebJwt()), "Content-Type": "application/json" } });
  const t = await r.text();
  let d: any; try { d = JSON.parse(t); } catch { d = { raw: t.slice(0, 300) }; }
  if (!r.ok) throw new EbError(r.status, d);
  return d;
}
const bankShort = (n: string) => n.startsWith("Crédit Agricole") ? "Crédit Agricole" : n.startsWith("BNP") ? "BNP Paribas" : n;
const isDay = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "not_signed_in" }, 401);
    if (!ALLOWED.includes(user.id)) return json({ error: "forbidden" }, 403);
    if (!APP_ID || !KEY_PEM.includes("PRIVATE KEY")) return json({ error: "not_configured" }, 500);
    const body = await req.json().catch(() => ({}));

    if (body.action === "banks") {
      const d = await eb("/aspsps?country=FR&psu_type=personal");
      return json({ banks: (d.aspsps ?? []).map((x: any) => x.name).filter((n: string) => /BNP Paribas$|^Crédit Agricole/.test(n)) });
    }

    if (body.action === "start") {
      const name = String(body.bank ?? "");
      const asp = ((await eb("/aspsps?country=FR")).aspsps ?? []).find((x: any) => x.name === name);
      if (!asp) return json({ error: "unknown_bank" }, 400);
      const maxS = Math.min(asp.maximum_consent_validity ?? 7776000, 180 * 86400);
      const state = crypto.randomUUID();
      await admin.from("bank_links").insert({ user_id: user.id, state, aspsp: name, status: "pending" });
      const d = await eb("/auth", { method: "POST", body: JSON.stringify({
        access: { valid_until: new Date(Date.now() + (maxS - 3600) * 1000).toISOString() },
        aspsp: { name, country: "FR" }, state, redirect_url: REDIRECT, psu_type: "personal", language: "fr",
      }) });
      return json({ url: d.url });
    }

    if (body.action === "finish") {
      const { data: link } = await admin.from("bank_links").select("*").eq("user_id", user.id).eq("state", String(body.state ?? "")).eq("status", "pending").maybeSingle();
      if (!link) return json({ error: "unknown_state" }, 400);
      const s = await eb("/sessions", { method: "POST", body: JSON.stringify({ code: String(body.code ?? "") }) });
      const accounts = (s.accounts ?? []).map((a: any) => ({ uid: a.uid, last4: String(a.account_id?.iban ?? "").slice(-4), name: a.name ?? a.product ?? "" }));
      // a new link to the same bank replaces the old one
      await admin.from("bank_links").update({ status: "replaced" }).eq("user_id", user.id).eq("aspsp", link.aspsp).eq("status", "ok");
      await admin.from("bank_links").update({ session_id: s.session_id, accounts, valid_until: s.access?.valid_until ?? null, status: "ok" }).eq("id", link.id);
      return json({ bank: bankShort(link.aspsp), accounts: accounts.length, valid_until: s.access?.valid_until ?? null });
    }

    if (body.action === "sync") {
      const since = isDay(body.since) ? body.since : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      const { data: links } = await admin.from("bank_links").select("*").eq("user_id", user.id).eq("status", "ok");
      const out: any = { accounts: [], transactions: [], errors: [] };
      for (const l of links ?? []) for (const acc of l.accounts ?? []) {
        try {
          const b = await eb(`/accounts/${acc.uid}/balances`);
          let bal: number | null = null;
          for (const t of ["ITAV", "CLAV", "ITBD", "CLBD", "XPCD", "OTHR"]) {
            const x = (b.balances ?? []).find((y: any) => y.balance_type === t);
            if (x) { bal = Number(x.balance_amount.amount); break; }
          }
          out.accounts.push({ bank: bankShort(l.aspsp), last4: acc.last4, name: acc.name, balance: bal, valid_until: l.valid_until });
          let ck: string | null = null, n = 0;
          do {
            const q = new URLSearchParams({ date_from: since });
            if (ck) q.set("continuation_key", ck);
            const t = await eb(`/accounts/${acc.uid}/transactions?` + q);
            for (const x of t.transactions ?? []) {
              if (x.status && x.status !== "BOOK") continue;
              const amt = Math.abs(Number(x.transaction_amount?.amount ?? 0)) * (x.credit_debit_indicator === "DBIT" ? -1 : 1);
              const label = [...(x.remittance_information ?? []), x.creditor?.name, x.debtor?.name].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 140) || "Opération";
              const date = x.booking_date ?? x.value_date ?? x.transaction_date;
              if (!isDay(date)) continue;
              out.transactions.push({ id: "eb:" + (x.entry_reference ?? x.transaction_id ?? `${acc.uid}:${date}:${amt}:${label}`), date, label, amount: amt, bank: bankShort(l.aspsp) });
            }
            ck = t.continuation_key ?? null; n++;
          } while (ck && n < 20);
        } catch (e) {
          const st = e instanceof EbError ? e.status : 0;
          out.errors.push({ bank: bankShort(l.aspsp), status: st });
          if (st === 401 || st === 403 || st === 422) await admin.from("bank_links").update({ status: "expired" }).eq("id", l.id);
        }
      }
      const { data: all } = await admin.from("bank_links").select("aspsp,status,valid_until").eq("user_id", user.id).in("status", ["ok", "expired"]);
      out.links = (all ?? []).map((x: any) => ({ bank: bankShort(x.aspsp), status: x.status, valid_until: x.valid_until }));
      return json(out);
    }

    if (body.action === "status") {
      const { data: all } = await admin.from("bank_links").select("aspsp,status,valid_until").eq("user_id", user.id).in("status", ["ok", "expired"]);
      return json({ links: (all ?? []).map((x: any) => ({ bank: bankShort(x.aspsp), status: x.status, valid_until: x.valid_until })) });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "bank_error", status: e instanceof EbError ? e.status : 500, detail: e instanceof EbError ? e.body : String((e as Error).message ?? e) }, 502);
  }
});
