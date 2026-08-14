#!/usr/bin/env node
/**
 * Unit tests for formatDateTime.js (MM-DD-YY + time labels).
 */
"use strict";

var dt = require("./formatDateTime.js");
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
