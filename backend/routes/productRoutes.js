const express = require('express');
const router = express.Router();
const { getOneTimePrice } = require('../controllers/productController');

router.get('/one-time-price', getOneTimePrice);
module.exports = router;