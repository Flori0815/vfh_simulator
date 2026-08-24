/**
 * Thin getUserMedia + MediaRecorder wrapper for the voice-challenge
 * record button (js/challenge-ui.js). Deliberately dumb: it only knows
 * how to start/stop a recording and hand back a Blob. Transcription and
 * grading live in js/gemini-api.js; nothing here talks to any network.
 */
(function (global) {
  "use strict";

  // Preference order matters: the Gemini API's documented audio mime types
  // are wav/mp3/aiff/aac/ogg/flac — NOT webm — so we ask MediaRecorder for
  // an Ogg/Opus capture first (Chrome/Firefox/Edge all support it) and only
  // fall back to webm (Chromium's default) or mp4 (Safari) if Ogg isn't
  // available. See js/gemini-api.js baseMimeType() for the send-side half
  // of this — it strips the ";codecs=..." suffix before the API call.
  function pickMimeType() {
    const candidates = ["audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== "undefined");
  }

  /**
   * Creates a recorder session. Returns an object with start()/stop().
   * onStop(blob, mimeType) fires once recording is finalized; onError(err)
   * fires on permission denial or other capture failure.
   */
  function createRecorder({ onStop, onError }) {
    let stream = null;
    let recorder = null;
    let chunks = [];

    async function start() {
      if (!isSupported()) {
        onError(new Error("Mikrofonaufnahme wird von diesem Browser nicht unterstützt."));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        onError(new Error("Mikrofonzugriff verweigert oder nicht verfügbar."));
        return;
      }
      const mimeType = pickMimeType();
      chunks = [];
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (e) {
        stopTracks();
        onError(new Error("Aufnahme konnte nicht gestartet werden: " + e.message));
        return;
      }
      recorder.addEventListener("dataavailable", (evt) => {
        if (evt.data && evt.data.size > 0) chunks.push(evt.data);
      });
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        stopTracks();
        onStop(blob, blob.type);
      });
      recorder.start();
    }

    function stop() {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    }

    function stopTracks() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    return { start, stop, isRecording: () => !!recorder && recorder.state === "recording" };
  }

  global.AudioRecorder = { isSupported, createRecorder };
})(window);
