const stripe = require('../config/stripeConfig');

// Fetches a single price based on the product ID
exports.getPrice = async (req, res) => {
    try {
        const { productId } = req.params;
        const price = await stripe.prices.retrieve(productId);
        res.json({
            success: true,
            price: {
                id: price.id,
                unit_amount: price.unit_amount,
                currency: price.currency,
                product: price.product,
                recurring: price.recurring
            }
        });
    } catch (error) {
        console.error('Error retrieving price:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve price' });
    }
};

// Fetches all active prices
exports.getAllPrices = async (req, res) => {
    try {
        const prices = await stripe.prices.list({
            active: true,
            expand: ['data.product']
        });

        const formattedPrices = prices.data.reduce((acc, price) => {
            const planName = price.product.name.toLowerCase();
            acc[planName] = price.id;
            return acc;
        }, {});

        // Return a successful response with formatted prices
        res.json({ success: true, prices: formattedPrices });
    } catch (error) {
        console.error('Error fetching price IDs:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch price IDs'
        });
    }
};
