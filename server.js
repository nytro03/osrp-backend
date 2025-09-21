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

// ────────── Config ──────────
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_SECRET    = process.env.TWITCH_SECRET;
const GTA_GAME_IDS     = ["32982", "491318"];   // GTA V + FiveM
const WHITELIST_LOGINS = (process.env.WHITELIST_LOGINS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

// Regex large : OSRP, OS RP, O.S.R.P, old school rp wl, osrpwl, etc.
const OSRP_RE = new RegExp(
  [
    "o\\s*\\.?\\s*s\\s*\\.?\\s*r\\s*\\.?\\s*p",
    "osrp\\s*wl",
    "old\\s*school\\s*rp(\\s*wl)?",
    "oldschool\\s*rp(\\s*wl)?",
    "osrp\\w*"
  ].join("|"),
  "i"
);

// ────────── Health ──────────
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    clientId: !!TWITCH_CLIENT_ID,
    secret: !!TWITCH_SECRET,
    whitelist: WHITELIST_LOGINS
  });
});

// ────────── Token Twitch ──────────
let cachedToken = null;
let tokenExpiry = 0;
async function getTwitchToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const url = `https://id.twitch.tv/oauth2/token` +
              `?client_id=${TWITCH_CLIENT_ID}` +
              `&client_secret=${TWITCH_SECRET}` +
              `&grant_type=client_credentials`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) {
    console.warn("Twitch token error:", r.status, await r.text().catch(()=> ""));
    return null;
  }
  const data = await r.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ────────── Scan “illimité” ──────────
async function getTwitchStreams() {
  const token = await getTwitchToken();
  if (!token) return [];

  const headers = {
    "Client-Id": TWITCH_CLIENT_ID,
    "Authorization": `Bearer ${token}`
  };

  const results = [];
  let cursor = null;
  let page   = 0;

  while (true) {
    page++;
    const url = new URL("https://api.twitch.tv/helix/streams");
    url.searchParams.set("first", "100");
    if (cursor) url.searchParams.set("after", cursor);

    const r = await fetch(url, { headers });
    if (!r.ok) {
      console.warn("helix/streams error:", r.status);
      break;
    }

    const data  = await r.json();
    const items = Array.isArray(data.data) ? data.data : [];
    if (!items.length) break;

    for (const s of items) {
      const login   = (s.user_login || "").toLowerCase();
      const title   = s.title || "";
      const isGTA   = GTA_GAME_IDS.includes(String(s.game_id));
      const isWhite = WHITELIST_LOGINS.includes(login);
      const matchT  = OSRP_RE.test(title);

      if (isGTA && (matchT || isWhite)) {
        results.push({
          platform : "twitch",
          name     : s.user_name,
          title    : s.title,
          url      : `https://twitch.tv/${s.user_login}`,
          thumbnail: (s.thumbnail_url || "")
                       .replace("{width}", "640")
                       .replace("{height}", "360"),
          viewers  : s.viewer_count,
          game     : s.game_name
        });
      }
    }

    console.log(`Page ${page}: ${items.length} streams scannés, total matches: ${results.length}`);
    cursor = data.pagination?.cursor || null;
    if (!cursor) break;   // fin réelle
  }

  const uniq = new Map();
  for (const s of results) uniq.set(s.url.toLowerCase(), s);
  return Array.from(uniq.values()).sort((a,b)=>b.viewers-a.viewers);
}

// TikTok placeholder
async function getTiktokStreams() { return []; }

// API principale
app.get("/streams", async (_req, res) => {
  try {
    const [tw, tt] = await Promise.allSettled([getTwitchStreams(), getTiktokStreams()]);
    const out = [
      ...(tw.status === "fulfilled" ? tw.value : []),
      ...(tt.status === "fulfilled" ? tt.value : [])
    ];
    res.json(out);
  } catch (e) {
    console.warn("streams error:", e);
    res.json([]);
  }
});

// Debug
app.get("/debug-osrp", async (_req, res) => {
  const data = await getTwitchStreams();
  res.json({ count: data.length, sample: data.slice(0, 10) });
});

// Static + root
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("*", (_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, () => {
  console.log(`✅ Backend OSRP en ligne sur port ${PORT} (scan illimité)`);
});

