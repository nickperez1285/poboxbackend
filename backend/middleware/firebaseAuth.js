const { getAuth, getFirestore } = require("../config/firebaseAdmin");

const getDb = () => getFirestore();

const getTokenProjectId = (idToken) => {
  const [, payload] = String(idToken || "").split(".");
  if (!payload) return null;

  try {
    const normalizedPayload = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(
      Buffer.from(normalizedPayload, "base64").toString("utf8"),
    );
    return claims.aud || null;
  } catch (error) {
    return null;
  }
};

/**
 * Verifies Firebase ID Token from Authorization header.
 * Expects: Authorization: Bearer <Firebase ID token>
 */
const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing authorization token" });
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    req.auth = decodedToken;
    req.authUid = decodedToken.uid;
    next();
  } catch (error) {
    console.error("[Auth] Token verification failed:", {
      message: error.message,
      tokenProjectId: getTokenProjectId(idToken),
      configuredProjectId: process.env.FIREBASE_PROJECT_ID || null,
    });
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/**
 * Sets internal auth flags like isAdmin based on decoded claims.
 */
const loadAuthContext = (req, res, next) => {
  req.isAdmin = !!req.auth?.isAdmin;
  next();
};

/**
 * Blocks request if user is not an admin.
 */
const requireAdmin = (req, res, next) => {
  if (!req.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};

/**
 * Blocks request if user is not registered as a partner.
 */
const requirePartnerAccount = async (req, res, next) => {
  const partnerSnap = await getDb().collection("partners").doc(req.auth.uid).get();
  if (!partnerSnap.exists) {
    return res.status(403).json({ message: "Partner profile not found" });
  }
  req.partnerProfile = partnerSnap.data();
  next();
};

/**
 * Ensures partner is approved and only accessing their own data.
 */
const requireApprovedPartner = async (req, res, next) => {
  const uid = req.auth.uid;
  const partnerSnap = await getDb().collection("partners").doc(uid).get();
  const partnerData = partnerSnap.data();

  if (!partnerSnap.exists || !partnerData.approved) {
    return res.status(403).json({ message: "Partner approval required" });
  }

  // Ownership check: If a partnerId is targeted, it must match the authenticated UID
  const targetPartnerId =
    req.body?.partnerId || req.params?.partnerId || req.query?.partnerId;
  if (targetPartnerId && targetPartnerId !== uid && !req.isAdmin) {
    return res
      .status(403)
      .json({ message: "Unauthorized access to partner resource" });
  }

  req.partnerProfile = partnerData;
  next();
};

/** Helper for ownership verification (e.g. Stripe sessions) */
const sessionOwnedByUser = (session, uid, email) => {
  if (!session) return false;
  if (session.client_reference_id === uid) return true;
  const sessionEmail =
    session.customer_email || session.customer_details?.email;
  return sessionEmail?.toLowerCase() === email?.toLowerCase();
};

/**
 * Ensures the userId in the request body matches the authenticated user.
 * Prevents users from creating/modifying checkout sessions for other users.
 */
const requireMatchingUserId = (req, res, next) => {
  const bodyUserId =
    req.body?.userId ||
    req.body?.user_id ||
    req.query?.userId ||
    req.params?.userId;
  const tokenUid = req.auth?.uid;

  if (bodyUserId && tokenUid) {
    if (String(bodyUserId).trim() !== String(tokenUid).trim()) {
      console.warn(
        `[Auth] User ID mismatch: Token(${tokenUid}) vs Request(${bodyUserId})`,
      );
      return res
        .status(403)
        .json({ message: "userId must match signed-in account" });
    }
  }
  next();
};

/**
 * Ensures the authenticated user owns the Stripe checkout session being accessed.
 * Reads sessionId from params or body, then verifies ownership via Stripe.
 */
const requireOwnedCheckoutSession = async (req, res, next) => {
  const { getStripe } = require("../config/stripeConfig");
  const sessionId = req.params?.sessionId || req.body?.sessionId;
  if (!sessionId) {
    return res.status(400).json({ message: "Missing sessionId" });
  }
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (!sessionOwnedByUser(session, req.auth.uid, req.auth.email)) {
      return res.status(403).json({ message: "Unauthorized checkout session" });
    }
    req.checkoutSession = session;
    next();
  } catch (err) {
    console.error("[requireOwnedCheckoutSession] Error:", err.message);
    return res
      .status(400)
      .json({ message: "Invalid or expired checkout session" });
  }
};

module.exports = {
  requireAuth,
  loadAuthContext,
  requireAdmin,
  requirePartnerAccount,
  requireApprovedPartner,
  sessionOwnedByUser,
  requireMatchingUserId,
  requireOwnedCheckoutSession,
};
