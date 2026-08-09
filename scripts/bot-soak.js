#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const seconds = Math.max(1, parseInt(process.env.BOT_SOAK_SECONDS || '600', 10));
const botCount = Math.max(1, parseInt(process.env.BOT_SOAK_COUNT || '8', 10));
const basePort = Math.max(1024, parseInt(process.env.BOT_SOAK_PORT || '3300', 10));
const reports = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runPhase(label, botCap, port) {
    const reportPath = path.join(root, `.bot-soak-${process.pid}-${label}.json`);
    try { fs.unlinkSync(reportPath); } catch { }

    const child = spawn(process.execPath, ['--no-lazy', 'index.js'], {
        cwd: root,
        env: {
            ...process.env,
            SINGLE_PROCESS: 'true',
            PORT: String(port),
            BOT_CAP: String(botCap),
            BOT_SOAK_MODE: 'true',
            BOT_SOAK_SECONDS: String(seconds),
            BOT_SOAK_REPORT: reportPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const deadline = Date.now() + (seconds + 30) * 1000;
    let report;
    while (Date.now() < deadline) {
        if (fs.existsSync(reportPath)) {
            try {
                report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                break;
            } catch { }
        }
        if (child.exitCode !== null) break;
        await sleep(250);
    }

    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    try { fs.unlinkSync(reportPath); } catch { }

    if (!report) {
        throw new Error(`${label} phase did not produce a report${stderr ? `: ${stderr.trim()}` : ''}`);
    }
    reports.push({ label, report });
    return report;
}

function compare(empty, loaded) {
    const summary = loaded.summary || {};
    const emptyMspt = empty.msptAverage || 0;
    const loadedMspt = loaded.msptAverage || 0;
    const bankRate = summary.botInstances ? summary.botsBankedAtLeastOnce / summary.botInstances : 0;
    const msptRatio = emptyMspt > 0 ? loadedMspt / emptyMspt : null;
    return {
        stuckEventsPerBotPerMinute: summary.stuckEventsPerBotPerMinute || 0,
        bankRate,
        wanderPercent: summary.wanderPercent || 0,
        stationaryBotsOver3s: summary.stationaryBotsOver3s || 0,
        emptyMspt,
        loadedMspt,
        msptRatio,
        pass: {
            stuckEventsPerBotPerMinute: (summary.stuckEventsPerBotPerMinute || 0) < 0.2,
            botsBankedAtLeastOnce: bankRate > 0.8,
            wanderPercent: (summary.wanderPercent || 0) < 25,
            stationaryBotsOver3s: (summary.stationaryBotsOver3s || 0) === 0,
            msptWithinTwentyPercent: msptRatio == null ? null : msptRatio <= 1.2,
        },
    };
}

(async () => {
    const empty = await runPhase('empty', 0, basePort);
    const loaded = await runPhase('bots', botCount, basePort + 1);
    console.log(JSON.stringify({
        seconds,
        botCount,
        baseline: empty,
        loaded,
        comparison: compare(empty, loaded),
    }, null, 2));
})().catch(error => {
    console.error(`[BOT SOAK] ${error.message}`);
    process.exitCode = 1;
});
