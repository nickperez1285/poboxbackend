const stripe = require('../config/stripeConfig');

exports.createOneTimePayment = async (req, res) => {
  const { priceId, userId, email } = req.body;

  if (!priceId) {
    return res.status(400).json({ success: false, message: 'Price ID is required' });
  }

  try {
    // Create a Stripe Checkout Session for one-time payment
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/checkout/cancel`,
    });

    // Return the session URL for the client to redirect to
    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Error creating one-time payment session:', error);
    res.status(500).json({ success: false, message: 'Failed to create one-time payment session' });
  }
};
