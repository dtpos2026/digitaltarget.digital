// Pakistan delivery location dataset (Province → City → Areas).
// Lightweight, used by POS delivery dialog and delivery board.

export interface CityAreas {
  city: string;
  areas: string[];
}

export interface ProvinceAreas {
  province: string;
  cities: CityAreas[];
}

export const PAKISTAN_AREAS: ProvinceAreas[] = [
  {
    province: 'Punjab',
    cities: [
      { city: 'Jhang City', areas: [
        'Satellite Town', 'Civil Lines', 'Gojra Road', 'Sargodha Road', 'Faisalabad Road',
        'Shorkot Road', 'Toba Road', 'Railway Road', 'Ghalla Mandi', 'Main Bazaar',
        'Madina Town', 'Model Town', 'Mohallah Mughalpura', 'Chiniot Road', 'Bhakkar Road',
      ]},
      { city: 'Burewala', areas: [
        'Ghalla Mandi', 'College Chowk', 'Multan Road', 'Vehari Road',
        'Pakpattan Road', 'Adda Lar', 'Sahiwal Road', 'Railway Road',
        'Jinnah Park', 'Model Town', 'Mohallah Islamabad', 'Mohallah Ghousia',
      ]},
      { city: 'Vehari', areas: [
        'Ghalla Mandi', 'Multan Road', 'Mailsi Road', 'Burewala Road',
        'Luddan Road', 'Jinnah Town', 'Model Town', 'Railway Road',
      ]},
      { city: 'Multan', areas: [
        'Bosan Road', 'Gulgasht Colony', 'Cantt', 'Shah Rukn-e-Alam',
        'Mumtazabad', 'Chowk Kumharanwala', 'New Multan', 'Wapda Town',
        'DHA Multan', 'Sher Shah Road', 'Northern Bypass',
      ]},
      { city: 'Lahore', areas: [
        'DHA', 'Gulberg', 'Model Town', 'Johar Town', 'Wapda Town',
        'Bahria Town', 'Cantt', 'Iqbal Town', 'Township', 'Garden Town',
        'Faisal Town', 'Samanabad', 'Shadman', 'Anarkali', 'Mall Road',
      ]},
      { city: 'Faisalabad', areas: [
        'D-Ground', 'Peoples Colony', 'Madina Town', 'Gulberg', 'Susan Road',
        'Satiana Road', 'Jaranwala Road', 'Sargodha Road', 'Samanabad',
      ]},
      { city: 'Rawalpindi', areas: [
        'Saddar', 'Bahria Town', 'DHA', 'Satellite Town', 'Chaklala',
        'Westridge', 'Committee Chowk', 'Murree Road', 'Adyala Road',
      ]},
      { city: 'Sahiwal', areas: ['Civil Lines', 'Farid Town', 'GT Road', 'Jinnah Colony'] },
      { city: 'Pakpattan', areas: ['Main Bazaar', 'Arifwala Road', 'Sahiwal Road', 'Darbar Road'] },
      { city: 'Mailsi', areas: ['Ghalla Mandi', 'Multan Road', 'Vehari Road'] },
      { city: 'Arifwala', areas: ['Main Bazaar', 'Pakpattan Road', 'Vehari Road'] },
    ],
  },
  {
    province: 'Sindh',
    cities: [
      { city: 'Karachi', areas: [
        'DHA', 'Clifton', 'Gulshan-e-Iqbal', 'Gulistan-e-Jauhar', 'North Nazimabad',
        'Korangi', 'Malir', 'PECHS', 'Saddar', 'Bahadurabad', 'Nazimabad',
      ]},
      { city: 'Hyderabad', areas: ['Latifabad', 'Qasimabad', 'Citizen Colony', 'Saddar'] },
      { city: 'Sukkur', areas: ['Military Road', 'Society', 'Workshop Road'] },
    ],
  },
  {
    province: 'KPK',
    cities: [
      { city: 'Peshawar', areas: ['Hayatabad', 'University Town', 'Saddar', 'Cantt', 'Gulbahar'] },
      { city: 'Abbottabad', areas: ['Mandian', 'Supply', 'Cantt', 'Jinnahabad'] },
    ],
  },
  {
    province: 'Balochistan',
    cities: [
      { city: 'Quetta', areas: ['Cantt', 'Satellite Town', 'Jinnah Town', 'Saryab Road'] },
    ],
  },
  {
    province: 'Islamabad',
    cities: [
      { city: 'Islamabad', areas: [
        'F-6', 'F-7', 'F-8', 'F-10', 'F-11', 'G-9', 'G-10', 'G-11', 'G-13',
        'I-8', 'I-10', 'Bahria Town', 'DHA Islamabad', 'Blue Area',
      ]},
    ],
  },
];

export function getProvinces(): string[] {
  return PAKISTAN_AREAS.map(p => p.province);
}
export function getCitiesOf(province: string): string[] {
  return PAKISTAN_AREAS.find(p => p.province === province)?.cities.map(c => c.city) || [];
}
export function getAreasOf(province: string, city: string): string[] {
  return PAKISTAN_AREAS.find(p => p.province === province)?.cities.find(c => c.city === city)?.areas || [];
}
