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

export function playTransferCompleteChime() {
    const context = getContext();
    if (!context) return;

    try {
        const now = context.currentTime;
        // Ascending harmonic chime: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> C6 (1046Hz)
        playTone(context, 523.25, now, 0.08, 0.045);
        playTone(context, 659.25, now + 0.07, 0.08, 0.045);
        playTone(context, 783.99, now + 0.14, 0.10, 0.05);
        playTone(context, 1046.50, now + 0.22, 0.25, 0.055);
    } catch {
        // audio unavailable — remain silent
    }
}

let beaconAudio = null;

// Silent WAV (1 sample of silence) used as an inaudible background audio beacon
// to keep mobile OS threads (iOS Safari / Android Chrome) awake during transfers.
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export function startAudioBeacon() {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    try {
        if (!beaconAudio) {
            beaconAudio = new Audio(SILENT_WAV);
            beaconAudio.loop = true;
            beaconAudio.volume = 0.001; // virtually silent
        }
        const promise = beaconAudio.play();
        if (promise && typeof promise.catch === 'function') {
            promise.catch(() => {});
        }
    } catch {
        // audio playback disallowed without user gesture — fallback silently
    }
}

export function stopAudioBeacon() {
    if (!beaconAudio) return;
    try {
        beaconAudio.pause();
        beaconAudio.currentTime = 0;
    } catch {
        // ignore
    }
}


