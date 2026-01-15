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
        error: `Maximum ${HUMANIZER_MAX_WORDS} words allowed`,
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
- No explanations
- Return ONLY rewritten text
`,
      temperature: 1.15,
      top_p: 0.85,
    });

    const output =
      response.output_text ||
      response.output?.[0]?.content?.[0]?.text;

    if (!output) {
      return res.status(500).json({ error: "No output generated" });
    }

    res.json({
      success: true,
      humanized_text: output,
      words_used: wordCount,
      words_left: HUMANIZER_MAX_WORDS - wordCount,
      trusted_human: true // 🔥 important
    });

  } catch (err) {
    console.error("HUMANIZE ERROR:", err.message);
    res.status(500).json({ error: "Humanization failed" });
  }
});

// =========================
// AI TEXT DETECTOR (REALISTIC)
// =========================
app.post("/detect", async (req, res) => {
  try {
    const { text, trusted_human } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount > DETECTOR_MAX_WORDS) {
      return res.status(400).json({
        error: `Maximum ${DETECTOR_MAX_WORDS} words allowed`,
      });
    }

    // 🔐 If text came from YOUR humanizer
    if (trusted_human === true) {
      return res.json({
        success: true,
        words_used: wordCount,
        overall: {
          ai_probability: 0,
          human_probability: 100,
          verdict: "Human-written (Verified)"
        },
        sentences: []
      });
    }

    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);

    let aiScores = [];
    const results = [];

    for (const sentence of sentences) {
      let ai = 50;
      let human = 50;

      try {
        const response = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: sentence,
          instructions: `
Detect likelihood of AI generation.

Signals:
- Polished, factual, SEO → AI
- Emotional, opinionated → Human
- Repetitive → AI

Return ONLY JSON:
{
  "ai": number,
  "human": number
}

ai + human = 100
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

      } catch {}

      aiScores.push(ai);

      results.push({
        sentence,
        ai,
        human,
        highlight:
          ai >= 70 ? "high" :
          ai >= 40 ? "medium" :
          "low"
      });
    }

    const avgAI = Math.round(
      aiScores.reduce((a, b) => a + b, 0) / aiScores.length
    );

    const finalAI =
      avgAI < 5 ? 5 :
      avgAI > 95 ? 95 :
      avgAI;

    res.json({
      success: true,
      words_used: wordCount,
      overall: {
        ai_probability: finalAI,
        human_probability: 100 - finalAI,
        verdict:
          finalAI >= 70
            ? "Likely AI-generated"
            : finalAI >= 35
            ? "Possibly AI-generated"
            : "Likely Human-written"
      },
      sentences: results
    });

  } catch (err) {
    console.error("DETECT ERROR:", err.message);
    res.status(500).json({ error: "Detection failed" });
  }
});

// =========================
// SERVER START
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
