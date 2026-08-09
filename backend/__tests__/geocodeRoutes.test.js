const request = require("supertest");
const geocodeRoutes = require("../routes/geocodeRoutes");
const express = require("express");

const app = express();
app.use("/api", geocodeRoutes);

const mockJsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("GET /api/geocode", () => {
  afterEach(() => {
    global.fetch = undefined;
  });

  it("rejects missing query", async () => {
    const res = await request(app).get("/api/geocode");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("proxies to Nominatim and returns results", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      mockJsonResponse(200, [
        { lat: "37.604", lon: "-122.401", display_name: "Millbrae" },
      ]),
    );
    global.fetch = fetchMock;

    const res = await request(app).get(
      "/api/geocode?q=491+Richmond+Drive+Millbrae+CA+94030",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].lat).toBe("37.604");

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain("nominatim.openstreetmap.org/search");
    expect(calledUrl).toContain(encodeURIComponent("491 Richmond Drive Millbrae CA 94030"));
    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toContain("PorchPOBox");
  });

  it("returns 502 when the upstream request fails", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("network down"));

    const res = await request(app).get("/api/geocode?q=somewhere");
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });

  it("returns upstream status when Nominatim errors", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockJsonResponse(429, {}));

    const res = await request(app).get("/api/geocode?q=somewhere");
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
  });
});
