'use client';

import { useEffect } from 'react';
import { useAuth, useClerk } from '@clerk/nextjs';
import { registerClerk } from '../../lib/auth/clerk-bridge.js';

// Renders nothing. Once Clerk has loaded, hands the instance to the session module (lib/auth/clerk-bridge.js).
export default function ClerkRegistrar() {
  const clerk = useClerk();
  const { isLoaded } = useAuth();
  useEffect(() => {
    if (isLoaded) registerClerk(clerk);
  }, [isLoaded, clerk]);
  return null;
}
