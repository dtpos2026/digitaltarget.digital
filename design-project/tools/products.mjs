// The products of the package: where each lives and which screen files feed it.
// `parked: true` = designed and kept for later, NOT part of the current scope (the customer app: the customer
// ordering website covers customers; a branded multi-restaurant app, Foodpanda-style, is a later project).
export const PRODUCTS = [
  { id: 'software', dir: '02-restaurant-software', title: 'Restaurant software (Windows + web)', frame: 'desktop', files: ['screens-software-1', 'screens-software-2', 'screens-software-3'], accent: 'software' },
  { id: 'website', dir: '03-customer-website', title: 'Customer ordering website', frame: 'mixed', files: ['screens-website'], accent: 'customer' },
  { id: 'rider-app', dir: '05-rider-app', title: 'Rider mobile app (Android)', frame: 'phone', files: ['screens-rider'], accent: 'rider' },
  { id: 'ordertaker-app', dir: '05b-order-taker-app', title: 'Order Taker mobile app (Android)', frame: 'phone', files: ['screens-ordertaker'], accent: 'ordertaker' },
  { id: 'owner-app', dir: '06-owner-app', title: 'Owner management mobile app', frame: 'phone', files: ['screens-owner'], accent: 'software' },
  { id: 'customer-app', dir: '10-future-customer-app', title: 'Customer mobile app — PARKED for later', frame: 'phone', files: ['screens-customer-app'], accent: 'customer', parked: true },
];
