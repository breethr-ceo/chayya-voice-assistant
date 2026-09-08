const SUPPORTED_LANGUAGES = new Set(["auto", "hi", "mr"]);

const MARATHI_MARKERS = new Set([
  "आहे", "आहेत", "होता", "होती", "होते", "नाही", "मला", "माझा", "माझी", "माझे",
  "तुम्ही", "तुम्हाला", "तुमचा", "तुमची", "तुझे", "तुला", "काय", "कसा", "कशी",
  "कोणता", "कोणती", "कुठे", "सांग", "सांगा", "करू", "करा", "पाहिजे", "आजचा",
]);

const HINDI_MARKERS = new Set([
  "है", "हैं", "था", "थी", "थे", "नहीं", "मुझे", "मेरा", "मेरी", "मेरे", "आप",
  "आपको", "आपका", "आपकी", "तुम", "तुम्हें", "क्या", "कैसे", "कैसा", "कैसी", "कौन",
  "कहाँ", "बताओ", "बताइए", "चाहिए", "आजका",
]);

export function safeLanguage(value) {
  return SUPPORTED_LANGUAGES.has(value) ? value : "auto";
}

export function detectLanguage(text) {
  const words = String(text || "")
    .toLocaleLowerCase("hi-IN")
    .replace(/[^\p{L}\p{M}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  let marathiScore = 0;
  let hindiScore = 0;
  for (const word of words) {
    if (MARATHI_MARKERS.has(word)) marathiScore += 1;
    if (HINDI_MARKERS.has(word)) hindiScore += 1;
  }
  return marathiScore > hindiScore ? "mr" : "hi";
}

export function parseAssistantReply(raw, preferredLanguage = "auto") {
  const fallbackLanguage = preferredLanguage === "mr" ? "mr" : "hi";
  const fixedLanguage = preferredLanguage === "hi" || preferredLanguage === "mr" ? preferredLanguage : null;
  const text = String(raw || "").trim();
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  const jsonCandidate = objectStart >= 0 && objectEnd > objectStart
    ? text.slice(objectStart, objectEnd + 1)
    : text;

  try {
    const parsed = JSON.parse(jsonCandidate);
    const detectedLanguage = parsed.language === "mr" ? "mr" : parsed.language === "hi" ? "hi" : fallbackLanguage;
    const language = fixedLanguage || detectedLanguage;
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    if (reply) return { language, reply };
  } catch {
    // A plain-text response is still usable if structured output is unavailable.
  }

  return { language: fallbackLanguage, reply: text };
}
