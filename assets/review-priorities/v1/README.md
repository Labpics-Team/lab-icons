# Review priority badges

Public, immutable vector assets for GitHub review comments from Laborant.

These are badges, not icons in the @labpics/icons package. They stay outside
svg/, src/, icon exports and Lab UI design system. No npm or runtime dependency.

- P0–P3 follow HIG semantic red, orange, yellow and blue; IDEA uses gray.
- Each status has light/dark muted backgrounds, a subtle border and foreground
  contrast above 4.5:1. These are HIG-derived colors, not Apple system color APIs.
- Fixed geometry: 34 × 22 pixels for P0–P3, 52 × 22 for IDEA; radius 8.
- No shadow, SVG filters, scripts, remote font, CSS or runtime resources.
- Letterforms are fixed vector outlines derived from Nunito Rounded, licensed
  under SIL OFL 1.1 (see OFL.txt). Apple's SF Pro Rounded is reserved for
  system use and is not embedded or reproduced.
- Consumer uses width, height 22, align middle and theme selection in picture.

Design: https://developer.apple.com/design/human-interface-guidelines/color
Fonts: https://developer.apple.com/documentation/technologyoverviews/fonts
Nunito: https://github.com/google/fonts/tree/main/ofl/nunito
Downloaded font sha256: bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207

GitHub Camo cannot fetch images from a private Laborant repository. This public
repo is the sole asset owner. Consumers pin exact Git commit SHA URLs.
No extra server or CI workflow is introduced.
