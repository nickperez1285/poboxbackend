const express = require('express');
const router = express.Router();
const pricesController = require("../controllers/priceController")
// Route for getting all prices
router.get('/get-all-prices', pricesController.getAllPrices);

// Route for getting a specific price by productId
router.get('/get-price/:productId', pricesController.getPrice);

module.exports = router;
