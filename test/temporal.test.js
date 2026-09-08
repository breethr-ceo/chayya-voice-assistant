import test from "node:test";
import assert from "node:assert/strict";
import { createTemporalReply, mumbaiDateTimeContext } from "../server.js";

const fixedNow = new Date("2026-09-08T10:15:00.000Z");

test("answers today's date locally in Hindi using Mumbai time", () => {
  const result = createTemporalReply("आज तारीख क्या है?", "auto", fixedNow);
  assert.equal(result.language, "hi");
  assert.match(result.reply, /८ सितंबर २०२६/);
});

test("answers today's date locally in Marathi", () => {
  const result = createTemporalReply("आजची तारीख काय आहे?", "auto", fixedNow);
  assert.equal(result.language, "mr");
  assert.match(result.reply, /८ सप्टेंबर,? २०२६/);
});

test("does not intercept non-current historical date questions", () => {
  assert.equal(createTemporalReply("महात्मा गांधींची जन्म तारीख काय होती?", "auto", fixedNow), null);
});

test("provides authoritative Mumbai date and time context", () => {
  const context = mumbaiDateTimeContext(fixedNow);
  assert.match(context, /2026/);
  assert.match(context, /3:45 pm/i);
});

test("answers common current-time phrasing locally", () => {
  assert.match(createTemporalReply("अभी कितने बजे हैं?", "auto", fixedNow).reply, /३:४५/);
  assert.match(createTemporalReply("आत्ता किती वाजले आहेत?", "auto", fixedNow).reply, /३:४५/);
});
