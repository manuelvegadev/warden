# Landing page design (Claude Design canvas)

Source of the landing page mockup that `landing/` implements. Authored as a Claude Design
"Design Component" (`landing.dc.html`): plain HTML with Beacon's tokens inlined, `{{ holes }}`,
`<sc-for>` / `<sc-if>` blocks and a small `DCLogic` class that simulates the panel (console feed,
sparklines, sections, instance switcher). `canvas.json` is the artboard layout.

The file renders only inside the Claude Design canvas editor; it is kept here as the design
reference, not as a web page. The final implementation lives in `landing/` and is the source of
truth once it diverges.
