import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function GameCount({ fallback = '100+' }: { fallback?: string }) {
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    supabase
      .from('games')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => {
        if (count != null) {
          const rounded = Math.floor(count / 10) * 10;
          setLabel(`${rounded}+`);
        }
      });
  }, []);

  return <>{label}</>;
}
