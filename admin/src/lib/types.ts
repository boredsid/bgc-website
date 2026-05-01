export interface CustomQuestionOption {
  value: string;
  capacity?: number;
}

export interface CustomQuestion {
  id: string;
  label: string;
  type: 'select' | 'radio' | 'text' | 'checkbox';
  required: boolean;
  options?: CustomQuestionOption[];
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  date: string;
  venue_name: string | null;
  venue_area: string | null;
  price: number;
  capacity: number;
  custom_questions: CustomQuestion[] | null;
  price_includes: string | null;
  is_published: boolean;
  created_at: string;
}

export interface Game {
  id: string;
  title: string;
  player_count: string | null;
  max_players: number | null;
  avg_rating: number | null;
  weight: number | null;
  complexity: string | null;
  play_time: string | null;
  max_play_time: number | null;
  length: string | null;
  owned_by: string | null;
  currently_with: string | null;
}

export interface Registration {
  id: string;
  event_id: string;
  user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  seats: number;
  total_amount: number;
  discount_applied: string | null;
  custom_answers: Record<string, string | boolean> | null;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  plus_ones_consumed: number;
  source: string | null;
  created_at: string;
}

export interface GuildMember {
  id: string;
  user_id: string;
  tier: 'initiate' | 'adventurer' | 'guildmaster';
  amount: number;
  status: 'pending' | 'paid' | 'cancelled';
  starts_at: string;
  expires_at: string;
  plus_ones_used: number;
  source: string | null;
  user_name: string | null;
  user_phone: string;
  user_email: string | null;
}

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  first_registered_at: string;
  last_registered_at: string;
  source: string | null;
}
