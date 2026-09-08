import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyPanchang } from "../lib/panchang.js";

test("builds a location-aware Marathi Panchang month", () => {
  const result = buildMonthlyPanchang({
    year: 2026,
    month: 9,
    latitude: 18.5204,
    longitude: 73.8567,
    elevation: 560,
  });

  assert.equal(result.days.length, 30);
  assert.equal(result.days[7].date, "2026-09-08");
  assert.equal(result.days[7].masa, "श्रावण");
  assert.equal(result.days[7].paksha, "कृष्ण");
  assert.equal(result.days[7].tithiName, "द्वादशी");
  assert.ok(result.days[7].sunrise);
  assert.ok(result.days[7].sunset);
  assert.ok(result.days[7].nakshatra);
});

test("includes major Maharashtra festivals for September 2026", () => {
  const result = buildMonthlyPanchang({
    year: 2026,
    month: 9,
    latitude: 19.076,
    longitude: 72.8777,
    elevation: 14,
  });

  assert.ok(result.days[13].festivals.includes("गणेश चतुर्थी"));
  assert.ok(result.days[13].featuredFestivals.includes("गणेश चतुर्थी"));
  assert.ok(result.days[24].festivals.includes("अनंत चतुर्दशी"));
  assert.ok(result.days[24].featuredFestivals.includes("अनंत चतुर्दशी"));
});
