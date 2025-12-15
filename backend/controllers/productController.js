const stripe = require('../config/stripeConfig');

exports.getProductDetails = async (req, res) => {
    try {
        // Fetch product details from Stripe
        const product = await stripe.prices.retrieve('price_1SbpjxILNRQzIFDVtfcg2EHK'); // Replace with your actual price ID
        res.json({ success: true, product });
    } catch (error) {
        console.error('Error fetching product details:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch product details' });
    }
};

