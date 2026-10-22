import type { CustomQuestion, CustomQuestionOption, EventSpots } from './types';

type Answers = Record<string, string | boolean>;

export function spotsText(n: number): string {
  return `${n} spot${n === 1 ? '' : 's'}`;
}

// Seats still open on one option: its own cap, but never more than the event
// has left. null when the option is uncapped or the counts never loaded — the
// Worker re-checks on /api/register either way.
export function optionSpotsLeft(
  option: CustomQuestionOption,
  counts: Record<string, number> | undefined,
  eventRemaining: number | undefined,
): number | null {
  if (option.capacity === undefined || !counts) return null;
  const left = Math.max(0, option.capacity - (counts[option.value] || 0));
  return eventRemaining === undefined ? left : Math.min(left, eventRemaining);
}

// The most seats the custom answers allow, and a line saying why when that is
// what's holding the count down. A required question that hasn't been answered
// yet caps seats at its roomiest option, so picking seats first can't leave
// every option too small to choose.
export function optionSeatLimit(
  questions: CustomQuestion[],
  answers: Answers,
  spots: EventSpots | null,
): { max: number; reason: string | null } {
  let max = Infinity;
  let reason: string | null = null;
  if (!spots) return { max, reason };

  for (const q of questions) {
    if (!q.options) continue;
    const counts = spots.option_counts?.[q.id];
    const answer = answers[q.id];

    if (typeof answer === 'string' && answer !== '') {
      const option = q.options.find((o) => o.value === answer);
      const left = option ? optionSpotsLeft(option, counts, spots.remaining) : null;
      if (option && left !== null && left < max) {
        max = left;
        reason = `Only ${spotsText(left)} left for ${option.value}.${
          q.required ? '' : ' Tap it again to clear your choice.'
        }`;
      }
    } else if (q.required) {
      const lefts = q.options.map((o) => optionSpotsLeft(o, counts, spots.remaining));
      if (lefts.some((l) => l === null)) continue;
      const roomiest = Math.max(...(lefts as number[]));
      if (roomiest < max) {
        max = roomiest;
        reason =
          roomiest === 0
            ? `Every option for "${q.label}" is full.`
            : `No option for "${q.label}" has more than ${spotsText(roomiest)} left.`;
      }
    }
  }
  return { max, reason };
}

// Why this booking can't go through on these counts, in the Worker's own words
// (see register.ts), or null if it fits.
export function capacityProblem(
  questions: CustomQuestion[],
  answers: Answers,
  spots: EventSpots,
  seats: number,
): string | null {
  if (spots.remaining <= 0) return 'Sorry, this event just filled up.';
  if (seats > spots.remaining) {
    return `Only ${spotsText(spots.remaining)} left now — lower your seats to ${spots.remaining}.`;
  }
  for (const q of questions) {
    const answer = answers[q.id];
    if (!q.options || typeof answer !== 'string' || answer === '') continue;
    const option = q.options.find((o) => o.value === answer);
    const left = option ? optionSpotsLeft(option, spots.option_counts?.[q.id], undefined) : null;
    if (option && left !== null && seats > left) {
      return left === 0
        ? `"${option.value}" is full — please pick another option.`
        : `Only ${spotsText(left)} left for "${option.value}" — book ${left} seat${left === 1 ? '' : 's'} or pick another option.`;
    }
  }
  return null;
}

// Required radios and checkboxes are buttons, so the browser's own `required`
// check never sees them. Returns the first one left unanswered.
export function unansweredRequired(questions: CustomQuestion[], answers: Answers): string | null {
  for (const q of questions) {
    if (!q.required) continue;
    if (q.type === 'radio' && !answers[q.id]) return `Please choose an option for "${q.label}".`;
    if (q.type === 'checkbox' && answers[q.id] !== true) return `Please tick "${q.label}".`;
  }
  return null;
}
