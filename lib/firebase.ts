import 'client-only';

import { getApp, getApps, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let firebaseApp: FirebaseApp | null = null;

export function getFirebaseApp() {
  if (!firebaseConfig.apiKey || !firebaseConfig.appId || !firebaseConfig.projectId) {
    return null;
  }

  firebaseApp ??= getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return firebaseApp;
}

export async function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (!(await isSupported())) return null;
  const app = getFirebaseApp();
  return app ? getAnalytics(app) : null;
}
