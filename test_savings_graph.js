#!/usr/bin/env node
/**
 * Unit tests for savingsGraph.js (date range, MM-DD-YY labels, zoom config).
 */
"use strict";

require("./formatDateTime.js");
var graph = require("./savingsGraph.js");
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

function assert(condition, label) {
  if (!condition) {
    failed += 1;
    console.error("FAIL " + label);
    return;
  }
  console.log("ok   " + label);
}

assertEqual(graph.toInputDate(new Date(2026, 7, 14)), "2026-08-14", "toInputDate local");
assertEqual(graph.toInputDate("2026-07-01"), "2026-07-01", "toInputDate YYYY-MM-DD");
assertEqual(graph.daysInclusive("2026-07-01", "2026-07-15"), 15, "daysInclusive 15-day window");
assertEqual(graph.daysInclusive("2026-08-14", "2026-08-14"), 1, "daysInclusive same day");

var range30 = graph.defaultRange(30);
assertEqual(graph.daysInclusive(range30.start, range30.end), 30, "defaultRange 30 days inclusive");
assertEqual(range30.end, graph.toInputDate(new Date()), "defaultRange end is today");

var points = [
  { t: "2026-08-01T12:00:00Z", daily: 10, cumulative: 10 },
  { t: "2026-08-02T12:00:00Z", daily: 11, cumulative: 21 },
  { t: "2026-08-03T12:00:00Z", daily: 12, cumulative: 33 },
  { t: "2026-08-04T12:00:00Z", daily: 13, cumulative: 46 },
];
var subset = graph.filterPointsByRange(points, "2026-08-02", "2026-08-03");
assertEqual(subset.length, 2, "filterPointsByRange keeps inner days");
assertEqual(subset[0].t, "2026-08-02T12:00:00Z", "filter start inclusive");
assertEqual(subset[1].t, "2026-08-03T12:00:00Z", "filter end inclusive");

assertEqual(
  graph.formatAxisDate("2026-08-14T12:00:00Z"),
  "08-14-26",
  "axis labels use MM-DD-YY"
);
assertEqual(
  graph.formatTooltipDate("2026-08-01T12:00:00Z"),
  "08-01-26",
  "tooltip labels use MM-DD-YY"
);

var zoom = graph.zoomOptions();
assert(zoom.zoom.wheel.enabled === true, "wheel zoom enabled");
assert(zoom.zoom.pinch.enabled === true, "pinch zoom enabled");
assert(zoom.zoom.drag.enabled === true, "drag-to-zoom enabled");
assert(zoom.zoom.mode === "x", "zoom is x-axis only");
assert(zoom.pan.enabled === true, "shift-pan enabled");

if (typeof global.NovaraSavingsGraph !== "object") {
  failed += 1;
  console.error("FAIL global NovaraSavingsGraph was not attached");
} else {
  console.log("ok   attaches NovaraSavingsGraph global");
}

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("\nAll savingsGraph tests passed");
