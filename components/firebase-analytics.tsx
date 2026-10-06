'use client';

import { useEffect } from 'react';
import { getFirebaseAnalytics } from '@/lib/firebase';

export function FirebaseAnalytics() {
  useEffect(() => {
    void getFirebaseAnalytics().catch((error: unknown) => {
      console.error('Firebase Analytics initialization failed:', error);
    });
  }, []);

  return null;
}
