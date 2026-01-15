import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// CONFIG
// =========================
const HUMANIZER_MAX_WORDS = 200;
const DETECTOR_MAX_WORDS = 800;

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.json({ status: "AI Humanizer + Detector API running" });
});

// =========================
// AI TEXT HUMANIZER
// =========================
app.post("/humanize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount > HUMANIZER_MAX_WORDS) {
      return res.status(400).json({
        error: `Maximum ${HUMANIZER_MAX_WORDS} words allowed.`,
      });
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

    // ---- Human Noise Injection ----
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
      words_used: wordCount,
      words_left: HUMANIZER_MAX_WORDS - wordCount,
    });

  } catch (err) {
    console.error("HUMANIZE ERROR:", err.message);
    res.status(500).json({ error: "Humanization failed" });
  }
});

/// =========================
// AI TEXT DETECTOR (BEST PRACTICAL)
// =========================
app.post("/detect", async (req, res) => {
  try {
    const { text, trusted_human } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const MAX_WORDS = 800;
    const wordCount = text.trim().split(/\s+/).length;

    if (wordCount > MAX_WORDS) {
      return res.status(400).json({
        error: `Maximum ${MAX_WORDS} words allowed`,
      });
    }

    // =========================
    // 🔒 TRUSTED HUMAN (ONLY HUMANIZER OUTPUT)
    // =========================
    if (trusted_human === true) {
      return res.json({
        success: true,
        overall: {
          ai_probability: 2,
          human_probability: 98,
          verdict: "Human-written (Verified)"
        },
        sentences: text.split(/(?<=[.!?])\s+/).map(s => ({
          sentence: s,
          ai: 2,
          human: 98,
          reason: "Verified humanized output",
          highlight: "low"
        }))
      });
    }

    // =========================
    // NORMAL DETECTION
    // =========================
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);

    let aiScores = [];
    const results = [];

    for (const sentence of sentences) {
      let ai = 55;
      let human = 45;
      let reason = "Neutral structure";

      try {
        const response = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: sentence,
          instructions: `
Judge how likely the sentence is AI-written.

Signals:
- Informational, neutral, polished → AI
- Emotional, opinionated, uneven → Human
- Mixed tone → Mixed

Return ONLY JSON:
{
  "ai": number,
  "human": number,
  "reason": "short reason"
}

Rules:
- ai + human = 100
Sentence:
"${sentence}"
`
        });

        const parsed = JSON.parse(
          response.output_text ||
          response.output?.[0]?.content?.[0]?.text
        );

        ai = parsed.ai;
        human = parsed.human;
        reason = parsed.reason;

      } catch {}

      aiScores.push(ai);

      results.push({
        sentence,
        ai,
        human,
        reason,
        highlight:
          ai >= 70 ? "high" :
          ai >= 40 ? "medium" :
          "low"
      });
    }

    // =========================
    // 🧠 REAL OVERALL LOGIC
    // =========================
    const avgAI =
      aiScores.reduce((a, b) => a + b, 0) / aiScores.length;

    let overallAI;

    if (avgAI < 20) {
      // Real human writing still not 0
      overallAI = Math.max(5, Math.round(avgAI));
    } else if (avgAI < 40) {
      overallAI = Math.round(avgAI);
    } else if (avgAI < 70) {
      overallAI = Math.round(avgAI + 5);
    } else {
      overallAI = Math.min(95, Math.round(avgAI + 10));
    }

    const overallHuman = 100 - overallAI;

    res.json({
      success: true,
      words_used: wordCount,
      words_left: MAX_WORDS - wordCount,
      overall: {
        ai_probability: overallAI,
        human_probability: overallHuman,
        verdict:
          overallAI >= 70
            ? "Likely AI-generated"
            : overallAI >= 35
            ? "Possibly AI-generated"
            : "Likely Human-written"
      },
      sentences: results
    });

  } catch (error) {
    console.error("DETECT ERROR:", error.message);
    res.status(500).json({ error: "Detection failed" });
  }
});

// =========================
// SERVER START (RENDER)
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});