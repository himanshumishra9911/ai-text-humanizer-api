import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Health check
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
      top_p: 0.85
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
   AI TEXT DETECTOR
========================= */
app.post("/detect", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: text,
      instructions: `
Analyze the text and estimate AI vs human probability.

Consider:
- Predictability
- Sentence uniformity
- Burstiness
- Repetition
- Structural smoothness

Return ONLY valid JSON in this format:
{
  "ai_probability": number (0-100),
  "human_probability": number (0-100),
  "verdict": "Likely AI-generated" or "Likely Human-written"
}
`
    });

    const raw =
      response.output_text ||
      response.output?.[0]?.content?.[0]?.text;

    if (!raw) {
      return res.status(500).json({ error: "No detection output" });
    }

    const parsed = JSON.parse(raw);

    res.json({
      success: true,
      ai_probability: parsed.ai_probability,
      human_probability: parsed.human_probability,
      verdict: parsed.verdict,
    });
  } catch (err) {
    console.error("DETECT ERROR:", err.message);
    res.status(500).json({ error: "Detection failed" });
  }
});

// Render compatible port
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
