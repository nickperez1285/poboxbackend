const toE164 = (phone) => {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (String(phone).trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
};

const getSignalWireConfig = () => {
  const spaceUrl = (process.env.SIGNALWIRE_SPACE_URL || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const projectId = (process.env.SIGNALWIRE_PROJECT_ID || "").trim();
  const apiToken = (process.env.SIGNALWIRE_API_TOKEN || "").trim();
  const fromNumber = (process.env.SIGNALWIRE_PHONE_NUMBER || "").trim();

  return { spaceUrl, projectId, apiToken, fromNumber };
};

const isSignalWireConfigured = () => {
  const { spaceUrl, projectId, apiToken, fromNumber } = getSignalWireConfig();
  return Boolean(spaceUrl && projectId && apiToken && fromNumber);
};

/**
 * Sends an SMS via SignalWire's LaML-compatible Messages API.
 * @see https://developer.signalwire.com/compatibility-api/rest/messages/create-message
 */
const sendSMS = async (to, body) => {
  const { spaceUrl, projectId, apiToken, fromNumber } = getSignalWireConfig();

  if (!isSignalWireConfigured()) {
    console.warn("[SignalWire] Credentials missing. SMS skipped.");
    return;
  }

  const toNumber = toE164(to);
  if (!toNumber) return;

  const url = `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}/Messages`;
  const auth = Buffer.from(`${projectId}:${apiToken}`).toString("base64");
  const payload = new URLSearchParams({
    From: fromNumber,
    To: toNumber,
    Body: body,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(
        `[SignalWire] SMS failed (${response.status}): ${errorBody || response.statusText}`,
      );
      return;
    }

    console.log(`[SignalWire] SMS sent to ${toNumber}`);
  } catch (err) {
    console.error(`[SignalWire] Error: ${err.message}`);
  }
};

module.exports = {
  sendSMS,
  isSignalWireConfigured,
  toE164,
};
