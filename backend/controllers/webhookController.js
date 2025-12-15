const stripe = require('../config/stripeConfig');

exports.handleWebhook = (req, res) => {
    const sig = req.headers['stripe-signature'];

    try {
        const event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET_KEY
        );

        switch (event.type) {
            case 'checkout.session.completed':
                console.log('New Subscription started!');
                break;
            case 'invoice.paid':
                console.log('Invoice paid');
                break;
            case 'invoice.payment_failed':
                console.log('Invoice payment failed!');
                break;
            case 'customer.subscription.updated':
                console.log('Subscription updated!');
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }

        res.status(200).send();
    } catch (err) {
        res.status(400).send(`Webhook Error: ${err.message}`);
    }
};
