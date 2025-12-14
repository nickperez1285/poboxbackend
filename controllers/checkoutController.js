const stripe = require('../config/stripeConfig');
const { createOneTimePayment } = require('../controllers/createOneTimePayment');

exports.createCheckoutSession = async (req, res) => {
  const { priceId, isSubscription, coupon } = req.body;

  if (!priceId) {
    return res.status(400).json({ success: false, message: 'Price ID is required' });
  }

  try {
    // If it's a one-time payment, use the dedicated endpoint
    if (!isSubscription) {
      return await createOneTimePayment(req, res);
    }

    // Determine session mode and validate price type
    const mode = 'subscription';

    // Configure the checkout session
    const sessionConfig = {
      mode,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
    };

    // Add discount if a coupon is provided
    if (coupon) {
      sessionConfig.discounts = [{ coupon }];
    }

    // Create the session
    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Respond with the session URL for redirect
    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ success: false, message: 'Failed to create checkout session' });
  }
};