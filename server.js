import "dotenv/config";

import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { pathToFileURL } from "node:url";
import { pcmToWav } from "./lib/audio.js";
import { detectLanguage, parseAssistantReply, safeLanguage } from "./lib/language.js";
import { buildMonthlyPanchang } from "./lib/panchang.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const speechCache = new Map();
const streamingSpeechCache = new Map();
const responseModel = process.env.OPENAI_RESPONSE_MODEL || "gpt-4.1-nano";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

function requireConfiguration() {
  const missing = ["OPENAI_API_KEY", "MAYA_API_KEY"].filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error(`Missing configuration: ${missing.join(", ")}`);
    error.status = 503;
    throw error;
  }
}

function openAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function resolvedLanguageFor(transcript, requestedLanguage) {
  return requestedLanguage === "auto" ? detectLanguage(transcript) : requestedLanguage;
}

function mumbaiDateTimeContext(now = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "short",
    hour12: true,
  }).format(now);
}

function createTemporalReply(transcript, requestedLanguage = "auto", now = new Date()) {
  const text = String(transcript || "").toLocaleLowerCase("hi-IN").trim();
  const asksForDate = [
    /(?:आज|आजची|आजचा|today).*(?:तारीख|दिनांक|दिन|वार|date|day)/iu,
    /^(?:तारीख|दिनांक)\s*(?:क्या|काय)/iu,
    /^(?:what(?:'s| is)|which)\s+(?:the\s+)?(?:date|day)/iu,
  ].some((pattern) => pattern.test(text));
  const asksForTime = [
    /(?:अभी|आत्ता|सध्या|now|current).*(?:समय|वक्त|वेळ|time)/iu,
    /(?:समय|वक्त|वेळ|time).*(?:क्या|काय|what|कितना|किती)/iu,
    /(?:अभी|आत्ता|सध्या).*(?:कितने\s*बजे|किती\s*वाज)/iu,
    /^(?:what(?:'s| is))\s+(?:the\s+)?time/iu,
  ].some((pattern) => pattern.test(text));
  if (!asksForDate && !asksForTime) return null;

  const language = resolvedLanguageFor(transcript, requestedLanguage);
  const locale = language === "mr" ? "mr-IN-u-nu-deva" : "hi-IN-u-nu-deva";
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  if (language === "mr") {
    if (asksForDate && asksForTime) return { language, reply: `आज ${date} आहे आणि मुंबईत वेळ ${time} आहे.` };
    if (asksForTime) return { language, reply: `मुंबईत आत्ता ${time} वाजले आहेत.` };
    return { language, reply: `आज ${date} आहे.` };
  }
  if (asksForDate && asksForTime) return { language, reply: `आज ${date} है और मुंबई में समय ${time} है।` };
  if (asksForTime) return { language, reply: `मुंबई में अभी ${time} बजे हैं।` };
  return { language, reply: `आज ${date} है।` };
}

async function transcribeAudio(client, file, language) {
  if (!file?.buffer?.length) return "";

  const extension = file.mimetype.includes("mp4") ? "m4a" : file.mimetype.includes("ogg") ? "ogg" : "webm";
  const request = {
    file: await toFile(file.buffer, `voice-command.${extension}`, { type: file.mimetype }),
    model: "gpt-4o-mini-transcribe",
    prompt: "यह हिंदी या मराठी में बोला गया एक छोटा voice command है। संभावित भाषा हिन्दी या मराठी है।",
  };

  if (language === "hi" || language === "mr") request.language = language;
  const transcription = await client.audio.transcriptions.create(request);
  return transcription.text?.trim() || "";
}

async function createReply(client, transcript, requestedLanguage, history) {
  const resolvedLanguage = resolvedLanguageFor(transcript, requestedLanguage);
  const fixedLanguage = resolvedLanguage === "mr" ? "Marathi" : "Hindi";
  const languageRule = `The user's language is ${fixedLanguage}. Always answer in ${fixedLanguage}, in natural Devanagari script.`;

  const historyText = Array.isArray(history)
    ? history
        .slice(-6)
        .filter((item) => item && typeof item.user === "string" && typeof item.assistant === "string")
        .map((item) => `User: ${item.user}\nAssistant: ${item.assistant}`)
        .join("\n")
    : "";

  const response = await client.responses.create({
    model: responseModel,
    instructions: [
      "You are Chayya, a warm, patient voice assistant for older adults in India.",
      languageRule,
      "Give a direct, helpful spoken answer. Keep it under 45 words and usually 1 or 2 short sentences.",
      "Do not use markdown, bullet points, emoji, URLs, or labels because the answer will be spoken aloud.",
      "If the request is unclear, politely ask one short clarifying question.",
      "Return only valid JSON with exactly two keys: language (hi or mr) and reply.",
    ].join(" "),
    input: `${historyText ? `Recent conversation:\n${historyText}\n\n` : ""}Authoritative current Mumbai date and time: ${mumbaiDateTimeContext()}\nUser's latest spoken request: ${transcript}`,
    max_output_tokens: 120,
  });

  return parseAssistantReply(response.output_text, resolvedLanguage);
}

async function requestMayaSpeech(text, language, signal = AbortSignal.timeout(30_000)) {
  const response = await fetch("https://tts.mayaresearch.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MAYA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ voice: "Ananya", text, language }),
    signal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Maya voice service returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return response;
}

async function synthesizeWithMaya(text, language) {
  const response = await requestMayaSpeech(text, language);

  const pcm = Buffer.from(await response.arrayBuffer());
  if (!pcm.length) throw new Error("Maya voice service returned empty audio");
  return pcmToWav(pcm);
}

async function synthesizeCached(text, language) {
  const cacheKey = `${language}:${text}`;
  if (speechCache.has(cacheKey)) return speechCache.get(cacheKey);
  const pendingAudio = synthesizeWithMaya(text, language);
  speechCache.set(cacheKey, pendingAudio);
  try {
    const audio = await pendingAudio;
    if (speechCache.size > 48) speechCache.delete(speechCache.keys().next().value);
    return audio;
  } catch (error) {
    speechCache.delete(cacheKey);
    throw error;
  }
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    configured: Boolean(process.env.OPENAI_API_KEY && process.env.MAYA_API_KEY),
    voice: "Ananya",
    responseModel,
  });
});

app.get("/api/panchang", (request, response, next) => {
  try {
    const indiaNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const parsedYear = Number(request.query.year);
    const parsedMonth = Number(request.query.month);
    const parsedLatitude = Number(request.query.lat);
    const parsedLongitude = Number(request.query.lng);
    const parsedElevation = Number(request.query.elevation);
    const year = Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100 ? parsedYear : indiaNow.getFullYear();
    const month = Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : indiaNow.getMonth() + 1;
    const latitude = Number.isFinite(parsedLatitude) && parsedLatitude >= -90 && parsedLatitude <= 90 ? parsedLatitude : 19.076;
    const longitude = Number.isFinite(parsedLongitude) && parsedLongitude >= -180 && parsedLongitude <= 180 ? parsedLongitude : 72.8777;
    const elevation = Number.isFinite(parsedElevation) && parsedElevation >= -500 && parsedElevation <= 9000 ? parsedElevation : 14;

    response.json(buildMonthlyPanchang({ year, month, latitude, longitude, elevation }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/converse", upload.single("audio"), async (request, response, next) => {
  const requestStarted = performance.now();
  let transcriptionFinished = requestStarted;
  let answerFinished = requestStarted;
  try {
    requireConfiguration();
    const client = openAIClient();
    const language = safeLanguage(request.body?.language);
    let transcript = typeof request.body?.text === "string" ? request.body.text.trim() : "";

    if (!transcript) transcript = await transcribeAudio(client, request.file, language);
    transcriptionFinished = performance.now();
    if (!transcript) return response.status(400).json({ error: "कोई आवाज़ सुनाई नहीं दी। कृपया फिर से बोलें।" });

    let history = [];
    try {
      history = JSON.parse(request.body?.history || "[]");
    } catch {
      history = [];
    }

    const temporalReply = createTemporalReply(transcript, language);
    const assistant = temporalReply || await createReply(client, transcript, language, history);
    answerFinished = performance.now();
    if (!assistant.reply) throw new Error("OpenAI returned an empty response");

    response.setHeader("Server-Timing", [
      `transcribe;dur=${(transcriptionFinished - requestStarted).toFixed(1)}`,
      `answer;dur=${(answerFinished - transcriptionFinished).toFixed(1)}`,
    ].join(", "));
    response.json({
      transcript,
      reply: assistant.reply,
      language: assistant.language,
      voice: "Ananya",
      voiceStream: "/api/speak-stream",
      responseSource: temporalReply ? "local-time" : "openai",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/speak-stream", async (request, response, next) => {
  try {
    requireConfiguration();
    const language = request.body?.language === "mr" ? "mr" : "hi";
    const text = typeof request.body?.text === "string" ? request.body.text.trim().slice(0, 500) : "";
    if (!text) return response.status(400).json({ error: "बोलने के लिए कोई संदेश नहीं मिला।" });

    const cacheKey = `${language}:${text}`;
    const cachedPcm = streamingSpeechCache.get(cacheKey);
    response.setHeader("Content-Type", "audio/L16; rate=24000; channels=1");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Chayya-Voice", "Ananya");
    if (cachedPcm) {
      response.setHeader("X-Chayya-Audio-Cache", "hit");
      return response.end(cachedPcm);
    }

    const clientAbort = new AbortController();
    response.once("close", () => {
      if (!response.writableEnded) clientAbort.abort();
    });
    const mayaStarted = performance.now();
    const mayaResponse = await requestMayaSpeech(
      text,
      language,
      AbortSignal.any([clientAbort.signal, AbortSignal.timeout(30_000)]),
    );
    response.setHeader("Server-Timing", `maya-connect;dur=${(performance.now() - mayaStarted).toFixed(1)}`);
    response.flushHeaders();

    const chunks = [];
    for await (const chunk of mayaResponse.body) {
      const bytes = Buffer.from(chunk);
      chunks.push(bytes);
      if (!response.write(bytes)) await new Promise((resolve) => response.once("drain", resolve));
    }
    if (!response.writableEnded) response.end();
    const pcm = Buffer.concat(chunks);
    if (pcm.length) {
      streamingSpeechCache.set(cacheKey, pcm);
      if (streamingSpeechCache.size > 48) streamingSpeechCache.delete(streamingSpeechCache.keys().next().value);
    }
  } catch (error) {
    if (response.headersSent) response.destroy(error);
    else next(error);
  }
});

app.post("/api/speak", async (request, response, next) => {
  try {
    requireConfiguration();
    const language = request.body?.language === "mr" ? "mr" : "hi";
    const text = typeof request.body?.text === "string" ? request.body.text.trim().slice(0, 500) : "";
    if (!text) return response.status(400).json({ error: "बोलने के लिए कोई संदेश नहीं मिला।" });

    const wav = await synthesizeCached(text, language);
    response.json({
      language,
      audio: wav.toString("base64"),
      audioMime: "audio/wav",
      voice: "Ananya",
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.status || (error.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  const message = status === 413
    ? "रिकॉर्डिंग बहुत लंबी है। कृपया छोटा प्रश्न पूछें।"
    : status === 503
      ? "ऐप की API कुंजियाँ कॉन्फ़िगर नहीं हैं।"
      : "अभी कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।";
  response.status(status).json({ error: message });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`Chayya is ready at http://localhost:${port}`);
  });
}

export { app, createReply, createTemporalReply, mumbaiDateTimeContext, synthesizeWithMaya, transcribeAudio };
