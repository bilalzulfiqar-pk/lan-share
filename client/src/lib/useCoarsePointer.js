import { useEffect, useState } from 'react';

// True on touch-primary devices (phones/tablets), where spring animations and
// backdrop-filter blurs are expensive to composite.
export function useCoarsePointer() {
    const [coarse, setCoarse] = useState(
        () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)
    );

    useEffect(() => {
        const mediaQuery = window.matchMedia('(pointer: coarse)');
        const update = () => setCoarse(mediaQuery.matches);
        mediaQuery.addEventListener?.('change', update);
        return () => mediaQuery.removeEventListener?.('change', update);
    }, []);

    return coarse;
}
