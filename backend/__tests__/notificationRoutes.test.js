const express = require("express");
const request = require("supertest");

const mockDocState = new Map();
const mockCollectionDocs = new Map();

const applyMerge = (existing, updates) => {
  const next = { ...(existing || {}) };
  Object.entries(updates).forEach(([key, value]) => {
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "__increment")) {
      next[key] = (Number(existing?.[key]) || 0) + value.__increment;
      return;
    }
    if (value && typeof value === "object" && value.__serverTimestamp) {
      next[key] = value;
      return;
    }
    next[key] = value;
  });
  return next;
};

jest.mock("../config/firebaseAdmin", () => {
  const admin = {
    firestore: {
      FieldValue: {
        increment: jest.fn((v) => ({ __increment: v })),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      },
      Timestamp: {
        fromDate: jest.fn((d) => ({ toDate: () => d, toMillis: () => d.getTime() }))
      }
    }
  };

  const getFirestore = () => ({
    doc: (path) => ({
      async get() {
        const data = mockDocState.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      async set(payload, options = {}) {
        const current = mockDocState.get(path);
        const next = options.merge ? applyMerge(current, payload) : payload;
        mockDocState.set(path, next);
      },
      async update(payload) {
        const current = mockDocState.get(path) || {};
        mockDocState.set(path, applyMerge(current, payload));
      },
      get ref() {
        return {
          async update(payload) {
            const current = mockDocState.get(path) || {};
            mockDocState.set(path, applyMerge(current, payload));
          }
        };
      }
    }),
    collection: (path) => ({
      async add(payload) {
        const existing = mockCollectionDocs.get(path) || [];
        existing.push(payload);
        mockCollectionDocs.set(path, existing);
      },
      where: (field, op, value) => ({
        limit: () => ({
          async get() {
            const allDocs = mockDocState;
            const matches = [];
            allDocs.forEach((data, docPath) => {
              if (docPath.startsWith(path.replace(/\/$/, "") + "/") && data?.[field] === value) {
                matches.push({
                  data: () => data,
                  ref: {
                    async update(updates) {
                      mockDocState.set(docPath, applyMerge(data, updates));
                    }
                  }
                });
              }
            });
            return { empty: matches.length === 0, docs: matches };
          }
        })
      })
    })
  });

  return { admin, getFirestore };
});

const { admin } = require("../config/firebaseAdmin");
const notificationRoutes = require("../routes/notificationRoutes");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", notificationRoutes);
  return app;
};

beforeEach(() => {
  mockDocState.clear();
  mockCollectionDocs.clear();
  process.env.RESEND_API_KEY = "test-key";
  process.env.MAIL_FROM_EMAIL = "noreply@porchpobox.com";
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM_EMAIL;
});

// ─── Package Check-In ────────────────────────────────────────────────────────

describe("POST /package-check-in", () => {
  it("returns 400 if required fields are missing", async () => {
    const res = await request(buildApp()).post("/api/notifications/package-check-in").send({});
    expect(res.status).toBe(400);
  });

  it("sets first-time inactive user to trial and sends email", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "inactive", packagesCheckedIn: 0, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 0 });

    const res = await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(res.status).toBe(200);
    expect(mockDocState.get("users/u1").status).toBe("trial");
    expect(mockDocState.get("users/u1").packagesCheckedIn).toBe(1);
    expect(mockDocState.get("partners/p1/packageCounts/u1").count).toBe(1);
    expect(mockDocState.get("partners/p1/packageCounts/u1").totalReceived).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sets already-trialed user to inactive on second check-in", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "trial", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    const res = await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(res.status).toBe(200);
    expect(mockDocState.get("users/u1").status).toBe("inactive");
  });

  it("does not change status for active users", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 5, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 5 });

    await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 2 }]
    });

    expect(mockDocState.get("users/u1").status).toBe("active");
  });

  it("skips email when notificationsEnabled is false", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: false });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("always sends email on first check-in regardless of timing", async () => {
    // No lastCheckInEmailAt set — first time this user has been checked in
    mockDocState.set("users/u1", { email: "a@test.com", status: "trial", packagesCheckedIn: 0, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 0, totalReceived: 0, totalPickedUp: 0 }); // no lastCheckInEmailAt
    mockDocState.set("partners/p1", { packageCheckInCount: 0 });

    await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate email sent within 10 minutes", async () => {
    const recentTimestamp = { toMillis: () => Date.now() - 2 * 60 * 1000 }; // 2 min ago
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 1, totalReceived: 1, totalPickedUp: 0, lastCheckInEmailAt: recentTimestamp });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends email again after 10 minutes have passed", async () => {
    const oldTimestamp = { toMillis: () => Date.now() - 15 * 60 * 1000 }; // 15 min ago
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 1, totalReceived: 1, totalPickedUp: 0, lastCheckInEmailAt: oldTimestamp });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("correctly increments totalReceived on each check-in", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 2, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 2, totalReceived: 2, totalPickedUp: 0 });
    mockDocState.set("partners/p1", { packageCheckInCount: 2 });

    await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 3 }]
    });

    expect(mockDocState.get("partners/p1/packageCounts/u1").totalReceived).toBe(5);
    expect(mockDocState.get("partners/p1/packageCounts/u1").count).toBe(5);
  });

  it("handles multiple recipients in one call", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("users/u2", { email: "b@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 0 });

    const res = await request(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [
        { id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 },
        { id: "u2", name: "Bob", email: "b@test.com", packageCount: 2 }
      ]
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockDocState.get("partners/p1").packageCheckInCount).toBe(3);
  });
});

// ─── Package Delivery ─────────────────────────────────────────────────────────

describe("POST /package-delivery", () => {
  it("returns 400 if recipients are missing", async () => {
    const res = await request(buildApp()).post("/api/notifications/package-delivery").send({});
    expect(res.status).toBe(400);
  });

  it("increments packagesDelivered and sets inactive on first delivery for non-active user", async () => {
    mockDocState.set("users/u1", { status: "trial", packagesDelivered: 0 });

    const res = await request(buildApp()).post("/api/notifications/package-delivery").send({
      recipients: [{ id: "u1", packageCount: 1 }]
    });

    expect(res.status).toBe(200);
    expect(mockDocState.get("users/u1").status).toBe("inactive");
    expect(mockDocState.get("users/u1").packagesDelivered).toBe(1);
  });

  it("decrements count on delivery so packages in stock is accurate", async () => {
    mockDocState.set("users/u1", { status: "active", packagesDelivered: 2 });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 3, totalReceived: 3, totalPickedUp: 0 });

    await request(buildApp()).post("/api/notifications/package-delivery").send({
      partnerId: "p1", partnerName: "Shop A",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 2 }]
    });

    expect(mockDocState.get("partners/p1/packageCounts/u1").count).toBe(1);
    expect(mockDocState.get("partners/p1/packageCounts/u1").totalPickedUp).toBe(2);
  });

  it("does not change status for active users on delivery", async () => {
    mockDocState.set("users/u1", { status: "active", packagesDelivered: 3 });

    await request(buildApp()).post("/api/notifications/package-delivery").send({
      recipients: [{ id: "u1", packageCount: 1 }]
    });

    expect(mockDocState.get("users/u1").status).toBe("active");
  });

  it("sends first-delivery welcome email for non-active users", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", name: "Alice", status: "trial", packagesDelivered: 0 });

    await request(buildApp()).post("/api/notifications/package-delivery").send({
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.html).toContain("first package");
  });

  it("does not send welcome email on subsequent deliveries", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesDelivered: 2 });

    await request(buildApp()).post("/api/notifications/package-delivery").send({
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── Partner Approved ─────────────────────────────────────────────────────────

describe("POST /partner-approved", () => {
  it("returns 400 if businessName or email missing", async () => {
    const res = await request(buildApp()).post("/api/notifications/partner-approved").send({ businessName: "Shop" });
    expect(res.status).toBe(400);
  });

  it("sends approval email to partner", async () => {
    const res = await request(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com"
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toBe("shop@test.com");
    expect(body.html).toContain("Approved");
  });

  it("sends referral reward email and grants 1 year when referredBy matches a user", async () => {
    mockDocState.set("users/referrer-1", {
      email: "referrer@test.com",
      name: "Jane",
      referralCode: "JA120525",
      status: "inactive"
    });

    const res = await request(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com", referredBy: "JA120525"
    });

    expect(res.status).toBe(200);
    // 2 emails: partner approval + referrer reward
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const rewardBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(rewardBody.to).toBe("referrer@test.com");
    expect(rewardBody.html).toContain("free");

    const referrer = mockDocState.get("users/referrer-1");
    expect(referrer.status).toBe("active");
    expect(referrer.referralRewardGranted).toBe(true);
  });

  it("does not error if referredBy code does not match any user", async () => {
    const res = await request(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com", referredBy: "XX999999"
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1); // only partner email
  });
});

// ─── Vendor Registration ──────────────────────────────────────────────────────

describe("POST /vendor-registration", () => {
  it("returns 400 if any required field is missing", async () => {
    const res = await request(buildApp()).post("/api/notifications/vendor-registration").send({
      businessName: "Shop A"
    });
    expect(res.status).toBe(400);
  });

  it("sends two emails: admin alert and partner confirmation", async () => {
    const res = await request(buildApp()).post("/api/notifications/vendor-registration").send({
      businessName: "Shop A", email: "shop@test.com", phoneNumber: "5551234567",
      streetAddress: "123 Main St", city: "Springfield", state: "CA", zipCode: "90210"
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const adminEmail = JSON.parse(global.fetch.mock.calls[0][1].body);
    const partnerEmail = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(adminEmail.to).toBe("contact@porchpobox.com");
    expect(partnerEmail.to).toBe("shop@test.com");
  });
});

// ─── Referral ─────────────────────────────────────────────────────────────────

describe("POST /referral", () => {
  it("returns 400 if email is missing", async () => {
    const res = await request(buildApp()).post("/api/notifications/referral").send({});
    expect(res.status).toBe(400);
  });

  it("sends referral notification to admin", async () => {
    const res = await request(buildApp()).post("/api/notifications/referral").send({
      email: "referrer@test.com", additionalInfo: "Great local shop"
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toBe("contact@porchpobox.com");
    expect(body.html).toContain("referrer@test.com");
  });
});

// ─── Missing env vars ─────────────────────────────────────────────────────────

describe("email env var validation", () => {
  it("returns 500 if RESEND_API_KEY is missing on partner approval", async () => {
    delete process.env.RESEND_API_KEY;

    const res = await request(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com"
    });

    expect(res.status).toBe(500);
  });
});
