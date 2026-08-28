# Sketch 003 — Editorial / morning briefing

## Design stance
Treat the home screen like the weekly brief it generates. Headline, dek, prose summary with verified figures, then the supporting evidence. The CEO reads a story; the charts are footnotes.

## Key choices
- Layout: dateline + headline → verified briefing card → figure row → "what moved" list → chart → top posts
- Single-column, 760px measure, print-like typography (stone palette, small radii)
- The verification line is on the brief card itself: "9 of 9 figures traced to source"
- Every signal written as a sentence, not a metric chip

## Trade-offs
- Strong at: the CEO demo; the "artifact" use case; matches the verified-brief differentiator
- Weak at: power users who want the dashboard — prose costs scroll depth
- The prose summary is only as good as the generator; needs a "Open analytics view" escape hatch (included at the bottom)

## Best for
The demo. Also the strongest case that this tool is not Rival IQ: nobody else writes the morning story from verified numbers.
