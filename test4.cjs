const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({ credential: applicationDefault() });
console.log("App project:", app.options.projectId);
getFirestore(app, "ai-studio-alphaengine-94d6c309-5a24-4eb3-b5fc-aed88e51a000").collection("system_risk_state").limit(1).get().then(() => console.log("Success")).catch(e => console.error("Error:", e.message));
