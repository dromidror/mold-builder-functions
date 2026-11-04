import { describe, expect, it } from "vitest";
import { ask, buildMessages, searchConfig, searchQuery, suggest } from "../docsSearch.js";

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

describe("searchQuery", () => {
  it("drops filler words so the topic words drive retrieval", () => {
    expect(searchQuery("How to create Gallery")).toBe("create gallery");
    expect(searchQuery("how do I make a casting mold?")).toBe("make casting mold");
    expect(searchQuery("What is a gallery?")).toBe("gallery");
  });

  it("keeps single-word topics and falls back to the question when everything is filler", () => {
    expect(searchQuery("gestures")).toBe("gestures");
    expect(searchQuery("how to")).toBe("how to");
  });
});

describe("buildMessages", () => {
  const passages = [{ title: "Gestures", section: "Touch", content: "Pinch to zoom.", url: "" }];

  it("sends one user turn: earlier questions are background inside it, not separate turns", () => {
    const messages = buildMessages(
      "gestures",
      { screen: "3D view", history: ["how to create gallery", "export a mold"] },
      passages,
    );
    // Regression: history used to be pushed as extra `user` messages with no replies between them,
    // so the model answered the OLD question ("gallery") against the NEW question's docs.
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    const user = messages[1].content;
    expect(user).toContain("- how to create gallery");
    expect(user).toContain("- export a mold");
    expect(user).toContain("Final question — answer this one: gestures");
    // Background first, then the documentation, then the question to answer.
    expect(user.indexOf("how to create gallery")).toBeLessThan(user.indexOf("Documentation:"));
    expect(user.indexOf("Documentation:")).toBeLessThan(user.indexOf("answer this one: gestures"));
  });

  it("tells the model to answer only the final question", () => {
    const system = buildMessages("gestures", {}, passages)[0].content;
    expect(system).toMatch(/Answer ONLY the final question/);
  });

  it("works with no history or context", () => {
    const messages = buildMessages("gestures", undefined, []);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).not.toContain("Earlier questions");
    expect(messages[1].content).toContain("(no matching documentation found)");
  });
});

describe("suggest", () => {
  it("returns an empty list without blowing up when search is unconfigured", async () => {
    expect(await suggest("mo", {})).toEqual([]);
    expect(await suggest("", {})).toEqual([]);
  });
});
