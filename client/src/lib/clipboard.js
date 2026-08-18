// Clipboard with a fallback for insecure origins (http:// LAN deployments),
// where navigator.clipboard is undefined.

export function isClipboardAvailable() {
    return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
}

export async function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // fall through to the legacy path
        }
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const succeeded = document.execCommand('copy');
        document.body.removeChild(textarea);
        return succeeded;
    } catch {
        return false;
    }
}
