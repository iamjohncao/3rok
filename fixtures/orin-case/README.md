# Orin fixture case

`records.json` is the demo data for 3rok. Upload it on a case's Data region. It is the public Jetson Orin evidence in [`docs/universal-data-input-guidelines.md`](../../docs/universal-data-input-guidelines.md), mapped to the nine record types. Nothing here is flight data.

## What each row is

| Rows | `value_status` | Where it comes from |
|---|---|---|
| Records 1 to 3 (`orin-*-identity`, `tid-*`, `see-*`) | `measured` | A figure the cited source reports: 42 krad(Si) under Co-60, 6 krad(Si) under 150 MeV protons, 19 krad(Si) first reported, 36.2 krad(Si) survived, and the 480 MeV proton cross-sections. A field the guidelines do not give is `not_reported`. |
| Record 6 (`env-dawn-dusk-suncatcher`) | `derived` | The Suncatcher preprint's estimate of about 150 rad(Si)/year for a shielded dawn-dusk orbit. It is a TPU study and it is not chip-specific, so the row says `not_chip_specific`. |
| Records 5 and 7 (`traj-*`, `place-*`) | `assumed` | Placeholders so a score has an orbit and a shield thickness to read. 650 km, sun-synchronous, 6 h LTAN, 5 mm Al, and the epoch are not from any source. Replace them. |
| Record 8 (`outcome-synthetic-*`) | `assumed`, `holdout` | Synthetic. They are not observations. No public on-orbit Orin outcome exists, so these two rows (a failure at 4.5 years and a survivor censored at 2 years) only give the holdout evaluator something to score. Replace them with real outcomes. |

Records 4 (thermal and electrical wear) and 9 (provenance) are empty on purpose. The guidelines give no Orin figure for wear, and provenance already sits on every row.

## Choose the chip

Open the case, find "Chips in this case", and check `nvidia_jetson_agx_orin`. That id is in `starmind-physics/starmind_physics/data/ai_chips.yaml`. `jetson_orin_nx` is not, so a score for it is refused.

## What is not here

- **No H100, Rubin, or Starmind lifetime.** Predictions for this case are Jetson-class. The Meta Llama 3 H100 interruption counts are not loaded as a row: an H100 outcome would be scored against an Orin lifetime, and it is a population count, not a time to failure.
- **No node.** The guidelines text calls Orin a 7 nm SoC. That is not carried into `node`, because the figure is not checked against the cited paper here. It is `not_reported` until someone confirms it.
- **Confidence intervals.** The UPC paper reports lower and upper bounds. They are not transcribed. The rows say so.

The rows hold the numbers. A PDF of a cited report can be attached to a row after the row is in the case.
