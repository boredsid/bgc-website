export interface Game {
  id: string;
  title: string;
  player_count: string;
  max_players: number;
  avg_rating: number;
  weight: number;
  complexity: string;
  play_time: string;
  max_play_time: number;
  length: string;
}

export interface Event {
  id: string;
  name: string;
  description: string;
  date: string;
  venue_name: string;
  venue_area: string;
  price: number;
  capacity: number;
  custom_questions: CustomQuestion[] | null;
  price_includes: string | null;
  llm_notes: string | null;
  is_published: boolean;
  guild_path_exclusive: boolean;
  externally_managed: boolean;
  external_registration_url: string | null;
  created_at: string;
}

export interface CustomQuestion {
  id: string;
  label: string;
  type: 'select' | 'radio' | 'text' | 'checkbox';
  required: boolean;
  options?: CustomQuestionOption[];
}

export interface CustomQuestionOption {
  value: string;
  capacity?: number;
  price?: number;
}

export interface CorporateEvent {
  id: string;
  company_name: string;
  title: string | null;
  event_date: string;
  headcount: number | null;
  description: string | null;
  logo_url: string | null;
  testimonial: string | null;
  is_published: boolean;
  created_at: string;
}

export interface EventSpots {
  capacity: number;
  registered: number;
  remaining: number;
  option_counts: Record<string, Record<string, number>>;
}

export interface PhoneLookupResponse {
  user: { found: boolean; name: string | null; email: string | null };
  membership: {
    isMember: boolean;
    tier: string | null;
    discount: string | null;
    plus_ones_remaining: number;
  };
  existing_seats_for_event: number;
  credit_balance: number;
  active_promo: {
    remaining_uses: number;
    max_event_price: number;
    expires_at: string | null;
  } | null;
}

export interface RegisterRequest {
  event_id: string;
  name: string;
  phone: string;
  email: string;
  seats: number;
  custom_answers: Record<string, string | boolean>;
  payment_status: 'pending' | 'confirmed';
}

export interface RegisterResponse {
  success: boolean;
  registration_id?: string;
  error?: string;
}
