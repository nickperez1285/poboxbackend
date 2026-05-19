const express = require("express");
const router = express.Router();
const checkoutController = require("../controllers/checkoutController");

// Basic validation to ensure controller functions are defined
if (!checkoutController) {
  throw new Error(
    "checkoutController module is undefined. Check if ../controllers/checkoutController.js exists and exports correctly.",
  );
}
if (typeof checkoutController.createCheckoutSession !== "function") {
  throw new Error(
    "checkoutController.createCheckoutSession is not a function. Check ../controllers/checkoutController.js",
  );
}
if (typeof checkoutController.finalizeCheckoutSession !== "function") {
  throw new Error(
    "checkoutController.finalizeCheckoutSession is not a function. Check ../controllers/checkoutController.js",
  );
}
if (typeof checkoutController.getCheckoutSession !== "function") {
  throw new Error(
    "checkoutController.getCheckoutSession is not a function. Check ../controllers/checkoutController.js",
  );
}
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
