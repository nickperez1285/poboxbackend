const stripe = require('../config/stripeConfig');

exports.createSubscription = async (req, res) => {
    const { plan, coupon } = req.query;

    if (!plan) {
        return res.status(400).send('Subscription plan not provided.');
    }

    try {
        // Fetch active prices from Stripe with expanded product details
        const prices = await stripe.prices.list({ 
            active: true,
            expand: ['data.product']
        });

        // Find the price for the requested plan
        const priceObject = prices.data.find(price => price.product.name.toLowerCase() === plan.toLowerCase());

        if (!priceObject) {
            return res.status(404).send(`Subscription plan "${plan}" not found.`);
        }

        const sessionConfig = {
            mode: 'subscription',
            line_items: [
                {
                    price: priceObject.id,
                    quantity: 1,
                },
            ],
            success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
            cancel_url: `${process.env.BASE_URL}/cancel`,
            allow_promotion_codes: true, // Allow customers to enter promotion codes
            customer_creation: 'always', // Always create a new customer
        };

        // Add coupon if provided
        if (coupon) {
            sessionConfig.discounts = [{ coupon }];
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        // Redirect to the Stripe payment page
        res.redirect(session.url);
    } catch (error) {
        console.error('Error creating subscription session:', error);
        res.status(500).send('An error occurred while processing your request');
    }
};
