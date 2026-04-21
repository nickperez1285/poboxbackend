const stripe = require('../config/stripeConfig');
const { createOneTimePayment } = require('../controllers/createOneTimePayment');
const { admin, getFirestore } = require("../config/firebaseAdmin");

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

const timestampToDate = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const activateUserSubscription = async (session, overrideUserId) => {
  const userId = overrideUserId || session.client_reference_id;

  if (!userId) {
    throw new Error("Missing user ID for subscription activation.");
  }

  const firestore = getFirestore();
  const userRef = firestore.collection("users").doc(userId);
  const snapshot = await userRef.get();
  const currentData = snapshot.exists ? snapshot.data() : {};

  if (currentData.lastCheckoutSessionId === session.id) {
    return {
      alreadyProcessed: true,
      subscribedAt: timestampToDate(currentData.subscribedAt),
      subscriptionEndsAt: timestampToDate(currentData.subscriptionEndsAt)
    };
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

  return {
    alreadyProcessed: false,
    subscribedAt: admin.firestore.Timestamp.fromDate(purchaseDate),
    subscriptionEndsAt: admin.firestore.Timestamp.fromDate(endDate)
  };
};

exports.createCheckoutSession = async (req, res) => {
  const { priceId, isSubscription, coupon, userId, email } = req.body;
  const baseUrl = process.env.BASE_URL;

  if (!priceId) {
    return res.status(400).json({ success: false, message: 'Price ID is required' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: 'Missing STRIPE_SECRET_KEY in backend environment.'
    });
  }

  if (!baseUrl) {
    return res.status(500).json({
      success: false,
      message: 'Missing BASE_URL in backend environment.'
    });
  }

  try {
    // If it's a one-time payment, use the dedicated endpoint
    if (!isSubscription) {
      return await createOneTimePayment(req, res);
    }

    // Determine session mode and validate price type
    const mode = 'subscription';

    // Configure the checkout session
    const sessionConfig = {
      mode,
      payment_method_types: ['card'],
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
    };

    // Add discount if a coupon is provided
    if (coupon) {
      sessionConfig.discounts = [{ coupon }];
    }

    // Create the session
    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Respond with the session URL for redirect
    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Failed to create checkout session'
    });
  }
};

exports.getCheckoutSession = async (req, res) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ success: false, message: "Session ID is required" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    res.json({
      success: true,
      session: {
        id: session.id,
        payment_status: session.payment_status,
        status: session.status,
        customer_email: session.customer_email,
        client_reference_id: session.client_reference_id,
        created: session.created,
        mode: session.mode
      }
    });
  } catch (error) {
    console.error("Error retrieving checkout session:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve checkout session" });
  }
};

exports.finalizeCheckoutSession = async (req, res) => {
  const { sessionId, userId } = req.body;

  if (!sessionId || !userId) {
    return res.status(400).json({
      success: false,
      message: "sessionId and userId are required"
    });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const isPaidSession = session.payment_status === "paid";
    const isCompletedSubscription =
      session.mode === "subscription" && session.status === "complete";

    if (!isPaidSession && !isCompletedSubscription) {
      return res.status(400).json({
        success: false,
        message: "Checkout session has not completed successfully."
      });
    }

    if (session.client_reference_id && session.client_reference_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Checkout session does not belong to this user."
      });
    }

    const activation = await activateUserSubscription(session, userId);

    res.json({
      success: true,
      alreadyProcessed: activation.alreadyProcessed,
      subscribedAt: activation.subscribedAt
        ? timestampToDate(activation.subscribedAt)?.toISOString() || null
        : null,
      subscriptionEndsAt: activation.subscriptionEndsAt
        ? timestampToDate(activation.subscriptionEndsAt)?.toISOString() || null
        : null
    });
  } catch (error) {
    console.error("Error finalizing checkout session:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to finalize checkout session"
    });
  }
};
