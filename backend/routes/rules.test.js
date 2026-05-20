const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");

describe("Firestore Security Rules", () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "porchpobox-test",
      firestore: {
        rules: fs.readFileSync("firestore.rules", "utf8"),
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  test("Users should be able to read their own profile", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const aliceProfile = aliceDb.collection("users").doc("alice");

    await testEnv.withSecurityRulesDisabled((db) => {
      return db.collection("users").doc("alice").set({ name: "Alice" });
    });

    await assertSucceeds(aliceProfile.get()); // Should work because uid matches
  });

  test("isAdmin() doesn't crash when user doc doesn't exist (Registration check)", async () => {
    const newUserDb = testEnv.authenticatedContext("new-user").firestore();
    const newUserProfile = newUserDb.collection("users").doc("new-user");

    // This verifies that the 'exists()' check in the isAdmin function prevents a crash
    // during the 'get' check performed by Register.js on a brand new account.
    await assertSucceeds(newUserProfile.get());
  });

  test("Users should NOT be able to read others' profiles", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobProfile = aliceDb.collection("users").doc("bob");

    await assertFails(bobProfile.get());
  });

  test("Partners can GET a user profile if they are the preferred location", async () => {
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await db
        .collection("users")
        .doc("alice")
        .set({
          name: "Alice",
          prefLocation: { id: "partner-1" },
        });
    });

    const p1Db = testEnv.authenticatedContext("partner-1").firestore();
    await assertSucceeds(p1Db.collection("users").doc("alice").get());
  });

  test("Partners CANNOT list the entire user collection", async () => {
    const p1Db = testEnv.authenticatedContext("partner-1").firestore();
    await assertFails(p1Db.collection("users").get());
  });

  test("Unapproved partners should not be able to check in packages", async () => {
    const strangerDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      strangerDb.collection("partners").doc("any").set({ approved: true }),
    );
  });
});
