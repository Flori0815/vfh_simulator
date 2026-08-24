/**
 * Challenge browser UI: category list -> challenge list -> detail panel
 * with Start/Reset, a live-updating checklist for device challenges, and
 * a self-certify script view for voice challenges. Pure DOM glue over
 * js/challenges.js's data/validation and the sim's public state — no
 * challenge content or grading logic lives here.
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

    function badge(challenge) {
      if (challenge.type === "voice") return "🗣";
      return passed.has(challenge.number) ? "✅" : "🖵";
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
      renderDetail();
      renderCategories();
    }

    function startChallenge() {
      if (!active) return;
      sinceTs = Date.now();
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
      renderDetail();
    }

    function selfCertify() {
      if (!active) return;
      passed.add(active.number);
      renderDetail();
      renderCategories();
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
          <span class="training__type training__type--${c.type}">${c.type === "device" ? "gerätebasiert · automatisch geprüft" : "Sprechfunk / Verfahren · Selbstbestätigung"}</span>
        </div>
        <h3>${escapeHtml(c.title)}</h3>
        <p class="training__important"><strong>Was wichtig ist:</strong> ${escapeHtml(c.important)}</p>
        <ol class="training__steps">${stepsHtml}</ol>
        <p class="training__criteria"><strong>Erfolgskriterien:</strong> ${escapeHtml(c.criteria)}</p>
        <div class="training__actions">
          <button type="button" class="training__btn training__btn--start" id="training-start">${started ? "Neu starten" : "Aufgabe starten"}</button>
          ${started ? '<button type="button" class="training__btn" id="training-reset">Zurücksetzen</button>' : ""}
        </div>
        ${started && c.type === "device" ? checklistHtml : ""}
        ${started && c.type === "device" ? `<div class="training__result ${allPass ? "is-pass" : "is-pending"}">${allPass ? "✅ Bestanden" : "Noch nicht vollständig — Aufgabe am Gerät ausführen"}</div>` : ""}
        ${started && c.type === "voice" ? `<button type="button" class="training__btn training__btn--certify" id="training-certify">${passed.has(c.number) ? "✅ Als erledigt markiert" : "Ich habe es korrekt gesprochen"}</button><p class=\"training__hint\">Automatische Sprachbewertung folgt in einer späteren Ausbaustufe (siehe docs/ROADMAP.md).</p>` : ""}
      `;

      const startBtn = document.getElementById("training-start");
      if (startBtn) startBtn.addEventListener("click", startChallenge);
      const resetBtn = document.getElementById("training-reset");
      if (resetBtn) resetBtn.addEventListener("click", resetChallenge);
      const certifyBtn = document.getElementById("training-certify");
      if (certifyBtn) certifyBtn.addEventListener("click", selfCertify);
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
