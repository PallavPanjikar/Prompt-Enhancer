// background.js — service worker
// Handles all outbound AI API calls so content scripts / popup never hit
// page CSP or CORS issues directly.

const QUESTIONS_SYSTEM_PROMPT = `You are a prompt engineering assistant.
Given a user's rough, underspecified prompt (something they want an AI to do)
— and possibly some attached images, PDFs, or reference files for context —
identify the most important missing pieces of information that would make the
prompt dramatically more effective. Ask between 3 and 6 concise, specific
clarifying questions. Prefer questions about: goal/audience, desired
format/length, tone/style, constraints, and concrete examples or context.
Skip questions already answered in the prompt or clearly answered by the
attached files, and skip questions that would not meaningfully change the
output.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact
shape:
{"questions": ["question 1", "question 2", "..."]}`;

const SYNTHESIS_SYSTEM_PROMPT = `You are an expert prompt engineer.
You will be given a user's original rough prompt, possibly some attached
images/PDFs/reference files for context, and a set of clarifying questions
with their answers (some answers may be blank/skipped, ignore those). Write
ONE final, polished, ready-to-use prompt that an end user could paste
directly into any AI chat to get the best possible result. Weave in relevant
details from the answers and from the attached files naturally — do not just
list Q&A pairs, and do not simply say "see attached file". If images or PDFs
were attached, describe/reference the relevant content directly in the final
prompt so it's useful even without re-attaching the files. Structure it
clearly (context/task/format/constraints as relevant), but keep it as
natural prose/instructions, not a form.

Respond with ONLY the final prompt text. No labels like "Final prompt:", no
markdown fences, no commentary before or after.`;

function stripDataUrlPrefix(dataUrl) {
  const idx = dataUrl.indexOf(",");
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
}

async function callOpenAI({ apiKey, model, system, user, attachments }) {
  const contentParts = [{ type: "text", text: user }];
  (attachments || [])
    .filter((a) => a.kind === "image")
    .forEach((a) => {
      contentParts.push({ type: "image_url", image_url: { url: a.dataUrl } });
    });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: contentParts.length > 1 ? contentParts : user }
      ],
      temperature: 0.4
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic({ apiKey, model, system, user, attachments }) {
  const blocks = [];
  (attachments || []).forEach((a) => {
    if (a.kind === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: a.mimeType || "image/png", data: stripDataUrlPrefix(a.dataUrl) }
      });
    } else if (a.kind === "pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: stripDataUrlPrefix(a.dataUrl) }
      });
    }
  });
  blocks.push({ type: "text", text: user });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-5",
      max_tokens: 1024,
      system: system,
      messages: [{ role: "user", content: blocks }]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function callGemini({ apiKey, model, system, user, attachments }) {
  const modelName = model || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [];
  (attachments || []).forEach((a) => {
    if (a.kind === "image" || a.kind === "pdf") {
      parts.push({
        inline_data: {
          mime_type: a.kind === "pdf" ? "application/pdf" : a.mimeType || "image/png",
          data: stripDataUrlPrefix(a.dataUrl)
        }
      });
    }
  });
  parts.push({ text: user });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.4 }
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const respParts = data.candidates?.[0]?.content?.parts || [];
  return respParts.map((p) => p.text || "").join("\n").trim();
}

async function callProvider(config, system, user, attachments) {
  if (!config || !config.apiKey) {
    throw new Error("No API key configured. Open the extension's settings to add one.");
  }
  if (config.provider === "openai") {
    return callOpenAI({ apiKey: config.apiKey, model: config.model, system, user, attachments });
  }
  if (config.provider === "anthropic") {
    return callAnthropic({ apiKey: config.apiKey, model: config.model, system, user, attachments });
  }
  if (config.provider === "gemini") {
    return callGemini({ apiKey: config.apiKey, model: config.model, system, user, attachments });
  }
  throw new Error("Unknown provider configured.");
}

function stripJsonFences(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === "generateQuestions") {
        const raw = await callProvider(
          message.config,
          QUESTIONS_SYSTEM_PROMPT,
          `User's rough prompt:\n"""${message.prompt}"""`,
          message.attachments || []
        );
        let parsed;
        try {
          parsed = JSON.parse(stripJsonFences(raw));
        } catch (e) {
          throw new Error("Could not parse questions from the AI response. Try again.");
        }
        sendResponse({ ok: true, questions: parsed.questions || [] });
      } else if (message.action === "generateFinalPrompt") {
        const qnaText = message.qna
          .filter((q) => q.answer && q.answer.trim())
          .map((q) => `Q: ${q.question}\nA: ${q.answer.trim()}`)
          .join("\n\n");
        const userMsg = `Original prompt:\n"""${message.prompt}"""\n\nClarifying Q&A:\n${qnaText || "(no additional answers provided)"}`;
        const finalPrompt = await callProvider(
          message.config,
          SYNTHESIS_SYSTEM_PROMPT,
          userMsg,
          message.attachments || []
        );
        sendResponse({ ok: true, finalPrompt: stripJsonFences(finalPrompt) });
      } else {
        sendResponse({ ok: false, error: "Unknown action." });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
