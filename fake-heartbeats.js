#!/usr/bin/env node
// hackatime vscode heartbeat generator - matches real account metadata & cadence

const https = require("https");
const fs = require("fs");
const os = require("os");

const API_KEY = process.env.HACKATIME_API_KEY || readApiKey();
const USER_ID = "39646";
const BASE = "hackatime.hackclub.com";
const PROJECT = "Arras2";
const MACHINE = "Raghavans-MacBook-Air.local";
const UA = "wakatime/v2.22.0 (darwin-25.5.0-arm64) go1.26.5 vscode/1.116.0 vscode-wakatime/30.2.1";
const BRANCH = "dig-wars";
const TARGET_CODED_SECONDS = 1 * 3600;  // 1h of wakatime-logged time (gaps capped at 2min)
const DAYS = 3;  // aug 20, 21, 22
const FIRST_DAY = "2026-08-20";
const MAX_BATCH = 100;
const DRY = process.argv.includes("--dry-run");

// real files observed on this account (weighted)
const FILES = [
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/public/client/app.js",            lang: "JavaScript", lines: 900, w: 20 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/public/client/terrainRenderer.js", lang: "JavaScript", lines: 600, w: 14 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/game/terrain/terrainGrid.js", lang: "JavaScript", lines: 800, w: 12 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/game/network/sockets.js",  lang: "JavaScript", lines: 500, w: 8 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/index.js",                         lang: "JavaScript", lines: 300, w: 6 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/TASKS.md",                         lang: "Markdown",  lines: 150, w: 6 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/game/terrain/gems.js",     lang: "JavaScript", lines: 250, w: 5 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/public/client/canvas.js",         lang: "JavaScript", lines: 400, w: 5 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/config.js",                 lang: "JavaScript", lines: 200, w: 4 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/game/gamemodes/config/dig_wars.js", lang: "JavaScript", lines: 350, w: 4 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/game/entities/entity.js",  lang: "JavaScript", lines: 700, w: 4 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/loaders/global.js",        lang: "JavaScript", lines: 300, w: 3 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/public/client/socketinit.js",     lang: "JavaScript", lines: 250, w: 3 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/public/client/color.js",          lang: "JavaScript", lines: 100, w: 2 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/public/client/gameDraw.js",       lang: "JavaScript", lines: 500, w: 2 },
  { entity: "/Users/raghavan/Documents/GitHub/Arras2/server/game/gamemodeManager.js",  lang: "JavaScript", lines: 150, w: 2 },
];

// real per-day windows: late night + afternoon/evening
const WINDOWS = [
  [ 1, 3 ],   // 01:00 - 03:00 (account's late-night pattern)
  [ 9, 12 ],  // 09:00 - 12:00
  [ 14, 17 ], // 14:00 - 17:00
  [ 19, 23 ], // 19:00 - 23:00
];

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const weightedPick = (items) => {
  const total = items.reduce((s, i) => s + i.w, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.w; if (r <= 0) return it; }
  return items[items.length - 1];
};

// day base = LOCAL midnight, so the WINDOWS hours below are your local wall-clock
// (hackatime renders heartbeats in your local tz; building UTC made it shift -7h)
function dayOffset(dayIndex) {
  const [y, m, d] = FIRST_DAY.split("-").map(Number);
  return new Date(y, m - 1, d + dayIndex, 0, 0, 0, 0).getTime() / 1000;
}

// typing cadence (in-burst): matches real p50/p75/p90 (18/65/160)
function burstGap() {
  const r = Math.random();
  if (r < 0.55) return rand(8, 20);       // typing (median ~14)
  if (r < 0.8) return rand(20, 65);       // normal editing
  if (r < 0.95) return rand(65, 119);     // reading/thinking (under 2min cap)
  return rand(90, 119);
}

function buildBurst(startTime, fileState, hbs, codedSeconds) {
  let t = startTime;
  const burstHbs = [];
  const burstCount = randInt(6, 22);
  let file = weightedPick(FILES);
  let lineno = randInt(5, Math.floor(file.lines * 0.6));
  let fileLines = file.lines;
  let sinceSwitch = 0;
  let burstTime = 0;

  for (let i = 0; i < burstCount && t >= 0; i++) {
    if (sinceSwitch > randInt(6, 30)) {
      file = weightedPick(FILES);
      lineno = randInt(5, Math.floor(file.lines * 0.6));
      fileLines = file.lines;
      sinceSwitch = 0;
    }
    sinceSwitch++;

    const isWrite = Math.random() < 0.42;
    lineno = Math.max(1, Math.min(file.lines, lineno + randInt(-8, 8)));
    if (isWrite && Math.random() < 0.15) fileLines += randInt(1, 6);
    const cursorpos = Math.max(0, Math.floor(lineno * 45 + rand(-30, 80)));

    const hb = {
      entity: file.entity,
      type: "file",
      category: "coding",
      time: Math.floor(t),
      project: PROJECT,
      language: file.lang,
      editor: "vscode",
      operating_system: "macos",
      machine: MACHINE,
      branch: BRANCH,
      user_agent: UA,
      is_write: isWrite,
      lines: fileLines,
      lineno,
      cursorpos,
      project_root_count: 1,
      dependencies: [],
    };
    if (isWrite && Math.random() < 0.3) {
      hb.line_additions = randInt(1, 25);
      hb.line_deletions = randInt(0, 6);
    }
    burstHbs.push(hb);

    // step to next heartbeat: gap contributes min(gap, 120) to coded time
    const gap = burstGap();
    burstTime += Math.min(gap, 120);
    codedSeconds += Math.min(gap, 120);
    t += gap;
  }

  return { burstHbs, codedSeconds, nextTime: t };
}

function buildAll() {
  const all = [];
  let codedSeconds = 0;
  const avgPerDay = TARGET_CODED_SECONDS / DAYS; // ~2.14h/day

  // per-day session plan: pick 1-3 windows/day across 14 days
  for (let d = 0; d < DAYS && codedSeconds < TARGET_CODED_SECONDS; d++) {
    const dayBase = dayOffset(d);
    // daily budget: 0.5x-1.5x of average, remaining budget aware
    const remainingDays = DAYS - d;
    const remainingBudget = TARGET_CODED_SECONDS - codedSeconds;
    const maxByDaysLeft = remainingBudget / remainingDays * 1.5;
    const dayCap = Math.min(avgPerDay * (0.6 + Math.random() * 0.9), maxByDaysLeft);
    const dayStart = codedSeconds;

    const windows = WINDOWS.slice().sort(() => Math.random() - 0.5);
    const nWins = Math.random() < 0.7 ? 2 : (Math.random() < 0.5 ? 1 : 3);

    for (let wi = 0; wi < Math.min(nWins, windows.length) && codedSeconds - dayStart < dayCap && codedSeconds < TARGET_CODED_SECONDS; wi++) {
      const [sh, eh] = windows[wi];
      let t = dayBase + sh * 3600 + rand(0, 600);
      const winEnd = dayBase + eh * 3600 - rand(0, 900);

      while (t < winEnd && codedSeconds - dayStart < dayCap && codedSeconds < TARGET_CODED_SECONDS) {
        const { burstHbs, codedSeconds: cs, nextTime } = buildBurst(t, null, all, codedSeconds);
        all.push(...burstHbs);
        codedSeconds = cs;

        // natural break 2-18 min between bursts (doesn't count toward coded time)
        const pause = rand(120, 1100);
        t = nextTime + pause;
      }
    }
  }

  return all;
}

function postBatch(batch) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ heartbeats: batch });
    const req = https.request({
      hostname: BASE,
      path: `/api/hackatime/v1/users/${USER_ID}/heartbeats.bulk`,
      method: "POST",
      headers: {
        "Authorization": "Bearer " + API_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": UA,
        "X-Machine-Name": MACHINE,
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 400)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function readApiKey() {
  try {
    const raw = fs.readFileSync(os.homedir() + "/.wakatime.cfg", "utf8");
    const m = raw.match(/^\s*api_key\s*=\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return "";
}

(async () => {
  if (!API_KEY) { console.error("no api key found (set HACKATIME_API_KEY or ~/.wakatime.cfg)"); process.exit(1); }

  const hbs = buildAll();

  // verify coded time = sum of min(gap,120)
  let coded = 0;
  const sorted = hbs.slice().sort((a, b) => a.time - b.time);
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].time - sorted[i - 1].time;
    if (g > 0) coded += Math.min(g, 120);
  }
  console.log(`generated ${hbs.length} heartbeats, coded=${(coded / 3600).toFixed(2)}h (target ${(TARGET_CODED_SECONDS / 3600)}h)`);

  // gap distribution
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].time - sorted[i - 1].time;
    if (g > 0 && g < 3600) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const p = (q) => Math.round(gaps[Math.floor(gaps.length * q)] || 0);
  console.log(`gap p50=${p(0.5)}s p75=${p(0.75)}s p90=${p(0.9)}s (real: 18/65/160)`);

  const perDay = {};
  hbs.forEach((h) => {
    const d = new Date(h.time * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    perDay[key] = (perDay[key] || 0) + 1;
  });
  console.log("per-day (local):", JSON.stringify(perDay));

  // sanity checks
  const bad = hbs.filter((h) => h.editor !== "vscode" || h.entity.includes("test.txt") || !h.entity);
  if (bad.length) { console.error("INVALID heartbeat:", bad[0]); process.exit(1); }

  if (DRY) { console.log("dry run - not sending"); process.exit(0); }

  let sent = 0, accepted = 0;
  for (let i = 0; i < hbs.length; i += MAX_BATCH) {
    const batch = hbs.slice(i, i + MAX_BATCH);
    try {
      const res = await postBatch(batch);
      const ok = (res.responses || []).filter((r) => r.id).length;
      accepted += ok;
      sent += batch.length;
      console.log(`sent ${sent}/${hbs.length} (ok=${ok})`);
    } catch (e) {
      console.error(`batch ${i} failed: ${e.message}`);
      if (/does not exist|unauthorized|forbidden|401|403|404/i.test(e.message)) { console.error("aborting"); process.exit(1); }
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log(`done. sent=${sent} accepted=${accepted}`);
})().catch((e) => { console.error("fatal:", e.message); process.exit(1); });