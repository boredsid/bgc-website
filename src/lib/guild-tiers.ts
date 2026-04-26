export type Tier = {
  key: string;
  name: string;
  price: number;
  priceLabel: string;
  period: string;
  color: string;
  badge: string | null;
  benefits: string[];
  note: string | null;
};

export const TIERS: Tier[] = [
  {
    key: 'initiate',
    name: 'Initiate',
    price: 600,
    priceLabel: '₹600',
    period: '3 months',
    color: '#4ECDC4',
    badge: null,
    benefits: [
      'Flat 20% off every event',
      'Flat 10% off for one tag along',
      'Early access to all events',
      'Exclusive Guild Path only events',
      'Valid for 3 months',
    ],
    note: "Free if you've attended 10+ events in the last year",
  },
  {
    key: 'adventurer',
    name: 'Adventurer',
    price: 2000,
    priceLabel: '₹2,000',
    period: '3 months',
    color: '#FFD166',
    badge: 'Recommended',
    benefits: [
      'Everything under Initiate',
      'Flat 100% off every event',
      'Flat 100% off for one tag along for 1 event',
      'Valid for 3 months',
    ],
    note: null,
  },
  {
    key: 'guildmaster',
    name: 'Guildmaster',
    price: 8000,
    priceLabel: '₹8,000',
    period: '12 months',
    color: '#C3A6FF',
    badge: 'Best Value',
    benefits: [
      'Everything under Adventurer',
      'Flat 100% off every event',
      'Flat 100% off for one tag along across 5 events',
      'Free 2 day passes for REPLAY conventions',
      'Valid for 12 months',
    ],
    note: null,
  },
];
