const { admin, getFirestore } = require("../config/firebaseAdmin");
const stripe = require("../config/stripeConfig");

const getBearerToken = (req) => {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
};

const requireAuth = async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "Missing authorization token" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.auth = decoded;
    req.authUid = decoded.uid;
    return next();
  } catch (error) {
    console.error("Firebase token verification failed:", error.message);
    return res.status(401).json({ message: "Invalid or expired authorization token" });
  }
};

const loadAuthContext = async (req, res, next) => {
  try {
    const userSnap = await getFirestore().collection("users").doc(req.authUid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    req.userProfile = userData;
    req.isAdmin = userData.isAdmin === true;
    return next();
  } catch (error) {
    console.error("Failed to load auth context:", error);
    return res.status(500).json({ message: "Failed to verify user permissions" });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  return next();
};

const requirePartnerAccount = async (req, res, next) => {
  try {
    const partnerSnap = await getFirestore()
      .collection("partners")
      .doc(req.authUid)
      .get();

    if (!partnerSnap.exists) {
      return res.status(403).json({ message: "Partner profile required" });
    }

    req.partnerDoc = partnerSnap.data();
    return next();
  } catch (error) {
    console.error("Partner account check failed:", error);
    return res.status(500).json({ message: "Failed to verify partner account" });
  }
};

const requireApprovedPartner = async (req, res, next) => {
  const partnerId = req.body?.partnerId;
  if (!partnerId) {
    return res.status(400).json({ message: "Missing partnerId" });
  }

  try {
    if (req.isAdmin) {
      const partnerSnap = await getFirestore().collection("partners").doc(partnerId).get();
      if (!partnerSnap.exists) {
        return res.status(404).json({ message: "Partner not found" });
      }
      req.partnerId = partnerId;
      return next();
    }

    if (req.authUid !== partnerId) {
      return res.status(403).json({ message: "Cannot act on behalf of another partner" });
    }

    const partnerSnap = await getFirestore().collection("partners").doc(partnerId).get();
    if (!partnerSnap.exists) {
      return res.status(403).json({ message: "Partner profile required" });
    }

    if (!partnerSnap.data().approved) {
      return res.status(403).json({ message: "Partner account is not approved" });
    }

    req.partnerId = partnerId;
    return next();
  } catch (error) {
    console.error("Approved partner check failed:", error);
    return res.status(500).json({ message: "Failed to verify partner access" });
  }
};

const sessionOwnedByUser = (session, authUid, authEmail) => {
  if (session.client_reference_id) {
    return session.client_reference_id === authUid;
  }

  const sessionEmail = (session.customer_email || "").toLowerCase();
  const tokenEmail = (authEmail || "").toLowerCase();
  return Boolean(sessionEmail && tokenEmail && sessionEmail === tokenEmail);
};

const requireMatchingUserId = (req, res, next) => {
  const userId = req.body?.userId;

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "userId is required" });
  }

  if (userId !== req.authUid) {
    return res.status(403).json({
      success: false,
      message: "userId must match signed-in account",
    });
  }

  if (req.body?.email) {
    const tokenEmail = (req.auth.email || "").toLowerCase();
    if (tokenEmail !== String(req.body.email).toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "email must match signed-in account",
      });
    }
  }

  return next();
};

const requireOwnedCheckoutSession = async (req, res, next) => {
  const sessionId = req.params.sessionId || req.body?.sessionId;

  if (!sessionId) {
    return res
      .status(400)
      .json({ success: false, message: "sessionId is required" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!sessionOwnedByUser(session, req.authUid, req.auth.email)) {
      return res.status(403).json({
        success: false,
        message: "Checkout session does not belong to this account",
      });
    }

    req.stripeSession = session;
    return next();
  } catch (error) {
    console.error("Checkout session verification failed:", error.message);
    return res.status(400).json({
      success: false,
      message: "Invalid or unknown checkout session",
    });
  }
};

module.exports = {
  requireAuth,
  loadAuthContext,
  requireAdmin,
  requirePartnerAccount,
  requireApprovedPartner,
  requireMatchingUserId,
  requireOwnedCheckoutSession,
  sessionOwnedByUser,
};
