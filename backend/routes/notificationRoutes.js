const express = require("express");
const { admin, getFirestore } = require("../config/firebaseAdmin");

const router = express.Router();
const db = getFirestore();

const adminInbox = "contact@porchpobox.com";
const resendApiUrl = "https://api.resend.com/emails";

const sendEmail = async ({ to, replyTo, subject, text, template, templateData }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM_EMAIL;

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  if (!from) {
    throw new Error("Missing MAIL_FROM_EMAIL or SMTP_FROM_EMAIL");
  }

  const payload = {
    from,
    to,
    reply_to: replyTo
  };

  if (template) {
    payload.template_id = template;
  } else {
    payload.subject = subject;
    payload.text = text;
  }

  if (templateData && typeof templateData === "object") {
    payload.template_data = templateData;
  }

  const response = await fetch(resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    console.error("Resend API error:", { status: response.status, errorBody, payload });
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

router.post("/referral", async (req, res) => {
  const { email, additionalInfo } = req.body || {};

  if (!email) {
    return res.status(400).json({ message: "Referral email is required" });
  }

  try {
    await sendEmail({
      to: adminInbox,
      replyTo: email,
      subject: "New Porch P.O. Box referral submission",
      text: [
        "A new referral form was submitted.",
        "",
        `Referral Email: ${email}`,
        `Additional Information: ${additionalInfo || "None provided"}`
      ].join("\n")
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Referral email delivery failed" });
  }
});

router.post("/partner-approved", async (req, res) => {
  const {
    businessName,
    email,
    streetAddress,
    city,
    state,
    zipCode
  } = req.body || {};

  if (!businessName || !email) {
    return res.status(400).json({ message: "Missing partner approval email fields" });
  }

  try {
    await sendEmail({
      to: email,
      replyTo: adminInbox,
      subject: "Your PorchPOBox Partner Request has been APPROVED!",
      text: [
        `Hello ${businessName},`,
        "",
        "Your request to become a PorchPOBox Partner has been APPROVED! Welcome to the community!",
        "",
        "You can now sign in to the partner portal to manage package check-ins and deliveries.",
        "",
        "Porch P.O. Box"
      ].join("\n")
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Partner approval email failed" });
  }
});

router.post("/package-check-in", async (req, res) => {
  const { vendorName, partnerId, recipients } = req.body || {};

  if (!vendorName || !partnerId || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ message: "Missing package check in recipients or partner ID" });
  }

  const invalidRecipient = recipients.find((recipient) => !recipient?.email || !recipient?.id || !recipient?.packageCount);
  if (invalidRecipient) {
    return res.status(400).json({ message: "All package recipients must include id, email, and packageCount" });
  }

  try {
    for (const recipient of recipients) {
      try {
        await sendEmail({
          to: recipient.email,
          replyTo: adminInbox,
          subject: `Package received at ${vendorName}`,
          text: [
            `Hello ${recipient.name || "Customer"},`,
            "",
            `You have received a package at ${vendorName}.`,
            "",
            "Porch P.O. Box"
          ].join("\n")
        });
      } catch (error) {
        throw new Error(
          `Package email to ${recipient.email} failed: ${error.message || "Unknown delivery error"}`
        );
      }
    }

    const partnerRef = db.doc(`partners/${partnerId}`);
    const partnerPackageUpdates = recipients.map(async (recipient) => {
      const userRef = db.doc(`users/${recipient.id}`);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const currentCheckedIn = Number(userData.packagesCheckedIn) || 0;
      const updates = {
        packagesCheckedIn: admin.firestore.FieldValue.increment(recipient.packageCount)
      };

      if (userData.status !== "active") {
        if (currentCheckedIn === 0) {
          // First ever package — grant trial
          updates.status = "trial";
        } else {
          // Trial already used — mark inactive so all partners see red
          updates.status = "inactive";
        }
      }

      const partnerPackageRef = db.doc(`partners/${partnerId}/packageCounts/${recipient.id}`);
      const userPackageHistoryRef = db.doc(`users/${recipient.id}/packageHistory/${partnerId}`);
      const packageCountSnap = await partnerPackageRef.get();
      const packageCountData = packageCountSnap.exists ? packageCountSnap.data() : {};
      const currentCount = Number(packageCountData.count) || 0;
      const currentTotalReceived = Number(packageCountData.totalReceived) || currentCount;
      const currentTotalPickedUp = Number(packageCountData.totalPickedUp) || 0;

      await Promise.all([
        userRef.set(updates, { merge: true }),
        partnerPackageRef.set(
          {
            count: currentCount + recipient.packageCount,
            totalReceived: currentTotalReceived + recipient.packageCount,
            totalPickedUp: currentTotalPickedUp,
            name: recipient.name || "Unnamed user",
            email: recipient.email || ""
          },
          { merge: true }
        ),
        userPackageHistoryRef.set(
          {
            partnerId,
            partnerName: vendorName || "Unknown Partner",
            totalReceived: currentTotalReceived + recipient.packageCount,
            totalPickedUp: currentTotalPickedUp,
            currentWaiting: currentCount + recipient.packageCount
          },
          { merge: true }
        )
      ]);
    });

    await Promise.all(partnerPackageUpdates);
    await partnerRef.set(
      { packageCheckInCount: admin.firestore.FieldValue.increment(recipients.reduce((sum, r) => sum + r.packageCount, 0)) },
      { merge: true }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Package check in email delivery failed" });
  }
});

router.post("/package-delivery", async (req, res) => {
  const { partnerId, partnerName, recipients } = req.body || {};

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ message: "Missing package delivery recipients" });
  }

  const invalidRecipient = recipients.find((recipient) => !recipient?.id || !recipient?.packageCount);
  if (invalidRecipient) {
    return res.status(400).json({ message: "All delivery recipients must include id and packageCount" });
  }

  try {
    for (const recipient of recipients) {
      const userRef = db.doc(`users/${recipient.id}`);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const currentDelivered = Number(userData.packagesDelivered) || 0;
      const updates = {
        packagesDelivered: admin.firestore.FieldValue.increment(recipient.packageCount)
      };

      if (userData.status !== "active" && currentDelivered === 0) {
        updates.status = "inactive";
      }

      const writes = [userRef.set(updates, { merge: true })];

      if (partnerId) {
        const partnerPackageRef = db.doc(`partners/${partnerId}/packageCounts/${recipient.id}`);
        const userPackageHistoryRef = db.doc(`users/${recipient.id}/packageHistory/${partnerId}`);
        const partnerPackageSnap = await partnerPackageRef.get();
        const partnerPackageData = partnerPackageSnap.exists ? partnerPackageSnap.data() : {};
        const currentCount = Number(partnerPackageData.count) || 0;
        const currentTotalReceived = Number(partnerPackageData.totalReceived) || currentCount;
        const currentTotalPickedUp = Number(partnerPackageData.totalPickedUp) || 0;
        const nextWaiting = Math.max(currentCount - recipient.packageCount, 0);

        writes.push(
          userPackageHistoryRef.set(
            {
              partnerId,
              partnerName: partnerName || partnerPackageData.name || "Unknown Partner",
              totalReceived: currentTotalReceived,
              totalPickedUp: currentTotalPickedUp + recipient.packageCount,
              currentWaiting: nextWaiting
            },
            { merge: true }
          )
        );
      }

      await Promise.all(writes);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Package delivery update failed" });
  }
});

module.exports = router;
