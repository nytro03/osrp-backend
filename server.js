// server.js
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
const TWITCH_MAX_PAGES = parseInt(process.env.TWITCH_MAX_PAGES || "8", 10); // ~8*100 = 800 streams

// Regex large : "osrp" ou "old school rp" (tolère espaces multiples, casse ignorée)
const OSRP_RE = /osrp|old\s*school\s*rp/i;

// ─────────────────────────────────────────────────────────────
// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasClientId: !!TWITCH_CLIENT_ID,
    hasSecret: !!TWITCH_SECRET,
    maxPages: TWITCH_MAX_PAGES
  });
});

// ─────────────────────────────────────────────────────────────
// OAuth
async function getTwitchToken() {
  if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) return null;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_SECRET}&grant_type=client_credentials`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) {
    const t = await r.text().catch(()=>"");
    console.warn("Twitch token error:", r.status, t);
    return null;
  }
  const data = await r.json();
  return data.access_token;
}

// ─────────────────────────────────────────────────────────────
// Balaye helix/streams en pagination et filtre par titre OSRP
async function getTwitchStreams() {
  const token = await getTwitchToken();
  if (!token) return [];

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
      const t = await r.text().catch(()=>"");
      console.warn("helix/streams error:", r.status, t);
      break;
    }
    const data = await r.json();
    const items = Array.isArray(data.data) ? data.data : [];

    for (const s of items) {
      if (OSRP_RE.test(s.title || "")) {
        results.push({
          platform : "twitch",
          name     : s.user_name,
          title    : s.title,
          thumbnail: (s.thumbnail_url || "").replace("{width}","640").replace("{height}","360"),
          url      : `https://twitch.tv/${s.user_login}`,
          viewers  : s.viewer_count
        });
      }
    }

    cursor = data?.pagination?.cursor || null;
    if (!cursor || items.length === 0) break; // plus de pages
  }

  // déduplique par login (URL unique)
  const uniq = new Map();
  for (const s of results) {
    const key = (s.url || "").toLowerCase();
    if (key && !uniq.has(key)) uniq.set(key, s);
  }
  return Array.from(uniq.values());
}

// TikTok (placeholder pour l’instant)
async function getTiktokStreams() {
  return []; // à brancher plus tard si besoin
}

// ─────────────────────────────────────────────────────────────
// API : n'échoue jamais (retourne [] en cas de problème)
app.get("/streams", async (_req, res) => {
  const out = [];
  try {
    const [tw, tt] = await Promise.allSettled([getTwitchStreams(), getTiktokStreams()]);
    if (tw.status === "fulfilled") out.push(...tw.value);
    if (tt.status === "fulfilled") out.push(...tt.value);
  } catch (e) {
    console.warn("streams aggregation error:", e);
  }
  res.json(out);
});

// ─────────────────────────────────────────────────────────────
// Fichiers statiques + racine
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// (Optionnel) fallback SPA
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Backend & Web en ligne sur port ${PORT}`);
});
