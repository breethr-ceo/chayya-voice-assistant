import test from "node:test";
import assert from "node:assert/strict";
import { MAYA_SAMPLE_RATE, pcmToWav } from "../lib/audio.js";

test("wraps Maya PCM in a valid mono 24 kHz WAV", () => {
  const pcm = Buffer.from([0, 0, 1, 0, 255, 255]);
  const wav = pcmToWav(pcm);

  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), MAYA_SAMPLE_RATE);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});
