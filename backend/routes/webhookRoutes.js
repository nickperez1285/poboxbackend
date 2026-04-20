const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { getFirestore, admin } = require("../config/firebaseAdmin");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

const activateUserSubscription = async (session) => {
  const userId = session.client_reference_id;

  if (!userId) {
    console.warn("Stripe webhook missing client_reference_id:", {
      sessionId: session.id,
      customerEmail: session.customer_email || null
    });
    return;
  }

  console.log("Activating user subscription from Stripe webhook:", {
    userId,
    sessionId: session.id,
    customerEmail: session.customer_email || null
  });

  const firestore = getFirestore();
  const userRef = firestore.collection("users").doc(userId);
  const snapshot = await userRef.get();
  const currentData = snapshot.exists ? snapshot.data() : {};

  if (currentData.lastCheckoutSessionId === session.id) {
    console.log("Stripe webhook session already processed:", {
      userId,
      sessionId: session.id
    });
    return;
  }

  const existingEndDate = currentData.subscriptionEndsAt?.toDate
    ? currentData.subscriptionEndsAt.toDate()
    : null;
  const purchaseDate = new Date();
  const extensionBaseDate =
    existingEndDate && existingEndDate.getTime() > Date.now()
      ? existingEndDate
      : purchaseDate;
  const endDate = new Date(extensionBaseDate.getTime() + THIRTY_DAYS_IN_MS);

  await userRef.set(
    {
      email: session.customer_email || currentData.email || "",
      status: "active",
      subscribedAt: admin.firestore.Timestamp.fromDate(purchaseDate),
      subscriptionEndsAt: admin.firestore.Timestamp.fromDate(endDate),
      lastCheckoutSessionId: session.id
    },
    { merge: true }
  );

  console.log("Stripe webhook activated subscription successfully:", {
    userId,
    sessionId: session.id,
    subscriptionEndsAt: endDate.toISOString()
  });
};

router.post(
  "/",
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
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
