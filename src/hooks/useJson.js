import { useEffect, useState } from 'react';

export function useJson(url, fallback, refreshMs = 300000) {
  const [data, setData] = useState(fallback);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  useEffect(() => {
    let live = true;
    // Reset to fallback when the URL changes so one station's data never bleeds into the
    // next when the new fetch 404s (e.g. a station with no saved price history file).
    setData(fallback);
    const load = () => {
      setError(null);
      fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return response.json();
        })
        .then(json => {
          if (!live) return;
          setData(json);
          setFetchedAt(new Date().toISOString());
        })
        .catch(error => { if (live) { setError(error.message); setData(fallback); } });
    };
    load();
    const timer = refreshMs ? window.setInterval(load, refreshMs) : null;
    return () => { live = false; if (timer) window.clearInterval(timer); };
  }, [url, refreshMs]);
  return { data, error, fetchedAt };
}
