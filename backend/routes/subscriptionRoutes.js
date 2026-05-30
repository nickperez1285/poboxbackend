const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');

// Subscribe to a plan
router.post('/subscribe', subscriptionController.createSubscription);
// router.get('/create-one-time-checkout-session', subscriptionController.createOneTimeCheckoutSession);


module.exports = router;
