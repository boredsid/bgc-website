import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dedupeGamesByTitle } from '../lib/games';

export default function GameCount({ fallback = '100+' }: { fallback?: string }) {
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    supabase
      .from('games')
      .select('title')
      .then(({ data }) => {
        if (data) {
          const unique = dedupeGamesByTitle(data).length;
          const rounded = Math.floor(unique / 10) * 10;
          setLabel(`${rounded}+`);
        }
      });
  }, []);

  return <>{label}</>;
}
