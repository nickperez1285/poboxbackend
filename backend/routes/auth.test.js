const mockVerifyIdToken = jest.fn();

jest.mock("../config/firebaseAdmin", () => ({
  admin: {
    auth: () => ({
      verifyIdToken: mockVerifyIdToken,
    }),
  },
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({
        get: jest.fn(),
      }),
    }),
  }),
}));

const { requireAuth, requireAdmin } = require("../middleware/firebaseAuth");

describe("Auth Middleware", () => {
  let mockReq;
  let mockRes;
  let nextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
    mockVerifyIdToken.mockReset();
  });

  test("requireAuth should fail if no token is provided", async () => {
    await requireAuth(mockReq, mockRes, nextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Missing authorization token",
    });
  });

  test("requireAuth should expose decoded auth context and legacy authUid", async () => {
    mockReq.headers.authorization = "Bearer test-token";
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-123",
      email: "user@example.com",
    });

    await requireAuth(mockReq, mockRes, nextFunction);

    expect(mockVerifyIdToken).toHaveBeenCalledWith("test-token");
    expect(mockReq.auth).toEqual({
      uid: "user-123",
      email: "user@example.com",
    });
    expect(mockReq.authUid).toBe("user-123");
    expect(nextFunction).toHaveBeenCalled();
  });

  test("requireAdmin should block non-admin users", () => {
    mockReq.isAdmin = false;
    requireAdmin(mockReq, mockRes, nextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Admin access required",
    });
  });

  test("requireAdmin should allow admin users", () => {
    mockReq.isAdmin = true;
    requireAdmin(mockReq, mockRes, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });
});
