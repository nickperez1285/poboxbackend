const admin = require("firebase-admin");

let appInstance;

const getFirebaseAdminApp = () => {
  if (appInstance) {
    return appInstance;
  }

  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Missing Firebase Admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
      );
    }

    appInstance = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
  } else {
    appInstance = admin.app();
  }

  return appInstance;
};

const getFirestore = () => {
  const app = getFirebaseAdminApp();
  return admin.firestore(app);
};

module.exports = {
  admin,
  getFirestore
};
