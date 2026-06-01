const { getStripe } = require('../config/stripeConfig');
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

const cleanupZeroPackageCountsForActiveUser = async (userId) => {
  const firestore = getFirestore();
  const partnersSnapshot = await firestore.collection("partners").get();

  await Promise.all(
    partnersSnapshot.docs.map(async (partnerDoc) => {
      const packageCountRef = firestore
        .collection("partners")
        .doc(partnerDoc.id)
        .collection("packageCounts")
        .doc(userId);
      const packageCountSnapshot = await packageCountRef.get();

      if (!packageCountSnapshot.exists) {
        return;
      }

      if ((Number(packageCountSnapshot.data()?.count) || 0) === 0) {
        await packageCountRef.delete();
      }
    })
  );
};

/** Partner document id from user.prefLocation (string id or Firestore reference shape). */
const getPreferredPartnerId = (prefLocation) => {
  if (!prefLocation || prefLocation === null) return null;
  const id = prefLocation.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (id && typeof id === "object") {
    if (typeof id.id === "string" && id.id) return id.id;
    if (typeof id.path === "string") {
      const parts = id.path.split("/");
      if (parts[0] === "partners" && parts[1]) return parts[1];
    }
  }
  return null;
};

const toDateFromUnixSeconds = (value) => {
  if (!value) return null;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getStripeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.id || "";
};

const getSubscriptionPeriodEnd = (subscription) => {
  if (!subscription) return null;

  const directPeriodEnd = toDateFromUnixSeconds(subscription.current_period_end);
  if (directPeriodEnd) return directPeriodEnd;

  const itemPeriodEnds = subscription.items?.data
    ?.map((item) => toDateFromUnixSeconds(item.current_period_end))
    .filter(Boolean);

  if (itemPeriodEnds?.length) {
    return new Date(Math.max(...itemPeriodEnds.map((date) => date.getTime())));
  }

  return null;
};

const getInvoicePeriodEnd = (invoice) => {
  const linePeriodEnds = invoice?.lines?.data
    ?.map((line) => toDateFromUnixSeconds(line.period?.end))
    .filter(Boolean);

  if (linePeriodEnds?.length) {
    return new Date(Math.max(...linePeriodEnds.map((date) => date.getTime())));
  }

  return toDateFromUnixSeconds(invoice?.period_end);
};

const getCheckoutSubscriptionDetails = async (session) => {
  const subscriptionId = getStripeId(session.subscription);
  if (!subscriptionId) return {};

  const subscription =
    typeof session.subscription === "object"
      ? session.subscription
      : await getStripe().subscriptions.retrieve(subscriptionId);

  return {
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId:
      getStripeId(subscription.customer) || getStripeId(session.customer),
    stripeSubscriptionStatus: subscription.status || "",
    subscriptionEndsAt: getSubscriptionPeriodEnd(subscription),
  };
};

const resolveStripeDiscount = async (code) => {
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) return null;

  try {
    const coupon = await getStripe().coupons.retrieve(normalizedCode);
    if (coupon?.valid) return { coupon: coupon.id };
  } catch (error) {
    if (error.type !== "StripeInvalidRequestError") throw error;
  }

  const promotionCodes = await getStripe().promotionCodes.list({
    code: normalizedCode,
    active: true,
    limit: 1,
  });
  const promotionCode = promotionCodes.data?.[0];

  if (promotionCode?.id) return { promotion_code: promotionCode.id };
  return null;
};

const activateUserSubscription = async (
  session,
  overrideUserId,
  subscriptionDetails = null,
) => {
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
  const resolvedSubscriptionDetails =
    subscriptionDetails || (await getCheckoutSubscriptionDetails(session));
  const stripePeriodEnd = resolvedSubscriptionDetails.subscriptionEndsAt;
  const extendingBeforeExpiry =
    existingEndDate && existingEndDate.getTime() > Date.now();
  const extensionBaseDate =
    extendingBeforeExpiry ? existingEndDate : purchaseDate;
  const endDate =
    stripePeriodEnd || new Date(extensionBaseDate.getTime() + THIRTY_DAYS_IN_MS);

  const stripeFields = {};
  if (resolvedSubscriptionDetails.stripeCustomerId) {
    stripeFields.stripeCustomerId = resolvedSubscriptionDetails.stripeCustomerId;
  } else if (getStripeId(session.customer)) {
    stripeFields.stripeCustomerId = getStripeId(session.customer);
  }
  if (resolvedSubscriptionDetails.stripeSubscriptionId) {
    stripeFields.stripeSubscriptionId =
      resolvedSubscriptionDetails.stripeSubscriptionId;
  } else if (getStripeId(session.subscription)) {
    stripeFields.stripeSubscriptionId = getStripeId(session.subscription);
  }
  if (resolvedSubscriptionDetails.stripeSubscriptionStatus) {
    stripeFields.stripeSubscriptionStatus =
      resolvedSubscriptionDetails.stripeSubscriptionStatus;
  }

  await userRef.set(
    {
      email: session.customer_email || currentData.email || "",
      status: "active",
      subscribedAt: admin.firestore.Timestamp.fromDate(purchaseDate),
      subscriptionEndsAt: admin.firestore.Timestamp.fromDate(endDate),
      lastCheckoutSessionId: session.id,
      ...stripeFields,
    },
    { merge: true }
  );

  await cleanupZeroPackageCountsForActiveUser(userId);

  const preferredPartnerId = getPreferredPartnerId(currentData.prefLocation);
  if (preferredPartnerId && !extendingBeforeExpiry) {
    try {
      await firestore
        .collection("partners")
        .doc(preferredPartnerId)
        .collection("activityLog")
        .add({
          type: "subscription",
          customerId: userId,
          customerName: currentData.name || "",
          customerEmail: session.customer_email || currentData.email || "",
          packageCount: 0,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (partnerLogErr) {
      console.error("Failed to write partner subscription activity:", partnerLogErr);
    }

    try {
      await firestore
        .collection("partners")
        .doc(preferredPartnerId)
        .collection("packageCounts")
        .doc(userId)
        .set(
          {
            status: "active",
            name: currentData.name || "",
            email: session.customer_email || currentData.email || "",
          },
          { merge: true },
        );
    } catch (pkgCountErr) {
      console.error("Failed to update packageCounts status:", pkgCountErr);
    }
  }

  // Log subscription payment to activity log
  try {
    await firestore.collection("activityLog").add({
      type: "subscription",
      userId,
      userEmail: session.customer_email || currentData.email || "",
      userName: currentData.name || "",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (logErr) {
    console.error("Failed to write subscription log:", logErr);
  }

  // Send subscription confirmation email
  try {
    const toEmail = session.customer_email || currentData.email;
    const toName = currentData.name || "there";
    const endsDate = endDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const plansUrl = `${process.env.FRONTEND_URL || "https://porchpobox.com"}/profile`;

    if (toEmail) {
      const { sendEmail, adminInbox } = require("../lib/email");

      if (process.env.RESEND_API_KEY && (process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM_EMAIL)) {
        await sendEmail({
          to: toEmail,
          replyTo: adminInbox,
          subject: "You're subscribed! Welcome to Porch P.O. Box 📦",
          text: [
              `Hello ${toName},`,
              "",
              "Congratulations — your Porch P.O. Box subscription is now active!",
              "",
              "You can now have packages delivered to your preferred partner location and pick them up at your convenience.",
              "",
              `Your subscription is active through ${endsDate}.`,
              "",
              "Here's what to do next:",
              "  1. Make sure you have a preferred location set in your profile.",
              "  2. Use your partner location's address when placing orders online.",
              "  3. You'll get an email notification as soon as a package is checked in for you.",
              "",
              `View your profile: ${plansUrl}`,
              "",
              "Thank you for subscribing. We're glad to have you!",
              "",
              "\u2014 The Porch P.O. Box Team"
            ].join("\n")
          })
        }
        console.log(`Subscription confirmation email sent to ${toEmail}`);
      }
  } catch (emailErr) {
    console.error("Failed to send subscription confirmation email:", emailErr);
  }

  return {
    alreadyProcessed: false,
    subscribedAt: admin.firestore.Timestamp.fromDate(purchaseDate),
    subscriptionEndsAt: admin.firestore.Timestamp.fromDate(endDate)
  };
};

const findUserByStripeSubscription = async (firestore, subscriptionId) => {
  if (!subscriptionId) return null;

  const snapshot = await firestore
    .collection("users")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0];
};

const findUserByStripeCustomer = async (firestore, customerId) => {
  if (!customerId) return null;

  const snapshot = await firestore
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0];
};

const updateSubscriptionFromInvoice = async (invoice) => {
  const subscriptionId = getStripeId(invoice.subscription);
  const customerId = getStripeId(invoice.customer);
  const invoiceId = invoice.id;

  if (!subscriptionId && !customerId) {
    console.warn("Skipping invoice without Stripe subscription/customer IDs:", {
      invoiceId,
    });
    return { skipped: true, reason: "missing_stripe_ids" };
  }

  const firestore = getFirestore();
  let userDoc = await findUserByStripeSubscription(firestore, subscriptionId);

  if (!userDoc && customerId) {
    userDoc = await findUserByStripeCustomer(firestore, customerId);
  }

  if (!userDoc) {
    console.warn("Skipping invoice for unknown Stripe subscription/customer:", {
      invoiceId,
      subscriptionId: subscriptionId || null,
      customerId: customerId || null,
    });
    return { skipped: true, reason: "user_not_found" };
  }

  const currentData = userDoc.data() || {};
  if (invoiceId && currentData.lastStripeInvoiceId === invoiceId) {
    return {
      alreadyProcessed: true,
      userId: userDoc.id,
      subscriptionEndsAt: timestampToDate(currentData.subscriptionEndsAt),
    };
  }

  let subscription = null;
  if (subscriptionId) {
    subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  }

  const endDate =
    getSubscriptionPeriodEnd(subscription) || getInvoicePeriodEnd(invoice);

  if (!endDate) {
    throw new Error(
      `Unable to determine subscription period end for invoice ${invoiceId}.`,
    );
  }

  await userDoc.ref.set(
    {
      status: "active",
      subscriptionEndsAt: admin.firestore.Timestamp.fromDate(endDate),
      stripeCustomerId: customerId || currentData.stripeCustomerId || "",
      stripeSubscriptionId:
        subscriptionId || currentData.stripeSubscriptionId || "",
      stripeSubscriptionStatus:
        subscription?.status || currentData.stripeSubscriptionStatus || "",
      lastStripeInvoiceId: invoiceId || currentData.lastStripeInvoiceId || "",
      renewedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  try {
    await firestore.collection("activityLog").add({
      type: "subscription_renewal",
      userId: userDoc.id,
      userEmail: currentData.email || invoice.customer_email || "",
      userName: currentData.name || "",
      stripeInvoiceId: invoiceId || "",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (logErr) {
    console.error("Failed to write subscription renewal log:", logErr);
  }

  return {
    alreadyProcessed: false,
    userId: userDoc.id,
    subscriptionEndsAt: admin.firestore.Timestamp.fromDate(endDate),
  };
};

exports.activateUserSubscription = activateUserSubscription;
exports.updateSubscriptionFromInvoice = updateSubscriptionFromInvoice;

exports.updateSubscriptionCancellation = async (req, res) => {
  const userId = req.auth?.uid;
  const { cancelAtPeriodEnd = true } = req.body || {};

  if (!userId) {
    return res.status(401).json({ success: false, message: "Missing user" });
  }

  try {
    const firestore = getFirestore();
    const userRef = firestore.collection("users").doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const subscriptionId = userData.stripeSubscriptionId;

    if (!subscriptionId) {
      return res.status(400).json({
        success: false,
        message: "No Stripe subscription is linked to this account.",
      });
    }

    const subscription = await getStripe().subscriptions.update(subscriptionId, {
      cancel_at_period_end: Boolean(cancelAtPeriodEnd),
    });
    const periodEnd = getSubscriptionPeriodEnd(subscription);

    const updatePayload = {
      subscriptionCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      stripeSubscriptionStatus: subscription.status || "",
      subscriptionCancellationUpdatedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    };

    const cancelAtDate = toDateFromUnixSeconds(subscription.cancel_at);
    if (cancelAtDate) {
      updatePayload.subscriptionCancelAt =
        admin.firestore.Timestamp.fromDate(cancelAtDate);
    } else {
      updatePayload.subscriptionCancelAt = null;
    }

    if (periodEnd) {
      updatePayload.subscriptionEndsAt =
        admin.firestore.Timestamp.fromDate(periodEnd);
    }

    await userRef.set(updatePayload, { merge: true });

    return res.json({
      success: true,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      subscriptionEndsAt: periodEnd ? periodEnd.toISOString() : null,
      status: subscription.status || "",
    });
  } catch (error) {
    console.error("Error updating subscription cancellation:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Unable to update subscription settings.",
    });
  }
};

exports.createCheckoutSession = async (req, res) => {
  const { priceId, isSubscription, coupon, userId, email } = req.body;
  const baseUrl = process.env.BASE_URL;

  if (!userId || userId !== req.authUid) {
    return res.status(403).json({
      success: false,
      message: "userId must match signed-in account",
    });
  }

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

  if (isSubscription) {
    const firestore = getFirestore();
    const userSnap = await firestore.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      return res.status(400).json({
        success: false,
        message: "User profile not found.",
      });
    }
    const userData = userSnap.data();
    if (!userData.prefLocation || !getPreferredPartnerId(userData.prefLocation)) {
      return res.status(400).json({
        success: false,
        message: "You must set a preferred delivery location before subscribing.",
        redirect: "/profile/settings?highlight=location",
      });
    }
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
      client_reference_id: userId,
      customer_email: email || req.auth.email || undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
    };

    // Add discount if a coupon or promotion code is provided
    if (coupon) {
      const discount = await resolveStripeDiscount(coupon);
      if (!discount) {
        return res.status(400).json({
          success: false,
          message: "Invalid promo code",
        });
      }
      sessionConfig.discounts = [discount];
    } else {
      sessionConfig.allow_promotion_codes = true;
    }

    // Create the session
    const session = await getStripe().checkout.sessions.create(sessionConfig);

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
    const session =
      req.stripeSession || (await getStripe().checkout.sessions.retrieve(sessionId));

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
    const session =
      req.stripeSession || (await getStripe().checkout.sessions.retrieve(sessionId));
    const isPaidSession = session.payment_status === "paid";
    const isCompletedSubscription =
      session.mode === "subscription" && session.status === "complete";

    if (!isPaidSession && !isCompletedSubscription) {
      return res.status(400).json({
        success: false,
        message: "Checkout session has not completed successfully."
      });
    }

    if (!session.client_reference_id || session.client_reference_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Checkout session does not belong to this user."
      });
    }

    if (userId !== req.authUid) {
      return res.status(403).json({
        success: false,
        message: "userId must match signed-in account",
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
