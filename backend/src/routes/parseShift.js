import { Router } from "express";
import multer from "multer";

export const parseShiftRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const demoParsedShift = {
  shiftDate: "2026-06-03",
  startTime: "15:00",
  endTime: "23:00",
  siteName: "Union Station",
  siteAddress: "65 Front St W, Toronto, ON",
  siteLat: 43.6453,
  siteLng: -79.3806,
  shiftCode: "Metro 235 (TT)",
  confidence: "demo",
};

async function parseWithClaude(file) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const base64 = file.buffer.toString("base64");
  const mediaType = file.mimetype || "image/png";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text:
                "Extract emergency security shift details from this screenshot. " +
                "Return ONLY valid JSON with keys: shiftDate (YYYY-MM-DD), startTime (HH:MM 24h), endTime (HH:MM 24h), siteName, siteAddress, shiftCode, notes, confidence. " +
                "If a value is not visible, use an empty string.",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude parse failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const text = data.content?.find((item) => item.type === "text")?.text || "{}";
  return JSON.parse(text);
}

parseShiftRouter.post("/", upload.single("screenshot"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Upload a screenshot file." });
    }

    const parsed = await parseWithClaude(req.file);

    if (parsed) {
      return res.json({
        parsedShift: parsed,
        source: "claude",
      });
    }

    res.json({
      parsedShift: {
        ...demoParsedShift,
        fileName: req.file.originalname,
      },
      source: "demo-fallback",
      message:
        "ANTHROPIC_API_KEY is not set, so the app returned a demo parse. You can edit the shift details before finding guards.",
    });
  } catch (err) {
    next(err);
  }
});
