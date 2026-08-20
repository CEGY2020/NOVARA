#!/usr/bin/env node
/**
 * Unit tests for formatDateTime.js (MM-DD-YY HH:MM labels).
 */
"use strict";

var dt = require("./formatDateTime.js");
var fs = require("fs");
var path = require("path");
var failed = 0;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    failed += 1;
    console.error("FAIL " + label);
    console.error("  expected: " + JSON.stringify(expected));
    console.error("  actual:   " + JSON.stringify(actual));
    return;
  }
  console.log("ok   " + label);
}

function assert(cond, label) {
  assertEqual(Boolean(cond), true, label);
}

var morning = new Date(2026, 7, 14, 9, 44, 0);
var afternoon = new Date(2026, 7, 14, 14, 30, 5);
var noon = new Date(2026, 7, 14, 12, 0, 0);
var midnight = new Date(2026, 7, 14, 0, 5, 0);

assertEqual(dt.formatDate(morning), "08-14-26", "formatDate local morning");
assertEqual(
  dt.formatDateTime(morning),
  "08-14-26 09:44 AM",
  "formatDateTime 12-hour morning"
);
assertEqual(
  dt.formatDateTime(afternoon, { use24Hour: true }),
  "08-14-26 14:30",
  "formatDateTime 24-hour afternoon"
);
assertEqual(
  dt.formatDateTime(afternoon, { use24Hour: true, includeSeconds: true }),
  "08-14-26 14:30:05",
  "formatDateTime 24-hour with seconds"
);
assertEqual(dt.formatTime(noon), "12:00 PM", "formatTime noon is PM");
assertEqual(dt.formatTime(midnight), "12:05 AM", "formatTime midnight is AM");
assertEqual(
  dt.formatDateTime(noon),
  "08-14-26 12:00 PM",
  "formatDateTime noon"
);
assertEqual(dt.formatDisplay("2026-08-14"), "08-14-26", "date-only ISO");
assertEqual(
  dt.formatDisplay("2024-06-01"),
  "06-01-24",
  "date-only does not shift timezone"
);
assertEqual(dt.formatOrDash(""), "—", "empty becomes dash");
assertEqual(dt.formatOrDash("not-a-date"), "not-a-date", "invalid keeps raw");
assertEqual(dt.formatDate("bogus"), "", "invalid date returns empty");
assertEqual(
  dt.formatChartLabel(morning, "date"),
  "08-14-26",
  "chart label date mode"
);
assertEqual(
  dt.formatChartLabel(morning, "time"),
  "09:44 AM",
  "chart label time mode"
);
assertEqual(
  dt.formatChartLabel(morning),
  "08-14-26 09:44 AM",
  "chart label datetime mode"
);
assertEqual(
  dt.formatChartLabel(afternoon, "datetime24"),
  "08-14-26 14:30",
  "chart label 24-hour datetime"
);

assertEqual(
  dt.stripReadingSortKey("2026-08-07T20:45:00Z#SYS001"),
  "2026-08-07T20:45:00Z",
  "strip #SYS001 from composite reading key"
);
assertEqual(
  dt.stripReadingSortKey("2026-08-07T20:45:00Z"),
  "2026-08-07T20:45:00Z",
  "plain ISO timestamp is unchanged"
);

var composite = "2026-08-07T20:45:00Z#SYS001";
assertEqual(
  dt.formatAxisTick(composite, "datetime24"),
  "08-07-26 20:45",
  "axis tick formats composite key as MM-DD-YY HH:MM"
);
assertEqual(
  dt.formatDateTime(composite, { use24Hour: true }),
  "08-07-26 20:45",
  "formatDateTime 24h strips #SYS001"
);
assertEqual(
  dt.formatDateTime(composite),
  "08-07-26 08:45 PM",
  "formatDateTime 12h strips #SYS001"
);
assertEqual(
  dt.formatAxisTick(composite).indexOf("#") === -1,
  true,
  "axis tick never includes #SYS suffix"
);
assertEqual(
  dt.formatAxisTick("08-07-26 20:45", "datetime24"),
  "08-07-26 20:45",
  "already-formatted tick is passed through"
);

function simulateChartLabels(points) {
  return points.map(function (p) {
    return dt.formatAxisTick(p.t, "datetime24");
  });
}

function simulateTooltipTitle(label) {
  return dt.formatAxisTick(label, "datetime24");
}

var rawPoints = [
  { t: "2026-08-07T20:45:00Z#SYS001", t1: 120, t2: 110 },
  { t: "2026-08-07T21:00:00Z#SYS001", t1: 121, t2: 111 },
];
var labels = simulateChartLabels(rawPoints);
assertEqual(labels[0], "08-07-26 20:45", "chart data.labels[0] is MM-DD-YY HH:MM");
assertEqual(labels[1], "08-07-26 21:00", "chart data.labels[1] is MM-DD-YY HH:MM");
assert(
  labels.every(function (label) {
    return label.indexOf("#") === -1 && !/T/.test(label);
  }),
  "chart labels contain no ISO T or #SYS001"
);
assertEqual(
  simulateTooltipTitle(labels[0]),
  "08-07-26 20:45",
  "tooltip title uses formatted label"
);
assertEqual(
  simulateTooltipTitle(composite),
  "08-07-26 20:45",
  "tooltip title formats raw composite key if Chart.js still has it"
);

var html = fs.readFileSync(path.join(__dirname, "system-detail.html"), "utf8");
assert(html.indexOf("formatDateTime.js") !== -1, "system-detail.html loads formatDateTime.js");
assert(
  html.indexOf("formatDateTime.js") < html.indexOf("temperature-trends.js"),
  "formatDateTime.js is loaded before temperature-trends.js"
);

var trends = fs.readFileSync(path.join(__dirname, "temperature-trends.js"), "utf8");
assert(
  trends.indexOf("formatAxisTick") !== -1,
  "temperature-trends.js calls NovaraDateTime.formatAxisTick"
);
assert(
  trends.indexOf("formatChartTick(p.t)") !== -1,
  "chart data.labels are pre-formatted with formatChartTick"
);
assert(
  trends.indexOf("return formatChartTick(items[0].label)") !== -1,
  "tooltip title uses formatChartTick"
);
assert(
  trends.indexOf("return formatChartTick(label)") !== -1,
  "axis tick callback uses formatChartTick"
);
assert(
  trends.indexOf("new Date(label)") === -1,
  "tick callback no longer uses new Date(label) which fails on #SYS001"
);

if (typeof global.NovaraDateTime !== "object") {
  failed += 1;
  console.error("FAIL window/global NovaraDateTime was not attached");
} else {
  console.log("ok   attaches NovaraDateTime global");
}

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("\nAll formatDateTime tests passed");
