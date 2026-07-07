const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, limit, query } = require("firebase/firestore");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json"));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

getDocs(query(collection(db, "system_config"), limit(1)))
  .then(() => console.log("Client Success"))
  .catch(e => console.error("Client Error:", e.message));
