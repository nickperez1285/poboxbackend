// const express = require('express');
// const router = express.Router();
// const webhookController = require('../controllers/webhookController');

// // Stripe webhook endpoint
// router.post('/webhook', express.raw({ type: 'application/json' }), webhookController.handleWebhook);

// module.exports = router;
const express = require("express");
const router = express.Router();
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/", (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle events
  if (event.type === "customer.subscription.created") {
    console.log("Subscription created");
  }

  if (event.type === "invoice.payment_succeeded") {
    console.log("Payment succeeded");
  }

  res.json({ received: true });
});

module.exports = router;
