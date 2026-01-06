import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.json({ status: "AI Humanizer + Detector API running" });
});

/* =========================
   AI TEXT HUMANIZER
========================= */
app.post("/humanize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: text,
      instructions: `
Rewrite the text as if written casually by a real person.

Rules:
- Keep meaning unchanged
- Natural, uneven sentence flow
- Slight imperfections allowed
- Avoid formal or academic tone
- No explanations, no questions
- Return ONLY rewritten text
`,
      temperature: 1.15,
      top_p: 0.85,
    });

    let output =
      response.output_text ||
      response.output?.[0]?.content?.[0]?.text;

    if (!output) {
      return res.status(500).json({ error: "No output generated" });
    }

    // ---- Human noise injection ----
    const fillers = [
      "Honestly,",
      "In simple terms,",
      "That’s the thing—",
      "If you think about it,",
      "In day-to-day use,",
      ""
    ];

    const endings = [
      "",
      " It just works.",
      " Nothing too fancy.",
      " Pretty straightforward.",
      ""
    ];

    function injectHumanNoise(text) {
      const sentences = text.split(". ");
      if (sentences.length < 3) return text;

      const start = fillers[Math.floor(Math.random() * fillers.length)];
      if (start) sentences[0] = `${start} ${sentences[0]}`;

      const index = Math.floor(Math.random() * sentences.length);
      sentences[index] = sentences[index].replace(",", "");

      const end = endings[Math.floor(Math.random() * endings.length)];
      return sentences.join(". ") + end;
    }

    output = injectHumanNoise(output);

    res.json({
      success: true,
      humanized_text: output,
    });
  } catch (err) {
    console.error("HUMANIZE ERROR:", err.message);
    res.status(500).json({ error: "Humanization failed" });
  }
});

/* =========================
   AI TEXT DETECTOR (STRICT + HIGHLIGHT READY)
========================= */
app.post("/detect", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Split text into meaningful sentences
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);

    const results = [];
    let totalAI = 0;

    for (const sentence of sentences) {
      const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: sentence,
        instructions: `
You are a STRICT AI content detection system.

Your task is to judge how likely the sentence is AI-generated.

Rules:
- Be skeptical by default
- Neutral, informational, SEO-style, or polished sentences → AI
- Only mark human if there is clear opinion, inconsistency, casual tone, or natural imperfection
- If unsure, lean towards AI
- Do NOT be generous

Return ONLY valid JSON in this exact format:
{
  "ai": number,
  "human": number,
  "reason": "short explanation"
}

Rules:
- ai + human must equal 100
- ai must be >= 80 for formal or polished sentences
- ai must be >= 60 for neutral informational sentences
- Do NOT include any extra text

Sentence:
"${sentence}"
`
      });

      let data;
      try {
        data = JSON.parse(response.output_text);
      } catch {
        continue;
      }

      totalAI += data.ai;

      results.push({
        sentence,
        ai: data.ai,
        human: data.human,
        reason: data.reason,
        // 🔴 🟠 🟢 highlight logic
        highlight:
          data.ai >= 75
            ? "high"     // 🔴 AI-heavy
            : data.ai >= 45
            ? "medium"   // 🟠 Mixed
            : "low"      // 🟢 Human
      });
    }

    const avgAI = results.length
      ? Math.round(totalAI / results.length)
      : 0;

    const avgHuman = 100 - avgAI;

    res.json({
      success: true,
      overall: {
        ai_probability: avgAI,
        human_probability: avgHuman,
        verdict:
          avgAI >= 75
            ? "Likely AI-generated"
            : avgAI >= 45
            ? "Possibly AI-generated"
            : "Likely Human-written"
      },
      sentences: results
    });

  } catch (error) {
    console.error("DETECT ERROR:", error.message);
    res.status(500).json({
      error: "Detection failed",
      details: error.message
    });
  }
});
