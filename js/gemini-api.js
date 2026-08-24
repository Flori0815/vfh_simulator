/**
 * Client for Google's Gemini "Generate Content" REST API, called directly
 * from the browser (this is a static site with no backend). Uses the
 * legacy models.generateContent endpoint specifically because it doesn't
 * require the Api-Revision header the newer Interactions API needs — that
 * header isn't in Google's Access-Control-Allow-Headers, so it fails CORS
 * from a browser origin, while generateContent works fine.
 *
 * Two calls: transcribeAudio() turns a recorded Blob into German text,
 * evaluateCall() judges that text against one exam challenge's criteria
 * and returns a structured verdict (via responseSchema, not prompt-only
 * JSON, so parsing is reliable). Both use the API key from js/settings.js.
 */
(function (global) {
  "use strict";

  const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

  function endpoint(model) {
    return `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  }

  // MediaRecorder mime strings carry a ";codecs=..." suffix Gemini doesn't
  // expect in inlineData.mimeType — strip it down to the container type.
  function baseMimeType(mimeType) {
    return (mimeType || "audio/ogg").split(";")[0].trim();
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result || "";
        const comma = result.indexOf(",");
        resolve(comma === -1 ? result : result.slice(comma + 1));
      };
      reader.onerror = () => reject(new Error("Audio konnte nicht gelesen werden."));
      reader.readAsDataURL(blob);
    });
  }

  async function callGemini(model, body) {
    const apiKey = global.simSettings.getApiKey();
    if (!apiKey) throw new Error("Kein Gemini API-Schlüssel hinterlegt. Bitte unter „⚙ KI-Einstellungen“ eintragen.");
    let resp;
    try {
      resp = await fetch(endpoint(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error("Netzwerkfehler beim Aufruf der Gemini API: " + e.message);
    }
    let json;
    try {
      json = await resp.json();
    } catch (e) {
      throw new Error(`Gemini API antwortete unerwartet (HTTP ${resp.status}).`);
    }
    if (!resp.ok) {
      const msg = (json && json.error && json.error.message) || `HTTP ${resp.status}`;
      throw new Error("Gemini API-Fehler: " + msg);
    }
    const candidate = json.candidates && json.candidates[0];
    const finishReason = candidate && candidate.finishReason;
    if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts.length) {
      if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
        throw new Error("Gemini hat die Anfrage aus Sicherheitsgründen abgelehnt.");
      }
      throw new Error("Gemini lieferte keine Antwort (finishReason: " + (finishReason || "unbekannt") + ").");
    }
    return candidate.content.parts.map((p) => p.text || "").join("");
  }

  async function transcribeAudio(blob, mimeType) {
    const model = global.simSettings.getModel();
    const data = await blobToBase64(blob);
    const text = await callGemini(model, {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Transkribiere die folgende deutschsprachige Sprechfunk-Aufnahme (UKW-Seefunk) wortwörtlich. " +
                "Gib NUR den transkribierten Text zurück, ohne Anführungszeichen, ohne Kommentar, ohne Zeitstempel. " +
                "Buchstabiertafeln (Alpha, Bravo, Charlie, ...) und Rufzeichen/MMSI-Ziffern bitte so transkribieren, wie gesprochen.",
            },
            { inlineData: { mimeType: baseMimeType(mimeType), data } },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    });
    return text.trim();
  }

  const EVAL_SCHEMA = {
    type: "object",
    properties: {
      pass: { type: "boolean", description: "true wenn der Funkspruch die Erfolgskriterien im Wesentlichen erfüllt" },
      feedback: { type: "string", description: "Kurzes, konstruktives Feedback auf Deutsch, 1-3 Sätze" },
      missing: { type: "array", items: { type: "string" }, description: "Liste fehlender oder falscher Pflichtelemente, leer wenn keine" },
    },
    required: ["pass", "feedback", "missing"],
  };

  async function evaluateCall(challenge, transcript) {
    const model = global.simSettings.getModel();
    const prompt =
      "Du bist Prüfer für das deutsche UBI/SRC-Seefunkzeugnis (Sprechfunk auf UKW-Seefunk). " +
      "Bewerte, ob der folgende (per Spracherkennung transkribierte) Funkspruch eines Prüflings die Aufgabe erfüllt. " +
      "Sei tolerant gegenüber Transkriptionsfehlern bei Eigennamen/Rufzeichen/Zahlen, aber bewerte Vollständigkeit und " +
      "korrekte Verfahrensstruktur (z. B. Reihenfolge MAYDAY/PAN PAN/SECURITE, dreifache Wiederholung wo vorgeschrieben, " +
      "Buchstabiertafel korrekt) streng.\n\n" +
      `AUFGABE: ${challenge.title}\n` +
      `WICHTIG: ${challenge.important}\n` +
      `VORGESCHRIEBENER ABLAUF:\n${(challenge.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")}\n` +
      `ERFOLGSKRITERIEN: ${challenge.criteria}\n\n` +
      `TRANSKRIPT DES PRÜFLINGS:\n"""${transcript}"""\n\n` +
      "Antworte ausschließlich im vorgegebenen JSON-Schema.";
    const text = await callGemini(model, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: EVAL_SCHEMA,
      },
    });
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Gemini-Antwort konnte nicht als JSON gelesen werden.");
    }
  }

  global.GeminiAPI = {
    transcribeAudio,
    evaluateCall,
    isConfigured: () => global.simSettings.hasApiKey(),
  };
})(window);
