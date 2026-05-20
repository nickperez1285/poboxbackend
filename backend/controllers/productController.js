const { getStripe } = require("../config/stripeConfig");

exports.getProductDetails = async (req, res) => {
  try {
    const oneTimeProductPriceId = process.env.ONE_TIME_PRODUCT_PRICE_ID;

    if (!oneTimeProductPriceId) {
      console.error(
        "Missing ONE_TIME_PRODUCT_PRICE_ID in environment variables.",
      );
      return res
        .status(500)
        .json({
          success: false,
          message:
            "Server configuration error: One-time product price ID is not set.",
        });
    }

    // Fetch product details from Stripe
    const product = await getStripe().prices.retrieve(oneTimeProductPriceId);
    res.json({ success: true, product });
  } catch (error) {
    console.error("Error fetching product details:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch product details" });
  }
};
