const { extractContent } = require("./extract");
const { llmJson } = require("./llm");

const SEARCH_API = "https://api.duckduckgo.com/?format=json&q=";

async function searchWeb(query) {
  const axios = require("axios");
  try {
    const resp = await axios.get(`${SEARCH_API}${encodeURIComponent(query)}`, { timeout: 8000 });
    const results = resp.data.RelatedTopics || [];
    return results.slice(0, 6).map((r) => ({
      title: r.Text?.split(" - ")[0] || r.Text || "",
      snippet: r.Text || "",
      url: r.FirstURL || "",
    })).filter((r) => r.url);
  } catch {
    return [];
  }
}

async function competitorIntel(params) {
  const { company_a, company_b, industry, aspect } = params;

  if (!company_a || !company_b) {
    throw new Error("Both company_a and company_b are required");
  }

  const searchQueryA = `${company_a} ${industry || ""} news analysis`.trim();
  const searchQueryB = `${company_b} ${industry || ""} news analysis`.trim();

  const [resultsA, resultsB] = await Promise.all([
    searchWeb(searchQueryA),
    searchWeb(searchQueryB),
  ]);

  const allResults = [...resultsA.slice(0, 3), ...resultsB.slice(0, 3)];

  const extractResults = await Promise.allSettled(
    allResults.map(async (r) => {
      try {
        const extracted = await extractContent(r.url);
        return { ...r, content: (extracted.textContent || "").substring(0, 3000) };
      } catch {
        return { ...r, content: "" };
      }
    })
  );

  const sourcesA = extractResults
    .filter((r, i) => r.status === "fulfilled" && r.value.content && i < 3)
    .map((r) => r.value);

  const sourcesB = extractResults
    .filter((r, i) => r.status === "fulfilled" && r.value.content && i >= 3 && i < 6)
    .map((r) => r.value);

  const focusArea = aspect && aspect !== "general"
    ? `Focus specifically on the "${aspect}" aspect.`
    : "Provide a comprehensive competitive analysis.";

  const contextA = sourcesA.map((s) => `--- ${s.title} (${s.url}) ---\n${s.content}`).join("\n");
  const contextB = sourcesB.map((s) => `--- ${s.title} (${s.url}) ---\n${s.content}`).join("\n");

  const result = await llmJson(
    `Perform a competitive intelligence analysis of:\n\nCompany A: ${company_a}\nCompany B: ${company_b}\n${industry ? `Industry: ${industry}` : ""}\n${focusArea}\n\nContext for ${company_a}:\n${contextA || "No sources found for this company"}\n\nContext for ${company_b}:\n${contextB || "No sources found for this company"}\n\nReturn JSON:\n{\n  "executive_summary": "2-3 paragraph analysis",\n  "company_a_profile": {"strengths": [], "weaknesses": [], "market_position": "", "recent_developments": []},\n  "company_b_profile": {"strengths": [], "weaknesses": [], "market_position": "", "recent_developments": []},\n  "competitive_advantages": {"company_a": [], "company_b": []},\n  "market_overlap": "description of areas where they compete directly",\n  "recommendations": ["actionable insights"],\n  "confidence": "high|medium|low"\n}`,
    {
      maxTokens: 2000,
      temperature: 0.3,
      system: "You are a competitive intelligence analyst. Return ONLY valid JSON.",
    }
  );

  return {
    company_a,
    company_b,
    industry: industry || null,
    aspect: aspect || "general",
    sources_a: sourcesA.map((s) => ({ title: s.title, url: s.url })),
    sources_b: sourcesB.map((s) => ({ title: s.title, url: s.url })),
    ...result,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { competitorIntel };
