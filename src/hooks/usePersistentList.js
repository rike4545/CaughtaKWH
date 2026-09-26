import { useCallback, useEffect, useState } from 'react';

export function usePersistentList(key, { maxItems = Infinity } = {}) {
  const [items, setItems] = useState(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, maxItems) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // Storage may be unavailable in privacy modes; in-memory state still works.
    }
  }, [key, items]);

  const toggle = useCallback(id => {
    if (!id) return;
    setItems(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [id, ...current].slice(0, maxItems)
    );
  }, [maxItems]);

  const push = useCallback(id => {
    if (!id) return;
    setItems(current => [id, ...current.filter(item => item !== id)].slice(0, maxItems));
  }, [maxItems]);

  const remove = useCallback(id => setItems(current => current.filter(item => item !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  return { items, toggle, push, remove, clear, setItems };
}
