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
    // .catch as well as .then: the resolver is written not to reject, but a
    // header is not worth an unhandled rejection if that ever stops being true.
    resolveRestaurantIdentity()
      .then(next => { if (alive) setId(next); })
      .catch(() => { /* the cached identity, already rendered, stands */ });
    return () => { alive = false; };
  }, []);

  return id;
}
