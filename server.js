// server.js — OSRP streams (Twitch deep scan + whitelist + debug)
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// ENV
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_SECRET    = process.env.TWITCH_SECRET;

// profondeur du scan: 100 pages = ~10 000 lives
const TWITCH_MAX_PAGES = parseInt(process.env.TWITCH_MAX_PAGES || "100", 10);

// Whitelist de logins Twitch (séparés par virgule): "login1,login2"
const WHITELIST_LOGINS = (process.env.WHITELIST_LOGINS || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Regex ULTRA-large (OSRP, OS RP, O.S.R.P, old school rp, oldschool rp, osrpfr, etc.)
const OSRP_RE = new RegExp(
  [
    "o\\s*\\.?\\s*s\\s*\\.?\\s*r\\s*\\.?\\s*p", // OSRP / OS RP / O.S.R.P
    "old\\s*school\\s*r\\s*p",                 // old school rp
    "oldschool\\s*r\\s*p",                     // oldschool rp
    "osrp\\w*"                                 // osrpfr, osrp_, etc.
  ].join("|"),
  "i"
);

// ─────────────────────────────────────────────────────────────
// Health (diagnostic rapide)
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasClientId: !!TWITCH_CLIENT_ID,
    hasSecret: !!TWITCH_SECRET,
    maxPages: TWITCH_MAX_PAGES,
    whitelist: WHITELIST_LOGINS
  });
});

// OAuth
async function getTwitchToken() {
  if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) return null;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_SECRET}&grant_type=client_credentials`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) {
    console.warn("Twitch token error:", r.status, await r.text().catch(()=> ""));
    return null;
  }
  const data = await r.json();
  return data.access_token;
}

// Deep scan global de helix/streams + filtre titre OSRP + union whitelist
async function getTwitchStreams() {
  const token = await getTwitchToken();
  if (!token) return [];

  // Headers officiels (casse exacte)
  const headers = {
    "Client-Id": TWITCH_CLIENT_ID,
    "Authorization": `Bearer ${token}`,
  };

  const results = [];
  let cursor = null;

  for (let page = 0; page < TWITCH_MAX_PAGES; page++) {
    const url = new URL("https://api.twitch.tv/helix/streams");
    url.searchParams.set("first", "100");
    if (cursor) url.searchParams.set("after", cursor);

    const r = await fetch(url, { headers });
    if (!r.ok) {
      console.warn("helix/streams error:", r.status, await r.text().catch(()=> ""));
      break;
    }
    const data = await r.json();
    const items = Array.isArray(data.data) ? data.data : [];

    let pageMatches = 0;

    for (const s of items) {
      const title = s.title || "";
      const login = (s.user_login || "").toLowerCase();

      const isWhitelisted = WHITELIST_LOGINS.includes(login);
      const matchesTitle  = OSRP_RE.test(title);

      if (isWhitelisted || matchesTitle) {
        results.push({
          platform : "twitch",
          name     : s.user_name,
          title    : s.title,
          thumbnail: (s.thumbnail_url || "").replace("{width}","640").replace("{height}","360"),
          url      : `https://twitch.tv/${s.user_login}`,
          viewers  : s.viewer_count,
          language : s.language
        });
        if (matchesTitle) pageMatches++;
      }
    }

    console.log(`Page ${page+1}: ${items.length} streams scannés, ${pageMatches} match OSRP`);

    cursor = data?.pagination?.cursor || null;
    if (!cursor || items.length === 0) break; // fin
  }

  // Déduplique par URL (login)
  const uniq = new Map();
  for (const s of results) {
    const key = (s.url || "").toLowerCase();
    if (key && !uniq.has(key)) uniq.set(key, s);
  }

  // Tri par viewers décroissant (utile pour l’affichage)
  return Array.from(uniq.values()).sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
}

// TikTok — placeholder (tu peux brancher plus tard)
async function getTiktokStreams() {
  return [];
}

// API principale — n’échoue jamais (au pire renvoie [])
app.get("/streams", async (_req, res) => {
  try {
    const [tw, tt] = await Promise.allSettled([getTwitchStreams(), getTiktokStreams()]);
    const out = [
      ...(tw.status === "fulfilled" ? tw.value : []),
      ...(tt.status === "fulfilled" ? tt.value : []),
    ];
    res.json(out);
  } catch (e) {
    console.warn("streams aggregation error:", e);
    res.json([]);
  }
});

// Debug: premiers titres scannés (preuve que le scan tourne)
app.get("/debug-sample", async (_req, res) => {
  const token = await getTwitchToken();
  if (!token) return res.json({ error: "no token" });

  const headers = { "Client-Id": TWITCH_CLIENT_ID, "Authorization": `Bearer ${token}` };
  const url = new URL("https://api.twitch.tv/helix/streams");
  url.searchParams.set("first", "100");
  const r = await fetch(url, { headers });
  if (!r.ok) return res.json({ error: "streams error", status: r.status });
  const data = await r.json();
  const items = Array.isArray(data.data) ? data.data : [];
  res.json({ scannedSampleCount: items.length, sample: items.slice(0, 50).map(s => ({ title: s.title, user: s.user_name, lang: s.language })) });
});

// Debug: résultats OSRP (count + sample)
app.get("/debug-osrp", async (_req, res) => {
  const data = await getTwitchStreams();
  res.json({ count: data.length, sample: data.slice(0, 10) });
});

// Fichiers statiques + racine
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`✅ Backend & Web en ligne sur port ${PORT}`);
});
