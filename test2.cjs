const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app1 = initializeApp({ projectId: "alpha-engine-ai-studio", credential: applicationDefault() }, "app1");
console.log("App1 project:", app1.options.projectId);
getFirestore(app1).collection("test").limit(1).get().then(() => console.log("App1 success")).catch(e => console.error("App1 error:", e.message));

const app2 = initializeApp({ projectId: "alpha-engine-ai-studio" }, "app2");
console.log("App2 project:", app2.options.projectId);
getFirestore(app2).collection("test").limit(1).get().then(() => console.log("App2 success")).catch(e => console.error("App2 error:", e.message));
