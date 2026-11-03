import { describe, expect, it } from "vitest";
import { ask, searchConfig, suggest } from "../docsSearch.js";

describe("docs search config", () => {
  it("reads endpoints/keys from the environment and trims trailing slashes", () => {
    const cfg = searchConfig({
      SEARCH_ENDPOINT: "https://s.search.windows.net/",
      SEARCH_API_KEY: "qk",
      AOAI_ENDPOINT: "https://o.openai.azure.com/",
      AOAI_API_KEY: "ak",
      AOAI_DEPLOYMENT: "gpt-4o-mini",
    });
    expect(cfg.searchEndpoint).toBe("https://s.search.windows.net");
    expect(cfg.aoaiEndpoint).toBe("https://o.openai.azure.com");
    expect(cfg.index).toBe("pottery-docs");       // default
    expect(cfg.aoaiApiVersion).toBeTruthy();       // default
  });
});

describe("ask input validation", () => {
  it("rejects an empty question with 400 before any network call", async () => {
    expect(await ask({ question: "" }, {})).toEqual({ status: 400, body: { error: "Type a question" } });
    expect(await ask({}, {})).toEqual({ status: 400, body: { error: "Type a question" } });
  });

  it("rejects an over-long question with 400", async () => {
    const { status } = await ask({ question: "x".repeat(1000) }, {});
    expect(status).toBe(400);
  });

  it("throws a clear config error when a valid question hits unconfigured services", async () => {
    await expect(ask({ question: "how do I export a mold?" }, {})).rejects.toThrow(/Missing config/);
  });
});

describe("suggest", () => {
  it("returns an empty list without blowing up when search is unconfigured", async () => {
    expect(await suggest("mo", {})).toEqual([]);
    expect(await suggest("", {})).toEqual([]);
  });
});
