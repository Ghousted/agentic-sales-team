import { afterEach, describe, expect, it, vi } from "vitest";
import { safeHttpUrl, openExternal, openMailto } from "./safeUrl";

describe("safeHttpUrl", () => {
  it("keeps http and https URLs", () => {
    expect(safeHttpUrl("https://www.reddit.com/r/x/comments/1")).toBe("https://www.reddit.com/r/x/comments/1");
    expect(safeHttpUrl("  http://example.com ")).toBe("http://example.com/");
  });

  it.each([
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "mailto:a@b.com",
    "//evil.example/path",
    "reddit.com/r/x",
    "",
    "https://",
  ])("rejects %j", (raw) => {
    expect(safeHttpUrl(raw)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});

describe("openExternal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens http(s) links with noopener,noreferrer", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openExternal("https://facebook.com/groups/1/posts/2");
    expect(open).toHaveBeenCalledWith("https://facebook.com/groups/1/posts/2", "_blank", "noopener,noreferrer");
  });

  it("does not open other schemes", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openExternal("javascript:alert(1)");
    expect(open).not.toHaveBeenCalled();
  });
});

describe("openMailto", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens mailto links with noopener,noreferrer", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openMailto("mailto:a@b.com?subject=Hi");
    expect(open).toHaveBeenCalledWith("mailto:a@b.com?subject=Hi", "_blank", "noopener,noreferrer");
  });

  it("does not open other schemes", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openMailto("javascript:alert(1)");
    openMailto("https://example.com");
    expect(open).not.toHaveBeenCalled();
  });
});
