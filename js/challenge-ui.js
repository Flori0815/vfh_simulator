/**
 * Challenge browser UI: category list -> challenge list -> detail panel
 * with Start/Reset, a live-updating checklist for device challenges, and
 * a record/transcribe/evaluate flow for voice challenges (falls back to
 * manual self-certification when the mic or a Gemini API key isn't
 * available). Pure DOM glue over js/challenges.js's data/validation, the
 * sim's public state, and js/audio-recorder.js + js/gemini-api.js for the
 * voice path — no challenge content or grading logic lives here.
 */
(function (global) {
  "use strict";

  function initChallengeUI(sim) {
    const catList = document.getElementById("training-categories");
    const detail = document.getElementById("training-detail");
    const passed = new Set(); // challenge numbers completed this session

    let active = null; // current challenge object
    let sinceTs = 0;
    let pollHandle = null;

    // Per-challenge voice-grading state (record -> transcribe -> evaluate).
    // Reset whenever the active challenge changes or the task is restarted;
    // survives re-renders in between so the record button's async flow
    // doesn't lose its place when renderDetail() rebuilds the DOM.
    let voice = { status: "idle", transcript: "", result: null, error: "", recorder: null };
    function resetVoiceState() {
      if (voice.recorder && voice.recorder.isRecording()) voice.recorder.stop();
      voice = { status: "idle", transcript: "", result: null, error: "", recorder: null };
    }

    function badge(challenge) {
      if (passed.has(challenge.number)) return "✅";
      return challenge.type === "voice" ? "🗣" : "🖵";
    }

    function renderCategories() {
      const byCat = global.Challenges.byCategory();
      catList.innerHTML = "";
      byCat.forEach((list, category) => {
        const group = document.createElement("details");
        group.className = "training__group";
        if (active && active.category === category) group.open = true;
        const summary = document.createElement("summary");
        const doneCount = list.filter((c) => passed.has(c.number)).length;
        summary.textContent = `${category} (${doneCount}/${list.length})`;
        group.appendChild(summary);
        const ul = document.createElement("ul");
        ul.className = "training__list";
        list.forEach((c) => {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "training__item";
          if (active && active.number === c.number) btn.classList.add("is-active");
          btn.innerHTML = `<span class="training__item-badge">${badge(c)}</span><span>Frage ${c.number}: ${c.title}</span>`;
          btn.addEventListener("click", () => selectChallenge(c));
          li.appendChild(btn);
          ul.appendChild(li);
        });
        group.appendChild(ul);
        catList.appendChild(group);
      });
    }

    function stopPolling() {
      if (pollHandle) clearInterval(pollHandle);
      pollHandle = null;
    }

    function selectChallenge(challenge) {
      stopPolling();
      active = challenge;
      sinceTs = 0;
      resetVoiceState();
      renderDetail();
      renderCategories();
    }

    function startChallenge() {
      if (!active) return;
      sinceTs = Date.now();
      resetVoiceState();
      if (active.setup) {
        try {
          active.setup(sim);
        } catch (e) {
          console.error("challenge setup failed", e);
        }
      }
      if (active.type === "device") {
        stopPolling();
        pollHandle = setInterval(renderDetail, 400);
      }
      renderDetail();
    }

    function resetChallenge() {
      stopPolling();
      sinceTs = 0;
      resetVoiceState();
      renderDetail();
    }

    function selfCertify() {
      if (!active) return;
      passed.add(active.number);
      renderDetail();
      renderCategories();
    }

    // ----------------------------------------------------- voice grading
    function toggleRecording() {
      if (!active) return;
      if (voice.status === "recording") {
        if (voice.recorder) voice.recorder.stop();
        return;
      }
      voice = { status: "recording", transcript: "", result: null, error: "", recorder: null };
      voice.recorder = global.AudioRecorder.createRecorder({
        onStop: (blob, mimeType) => {
          runGrading(blob, mimeType);
        },
        onError: (err) => {
          voice.status = "error";
          voice.error = err.message;
          renderDetail();
        },
      });
      renderDetail(); // show "recording" state immediately
      voice.recorder.start();
    }

    async function runGrading(blob, mimeType) {
      const challenge = active;
      voice.status = "transcribing";
      renderDetail();
      try {
        const transcript = await global.GeminiAPI.transcribeAudio(blob, mimeType);
        if (active !== challenge) return; // user navigated away meanwhile
        voice.transcript = transcript;
        voice.status = "evaluating";
        renderDetail();
        const result = await global.GeminiAPI.evaluateCall(challenge, transcript);
        if (active !== challenge) return;
        voice.result = result;
        voice.status = "done";
        if (result.pass) {
          passed.add(challenge.number);
          renderCategories();
        }
        renderDetail();
      } catch (e) {
        if (active !== challenge) return;
        voice.status = "error";
        voice.error = e.message;
        renderDetail();
      }
    }

    function renderDetail() {
      if (!active) {
        detail.innerHTML = '<div class="training__placeholder">Wähle links eine Aufgabe aus der Liste.</div>';
        return;
      }
      const c = active;
      const started = sinceTs > 0;
      let checklistHtml = "";
      let allPass = false;

      if (c.type === "device" && started) {
        const results = global.Challenges.evaluate(sim, c, sinceTs);
        allPass = results.length > 0 && results.every((r) => r.pass);
        if (allPass && !passed.has(c.number)) {
          passed.add(c.number);
          renderCategories();
        }
        checklistHtml = `<ul class="training__checklist">${results
          .map((r) => `<li class="${r.pass ? "is-pass" : "is-pending"}">${r.pass ? "✅" : "⬜"} ${r.label}</li>`)
          .join("")}</ul>`;
      }

      const stepsHtml = c.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");

      detail.innerHTML = `
        <div class="training__detail-head">
          <span class="training__number">Frage ${c.number}</span>
          <span class="training__type training__type--${c.type}">${c.type === "device" ? "gerätebasiert · automatisch geprüft" : "Sprechfunk / Verfahren · KI-Bewertung"}</span>
        </div>
        <h3>${escapeHtml(c.title)}</h3>
        <p class="training__important"><strong>Was wichtig ist:</strong> ${escapeHtml(c.important)}</p>
        <ol class="training__steps">${stepsHtml}</ol>
        <p class="training__criteria"><strong>Erfolgskriterien:</strong> ${escapeHtml(c.criteria)}</p>
        ${c.hint ? `<p class="training__device-hint">💡 <strong>Im Simulator:</strong> ${escapeHtml(c.hint)}</p>` : ""}
        <div class="training__actions">
          <button type="button" class="training__btn training__btn--start" id="training-start">${started ? "Neu starten" : "Aufgabe starten"}</button>
          ${started ? '<button type="button" class="training__btn" id="training-reset">Zurücksetzen</button>' : ""}
        </div>
        ${started && c.type === "device" ? checklistHtml : ""}
        ${started && c.type === "device" ? `<div class="training__result ${allPass ? "is-pass" : "is-pending"}">${allPass ? "✅ Bestanden" : "Noch nicht vollständig — Aufgabe am Gerät ausführen"}</div>` : ""}
        ${started && c.type === "voice" ? renderVoiceSection(c) : ""}
      `;

      const startBtn = document.getElementById("training-start");
      if (startBtn) startBtn.addEventListener("click", startChallenge);
      const resetBtn = document.getElementById("training-reset");
      if (resetBtn) resetBtn.addEventListener("click", resetChallenge);
      const certifyBtn = document.getElementById("training-certify");
      if (certifyBtn) certifyBtn.addEventListener("click", selfCertify);
      const recordBtn = document.getElementById("training-record");
      if (recordBtn) recordBtn.addEventListener("click", toggleRecording);
    }

    function renderVoiceSection(c) {
      const micOk = global.AudioRecorder.isSupported();
      const apiOk = global.GeminiAPI.isConfigured();
      let aiBlock = "";

      if (!micOk) {
        aiBlock = '<p class="training__hint">⚠️ Dieser Browser unterstützt keine Mikrofonaufnahme — nur Selbstbestätigung möglich.</p>';
      } else if (!apiOk) {
        aiBlock = '<p class="training__hint">💡 Trage oben rechts unter „⚙ KI-Einstellungen“ einen Gemini API-Schlüssel ein, um deinen Funkspruch automatisch aufnehmen, transkribieren und bewerten zu lassen.</p>';
      } else {
        const recording = voice.status === "recording";
        aiBlock = `<button type="button" class="training__btn training__record-btn ${recording ? "is-recording" : ""}" id="training-record">${recording ? "⏹ Aufnahme beenden" : "🎙 Sprechfunk aufnehmen"}</button>`;
        if (voice.status === "recording") {
          aiBlock += '<p class="training__hint training__hint--live">🔴 Aufnahme läuft — sprich den Funkspruch, dann auf „Aufnahme beenden“ klicken.</p>';
        } else if (voice.status === "transcribing") {
          aiBlock += '<p class="training__hint training__hint--live">⏳ Transkribiere Aufnahme (Gemini)…</p>';
        } else if (voice.status === "evaluating") {
          aiBlock += `<p class="training__transcript">🗣 „${escapeHtml(voice.transcript)}“</p><p class="training__hint training__hint--live">⏳ Bewerte Funkspruch (Gemini)…</p>`;
        } else if (voice.status === "error") {
          aiBlock += `<p class="training__hint training__hint--error">⚠️ ${escapeHtml(voice.error)}</p>`;
        } else if (voice.status === "done" && voice.result) {
          const r = voice.result;
          const missingHtml = r.missing && r.missing.length ? `<ul class="training__missing">${r.missing.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : "";
          aiBlock += `
            <p class="training__transcript">🗣 „${escapeHtml(voice.transcript)}“</p>
            <div class="training__eval ${r.pass ? "is-pass" : "is-fail"}">
              <strong>${r.pass ? "✅ Bestanden" : "❌ Noch nicht bestanden"}</strong>
              <p>${escapeHtml(r.feedback)}</p>
              ${missingHtml}
            </div>`;
        }
      }

      return `
        <div class="training__voice">${aiBlock}</div>
        <button type="button" class="training__btn training__btn--certify" id="training-certify">${passed.has(c.number) ? "✅ Als erledigt markiert" : "Alternativ: Ich habe es korrekt gesprochen (manuell bestätigen)"}</button>
      `;
    }

    function escapeHtml(s) {
      const div = document.createElement("div");
      div.textContent = s;
      return div.innerHTML;
    }

    renderCategories();
    renderDetail();
  }

  global.initChallengeUI = initChallengeUI;
})(window);
