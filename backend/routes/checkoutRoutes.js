const express = require("express");
const router = express.Router();
const checkoutController = require("../controllers/checkoutController");
const {
  requireAuth,
  requireMatchingUserId,
  requireOwnedCheckoutSession,
} = require("../middleware/firebaseAuth");

router.post(
  "/create-checkout-session",
  requireAuth,
  requireMatchingUserId,
  checkoutController.createCheckoutSession,
);
router.post(
  "/finalize-checkout-session",
  requireAuth,
  requireMatchingUserId,
  requireOwnedCheckoutSession,
  checkoutController.finalizeCheckoutSession,
);
router.get(
  "/checkout-session/:sessionId",
  requireAuth,
  requireOwnedCheckoutSession,
  checkoutController.getCheckoutSession,
);

module.exports = router;
