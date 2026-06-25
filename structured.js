const { extractContent } = require("./extract");
const { llmJson } = require("./llm");

async function extractStructured(url, schema) {
  if (!url) throw new Error("url is required");

  const extracted = await extractContent(url);
  const textContent = extracted.textContent || "";

  if (!textContent || textContent.trim().length < 10) {
    throw new Error("Insufficient content extracted from URL");
  }

  const schemaDesc = schema
    ? `Extract the following fields from the content and return as JSON matching this schema/description:\n${JSON.stringify(schema, null, 2)}`
    : `Extract the most important structured information from this content as a JSON object. Use field names like title, author, datePublished, summary, keyPoints, keywords, statistics.`;

  const result = await llmJson(
    `Extract structured data from the following content.\n\n${schemaDesc}\n\nContent:\n${textContent.substring(0, 20000)}`,
    {
      maxTokens: 1500,
      temperature: 0.2,
      system: "You are a data extraction engine. Extract clean structured data from text content. Return ONLY valid JSON. Use null for missing fields.",
    }
  );

  return {
    url,
    title: extracted.title,
    wordCount: extracted.wordCount,
    extractedAt: new Date().toISOString(),
    schema,
    data: result,
  };
}

module.exports = { extractStructured };
