# छाया — Hindi & Marathi voice assistant

A locally hosted, wake-word voice assistant built for simple, accessible use. The microphone starts automatically when the page opens: allow the browser's one-time microphone request, then say **“Hey Chayya / हे छाया”**. The floating green microphone remains available as a fallback. OpenAI transcribes and answers; Maya speaks every response using the **Ananya** voice. The page also renders the current Hindu/Marathi calendar month in a clean, single-screen layout.

The calendar is calculated locally with `@ishubhamx/panchangam-js`. It includes the sunrise-anchored tithi, paksha, Marathi lunar month, nakshatra, moon phase, festivals, sunrise, sunset, moonrise, moonset, Rahu Kaal, and Shaka year. Calendar calculations are fixed to Mumbai, Maharashtra.

## Run locally

1. Copy `.env.example` to `.env` and add the OpenAI and Maya API keys.
2. Install dependencies with `npm install`.
3. Start the app with `npm start`.
4. Open [http://localhost:3000](http://localhost:3000) in Chrome or Edge.
5. Allow microphone access when the browser asks. Chayya immediately begins waiting for the wake phrase.

The wake-word listener uses the browser's speech-recognition support. If it is unavailable or misses the phrase, the floating green microphone button remains available.

## Privacy and keys

API keys stay in the local server environment and are never sent to browser code. Recorded commands are processed in memory and are not written to disk by this app. `.env` is excluded from git.

Browsers always require the user to grant microphone permission; a website cannot bypass that permission prompt. Once granted, Chayya starts automatically on later page visits and returns to wake-word mode after every response.

After Chayya answers, the microphone remains open for a follow-up. If no follow-up is heard for about nine seconds, Ananya plays a Hindi or Marathi closing message in the detected language and the app returns to **“Hey Chayya”** mode.

Current date and time questions are answered directly from Mumbai time instead of asking the language model, which prevents stale dates and removes one network round trip. Other answers receive the authoritative current Mumbai date/time as context. The app uses the low-latency `gpt-4.1-nano` model by default, streams Ananya's raw PCM audio to the browser as Maya generates it, caches repeated speech in memory, and uses a short pause for end-of-speech detection.
