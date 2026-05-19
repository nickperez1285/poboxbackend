const { admin, getFirestore } = require("../config/firebaseAdmin");

const db = getFirestore();

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
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.auth = decodedToken;
    next();
  } catch (error) {
    console.error("[Auth] Token verification failed:", error.message);
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
  const partnerSnap = await db.collection("partners").doc(req.auth.uid).get();
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
  const partnerSnap = await db.collection("partners").doc(uid).get();
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

module.exports = {
  requireAuth,
  loadAuthContext,
  requireAdmin,
  requirePartnerAccount,
  requireApprovedPartner,
  sessionOwnedByUser,
};
