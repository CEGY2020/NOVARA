#!/usr/bin/env node
/**
 * Tests for Temperature Trends MM-DD-YY HH:MM labels.
 *
 * Live bug: Chart.js data.labels were raw DynamoDB keys
 * ``2026-08-07T21:30:00Z#SYS001``. ``new Date(label)`` is NaN, so the tick
 * callback returned the raw string.
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

/** This is the live tick callback on main. It is what the screenshot shows. */
function brokenTickCallback(label) {
  var date = new Date(label);
  if (Number.isNaN(date.getTime())) return label;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}

var liveLabels = [
  "2026-08-07T21:30:00Z#SYS001",
  "2026-08-08T09:45:00Z#SYS001",
];

assertEqual(
  brokenTickCallback(liveLabels[0]),
  "2026-08-07T21:30:00Z#SYS001",
  "BROKEN callback returns raw ISO#SYS001 (matches live screenshot)"
);
assertEqual(
  brokenTickCallback(liveLabels[1]),
  "2026-08-08T09:45:00Z#SYS001",
  "BROKEN callback returns second raw ISO#SYS001"
);

assertEqual(
  dt.stripReadingSortKey(liveLabels[0]),
  "2026-08-07T21:30:00Z",
  "strip #SYS001 from composite reading key"
);
assertEqual(
  dt.formatAxisTick(liveLabels[0]),
  "08-07-26 21:30",
  "axis tick: 2026-08-07T21:30:00Z#SYS001 -> 08-07-26 21:30"
);
assertEqual(
  dt.formatAxisTick(liveLabels[1]),
  "08-08-26 09:45",
  "axis tick: 2026-08-08T09:45:00Z#SYS001 -> 08-08-26 09:45"
);
assertEqual(
  dt.formatAxisTick("2026-08-07T21:30:00Z"),
  "08-07-26 21:30",
  "plain ISO timestamp formats the same way"
);
assertEqual(
  dt.formatAxisTick("08-07-26 21:30"),
  "08-07-26 21:30",
  "already-formatted tick is passed through"
);
assert(
  dt.formatAxisTick(liveLabels[0]).indexOf("#") === -1,
  "axis tick never includes #SYS suffix"
);

function simulateChartLabels(points) {
  return points.map(function (p) {
    return dt.formatAxisTick(p.t);
  });
}

function simulateTooltipTitle(label) {
  return dt.formatAxisTick(label);
}

var rawPoints = [
  { t: "2026-08-07T21:30:00Z#SYS001", t1: 120, t2: 110 },
  { t: "2026-08-08T09:45:00Z#SYS001", t1: 121, t2: 111 },
];
var labels = simulateChartLabels(rawPoints);
assertEqual(labels[0], "08-07-26 21:30", "chart data.labels[0] is MM-DD-YY HH:MM");
assertEqual(labels[1], "08-08-26 09:45", "chart data.labels[1] is MM-DD-YY HH:MM");
assert(
  labels.every(function (label) {
    return label.indexOf("#") === -1 && !/T/.test(label);
  }),
  "chart labels contain no ISO T or #SYS001"
);
assertEqual(
  simulateTooltipTitle(labels[0]),
  "08-07-26 21:30",
  "tooltip title uses formatted label"
);
assertEqual(
  simulateTooltipTitle(liveLabels[0]),
  "08-07-26 21:30",
  "tooltip title formats raw composite key if Chart.js still has it"
);

var html = fs.readFileSync(path.join(__dirname, "system-detail.html"), "utf8");
assert(
  html.indexOf("formatDateTime.js") !== -1,
  "system-detail.html loads formatDateTime.js"
);
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
  assertEqual(
    global.NovaraDateTime.formatAxisTick(liveLabels[0]),
    "08-07-26 21:30",
    "NovaraDateTime.formatAxisTick is actually callable"
  );
}

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("\nAll formatDateTime tests passed");
