# Rubin NVL72 example case

`records.json` is an example dataset for 3rok. Upload it on a case's Data region (`records.csv` holds the same rows, for a spreadsheet). It shows all nine record types for an NVIDIA Vera Rubin NVL72.

**It is not NVIDIA test data. No public radiation test data exists for Rubin or the Vera Rubin NVL72.** The physics package says so (`starmind-physics/starmind_physics/data/ai_chips.yaml`), and so does this repo's plan. Every test and outcome row here is synthetic. Nothing in it is `measured`.

## What each row is

| Rows | `value_status` | What they are |
|---|---|---|
| `rubin-nvl72-identity` | `assumed` | The chip. `chip_id` is `nvidia_vera_rubin_nvl72`, the id the physics package knows. The link cites a secondary press report that ties Starmind to this part. NVIDIA published no radiation data for it. |
| `tid-synth-*` (4 rows) | `assumed` | Synthetic total-dose tests: HBM stack 2.2 krad(Si), power regulators 3.5 krad(Si) under protons, GPU die 11 krad(Si), and a low-dose-rate board test that survived past 3 krad(Si). The shape follows the ESCC 22900 fields. The numbers are invented. |
| `see-synth-*` (3 rows) | `assumed` | Synthetic single-event tests: 200 MeV protons, krypton ions at LET 37, and 64 MeV protons with silent data corruption under load. The numbers are invented. |
| `thermal-synth-*` (2 rows) | `assumed` | Synthetic thermal cycling and high-temperature life, no failure reached. |
| `traj-synth-sso-700` | `assumed` | A placeholder orbit: 700 km, sun-synchronous, 6 h LTAN. Replace it. |
| `env-*` (2 rows) | `derived` | The only computed rows. `scripts/build-rubin-example.py` ran the physics package at this orbit: orbit-averaged AP8/AE8 flux (protons 63.09 and electrons 4083.8 per cm² per second), and the dose rate behind 5 mm of aluminium, 0.1212 krad(Si)/year. The dose coefficients are assumed in `params.yaml`, and the row says so. |
| `place-synth-a1` | `assumed` | A placeholder: 5 mm of aluminium. The platform reads `shield_mm_Al` from here. |
| `outcome-synth-*` (5 rows) | `assumed` | Synthetic outcomes. One is in the train split (a field log, still running at 5 years). Four are in the holdout split: failures at 24 and 31 years, survivors censored at 10 and 18 years. They are not observations. They are placed so the evaluator has something to score and room to improve. |
| `prov-synthetic-notice` | `assumed` | A provenance row that says this case is a format example. |

Holdout rows are visible to you on the case screen and are never sent to Grok.

## Use it

1. Create a case, then upload `records.json` (or `records.csv`) in the Data region. It saves 20 records.
2. Under "Chips in this case", check `nvidia_vera_rubin_nvl72`.
3. Ask Grok for a trajectory. The evaluator reduces the proposed OEM to an altitude and an inclination, asks the physics service for a lifetime at the case's 6 h LTAN and 5 mm shield, and compares it with the four holdout outcomes.

## What to expect

The physics package ranks this chip at about **16.5 years** at 700 km sun-synchronous, 6 h LTAN, 5 mm Al, limited by total dose. The limit it uses is **2 krad(Si), which is an assumption**: the package has no Rubin number, so it borrows the commercial analogue. The 16.5 years is a ranking under assumed coefficients. It is not a Rubin flight lifetime.

Against this case's holdout rows, that baseline scores a mean error of **5.88 years**. Orbits near 610 to 640 km sun-synchronous, which the package ranks at about 25 to 29 years, score **1.75**, the lowest this synthetic set allows. The evaluator keeps a revision only if its error falls, so the evaluator rewards a lifetime that matches the outcomes, not the longest lifetime. That is why the best synthetic answer sits between the two failures and not at 79 years.

The package only scores orbits from 500 to 2000 km at 30 degrees or sun-synchronous. The orbit is not read from the `traj-synth-sso-700` row: that row is a placeholder, and the proposed OEM sets the orbit.

## Replace it with your own

Keep the row layout and swap in your data. A value a source does not give is written `not_reported`. A real test row uses `measured` and cites its report. Real outcomes replace the five `outcome-synth-*` rows. A shield thickness and LTAN that the case does not state refuse the score. Nothing is filled in.

## Regenerate

```
python scripts/build-rubin-example.py
```

It needs `starmind_physics` and `aep8`, and it rewrites both files and the two `derived` environment rows.
