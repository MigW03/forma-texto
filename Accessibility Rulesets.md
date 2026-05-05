Accessibility Rulesets
This document outlines the accessibility features and guidelines implemented in all digital assets to ensure they are usable by everyone, including people with disabilities.
## WCAG Compliance Level
- All UI codes must meet WCAG 2.2 AA.

## General Principles

- All relationships, groupings, and associations between content and control must be conveyed both visually and programmatically.
- The language of the page must be programmatically identified using the lang attribute. Any changes in language within the content must also be programmatically identified.
- All functionalities must be operable using assistive technologies.
- Consistent navigation patterns must be used across all pages within a site or application.
- Components that have the same functionality across pages must be identified consistently.

### 1. HTML & Semantics
- Always use semantic HTML elements (<button>, <a>, <input>, <select>, <textarea>, <table>, <nav>, <main>, etc.).
- Never use <div> or <span> for interactive elements. 
- Decorative images must use alt="" and aria-hidden="true".
- Complex images (charts, diagrams, infographics) must include a long description via <figcaption>, aria-describedby, or a linked text alternative.
- SVG icons used as interactive elements must have an accessible name via aria-label, or aria-labelledby.

### 2. ARIA
- Only add ARIA when native HTML is insufficient. Native HTML semantics always take precedence.
- Every interactive element must have an accessible name via aria-label, aria-labelledby, or a visible <label>. This applies universally to buttons, links, form fields, dialogs, tabs, and custom widgets.
- Dynamic content changes must be announced via aria-live regions or role="status" / role="alert" so that screen readers notify users of important updates.
    - Use aria-live="polite" for non-urgent updates.
    - Use aria-live="assertive" or role="alert" only for critical, time-sensitive notifications.
- Custom interactive widgets (tabs, accordions, modals, carousels, menus) must implement the appropriate WAI-ARIA Authoring Practices design pattern, including correct roles, states, and properties.
- aria-expanded, aria-selected, aria-checked, aria-pressed, and aria-disabled must accurately reflect the current state of interactive components at all times.
- Never use aria-hidden="true" on focusable elements or their ancestors.





### 3. Organization and Structure

- A descriptive and unique <title> must be provided for each page.
- Landmarks must be used to define content regions (<nav>, <main>, <header>, <footer>, <aside>, <article>, <section>). When more than one landmark of the same type exists on a page, each must have a unique accessible name.
- There must be only one <main> landmark per page.
- Headings (<h1> through <h6>) must only be used for content that describes a section. Heading levels must reflect the information hierarchy logically — no skipped levels (e.g., do not jump from <h2> to <h4>).
- Each page should have exactly one <h1> that describes the primary purpose of the page.
- Lists (<ul>, <ol>, <dl>) must be used for list content — and only for list content.
- Data tables larger than 3 rows and/or 3 columns must have properly marked-up table headers (<th>) with scope attributes that clearly describe how the data is organized.
- Complex data tables must use id and headers attributes to associate data cells with their headers.
- Layout tables must not use <th>, <caption>, or summary attributes.
- Data relationships in tables must be communicated both visually and programmatically.
- There must be at least two ways of finding a page within a set of web pages (e.g., navigation menu, site map, search functionality, or related links).

### 4. Keyboard Access and Focus
- All interactive elements and all essential information must be keyboard accessible with and without assistive technology.
- Users must be able to move focus away from any element using Tab, Shift+Tab, arrow keys, Escape, or other standard inputs.
- No keyboard traps. If a modal or dialog traps focus by design, it must provide a clear and accessible mechanism to close and restore focus.
- DOM order must mirror visual layout to ensure that keyboard tab order preserves meaning and operability.
- Individual keystrokes must not require specific timing for activation.
- If a shortcut key is provided, it must not use only a single printable character key, or it must be remappable, or it must only be active when the associated component has focus.
- All keyboard-accessible components must have a visible focus indicator that meets the following requirements:
- Focus indicator must have a minimum contrast ratio of 3:1 against adjacent colors.
- The focus indicator area must be at least as large as a 2 CSS pixel thick perimeter of the unfocused component.
- The focus indicator must not be entirely obscured by author-created content (SC 2.4.11 — Focus Not Obscured Minimum).
- An interface component must not initiate an unexpected change when it receives focus or when a setting is changed, unless the user has been advised in advance.
- When hidden content is revealed within the same page, focus must move to the revealed content either immediately or with one additional keystroke.
- Once the user finishes interacting with revealed content (e.g., closing a modal or dismissing a panel), focus must return to either the element that initiated the action or the next logical element in the focus order.
- If content is revealed on hover or focus that overlaps or replaces other content:
- The user must be able to dismiss the new content without moving focus or pointer (e.g., pressing Escape).
- The user must be able to move the pointer to the new content without it disappearing.
- The new content must remain visible until the user moves focus or pointer away, dismisses it, or the information is no longer valid.
- A skip-to-main-content link must be provided as the first focusable element on every page.

### 5. Color and Style
- All text must meet the minimum contrast ratio:
    - 4.5:1 for normal text (under 18pt regular or 14pt bold).
    - 3:1 for large text (18pt regular or 14pt bold and above).
- Non-text UI components and graphical objects required to understand the content must meet a 3:1 contrast ratio against adjacent colors.
- Focus indicators must meet a minimum contrast ratio of 3:1.
- Text must be implemented as actual text, not as images of text, unless the visual presentation is essential.
- Information must never be conveyed by color alone. An additional visual differentiator (text label, pattern, icon, underline) must always accompany color-coded information.
- Dark mode and high-contrast mode implementations must maintain all contrast requirements.

### 6. Input & Forms
- All form fields must have a persistent, visible, and programmatically associated label using <label for="id"> or equivalent.
- The placeholder attribute must never be used as a replacement for a field label. It may only supplement an existing visible label.
- Instructions must be provided to help users understand how to complete the form and individual form controls. Instructions must appear before the form or field they describe.
- Instructions must not rely solely on sensory characteristics (e.g., shape, size, visual location, orientation, or sound).
- Related controls must be grouped both visually and programmatically using <fieldset> and <legend> or equivalent ARIA grouping.
- When an error is detected, it must be:
    - Identified specifically — the field in error is pinpointed.
    - Described in text — the nature of the error and a suggestion for correction are provided.
    - Programmatically associated with the relevant field using aria-describedby or aria-errormessage.
    - Announced by screen readers immediately upon detection.
- Required fields must be indicated programmatically (via required or aria-required="true") and in the visible label — not just visually (e.g., not by color or asterisk alone without explanation).
- If a form gathers information across multiple screens and then submits user data, the user must be able to review, correct, and confirm data before final submission. Submissions must be reversible, verified, or confirmed.
- The purpose of each input field collecting personal user information must be programmatically determinable using the autocomplete attribute with the appropriate token value.
- All user inputs collecting information for the primary end user must support browser autocomplete.
- Links must have a purpose that is determinable from the link text alone, or from the link text combined with its programmatically determinable context. Avoid generic link text like "click here" or "read more" without additional context.
- Redundant Entry: In multi-step processes, if a user has already provided information in the previous step, they must not be required to re-enter it. Previously entered data must auto-populate or be selectable.
- Accessible Authentication: Authentication processes must not require users to memorize, transcribe, or solve cognitive function tests (e.g., CAPTCHA puzzles, password recall without paste support). Systems must support:
    - Copy/paste functionality in password fields for password manager compatibility.
    - Alternative authentication methods such as passkeys, biometrics, email/SMS verification links, or OAuth-based single sign-on.

### 7. Target Size
- All interactive targets (buttons, links, icons, form controls) must have a minimum clickable/tappable area of at least 24 × 24 CSS pixels (SC 2.5.8 — New in WCAG 2.2).
- Exceptions:
    - Inline links within a block of text are exempt.
    - Targets where the size is determined by the user agent and not modified by the author.
    - Targets where a conforming alternative of sufficient size is available on the same page.
- Adequate spacing must be maintained between adjacent interactive targets to prevent accidental activation.

### 8. Reflow and Zoom
- Content can be zoomed up to 200% without loss of content or functionality.
- Content can be viewed and operated in both portrait and landscape orientation unless a particular orientation is essential for the content's function.
- Content must reflow so users do not need to scroll in two dimensions at screen sizes as small as 320 CSS pixels wide (for vertically scrolling content) and 256 CSS pixels high (for horizontally scrolling content).
- Users must be able to increase text spacing to the following values without loss of content or functionality:
    - Line height to at least 1.5 times the font size.
    - Letter spacing to at least 0.12 times the font size.
    - Word spacing to at least 0.16 times the font size.
    - Paragraph spacing to at least 2 times the font size..

### 9. Motion and Sound
- Motion animations must respect the prefers-reduced-motion media query. When this preference is active, all non-essential animations must be suppressed or replaced with static alternatives.
- A mechanism must be provided to stop, pause, mute, or adjust volume for audio that automatically plays on a page for more than 3 seconds.
- Moving, blinking, or auto-scrolling content that starts automatically and lasts more than 5 seconds must have a mechanism to pause, stop, or hide the content.
- No content may flash more than 3 times in any 1-second period, or the flash must be below the general flash and red flash thresholds.
- No essential functionality may require complex or multipoint gestures (e.g., pinch, multi-finger swipe). A single-pointer alternative must always be available.
- Drag and drop functionality must have a keyboard-accessible and single-pointer alternative.
- All prerecorded videos with audio must have:
    - Synchronized captions.
    - Audio descriptions for visual content not conveyed in the existing audio track.
- All prerecorded audio-only content must have a text transcript.
- Live videos with audio must have real-time captions.
- If any functionality is triggered by motion actuation (e.g., shaking or tilting a device):
    - A UI component must be provided that performs the same function.
    - Users must be able to disable motion actuation to prevent accidental triggering.

### 10. Time limit
- When users are required to act within a limited time, at least one of the following must apply:
    - The user is allowed to turn off the time limit before encountering it.
    - The user is allowed to extend the time limit to at least 10 times the default before encountering it.
    - The user is warned before time expires and is given at least 20 seconds to extend the limit using a simple action (e.g., pressing the spacebar), and the user may extend the limit at least 10 times.
- Exceptions: Real-time events (e.g., auctions) and time limits longer than 20 hours are exempt. If a user's session expires, all data the user had entered must be preserved so no information is lost upon re-authentication

### 11. Content
- All content language must be inclusive, respectful, and person-first (e.g., "people with disabilities" rather than "disabled people," unless identity-first language is preferred by the community being referenced).
- Content should be understandable at a lower secondary education level (roughly 7th–9th grade, or ages 12–14). Where more complex language is necessary, supplementary explanations, glossaries, or simplified summaries must be provided. 
- Abbreviations and acronyms must be expanded on first use.
- Content must not require a specific reading direction unless the language itself requires it, and this must be programmatically indicated using the dir attribute.
- Status messages (e.g., "item added to cart," "form submitted successfully," "3 results found") must be programmatically determinable through role or properties so they can be presented to the user by assistive technologies without receiving focus.




### Accessibility Resources
Web Content Accessibility Guidelines (WCAG) 2.2
W3C | WAI | Introduction to Web Accessibility
W3C | WAI | How People with Disabilities Use the Web
W3C | WAI | Diverse Abilities and Barriers
WebAIM | Introduction to Accessibility
Google | Material Design System
Apple | Human Interface Guidelines
Microsoft | Inclusive Design

## Component-Specific Guidelines
Example: Dialog (Modal)

### HTML & Semantics
- Use the native HTML <dialog> element where possible. If a custom implementation is necessary, use a container element with role="dialog" or role="alertdialog" (for dialogs requiring an immediate user response, such as confirmations or error alerts).
- All content and interactive elements required to operate the modal must be descendants of the dialog container.

###ARIA (Roles, States, and Properties)
- The dialog container must have aria-modal="true" to indicate to assistive technologies that the content underneath the dialog is inert (not available for interaction).
- The dialog must have an accessible name:
    - Use aria-labelledby pointing to the id of the modal's visible title, or
    - Use aria-label if there is no visible title.
- (Optional) Use aria-describedby pointing to the id of the element containing the dialog's primary message or description.

### Keyboard Access and Focus Management

REQUIREMENT	DETAILS
Focus on Open	When the dialog opens, focus must automatically move into the modal. Initial focus should generally be set to the first focusable element or the least destructive action (e.g., a "Cancel" or "Close" button).
Focus Trap	Focus must be trapped within the dialog. Pressing Tab on the last focusable element loops focus back to the first, pressing Shift + Tab on the first loops to the last. Users must not be able to interact with the background page.
Dismissal	The user must be able to close the dialog by pressing the Escape key.
Focus on Close	When the dialog is closed or cancelled, focus must immediately return to the element that triggered the modal (e.g., the button that opened it).

### Color and Style
- The modal overlay/backdrop must not cause the focus indicator on elements within the dialog to fall below the 3:1 contrast ratio.
- Any close icon (e.g., "X" button) must meet the minimum 3:1 contrast ratio for UI components.

###Screen Reader Support
- Opening and closing the dialog should be announced by screen readers.
- The dialog's accessible name (title) should be the first thing read when focus enters the modal.
