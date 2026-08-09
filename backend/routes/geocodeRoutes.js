const express = require("express");
const router = express.Router();

router.get("/geocode", async (req, res) => {
  const { q, limit = 1 } = req.query;
  if (!q || typeof q !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "Missing address query." });
  }

  const parsedLimit = parseInt(limit, 10);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 1;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${safeLimit}&q=${encodeURIComponent(
      q,
    )}`;
    const response = await fetch(url, {
      headers: {
        "Accept-Language": "en",
        "User-Agent": "PorchPOBox/1.0 (https://porchpobox.com)",
      },
    });
    if (!response.ok) {
      return res
        .status(response.status)
        .json({ success: false, message: "Geocoding request failed." });
    }
    const data = await response.json();
    res.json({ success: true, results: data });
  } catch (error) {
    res.status(502).json({ success: false, message: "Geocoding service unavailable." });
  }
});

module.exports = router;
