const express = require("express");

const router = express.Router();

const adminInbox = "contact@porchpobox.com";
const resendApiUrl = "https://api.resend.com/emails";

const sendEmail = async ({ to, replyTo, subject, text }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM_EMAIL;

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  if (!from) {
    throw new Error("Missing MAIL_FROM_EMAIL or SMTP_FROM_EMAIL");
  }

  const response = await fetch(resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: replyTo,
      subject,
      text
    })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(
      errorBody?.message ||
        errorBody?.error?.message ||
        `Resend API request failed with status ${response.status}`
    );
  }
};

router.post("/vendor-registration", async (req, res) => {
  const {
    businessName,
    email,
    phoneNumber,
    streetAddress,
    city,
    state,
    zipCode
  } = req.body || {};

  if (
    !businessName ||
    !email ||
    !phoneNumber ||
    !streetAddress ||
    !city ||
    !state ||
    !zipCode
  ) {
    return res.status(400).json({ message: "Missing vendor registration fields" });
  }

  try {
    await sendEmail({
      to: adminInbox,
      replyTo: email,
      subject: `New Vendor Registration: ${businessName}`,
      text: [
        "A new vendor has registered.",
        "",
        `Business Name: ${businessName}`,
        `Email: ${email}`,
        `Phone Number: ${phoneNumber}`,
        `Street Address: ${streetAddress}`,
        `City: ${city}`,
        `State: ${state}`,
        `Zip Code: ${zipCode}`
      ].join("\n")
    });

    await sendEmail({
      to: email,
      replyTo: adminInbox,
      subject: "Porch P.O. Box vendor request received",
      text: [
        `Hello ${businessName},`,
        "",
        "Your registration information has been received and your request to become a vendor is being reviewed.",
        "",
        "We will contact you once the review is complete.",
        "",
        "Porch P.O. Box"
      ].join("\n")
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Email delivery failed" });
  }
});

module.exports = router;
