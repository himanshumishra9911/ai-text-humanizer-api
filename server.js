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

// Health check
app.get("/", (req, res) => {
  res.json({ status: "AI Text Humanizer API is running" });
});

// Humanizer API (detector-focused)
app.post("/humanize", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Text is required" });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: text,
      instructions: `
Rewrite the text as if it were written casually by a real person, not an AI.

Guidelines:
- Keep the original meaning exactly the same
- Write naturally, the way humans actually think and type
- Vary sentence length unevenly; avoid balance and symmetry
- Occasionally use sentence fragments or slightly informal phrasing
- Avoid polished, academic, or editor-like tone
- Let the writing feel a little imperfect, but still clear
- Do not explain anything
- Do not ask questions
- Do not add headings or formatting
- Do not mention rewriting, editing, or AI
- Return ONLY the rewritten text

Write like a human who knows the topic but isn’t trying to sound perfect.
`,
      temperature: 1.15,
      top_p: 0.85
    });

    // -------- Safe extraction --------
    let humanizedText = "";

    if (response.output_text) {
      humanizedText = response.output_text;
    } else if (
      response.output &&
      response.output[0] &&
      response.output[0].content &&
      response.output[0].content[0] &&
      response.output[0].content[0].text
    ) {
      humanizedText = response.output[0].content[0].text;
    }

    if (!humanizedText) {
      return res.status(500).json({ error: "No text generated" });
    }

    // -------- Human noise injection (detector breaker) --------
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
      " And yeah, it just works.",
      " Nothing too fancy.",
      " It’s pretty straightforward.",
      ""
    ];

    function injectHumanNoise(text) {
      const sentences = text.split(". ");
      if (sentences.length < 3) return text;

      // Random filler at start
      const start = fillers[Math.floor(Math.random() * fillers.length)];
      if (start) {
        sentences[0] = `${start} ${sentences[0]}`;
      }

      // Randomly weaken one sentence (remove a comma if exists)
      const index = Math.floor(Math.random() * sentences.length);
      sentences[index] = sentences[index].replace(",", "");

      // Random casual ending
      const end = endings[Math.floor(Math.random() * endings.length)];

      return sentences.join(". ") + end;
    }

    humanizedText = injectHumanNoise(humanizedText);

    res.json({
      success: true,
      humanized_text: humanizedText,
    });
  } catch (error) {
    console.error("OPENAI ERROR:", error.message);
    res.status(500).json({
      error: "Humanization failed",
      details: error.message,
    });
  }
});

// Render-compatible port binding
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});