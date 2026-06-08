import { initializeApp, getApp, getApps, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import defaultFirebaseConfig from '../firebase-applet-config.json';

// Resolves the active firebase configuration
export function getActiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem("ALPHA_FIREBASE_CONFIG_OVERRIDE");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.apiKey) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed parsing localStorage firebase config override:", e);
  }
  return defaultFirebaseConfig;
}

const activeConfig = getActiveFirebaseConfig();

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(activeConfig) : getApp();

// Initialize Firestore
export let db = getFirestore(app, activeConfig.firestoreDatabaseId || "(default)");

// Initialize Authentication
export let auth = getAuth(app);

// Updates configuration dynamically and reloads the active instances
export function updateActiveFirebaseConfig(newConfig: any) {
  if (newConfig) {
    localStorage.setItem("ALPHA_FIREBASE_CONFIG_OVERRIDE", JSON.stringify(newConfig));
  } else {
    localStorage.removeItem("ALPHA_FIREBASE_CONFIG_OVERRIDE");
  }

  try {
    const existingApps = getApps();
    for (const ea of existingApps) {
      deleteApp(ea);
    }
  } catch (e) {
    console.error("Error clearing existing firebase apps:", e);
  }

  const updatedConfig = getActiveFirebaseConfig();
  const newApp = initializeApp(updatedConfig);
  db = getFirestore(newApp, updatedConfig.firestoreDatabaseId || "(default)");
  auth = getAuth(newApp);

  window.location.reload();
}

// Custom context-rich error logger as mandated by Firebase rules guidelines
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Detailed Payload: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Hardened connection test validation helper
export async function testConnection(): Promise<boolean> {
  const pathForTest = 'test/connection';
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or network status.");
    }
    // If it fails with permission denied, it's still alive/authorized but we hit security rules (which is fine for network test)
    if (error?.code === 'permission-denied') {
      return true;
    }
    return false;
  }
}
