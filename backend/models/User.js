const { getFirestore } = require("../config/firebaseAdmin");

const db = getFirestore();
const userCollection = db.collection("users");
module.exports = userCollection;
