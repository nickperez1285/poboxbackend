const { isAllowedOrigin } = require("./corsConfig");

describe("CORS Configuration Logic", () => {
  test("allows the production domain", () => {
    expect(isAllowedOrigin("https://www.porchpobox.com")).toBe(true);
    expect(isAllowedOrigin("https://porchpobox.com")).toBe(true);
  });

  test("allows localhost for development", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  test("allows Vercel preview deployments", () => {
    expect(isAllowedOrigin("https://frontend-git-main-myuser.vercel.app")).toBe(
      true,
    );
  });

  test("blocks unauthorized domains", () => {
    expect(isAllowedOrigin("https://evil-hacker.com")).toBe(false);
  });

  test("handles null/empty origins correctly", () => {
    // Some local tools or server-to-server requests send no origin
    expect(isAllowedOrigin(null)).toBe(true);
  });
});
