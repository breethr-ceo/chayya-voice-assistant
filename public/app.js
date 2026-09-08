const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const FOLLOW_UP_WAIT_MS = 9_000;

const voiceStage = document.querySelector(".voice-stage");
const voiceButton = document.querySelector("#voiceButton");
const buttonLabel = document.querySelector("#buttonLabel");
const liveStatus = document.querySelector("#liveStatus");
const micDot = document.querySelector("#micDot");
const micStatus = document.querySelector("#micStatus");
const internetDot = document.querySelector("#internetDot");
const internetStatus = document.querySelector("#internetStatus");
const toast = document.querySelector("#toast");

let state = "off";
let activationPending = false;
let stream = null;
let audioContext = null;
let analyser = null;
let wakeRecognition = null;
let shouldWakeListen = false;
let mediaRecorder = null;
let audioChunks = [];
let silenceTimer = null;
let captureTimeout = null;
let captureHeardSpeech = false;
let followUpCapture = false;
let conversationActive = false;
let lastResponseLanguage = "hi";
let activeAudio = null;
let activeStreamController = null;
const activeSources = new Set();
let resolvePlayback = null;
let history = [];
let toastTimer = null;

const labels = {
  off: ["छाया शुरू करें", "माइक चालू करने के लिए बटन दबाएँ"],
  listening: ["हे छाया कहें", "हे छाया कहने का इंतज़ार है"],
  capturing: ["सुन रही हूँ…", "अपना सवाल बोलें"],
  processing: ["सोच रही हूँ…", "आपकी बात समझ रही हूँ"],
  speaking: ["छाया बोल रही है", "अनन्या की आवाज़ में जवाब"],
  closing: ["फिर मिलेंगे", "बातचीत पूरी हुई"],
};

function setState(nextState, customStatus = "") {
  state = nextState;
  voiceStage.dataset.state = nextState;
  buttonLabel.textContent = labels[nextState][0];
  liveStatus.textContent = customStatus || labels[nextState][1];
  voiceButton.disabled = nextState === "processing" || nextState === "closing";
  voiceButton.setAttribute("aria-label", liveStatus.textContent);
  const micActive = nextState !== "off";
  micDot.classList.toggle("active", micActive);
  micStatus.textContent = micActive ? "माइक सक्रिय" : "माइक बंद";
}

function updateInternetStatus() {
  const online = navigator.onLine;
  internetDot.classList.toggle("active", online);
  internetStatus.textContent = online ? "इंटरनेट सक्रिय" : "इंटरनेट बंद";
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("show"));
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => { toast.hidden = true; }, 200);
  }, 5000);
}

function normalizedWords(text) {
  return text.toLocaleLowerCase("hi-IN").replace(/[.,!?।॥'"’]/g, " ").replace(/\s+/g, " ").trim();
}

function wakeWordMatch(text) {
  const normalized = normalizedWords(text);
  const patterns = [
    /(?:hey|hi|हे|हाय|हेलो)\s+(?:chh?ayya|chh?aya|chaiya|छाया|चाया|छैया)/iu,
    /(?:chh?ayya|chh?aya|chaiya|छाया|चाया|छैया)/iu,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return { found: true, remainder: normalized.slice((match.index || 0) + match[0].length).trim() };
  }
  return { found: false, remainder: "" };
}

function stopWakeRecognition() {
  shouldWakeListen = false;
  if (!wakeRecognition) return;
  wakeRecognition.onend = null;
  try { wakeRecognition.stop(); } catch { /* Already stopped. */ }
  wakeRecognition = null;
}

function startWakeRecognition() {
  if (!SpeechRecognition || !stream || state !== "listening") return;
  stopWakeRecognition();
  shouldWakeListen = true;
  const recognition = new SpeechRecognition();
  wakeRecognition = recognition;
  recognition.lang = "hi-IN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      for (let alternativeIndex = 0; alternativeIndex < result.length; alternativeIndex += 1) {
        const wake = wakeWordMatch(result[alternativeIndex].transcript);
        if (wake.found && result.isFinal) {
          stopWakeRecognition();
          conversationActive = true;
          playCue(620, .08);
          if (wake.remainder.length > 1) askChayya({ text: wake.remainder });
          else window.setTimeout(() => startCapture({ followUp: true }), 180);
          return;
        }
      }
    }
  };

  recognition.onerror = (event) => {
    if (["no-speech", "aborted"].includes(event.error)) return;
    if (event.error === "not-allowed") {
      shouldWakeListen = false;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      audioContext?.close();
      audioContext = null;
      analyser = null;
      setState("off");
      showToast("ब्राउज़र सेटिंग में माइक्रोफ़ोन की अनुमति दें।");
    }
  };

  recognition.onend = () => {
    wakeRecognition = null;
    if (shouldWakeListen && state === "listening") window.setTimeout(startWakeRecognition, 350);
  };

  try { recognition.start(); } catch { window.setTimeout(startWakeRecognition, 500); }
}

async function activateAssistant() {
  if (activationPending || stream) return;
  activationPending = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable.");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const BrowserAudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new BrowserAudioContext();
    if (audioContext.state === "suspended") {
      try { await audioContext.resume(); } catch { /* Wake-word monitoring can still start. */ }
    }
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    setState("listening");
    playCue(500, .06);
    if (SpeechRecognition) startWakeRecognition();
    else showToast("इस ब्राउज़र में वेक-वर्ड उपलब्ध नहीं है; हरा बटन दबाएँ।");
  } catch (error) {
    console.error(error);
    setState("off");
    showToast("छाया को सुनने के लिए माइक्रोफ़ोन की अनुमति दें।");
  } finally {
    activationPending = false;
  }
}

function playCue(frequency, duration) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.11, audioContext.currentTime + .015);
  gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration + .02);
}

function bestRecordingType() {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function startCapture({ followUp = false } = {}) {
  if (!stream || state === "capturing") return;
  stopWakeRecognition();
  audioChunks = [];
  captureHeardSpeech = false;
  followUpCapture = followUp;
  const mimeType = bestRecordingType();
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  mediaRecorder.ondataavailable = (event) => { if (event.data.size) audioChunks.push(event.data); };
  mediaRecorder.onstop = () => {
    const recordedType = mediaRecorder.mimeType || "audio/webm";
    const audio = new Blob(audioChunks, { type: recordedType });
    const heardSpeech = captureHeardSpeech;
    const wasFollowUp = followUpCapture;
    mediaRecorder = null;
    if (!heardSpeech || audio.size < 700) {
      if (conversationActive && wasFollowUp) endConversation();
      else resumeWakeMode();
      return;
    }
    askChayya({ audio });
  };
  mediaRecorder.start(200);
  setState("capturing", followUp ? "जवाब का इंतज़ार है" : "अपना सवाल बोलें");
  monitorSilence();
}

function monitorSilence() {
  clearInterval(silenceTimer);
  clearTimeout(captureTimeout);
  const values = new Uint8Array(analyser.fftSize);
  let quietSince = null;
  const startedAt = Date.now();
  let noiseFloor = 0;
  let noiseSamples = 0;
  let loudSamples = 0;

  silenceTimer = setInterval(() => {
    analyser.getByteTimeDomainData(values);
    let sum = 0;
    for (const value of values) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const volume = Math.sqrt(sum / values.length);

    if (Date.now() - startedAt < 650) {
      noiseFloor = ((noiseFloor * noiseSamples) + volume) / (noiseSamples + 1);
      noiseSamples += 1;
      return;
    }

    const speechThreshold = Math.max(.038, noiseFloor * 2.35);
    if (volume > speechThreshold) {
      loudSamples += 1;
      if (loudSamples >= 2) captureHeardSpeech = true;
      quietSince = null;
    } else if (captureHeardSpeech && Date.now() - startedAt > 700) {
      loudSamples = 0;
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince > 750) stopCapture();
    } else {
      loudSamples = 0;
    }
  }, 100);

  captureTimeout = setTimeout(stopCapture, 18_000);
  window.setTimeout(() => {
    if (state === "capturing" && !captureHeardSpeech) stopCapture();
  }, FOLLOW_UP_WAIT_MS);
}

function stopCapture() {
  clearInterval(silenceTimer);
  clearTimeout(captureTimeout);
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

async function askChayya({ audio = null, text = "" }) {
  setState("processing");
  const form = new FormData();
  form.append("language", "auto");
  form.append("history", JSON.stringify(history.slice(-6)));
  if (audio) {
    const extension = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
    form.append("audio", audio, `command.${extension}`);
  } else form.append("text", text);

  try {
    const response = await fetch("/api/converse", { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "छाया से संपर्क नहीं हो पाया।");
    lastResponseLanguage = result.language === "mr" ? "mr" : "hi";
    history.push({ user: result.transcript, assistant: result.reply });
    history = history.slice(-6);
    if (!result.reply) throw new Error("अनन्या की आवाज़ अभी उपलब्ध नहीं है।");
    await playAssistantStream(result.reply, lastResponseLanguage, true);
  } catch (error) {
    console.error(error);
    showToast(error.message || "अभी कुछ गड़बड़ हो गई।");
    resumeWakeMode();
  }
}

async function endConversation() {
  if (!conversationActive) return resumeWakeMode();
  conversationActive = false;
  setState("closing");
  const closingText = lastResponseLanguage === "mr"
    ? "आशा आहे की मी तुमची मदत केली. पुन्हा गरज असेल तर फक्त हे छाया म्हणा."
    : "उम्मीद है मैंने आपकी मदद की। अगर आपको मेरी ज़रूरत हो तो बस हे छाया कहें।";

  try {
    await playAssistantStream(closingText, lastResponseLanguage, false);
  } catch (error) {
    console.error(error);
    resumeWakeMode();
  }
}

function stopAssistantPlayback() {
  activeStreamController?.abort();
  activeStreamController = null;
  activeAudio?.pause();
  activeAudio = null;
  for (const source of activeSources) {
    try { source.stop(); } catch { /* Source already ended. */ }
  }
  activeSources.clear();
  resolvePlayback?.();
  resolvePlayback = null;
}

async function playAssistantStream(text, language, continueConversation) {
  if (!audioContext) throw new Error("ऑडियो उपलब्ध नहीं है।");
  if (audioContext.state === "suspended") await audioContext.resume();
  stopAssistantPlayback();
  const controller = new AbortController();
  activeStreamController = controller;

  try {
    const response = await fetch("/api/speak-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "अनन्या की आवाज़ अभी उपलब्ध नहीं है।");
    }
    if (!response.body) throw new Error("ऑडियो स्ट्रीम उपलब्ध नहीं है।");

    setState("speaking");
    const reader = response.body.getReader();
    let pendingByte = null;
    let playAt = audioContext.currentTime + 0.06;
    let scheduledChunks = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let bytes = value;
      if (pendingByte !== null) {
        const joined = new Uint8Array(value.byteLength + 1);
        joined[0] = pendingByte;
        joined.set(value, 1);
        bytes = joined;
        pendingByte = null;
      }
      const usableLength = bytes.byteLength - (bytes.byteLength % 2);
      if (usableLength !== bytes.byteLength) pendingByte = bytes[bytes.byteLength - 1];
      if (!usableLength) continue;

      const sampleCount = usableLength / 2;
      const samples = new Float32Array(sampleCount);
      const view = new DataView(bytes.buffer, bytes.byteOffset, usableLength);
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = view.getInt16(index * 2, true) / 32768;
      }
      const buffer = audioContext.createBuffer(1, sampleCount, 24_000);
      buffer.copyToChannel(samples, 0);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => activeSources.delete(source);
      activeSources.add(source);
      playAt = Math.max(playAt, audioContext.currentTime + 0.03);
      source.start(playAt);
      playAt += buffer.duration;
      scheduledChunks += 1;
    }

    if (!scheduledChunks) throw new Error("अनन्या की आवाज़ से खाली ऑडियो मिला।");
    const waitMilliseconds = Math.max(0, (playAt - audioContext.currentTime) * 1000);
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, waitMilliseconds);
      resolvePlayback = () => {
        window.clearTimeout(timer);
        resolve();
      };
    });
    resolvePlayback = null;
    activeStreamController = null;
    if (continueConversation && conversationActive) window.setTimeout(() => startCapture({ followUp: true }), 420);
    else resumeWakeMode();
  } catch (error) {
    activeStreamController = null;
    if (error.name === "AbortError") return;
    throw error;
  }
}

async function playAssistantAudio(base64, mimeType, continueConversation) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  activeAudio = new Audio(url);
  setState("speaking");
  await new Promise((resolve, reject) => {
    resolvePlayback = resolve;
    activeAudio.onended = resolve;
    activeAudio.onerror = reject;
    activeAudio.play().catch(reject);
  });
  resolvePlayback = null;
  URL.revokeObjectURL(url);
  activeAudio = null;
  if (continueConversation && conversationActive) window.setTimeout(() => startCapture({ followUp: true }), 420);
  else resumeWakeMode();
}

function resumeWakeMode() {
  conversationActive = false;
  setState("listening");
  startWakeRecognition();
}

const HINDI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const MARATHI_MONTHS = ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"];
const WEEKDAYS = ["रवि", "सोम", "मंगळ", "बुध", "गुरु", "शुक्र", "शनि"];
let calendarRequestId = 0;

function indiaToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts().filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

function localTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("mr-IN-u-nu-deva", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}

function localNumber(value) {
  return new Intl.NumberFormat("mr-IN-u-nu-deva", { useGrouping: false }).format(value);
}

function renderCalendar(data, locationLabel) {
  const current = indiaToday();
  const monthIndex = data.month - 1;
  const firstWeekday = new Date(Date.UTC(data.year, monthIndex, 1)).getUTCDay();
  const dayCount = data.days.length;
  const todayDetails = data.days.find((day) => day.day === current.day);

  document.querySelector("#monthTitle").textContent = `${HINDI_MONTHS[monthIndex]} · ${MARATHI_MONTHS[monthIndex]}`;
  document.querySelector("#yearTitle").textContent = localNumber(data.year);
  document.querySelector("#todayLabel").textContent = `${localNumber(current.day)} ${MARATHI_MONTHS[monthIndex]} ${localNumber(data.year)}`;
  document.querySelector("#locationLabel").textContent = locationLabel;
  const weekdayRow = document.querySelector("#calendarWeekdays");
  const grid = document.querySelector("#calendarGrid");
  weekdayRow.replaceChildren();
  grid.replaceChildren();
  WEEKDAYS.forEach((weekday) => {
    const cell = document.createElement("div");
    cell.textContent = weekday;
    weekdayRow.append(cell);
  });
  for (let slot = 0; slot < 42; slot += 1) {
    const day = slot - firstWeekday + 1;
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    if (slot % 7 === 0) cell.classList.add("sunday");
    if (day < 1 || day > dayCount) cell.classList.add("empty");
    else {
      const details = data.days[day - 1];
      const top = document.createElement("span");
      top.className = "day-top";
      const number = document.createElement("strong");
      number.className = "day-number";
      number.textContent = localNumber(day);
      const moon = document.createElement("span");
      moon.className = "moon-symbol";
      moon.textContent = details.moonSymbol;
      const tithi = document.createElement("span");
      tithi.className = "day-tithi";
      tithi.textContent = `${details.paksha} ${details.tithiName}`;
      top.append(number, moon);
      cell.append(top, tithi);
      if (details.featuredFestivals.length) {
        const festival = document.createElement("span");
        festival.className = "day-festival";
        festival.textContent = details.featuredFestivals.join(" · ");
        cell.append(festival);
      }
      const ariaDetails = [
        `${day} ${MARATHI_MONTHS[monthIndex]} ${data.year}`,
        `${details.masa} ${details.paksha} ${details.tithiName}`,
        ...details.festivals,
      ];
      cell.setAttribute("aria-label", ariaDetails.join(", "));
      if (day === current.day) cell.classList.add("today");
    }
    grid.append(cell);
  }

  if (!todayDetails) return;
  document.querySelector("#lunarDate").textContent = `${todayDetails.moonSymbol} ${todayDetails.masa} · ${todayDetails.paksha} ${todayDetails.tithiName}`;
  document.querySelector("#todayFestival").textContent = todayDetails.festivals.slice(0, 3).join(" · ");
  document.querySelector("#sunriseTime").textContent = localTime(todayDetails.sunrise);
  document.querySelector("#sunsetTime").textContent = localTime(todayDetails.sunset);
  document.querySelector("#moonriseTime").textContent = localTime(todayDetails.moonrise);
  document.querySelector("#nakshatraName").textContent = `${todayDetails.nakshatra} · ${localTime(todayDetails.nakshatraEnd)}`;
  document.querySelector("#tithiEndTime").textContent = localTime(todayDetails.tithiEnd);
  document.querySelector("#rahuTime").textContent = `${localTime(todayDetails.rahuStart)}–${localTime(todayDetails.rahuEnd)}`;
}

async function loadPanchang({ latitude = 19.076, longitude = 72.8777, elevation = 14, label = "मुंबई, महाराष्ट्र" } = {}) {
  const requestId = ++calendarRequestId;
  const current = indiaToday();
  const parameters = new URLSearchParams({
    year: current.year, month: current.month, lat: latitude, lng: longitude, elevation,
  });
  try {
    const response = await fetch(`/api/panchang?${parameters}`);
    if (!response.ok) throw new Error("Panchang calculation failed");
    const data = await response.json();
    if (requestId !== calendarRequestId) return;
    renderCalendar(data, label);
    document.querySelector("#locationStatus").textContent = "मुंबई स्थानानुसार";
  } catch (error) {
    console.error(error);
    document.querySelector("#lunarDate").textContent = "पंचांग उपलब्ध नाही";
  }
}

voiceButton.addEventListener("click", async () => {
  if (state === "off") return activateAssistant();
  if (audioContext?.state === "suspended") await audioContext.resume().catch(() => {});
  if (state === "listening") {
    conversationActive = true;
    return startCapture({ followUp: true });
  }
  if (state === "capturing") return stopCapture();
  if (state === "speaking") {
    stopAssistantPlayback();
    return resumeWakeMode();
  }
});

window.addEventListener("online", updateInternetStatus);
window.addEventListener("offline", updateInternetStatus);
window.addEventListener("beforeunload", () => {
  stopWakeRecognition();
  stream?.getTracks().forEach((track) => track.stop());
  audioContext?.close();
});

loadPanchang();
updateInternetStatus();
activateAssistant();
fetch("/api/health")
  .then((response) => response.json())
  .then((health) => {
    if (!health.configured) {
      internetDot.classList.remove("active");
      internetStatus.textContent = "सेवा बंद";
    }
  })
  .catch(() => {
    internetDot.classList.remove("active");
    internetStatus.textContent = "इंटरनेट बंद";
  });
