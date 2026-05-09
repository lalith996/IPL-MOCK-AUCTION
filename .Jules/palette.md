## 2024-05-08 - Accessible Admin Replay Close Button
**Learning:** Found that the admin replay viewer close button `<button onClick={onClose} className="text-gray-400 hover:text-white text-xl px-2">&times;</button>` lacks an ARIA label, making it inaccessible to screen readers.
**Action:** Add an `aria-label="Close replay"` to icon-only or text-symbol close buttons.
