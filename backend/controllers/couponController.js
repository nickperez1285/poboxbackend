const { getStripe } = require('../config/stripeConfig');

const validateCoupon = async (req, res) => {
    try {
        const { coupon } = req.body;
        const normalizedCoupon = String(coupon || "").trim();

        // Basic validation
        if (!normalizedCoupon) {
            return res.status(400).json({
                success: false,
                message: 'Coupon code is required'
            });
        }

        let couponObject = null;
        let promotionCode = null;

        try {
            couponObject = await getStripe().coupons.retrieve(normalizedCoupon);
        } catch (error) {
            if (error.type !== 'StripeInvalidRequestError') throw error;
        }

        if (!couponObject) {
            const promotionCodes = await getStripe().promotionCodes.list({
                code: normalizedCoupon,
                active: true,
                limit: 1
            });
            promotionCode = promotionCodes.data?.[0] || null;
            couponObject = promotionCode?.coupon || null;
        }

        // Check if the coupon is valid and active
        if (!couponObject?.valid) {
            return res.status(400).json({
                success: false,
                message: 'Promo code is no longer valid'
            });
        }

        res.json({
            success: true,
            coupon: {
                id: couponObject.id,
                promotionCodeId: promotionCode?.id || null,
                code: promotionCode?.code || normalizedCoupon,
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
