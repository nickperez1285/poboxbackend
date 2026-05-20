const express = require("express");
const router = express.Router();
const { getStripe } = require("../config/stripeConfig");
const { activateUserSubscription } = require("../controllers/checkoutController");

router.post(
  "/",
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = getStripe().webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET_KEY
      );
    } catch (err) {
      console.error("Webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      console.log("Received Stripe webhook event:", event.type);

      if (event.type === "checkout.session.completed") {
        await activateUserSubscription(event.data.object);
      }

      if (event.type === "invoice.payment_succeeded") {
        console.log("Invoice payment succeeded:", event.data.object.id);
      }
    } catch (error) {
      console.error("Webhook processing error:", error);
      return res.status(500).json({ received: false, message: error.message });
    }

    res.json({ received: true });
  }
);

module.exports = router;
