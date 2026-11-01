// The five products of the package: where each lives and which screen files feed it.
export const PRODUCTS = [
  { id: 'software', dir: '02-restaurant-software', title: 'Restaurant software (Windows + web)', frame: 'desktop', files: ['screens-software-1', 'screens-software-2', 'screens-software-3'], accent: 'software' },
  { id: 'website', dir: '03-customer-website', title: 'Customer ordering website', frame: 'mixed', files: ['screens-website'], accent: 'customer' },
  { id: 'customer-app', dir: '04-customer-app', title: 'Customer mobile app (Android)', frame: 'phone', files: ['screens-customer-app'], accent: 'customer' },
  { id: 'rider-app', dir: '05-rider-app', title: 'Rider mobile app (Android)', frame: 'phone', files: ['screens-rider'], accent: 'rider' },
  { id: 'owner-app', dir: '06-owner-app', title: 'Owner management mobile app', frame: 'phone', files: ['screens-owner'], accent: 'software' },
];
