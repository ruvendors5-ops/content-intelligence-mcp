const { llmJson, llmCall } = require("./llm");
const { extractContent } = require("./extract");

async function sentimentOverTime(params) {
  const { texts, urls, topic } = params;

  if (!texts && !urls && !topic) {
    throw new Error("One of texts, urls, or topic is required");
  }

  const pieces = [];

  if (texts && Array.isArray(texts)) {
    texts.forEach((t, i) => {
      pieces.push({ id: `text-${i}`, label: t.label || `Text ${i + 1}`, content: t.content, source: "direct" });
    });
  }

  if (urls && Array.isArray(urls)) {
    const axios = require("axios");
    const results = await Promise.allSettled(
      urls.map(async (u, i) => {
        const urlStr = u.url || u;
        const extracted = await extractContent(urlStr);
        return {
          id: `url-${i}`,
          label: u.label || extracted.title || `Source ${i + 1}`,
          content: extracted.textContent || "",
          source: urlStr,
        };
      })
    );
    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value.content) pieces.push(r.value);
    });
  }

  if (pieces.length === 0) {
    throw new Error("No extractable content found");
  }

  const analyses = await Promise.allSettled(
    pieces.map(async (piece) => {
      const truncated = piece.content.substring(0, 5000);
      const analysis = await llmJson(
        `Analyze the sentiment of this text about "${topic || piece.label}".\n\nReturn JSON:\n{\n  "overall": "positive|negative|neutral|mixed",\n  "score": 0.0-1.0,\n  "confidence": "high|medium|low",\n  "key_emotions": ["list of emotions detected"],\n  "notable_phrases": ["phrases that reveal sentiment"]\n}\n\nText:\n${truncated}`,
        {
          maxTokens: 300,
          temperature: 0.3,
          system: "You are a sentiment analysis engine. Return ONLY valid JSON.",
        }
      );
      return {
        id: piece.id,
        label: piece.label,
        source: piece.source,
        ...analysis,
      };
    })
  );

  const sentimentResults = analyses
    .filter((a) => a.status === "fulfilled")
    .map((a) => a.value);

  const overallSummary = await llmCall(
    `Synthesize the following sentiment analyses about "${topic || "the content"}".\n\nFindings:\n${sentimentResults.map((s) => `- ${s.label}: ${s.overall} (score: ${s.score})`).join("\n")}\n\nProvide a 2-3 sentence summary of the overall sentiment landscape, noting any shifts, contradictions, or patterns.`,
    { maxTokens: 300, temperature: 0.3 }
  );

  return {
    topic: topic || null,
    sourcesAnalyzed: sentimentResults.length,
    overall: overallSummary,
    results: sentimentResults,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { sentimentOverTime };
