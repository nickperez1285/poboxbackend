const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { requireAuth, loadAuthContext, requireAdmin } = require('../middleware/firebaseAuth');

router.get('/get-all-customers', requireAuth, loadAuthContext, requireAdmin, customerController.getAllCustomers);
router.get('/customers', requireAuth, loadAuthContext, requireAdmin, customerController.getCustomersWithPlans);

module.exports = router;
