const { extractContent } = require("./extract");
const { llmCall, llmJson } = require("./llm");

async function generateBrief(params) {
  const { urls, topics, format, focus } = params;

  if ((!urls || !Array.isArray(urls) || urls.length === 0) &&
      (!topics || !Array.isArray(topics) || topics.length === 0)) {
    throw new Error("Either urls (array of URLs) or topics (array of strings) is required");
  }

  const sources = [];

  // Process URLs
  if (urls && Array.isArray(urls)) {
    const results = await Promise.allSettled(
      urls.map(async (u) => {
        const urlStr = u.url || u;
        const label = u.label || "";
        try {
          const extracted = await extractContent(urlStr);
          return {
            title: extracted.title || label || urlStr,
            url: urlStr,
            content: (extracted.textContent || "").substring(0, 4000),
            wordCount: extracted.wordCount,
            excerpt: extracted.excerpt || "",
          };
        } catch {
          return { title: label || urlStr, url: urlStr, content: "", error: "extraction failed" };
        }
      })
    );
    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value.content) sources.push(r.value);
    });
  }

  // Process topics (search for each topic)
  if (topics && Array.isArray(topics)) {
    const axios = require("axios");
    const searchResults = await Promise.allSettled(
      topics.map(async (topic) => {
        try {
          const resp = await axios.get(
            `https://api.duckduckgo.com/?format=json&q=${encodeURIComponent(topic)}`,
            { timeout: 8000 }
          );
          const items = (resp.data.RelatedTopics || []).slice(0, 2);
          const results = await Promise.allSettled(
            items.map(async (item) => {
              const urlStr = item.FirstURL;
              if (!urlStr) return null;
              const extracted = await extractContent(urlStr);
              return {
                title: extracted.title || item.Text?.split(" - ")[0] || topic,
                url: urlStr,
                content: (extracted.textContent || "").substring(0, 4000),
                wordCount: extracted.wordCount,
                excerpt: extracted.excerpt || "",
                topic,
              };
            })
          );
          return results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
        } catch {
          return [];
        }
      })
    );
    searchResults.forEach((r) => {
      if (r.status === "fulfilled") {
        r.value.forEach((v) => {
          if (v && v.content) sources.push(v);
        });
      }
    });
  }

  if (sources.length === 0) {
    throw new Error("Could not extract content from any source");
  }

  const briefFormat = format || "executive";
  const focusArea = focus ? `Focus the brief specifically on "${focus}".` : "Cover the most important and relevant information.";

  const contextBlock = sources
    .map((s, i) => `[Source ${i + 1}]: ${s.title}\nURL: ${s.url}\n${s.excerpt ? `Excerpt: ${s.excerpt}\n` : ""}\n${s.content}`)
    .join("\n\n---\n\n");

  let brief;
  if (briefFormat === "bullet") {
    brief = await llmCall(
      `Generate a bullet-point briefing from the following sources.\n\n${focusArea}\n\nSources:\n${contextBlock}\n\nFormat:\n- Key Headline 1: bullet points\n- Key Headline 2: bullet points\n\nInclude only the most important information. Be concise.`,
      { maxTokens: 1500, temperature: 0.3 }
    );
  } else if (briefFormat === "detailed") {
    brief = await llmCall(
      `Generate a detailed briefing report from the following sources.\n\n${focusArea}\n\nSources:\n${contextBlock}\n\nInclude:\n1. Executive Summary\n2. Key Developments\n3. Analysis & Implications\n4. Action Items\n\nWrite in professional briefing format.`,
      { maxTokens: 2500, temperature: 0.4 }
    );
  } else {
    // executive (default)
    brief = await llmCall(
      `Generate an executive briefing from the following sources.\n\n${focusArea}\n\nSources:\n${contextBlock}\n\nProvide:\n- 2-3 paragraph executive summary\n- 5-7 key bullet points\n- Key takeaway\n\nBe concise and professional.`,
      { maxTokens: 1500, temperature: 0.3 }
    );
  }

  return {
    format: briefFormat,
    focus: focus || null,
    sourcesProcessed: sources.length,
    sources: sources.map((s) => ({ title: s.title, url: s.url, wordCount: s.wordCount })),
    briefing: brief,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { generateBrief };
