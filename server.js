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

// Vars Twitch
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_SECRET    = process.env.TWITCH_SECRET;

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, hasClientId: !!TWITCH_CLIENT_ID, hasSecret: !!TWITCH_SECRET });
});

// OAuth Twitch
async function getTwitchToken() {
  if (!TWITCH_CLIENT_ID || !TWITCH_SECRET) return null;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_SECRET}&grant_type=client_credentials`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) return null;
  const data = await r.json();
  return data.access_token;
}

// Streams Twitch (recherche + filtre)
async function getTwitchStreams() {
  const token = await getTwitchToken();
  if (!token) return []; // Pas de clés → on n'échoue pas

  const headers = { "Client-ID": TWITCH_CLIENT_ID, "Authorization": `Bearer ${token}` };
  const queries = ["osrp", "oldschoolrp", "old school rp"];
  const found = new Map();

  for (const q of queries) {
    const r = await fetch(`https://api.twitch.tv/helix/search/channels?query=${encodeURIComponent(q)}&live_only=true`, { headers });
    if (!r.ok) continue;
    const data = await r.json();
    (data.data || []).forEach(ch => { if (ch.is_live) found.set(ch.broadcaster_login, ch.display_name); });
  }
  if (found.size === 0) return [];

  const logins = Array.from(found.keys());
  const qs     = logins.map(l => `user_login=${encodeURIComponent(l)}`).join("&");
  const r2     = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, { headers });
  if (!r2.ok) return [];
  const data2  = await r2.json();

  const re = /osrp|old\s*school\s*rp/i;
  return (data2.data || [])
    .filter(s => re.test(s.title))
    .map(s => ({
      platform : "twitch",
      name     : s.user_name,
      title    : s.title,
      thumbnail: s.thumbnail_url.replace("{width}","640").replace("{height}","360"),
      url      : `https://twitch.tv/${s.user_login}`,
      viewers  : s.viewer_count
    }));
}

// TikTok placeholder
async function getTiktokStreams() { return []; }

// API streams (n'échoue jamais)
app.get("/streams", async (_req, res) => {
  const out = [];
  try {
    const [tw, tt] = await Promise.allSettled([getTwitchStreams(), getTiktokStreams()]);
    if (tw.status === "fulfilled") out.push(...tw.value);
    if (tt.status === "fulfilled") out.push(...tt.value);
  } catch {}
  res.json(out);
});

// ✅ Sert les fichiers statiques
app.use(express.static(path.join(__dirname, "public")));

// ✅ Route racine renvoie index.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// (Optionnel) SPA fallback (toutes autres routes → index)
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`✅ Backend & Web en ligne sur port ${PORT}`));
