const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');

router.post('/create-checkout-session', checkoutController.createCheckoutSession);
router.get('/checkout-session/:sessionId', checkoutController.getCheckoutSession);

module.exports = router;
