flux-grid.bin and flux-grid.json

AE8/AP8 trapped-particle integral flux from the physics package, for the placement-score layer on
/test. Written by scripts/build-flux-grid.py from starmind_physics.flux.latlon_flux_grid:
protons above 10 MeV and electrons above 1 MeV, a 3 degree longitude and latitude grid, altitudes
from 500 to 2000 km in 100 km steps, solar maximum, at the epoch in params.yaml. Nothing is fitted
or smoothed. flux-grid.json lists the axes, the model, and the dose coefficients, which the package
marks as assumed.

Regenerate after a change to the package's flux model or dose coefficients:

    python scripts/build-flux-grid.py        (needs starmind_physics and aep8)

then commit these two files and fixtures/dose-rate-expected.json, and run `npm test`.
