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
const MAX_WORDS = 200;

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

    // ---- Validation ----
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount > MAX_WORDS) {
      return res.status(400).json({
        error: `Word limit exceeded. Maximum ${MAX_WORDS} words allowed.`,
      });
    }

    // ---- OpenAI Call ----
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
      words_left: MAX_WORDS - wordCount,
    });

  } catch (err) {
    console.error("HUMANIZE ERROR:", err.message);
    res.status(500).json({ error: "Humanization failed" });
  }
});

// =========================
// AI TEXT DETECTOR (SMART + QUILLBOT STYLE)
// =========================
app.post("/detect", async (req, res) => {
  try {
    const { text } = req.body;

    // ---- Validation ----
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    // 🔒 800 WORD LIMIT
    const wordCount = text.trim().split(/\s+/).length;
    const MAX_WORDS = 800;

    if (wordCount > MAX_WORDS) {
      return res.status(400).json({
        error: `Maximum ${MAX_WORDS} words allowed`,
      });
    }

    // ---- Sentence split ----
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 12);

    const results = [];

    let aiHeavy = 0;
    let mixed = 0;
    let human = 0;

    for (const sentence of sentences) {
      let aiScore = 70;    // default AI-leaning
      let humanScore = 30;
      let reason = "Neutral structured sentence";

      try {
        const response = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: sentence,
          instructions: `
You are an AI content detector similar to QuillBot.

Judgement rules:
- Informational, SEO, neutral, polished sentences → AI
- Repetitive or symmetrical structure → AI
- Emotional tone, opinion, casual flow → Human
- If unsure, lean towards AI (not human)

Return ONLY valid JSON:
{
  "ai": number,
  "human": number,
  "reason": "short reason"
}

Rules:
- ai + human = 100
- Do NOT add any extra text

Sentence:
"${sentence}"
`
        });

        const parsed = JSON.parse(
          response.output_text ||
          response.output?.[0]?.content?.[0]?.text
        );

        aiScore = parsed.ai;
        humanScore = parsed.human;
        reason = parsed.reason;

      } catch {
        // fallback remains AI-leaning
      }

      // ---- Classification ----
      if (aiScore >= 70) aiHeavy++;
      else if (aiScore >= 40) mixed++;
      else human++;

      results.push({
        sentence,
        ai: aiScore,
        human: humanScore,
        reason,
        highlight:
          aiScore >= 70
            ? "high"    // 🔴 AI
            : aiScore >= 40
            ? "medium"  // 🟠 Mixed
            : "low"     // 🟢 Human
      });
    }

    const total = results.length || 1;

    // =========================
    // 🧠 SMART OVERALL LOGIC
    // =========================
    let overallAI;

    // 🟢 Mostly human → force AI very low (Humanizer-safe)
    if (human / total >= 0.8) {
      overallAI = Math.min(5, Math.round((aiHeavy / total) * 10));
    }
    // 🔴 Mostly AI content
    else if (aiHeavy / total >= 0.6) {
      overallAI = Math.round(70 + (aiHeavy / total) * 30);
    }
    // 🟠 Mixed content
    else {
      overallAI = Math.round(
        (aiHeavy * 80 + mixed * 50 + human * 20) / total
      );
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
