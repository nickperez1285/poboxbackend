const express = require("express");
const request = require("supertest");

const mockDocState = new Map();

const makeIncrement = (value) => ({ __increment: value });

jest.mock("../config/firebaseAdmin", () => {
  const admin = {
    firestore: {
      FieldValue: {
        increment: jest.fn((value) => ({ __increment: value }))
      }
    }
  };

  const applyMerge = (existing, updates) => {
    const next = { ...(existing || {}) };

    Object.entries(updates).forEach(([key, value]) => {
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "__increment")) {
        next[key] = (Number(existing?.[key]) || 0) + value.__increment;
        return;
      }

      next[key] = value;
    });

    return next;
  };

  const getFirestore = () => ({
    doc: (path) => ({
      async get() {
        const data = mockDocState.get(path);
        return {
          exists: data !== undefined,
          data: () => data
        };
      },
      async set(payload, options = {}) {
        const current = mockDocState.get(path);
        const next = options.merge ? applyMerge(current, payload) : payload;
        mockDocState.set(path, next);
      }
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

describe("notificationRoutes", () => {
  beforeEach(() => {
    mockDocState.clear();
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.MAIL_FROM_EMAIL = "noreply@example.com";
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({})
      })
    );
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM_EMAIL;
  });

  it("records package check-in totals and moves first-time inactive users into trial", async () => {
    mockDocState.set("users/user-1", {
      email: "casey@example.com",
      status: "inactive",
      packagesCheckedIn: 0
    });
    mockDocState.set("partners/partner-1", {
      businessName: "Main Street Partner",
      packageCheckInCount: 0
    });

    const response = await request(buildApp())
      .post("/api/notifications/package-check-in")
      .send({
        vendorName: "Main Street Partner",
        partnerId: "partner-1",
        recipients: [
          {
            id: "user-1",
            name: "Casey Customer",
            email: "casey@example.com",
            packageCount: 1
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockDocState.get("users/user-1")).toEqual({
      email: "casey@example.com",
      status: "trial",
      packagesCheckedIn: 1
    });
    expect(mockDocState.get("partners/partner-1/packageCounts/user-1")).toEqual({
      count: 1,
      totalReceived: 1,
      totalPickedUp: 0,
      name: "Casey Customer",
      email: "casey@example.com"
    });
    expect(mockDocState.get("partners/partner-1")).toEqual({
      businessName: "Main Street Partner",
      packageCheckInCount: 1
    });
    expect(admin.firestore.FieldValue.increment).toHaveBeenCalledWith(1);
  });

  it("records delivery totals and moves first-time non-active users back to inactive", async () => {
    mockDocState.set("users/user-1", {
      status: "trial",
      packagesDelivered: 0
    });

    const response = await request(buildApp())
      .post("/api/notifications/package-delivery")
      .send({
        recipients: [
          {
            id: "user-1",
            packageCount: 2
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(mockDocState.get("users/user-1")).toEqual({
      status: "inactive",
      packagesDelivered: 2
    });
    expect(admin.firestore.FieldValue.increment).toHaveBeenCalledWith(2);
  });

  it("sends a partner approval welcome email", async () => {
    const response = await request(buildApp())
      .post("/api/notifications/partner-approved")
      .send({
        businessName: "Main Street Partner",
        email: "partner@example.com",
        streetAddress: "123 Main St",
        city: "Springfield",
        state: "CA",
        zipCode: "90210"
      });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"template":"partner approved"')
      })
    );
  });
});
