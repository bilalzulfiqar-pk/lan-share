// Subtle two-tone blip synthesized with WebAudio — no audio assets needed.

let audioContext = null;

function getContext() {
    if (typeof window === 'undefined') return null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioContext) {
        try {
            audioContext = new AudioContextClass();
        } catch {
            return null;
        }
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }

    return audioContext;
}

function playTone(context, frequency, startAt, duration, volume) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.05);
}

export function playNotificationBlip() {
    const context = getContext();
    if (!context) return;

    try {
        const now = context.currentTime;
        playTone(context, 660, now, 0.09, 0.045);
        playTone(context, 990, now + 0.09, 0.12, 0.04);
    } catch {
        // audio unavailable — notifications remain silent
    }
}
