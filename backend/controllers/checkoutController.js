const stripe = require('../config/stripeConfig');
const { createOneTimePayment } = require('../controllers/createOneTimePayment');

exports.createCheckoutSession = async (req, res) => {
  const { priceId, isSubscription, coupon, userId, email } = req.body;
  const baseUrl = process.env.BASE_URL;

  if (!priceId) {
    return res.status(400).json({ success: false, message: 'Price ID is required' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: 'Missing STRIPE_SECRET_KEY in backend environment.'
    });
  }

  if (!baseUrl) {
    return res.status(500).json({
      success: false,
      message: 'Missing BASE_URL in backend environment.'
    });
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
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
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
    res.status(500).json({
      success: false,
      message: error?.message || 'Failed to create checkout session'
    });
  }
};

exports.getCheckoutSession = async (req, res) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ success: false, message: "Session ID is required" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    res.json({
      success: true,
      session: {
        id: session.id,
        payment_status: session.payment_status,
        status: session.status,
        customer_email: session.customer_email,
        client_reference_id: session.client_reference_id,
        created: session.created,
        mode: session.mode
      }
    });
  } catch (error) {
    console.error("Error retrieving checkout session:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve checkout session" });
  }
};
