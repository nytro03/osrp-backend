// server.js — MODE DIAGNOSTIC
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

// ENV
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_SECRET    = process.env.TWITCH_SECRET;
const TWITCH_MAX_PAGES = parseInt(process.env.TWITCH_MAX_PAGES || "50", 10); // ↑ profondeur pour test

// Regex ultra-large : OSRP, OS RP, O.S.R.P, old school rp, oldschool rp, osrpfr…
const OSRP_RE = new RegExp(
  [
    "o\\s*\\.?\\s*s\\s*\\.?\\s*r\\s*\\.?\\s*p", // OSRP, OS RP, O.S.R.P
    "old\\s*school\\s*r\\s*p",                 // old school rp
    "oldschool\\s*r\\s*p",                     // oldschool rp
    "osrp\\w*"                                 // osrpfr, osrp_, etc.
  ].join("|"),
  "i"
);

// Health
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasClientId: !!TWITCH_CLIENT_ID,
    hasSecret: !!TWITCH_SECRET,
    maxPages: TWITCH_MAX_PAGES
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

// Scan helix/streams en pagination + logs par page
async function getTwitchStreams({ collectSample=false } = {}) {
  const token = await getTwitchToken();
  if (!token) return { results: [], sample: [] };

  const headers = {
    // certaines implémentations préfèrent "Client-ID", d’autres "Client-Id" — on met les deux
    "Client-ID": TWITCH_CLIENT_ID,
    "Client-Id": TWITCH_CLIENT_ID,
    "Authorization": `Bearer ${token}`,
  };

  const results = [];
  const sample  = []; // pour /debug-sample
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

    // remplir l’échantillon (premiers 50 titres scannés)
    if (collectSample && sample.length < 50) {
      for (const s of items) {
        if (sample.length >= 50) break;
        sample.push({ title: s.title, user: s.user_name, lang: s.language, viewers: s.viewer_count });
      }
    }

    // filtrage par titre OSRP
    let pageMatches = 0;
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
          language : s.language
        });
        pageMatches++;
      }
    }

    console.log(`Page ${page+1}: ${items.length} streams scannés, ${pageMatches} match OSRP`);

    cursor = data?.pagination?.cursor || null;
    if (!cursor || items.length === 0) break;
  }

  // déduplique par URL
  const uniq = new Map();
  for (const s of results) {
    const key = (s.url || "").toLowerCase();
    if (key && !uniq.has(key)) uniq.set(key, s);
  }

  return { results: Array.from(uniq.values()), sample };
}

// TikTok (placeholder)
async function getTiktokStreams() { return []; }

// API principale — n’échoue jamais
app.get("/streams", async (_req, res) => {
  try {
    const [{ results: tw }, tt] = await Promise.all([
      getTwitchStreams(),
      getTiktokStreams()
    ]);
    res.json([...(tw || []), ...(tt || [])]);
  } catch (e) {
    console.warn("streams aggregation error:", e);
    res.json([]);
  }
});

// Debug : combien trouvés + échantillon
app.get("/debug-osrp", async (_req, res) => {
  const { results } = await getTwitchStreams();
  res.json({ count: results.length, sample: results.slice(0, 10) });
});

// Debug : premiers titres scannés (pour vérifier que le scan marche)
app.get("/debug-sample", async (_req, res) => {
  const { sample } = await getTwitchStreams({ collectSample: true });
  res.json({ scannedSampleCount: sample.length, sample });
});

// Static + root
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`✅ Backend & Web en ligne sur port ${PORT}`);
});
