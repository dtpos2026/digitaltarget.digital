// One hook, so no screen has to remember how the identity is fetched.
// Paints from the cache on the first frame, then refreshes in the background.
import { useEffect, useState } from 'react';
import {
  cachedIdentity, resolveRestaurantIdentity, type RestaurantIdentity,
} from '@/lib/restaurantIdentity';

export function useRestaurantIdentity(): RestaurantIdentity {
  const [id, setId] = useState<RestaurantIdentity>(() => cachedIdentity());

  useEffect(() => {
    let alive = true;
    void resolveRestaurantIdentity().then(next => { if (alive) setId(next); });
    return () => { alive = false; };
  }, []);

  return id;
}
