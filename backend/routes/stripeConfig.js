const express = require("express");
const router = express.Router();

router.get("/stripe-config", (_req, res) => {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const mode = key.startsWith("sk_live") ? "live" : "test";

  res.json({
    mode,
    priceIds: {
      monthly: process.env.STRIPE_PRICE_ID_MONTHLY || "",
      semiannual: process.env.STRIPE_PRICE_ID_SEMIANNUAL || "",
      yearly: process.env.STRIPE_PRICE_ID_YEARLY || "",
    },
  });
});

module.exports = router;
