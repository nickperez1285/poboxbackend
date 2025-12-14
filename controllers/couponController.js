const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const validateCoupon = async (req, res) => {
    try {
        const { coupon } = req.body;

        // Basic validation
        if (!coupon) {
            return res.status(400).json({
                success: false,
                message: 'Coupon code is required'
            });
        }

        // Retrieve the coupon from Stripe
        const couponObject = await stripe.coupons.retrieve(coupon);

        // Check if the coupon is valid and active
        if (!couponObject.valid) {
            return res.status(400).json({
                success: false,
                message: 'Coupon is no longer valid'
            });
        }

        res.json({
            success: true,
            coupon: {
                id: couponObject.id,
                percent_off: couponObject.percent_off,
                amount_off: couponObject.amount_off,
                currency: couponObject.currency,
                valid: couponObject.valid,
                duration: couponObject.duration
            }
        });
    } catch (error) {
        // Handle Stripe errors specifically
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid coupon code'
            });
        }

        // Handle unexpected errors
        console.error('Coupon validation error:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while validating the coupon'
        });
    }
};

module.exports = {
    validateCoupon
};