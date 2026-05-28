const express = require("express");
const router = express.Router();
const checkoutController = require("../controllers/checkoutController");

// Basic validation to ensure controller functions are defined
if (!checkoutController) {
  throw new Error(
    "checkoutController module is undefined. Check if ../controllers/checkoutController.js exists and exports correctly.",
  );
}

const ensureFunction = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    console.error(`Controller method ${name} is missing!`);
    res.status(501).json({ message: "Feature not yet implemented." });
  };
};

const createSession = ensureFunction(
  checkoutController.createCheckoutSession,
  "createCheckoutSession",
);
const finalizeSession = ensureFunction(
  checkoutController.finalizeCheckoutSession,
  "finalizeCheckoutSession",
);
const getSession = ensureFunction(
  checkoutController.getCheckoutSession,
  "getCheckoutSession",
);
const updateCancellation = ensureFunction(
  checkoutController.updateSubscriptionCancellation,
  "updateSubscriptionCancellation",
);

const {
  requireAuth,
  requireMatchingUserId,
  requireOwnedCheckoutSession,
} = require("../middleware/firebaseAuth");

router.post(
  "/create-checkout-session",
  requireAuth,
  requireMatchingUserId,
  createSession,
);
router.post(
  "/finalize-checkout-session",
  requireAuth,
  requireMatchingUserId,
  requireOwnedCheckoutSession,
  finalizeSession,
);
router.get(
  "/checkout-session/:sessionId",
  requireAuth,
  requireOwnedCheckoutSession,
  getSession,
);
router.post(
  "/subscription-cancellation",
  requireAuth,
  updateCancellation,
);

module.exports = router;
