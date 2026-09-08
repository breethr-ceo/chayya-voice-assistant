import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, parseAssistantReply, safeLanguage } from "../lib/language.js";

test("accepts only supported language preferences", () => {
  assert.equal(safeLanguage("mr"), "mr");
  assert.equal(safeLanguage("hi"), "hi");
  assert.equal(safeLanguage("en"), "auto");
});

test("parses a structured Marathi reply", () => {
  assert.deepEqual(parseAssistantReply('{"language":"mr","reply":"नमस्कार!"}', "auto"), {
    language: "mr",
    reply: "नमस्कार!",
  });
});

test("falls back to Hindi for unstructured auto replies", () => {
  assert.deepEqual(parseAssistantReply("नमस्ते!", "auto"), {
    language: "hi",
    reply: "नमस्ते!",
  });
});

test("keeps an explicitly selected language even if model metadata differs", () => {
  assert.deepEqual(parseAssistantReply('```json\n{"language":"hi","reply":"नमस्कार!"}\n```', "mr"), {
    language: "mr",
    reply: "नमस्कार!",
  });
});

test("detects common Marathi speech markers", () => {
  assert.equal(detectLanguage("आज कोणता वार आहे? थोडक्यात सांग."), "mr");
  assert.equal(detectLanguage("तुम्ही मला मदत करू शकता का?"), "mr");
});

test("detects Hindi and uses Hindi for ambiguous input", () => {
  assert.equal(detectLanguage("आज कौन सा दिन है? मुझे बताइए।"), "hi");
  assert.equal(detectLanguage("नमस्ते"), "hi");
});
