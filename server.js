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
const TWITCH_CLIENT_ID   = process.env.TWITCH_CLIENT_ID;
const TWITCH_SECRET      = process.env.TWITCH_SECRET;
const TWITCH_MAX_PAGES   = parseInt(process.env.TWITCH_MAX_PAGES || "25", 10);  // ↑ profondeur
const TWITCH_LANGUAGE    = (process.env.TWITCH_LANGUAGE || "").trim().toLowerCase(); // ex: "fr"
const TWITCH_GAME_IDS    = (process.env.TWITCH_GAME_IDS || "").split(",").map(s=>s.trim()).filter(Boolean); // ex: "32982,491318" (GTA V, FiveM)

// Regex UBER-large : osrp / os rp / o.s.r.p / osrpfr / old school rp / oldschool rp
const OSRP_RE = new RegExp(
  [
    "o\\s*\\.?\\s*s\\s*\\.?\\s*r\\s*\\.?\\s*p",   // OSRP sous toutes les formes (OS RP, O.S.R.P, etc.)
    "old\\s*school\\s*r\\s*p",                   // old school rp (tolère espaces)
    "oldschool\\s*r\\s*p",                       // oldschool rp
    "osrp\\w*"                                   // osrpfr, osrp_...
  ].join("|"),
  "i"
);

// ─────────────────────────────────────────────────────────────
// Health
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasClientId: !!TWITCH_CLIENT_ID,
    hasSecret: !!TWITCH_SECRET,
    maxPages: TWITCH_MAX_PAGES,
    language: TWITCH_LANGUAGE || null,
    gameIds: TWITCH_GAME_IDS
  });
});

// OAuth
async function getTwitchToken() {
  if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) return null;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_SECRET}&grant_type=client_credentials`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) return null;
  const data = await r.json();
  return data.access_token;
}

// Scan helix/streams en pagination + filtres langue/jeux + regex titre
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
    // filtre langue pour réduire le bruit et pousser plus deep
    if (TWITCH_LANGUAGE) url.searchParams.set("language", TWITCH_LANGUAGE);
    // filtre jeu si fourni (réduit énormément le bruit si tu connais vos catégories)
    for (const gid of TWITCH_GAME_IDS) url.searchParams.append("game_id", gid);

    const r = await fetch(url, { headers });
    if (!r.ok) break;

    const data = await r.json();
    const items = Array.isArray(data.data) ? data.data : [];

    for (const s of items) {
      const title = s.title || "";
      if (OSRP_RE.test(title)) {
        results.push({
          platform : "twitch",
          name     : s.user_name,
          title    : s.title,
          thumbnail: (s.thumbnail_url || "").replace("{width}","640").replace("{height}","360"),
          url      : `https://twitch.tv/${s.user_login}`,
          viewers  : s.viewer_count,
          language : s.language,
          game_id  : s.game_id
        });
      }
    }

    cursor = data?.pagination?.cursor || null;
    if (!cursor || items.length === 0) break;
  }

  // déduplique par login (URL unique)
  const uniq = new Map();
  for (const s of results) {
    const key = (s.url || "").toLowerCase();
    if (key && !uniq.has(key)) uniq.set(key, s);
  }
  return Array.from(uniq.values());
}

// TikTok placeholder
async function getTiktokStreams() { return []; }

// API — n’échoue jamais
app.get("/streams", async (_req, res) => {
  const out = [];
  try {
    const [tw, tt] = await Promise.allSettled([getTwitchStreams(), getTiktokStreams()]);
    if (tw.status === "fulfilled") out.push(...tw.value);
    if (tt.status === "fulfilled") out.push(...tt.value);
  } catch {}
  res.json(out);
});

// DEBUG : petite aide visuelle (combien scannés / premiers titres matchés)
app.get("/debug-osrp", async (_req, res) => {
  const data = await getTwitchStreams();
  res.json({
    count: data.length,
    sample: data.slice(0, 10)
  });
});

// Static + root
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Backend & Web en ligne sur port ${PORT}`);
});
