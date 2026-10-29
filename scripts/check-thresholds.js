#!/usr/bin/env node
/**
 * Performance quality gate.
 * Reads the statistics.json produced by the JMeter HTML dashboard, compares it with an
 * SLA thresholds file, prints a Markdown summary (for the GitHub run summary) and exits
 * non-zero if any SLA is breached — so a slow build fails like a broken one.
 *
 * Usage: node check-thresholds.js <statistics.json> <thresholds.json> <profile> [summary-out.json]
 */
const fs = require("fs");

const [statsPath, thresholdsPath, profile = "run", summaryOut] = process.argv.slice(2);
if (!statsPath || !thresholdsPath) {
  console.error("Usage: node check-thresholds.js <statistics.json> <thresholds.json> <profile> [summary-out.json]");
  process.exit(2);
}

const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
const gate = JSON.parse(fs.readFileSync(thresholdsPath, "utf8"));
const fmt = (n, d = 0) => (typeof n === "number" ? n.toFixed(d) : "n/a");

const breaches = [];
function check(label, rules = {}) {
  const s = stats[label];
  if (!s) {
    breaches.push(`${label}: no samples recorded`);
    return;
  }
  // JMeter dashboard: pct1ResTime = p90, pct2ResTime = p95, pct3ResTime = p99
  if (rules.maxErrorPct !== undefined && s.errorPct > rules.maxErrorPct)
    breaches.push(`${label}: error rate ${fmt(s.errorPct, 2)}% > ${rules.maxErrorPct}%`);
  if (rules.maxP95Ms !== undefined && s.pct2ResTime > rules.maxP95Ms)
    breaches.push(`${label}: p95 ${fmt(s.pct2ResTime)} ms > ${rules.maxP95Ms} ms`);
  if (rules.minThroughputPerSec !== undefined && s.throughput < rules.minThroughputPerSec)
    breaches.push(`${label}: throughput ${fmt(s.throughput, 1)}/s < ${rules.minThroughputPerSec}/s`);
}

check("Total", gate.total);
for (const [label, rules] of Object.entries(gate.transactions || {})) check(label, rules);

// ---- Markdown summary: transactions first, then samplers, then the total ----
const labels = Object.keys(stats).filter((l) => l !== "Total");
const order = (l) => (l.startsWith("T") ? 0 : 1);
labels.sort((a, b) => order(a) - order(b) || a.localeCompare(b));

const rows = [...labels, "Total"].map((l) => {
  const s = stats[l];
  const name = l === "Total" ? "**Total**" : l;
  return `| ${name} | ${s.sampleCount} | ${fmt(s.errorPct, 2)}% | ${fmt(s.meanResTime)} | ${fmt(s.pct1ResTime)} | ${fmt(s.pct2ResTime)} | ${fmt(s.pct3ResTime)} | ${fmt(s.throughput, 1)} |`;
});

const verdict = breaches.length === 0 ? "✅ **PASSED** — all SLAs met" : "❌ **FAILED** — SLA breached";
console.log(`### Performance: \`${profile}\` profile\n`);
console.log(`${verdict}\n`);
console.log("| Label | Samples | Errors | Mean ms | p90 ms | p95 ms | p99 ms | Req/s |");
console.log("|---|---|---|---|---|---|---|---|");
rows.forEach((r) => console.log(r));
if (breaches.length) {
  console.log("\n**Breaches**\n");
  breaches.forEach((b) => console.log(`- ${b}`));
}
console.log("");

if (summaryOut) {
  const t = stats.Total;
  fs.writeFileSync(summaryOut, JSON.stringify({
    profile,
    passed: breaches.length === 0,
    breaches,
    samples: t.sampleCount,
    errorPct: t.errorPct,
    meanMs: t.meanResTime,
    p95Ms: t.pct2ResTime,
    p99Ms: t.pct3ResTime,
    throughput: t.throughput,
    generatedAt: new Date().toISOString(),
  }, null, 2));
}

process.exit(breaches.length === 0 ? 0 : 1);
