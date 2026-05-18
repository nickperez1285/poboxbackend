const { isAllowedOrigin } = require("../middleware/corsConfig");

describe("isAllowedOrigin", () => {
  it("allows missing origin (server-to-server)", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("")).toBe(true);
  });

  it("allows production porchpobox domains", () => {
    expect(isAllowedOrigin("https://www.porchpobox.com")).toBe(true);
    expect(isAllowedOrigin("https://porchpobox.com")).toBe(true);
  });

  it("allows Vercel preview URLs", () => {
    expect(isAllowedOrigin("https://porchpoboxfrontend-git-main-nickperez1285s-projects.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://porchpoboxfrontend-abc123.vercel.app")).toBe(true);
  });

  it("allows localhost for development", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("blocks unknown origins", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
  });
});
