// PLACEHOLDER content for the mockups. Nothing here is real restaurant data.
export const REST = { name: 'Sample Restaurant', tagline: 'Pizza · Burgers · Karahi', branch: 'Main Branch', code: 'DT-4821', phone: '+92 300 0000000', city: 'Lahore' };
export const CATS = ['All', 'Pizza', 'Burgers', 'Karahi & BBQ', 'Wraps', 'Sides', 'Drinks', 'Desserts', 'Deals'];
export const ITEMS = [
  ['Chicken Tikka Pizza', 1450, 'Pizza', 'Pizza', 's1'], ['Fajita Pizza', 1550, 'Pizza', 'Pizza', 's2'], ['Zinger Burger', 650, 'Burgers', 'Sandwich', 's2'], ['Beef Smash Burger', 890, 'Burgers', 'Beef', 's1'],
  ['Chicken Karahi (half)', 1800, 'Karahi & BBQ', 'CookingPot', 's2'], ['Seekh Kabab', 780, 'Karahi & BBQ', 'Flame', 's1'], ['Chicken Wrap', 520, 'Wraps', 'Sandwich', 's3'], ['Crispy Fries', 290, 'Sides', 'Salad', 's1'],
  ['Mint Margarita', 320, 'Drinks', 'CupSoda', 's5'], ['Cold Coffee', 420, 'Drinks', 'Coffee', 's4'], ['Brownie', 380, 'Desserts', 'Cake', 's4'], ['Family Deal', 3290, 'Deals', 'Gift', 's2'],
];
export const NAMES = ['Ahmed Raza', 'Sara Khan', 'Bilal Hussain', 'Ayesha Noor', 'Usman Ali', 'Hina Malik', 'Zain Abbas', 'Fatima Iqbal'];
export const ORDERS = [
  ['#1042', 'Dining', 'T-07', 'Ahmed Raza', 3280, 'running', '12:41'], ['#1041', 'Delivery', '—', 'Sara Khan', 2150, 'cooking', '12:38'], ['#1040', 'Takeaway', '—', 'Walk-in', 940, 'paid', '12:30'],
  ['#1039', 'Dining', 'T-03', 'Bilal Hussain', 4120, 'paid', '12:12'], ['#1038', 'Delivery', '—', 'Ayesha Noor', 1780, 'onway', '12:05'], ['#1037', 'Dining', 'T-11', 'Usman Ali', 2650, 'partial', '11:58'],
  ['#1036', 'Takeaway', '—', 'Hina Malik', 1290, 'void', '11:44'],
];
export const WEEK = [412, 520, 478, 610, 702, 868, 794];
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HOURS = [12, 18, 31, 44, 38, 52, 61, 49, 40, 33, 22, 14];
export const STAGES = [['pending', 'Order placed'], ['accepted', 'Accepted by the restaurant'], ['cooking', 'Being prepared'], ['ready', 'Ready'], ['rider_assigned', 'Rider assigned'], ['rider_picked', 'Picked up'], ['onway', 'On the way'], ['delivered', 'Delivered']];
