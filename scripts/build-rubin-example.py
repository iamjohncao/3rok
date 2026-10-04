#!/usr/bin/env python3
"""Writes the Rubin NVL72 example case: fixtures/rubin-nvl72-case/records.json and records.csv.

    python scripts/build-rubin-example.py        (needs starmind_physics and aep8)

No public radiation test data exists for NVIDIA Rubin or the Vera Rubin NVL72, and the physics package
says so. This is a format example, and every test and outcome row in it is synthetic and marked
`assumed`. The only computed rows are the two environment rows, which this script gets by running the
physics package at the example's own orbit, so they are `derived`.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from starmind_physics.config import load_params
from starmind_physics.dose import dose_rate_krad_per_year
from starmind_physics.flux import orbit_averaged_flux
from starmind_physics.orbit import sso_inclination_deg

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "rubin-nvl72-case"
README = "https://github.com/iamjohncao/3rok/blob/main/fixtures/rubin-nvl72-case/README.md"
PRESS = "https://mlq.ai/news/spacex-targets-fourth-quarter-2027-launch-for-nvidia-based-starmind-ai-satellites/"
PACKAGE_FLUX = "https://github.com/iamjohncao/3rok/blob/main/starmind-physics/starmind_physics/flux.py"
PACKAGE_DOSE = "https://github.com/iamjohncao/3rok/blob/main/starmind-physics/starmind_physics/dose.py"

FAMILY = "Rubin"
PART = "Vera Rubin NVL72"
ALTITUDE_KM = 700
LTAN_H = 6
SHIELD_MM = 5.0


def row(record_id, record_type, test_or_model, body, *, split="train", status="assumed", url=README,
        family=FAMILY, part=PART, stress=None):
    return {
        "record_id": record_id,
        "record_type": record_type,
        "chip_family": family,
        "part_number": part,
        "test_or_model": test_or_model,
        "particle_or_stress": stress,
        "split": split,
        "source_url": url,
        "value_status": status,
        "body": body,
    }


def environment_rows():
    params = load_params()
    inclination = sso_inclination_deg(ALTITUDE_KM, params)
    flux = orbit_averaged_flux(ALTITUDE_KM, inclination, params)
    proton, electron = flux["proton_flux_cm2_s"], flux["electron_flux_cm2_s"]
    dose = dose_rate_krad_per_year(proton, electron, SHIELD_MM, params)["dose_rate_krad_Si_per_year"]
    epoch = params["orbit_sampling"]["epoch_utc"]
    return [
        row(
            "env-ap8ae8-700km-sso-orbit-average",
            "environment",
            "AP8/AE8 orbit-averaged flux from the physics package",
            {
                "model": "AP8/AE8 via aep8 (starmind_physics.flux.orbit_averaged_flux)",
                "version": f"aep8, solar {params['flux']['solar']}, epoch {epoch}",
                "mode": f"orbit average, {flux['n_samples']} samples, {ALTITUDE_KM} km, sun-synchronous ({inclination:.2f} deg)",
                "percentile": "not_applicable, a static model",
                "energies": f"protons above {params['flux']['proton_energy_MeV']:g} MeV, electrons above {params['flux']['electron_energy_MeV']:g} MeV",
                "shielding": "none applied",
                "units": "cm-2 s-1, integral flux",
                "flux": f"protons {proton:.2f}, electrons {electron:.1f}",
            },
            status="derived",
            url=PACKAGE_FLUX,
            family="not_chip_specific",
            part="not_chip_specific",
        ),
        row(
            "env-dose-rate-700km-sso-5mm-al",
            "environment",
            "Dose rate behind 5 mm Al from the physics package",
            {
                "model": "starmind_physics.dose.dose_rate_krad_per_year, an exponential fallback and not SHIELDOSE-2",
                "version": "params.yaml dose coefficients, which are assumed",
                "mode": f"orbit average, {ALTITUDE_KM} km, sun-synchronous",
                "percentile": "not_applicable, a static model",
                "energies": f"protons above {params['flux']['proton_energy_MeV']:g} MeV, electrons above {params['flux']['electron_energy_MeV']:g} MeV",
                "shielding": f"{SHIELD_MM:g} mm Al",
                "units": "krad(Si)/year",
                "dose": f"{dose:.4f} krad(Si)/year",
            },
            status="derived",
            url=PACKAGE_DOSE,
            family="not_chip_specific",
            part="not_chip_specific",
        ),
    ]


def records():
    out = [
        row(
            "rubin-nvl72-identity",
            "chip-identity",
            "Synthetic example, not a test",
            {
                "chip_id": "nvidia_vera_rubin_nvl72",
                "node": "not_reported",
                "die_area": "not_reported",
                "level_tested": "synthetic: a rack cannot go in a beam, so the rows below pretend a GPU board was",
                "memory_ecc": "HBM, ECC not_reported",
                "serials": "not_reported",
                "date_code": "not_reported",
                "note": "The press link ties Starmind to a Vera Rubin NVL72 only through secondary reports. NVIDIA has published no radiation data for it.",
            },
            url=PRESS,
        ),
        row(
            "tid-synth-hbm-co60",
            "tid",
            "Synthetic example: Co-60 total dose, HBM stack",
            {
                "source": "Co-60",
                "energy": "1.17 and 1.33 MeV gamma lines",
                "dose_rate": "36 krad(Si)/h",
                "bias": "worst case, held within 10%",
                "temperature": "25 C",
                "dose_steps": "0.5, 1, 2, 3, 5 krad(Si)",
                "failure_dose": "2.2 krad(Si)",
                "failure_mode": "HBM read-error rate rises above its limit",
                "anneal": "168 h at 100 C",
            },
            stress="Co-60",
        ),
        row(
            "tid-synth-regulators-protons",
            "tid",
            "Synthetic example: 150 MeV proton total dose, power regulators",
            {
                "source": "protons",
                "energy": "150 MeV",
                "dose_rate": "not_reported",
                "bias": "worst case, held within 10%",
                "temperature": "25 C",
                "dose_steps": "1, 2, 4, 6 krad(Si)",
                "failure_dose": "3.5 krad(Si)",
                "failure_mode": "a power stage drifts out of regulation before the logic is affected",
                "anneal": "not_reported",
            },
            stress="proton",
        ),
        row(
            "tid-synth-gpu-die-co60",
            "tid",
            "Synthetic example: Co-60 total dose, GPU die logic",
            {
                "source": "Co-60",
                "energy": "1.17 and 1.33 MeV gamma lines",
                "dose_rate": "36 krad(Si)/h",
                "bias": "worst case, held within 10%",
                "temperature": "25 C",
                "dose_steps": "2, 5, 8, 11, 15 krad(Si)",
                "failure_dose": "11 krad(Si)",
                "failure_mode": "leakage current rises and timing margin closes",
                "anneal": "168 h at 100 C",
            },
            stress="Co-60",
        ),
        row(
            "tid-synth-board-low-rate",
            "tid",
            "Synthetic example: low-dose-rate Co-60, board",
            {
                "source": "Co-60",
                "energy": "1.17 and 1.33 MeV gamma lines",
                "dose_rate": "100 rad(Si)/h",
                "bias": "worst case, held within 10%",
                "temperature": "25 C",
                "dose_steps": "0.5, 1, 1.5, 2, 3 krad(Si)",
                "failure_dose": "not_reached",
                "failure_mode": "not_applicable",
                "anneal": "not_reported",
                "survived_past": "3 krad(Si)",
            },
            stress="Co-60",
        ),
        row(
            "see-synth-proton-200mev",
            "see",
            "Synthetic example: 200 MeV proton single-event effects",
            {
                "particle": "proton",
                "energy": "200 MeV",
                "let": "not_applicable",
                "tilt": "0 deg",
                "flux": "1e6 p/cm2/s",
                "fluence": "1e10 p/cm2",
                "events_by_type": "SEU 14, SEFI 3, SEL 0",
                "cross_section": "SEU 1.4e-9 cm2 per device, SEFI 3.0e-10 cm2 per device",
                "confidence_interval": "not_reported",
                "power_mode": "full power",
                "workload": "transformer inference",
                "sdc_count": "2",
            },
            stress="proton",
        ),
        row(
            "see-synth-heavy-ion-kr",
            "see",
            "Synthetic example: krypton heavy-ion single-event effects",
            {
                "particle": "Kr",
                "energy": "not_reported",
                "let": "37 MeV cm2/mg",
                "tilt": "0 deg",
                "flux": "1e4 ions/cm2/s",
                "fluence": "1e7 ions/cm2",
                "events_by_type": "SEU 31, SEFI 5, SEL 0",
                "cross_section": "SEU 3.1e-6 cm2 per device",
                "confidence_interval": "not_reported",
                "power_mode": "full power",
                "workload": "idle",
                "sdc_count": "not_observable",
            },
            stress="heavy-ion",
        ),
        row(
            "see-synth-proton-64mev-sdc",
            "see",
            "Synthetic example: 64 MeV proton, silent data corruption under load",
            {
                "particle": "proton",
                "energy": "64 MeV",
                "let": "not_applicable",
                "tilt": "0 deg",
                "flux": "5e5 p/cm2/s",
                "fluence": "2e9 p/cm2",
                "events_by_type": "SEU 9, SEFI 1",
                "cross_section": "not_reported",
                "confidence_interval": "not_reported",
                "power_mode": "full power",
                "workload": "dense matrix multiply",
                "sdc_count": "1 per 30 rad(Si)",
            },
            stress="proton",
        ),
        row(
            "thermal-synth-cycling",
            "thermal-wear",
            "Synthetic example: thermal cycling",
            {
                "junction_temperature": "-40 C to 105 C",
                "power": "synthetic, 1.0 kW per module",
                "voltage": "synthetic, 0.8 V core",
                "cycle_profile": "-40 C to 105 C, 4 cycles per day, 90 min dwell",
                "time_to_failure": "not_reached in 1500 cycles",
                "mechanism": "solder fatigue, none observed",
                "activation_energy": "not_applicable",
            },
            stress="thermal-cycle",
        ),
        row(
            "thermal-synth-arrhenius",
            "thermal-wear",
            "Synthetic example: high-temperature operating life",
            {
                "junction_temperature": "105 C",
                "power": "synthetic, 1.0 kW per module",
                "voltage": "synthetic, 0.8 V core",
                "cycle_profile": "steady state",
                "time_to_failure": "not_reached in 5000 h",
                "mechanism": "electromigration, none observed",
                "activation_energy": "0.7 eV",
            },
            stress="thermal-cycle",
        ),
        row(
            "traj-synth-sso-700",
            "trajectory",
            "Placeholder dawn-dusk sun-synchronous orbit",
            {
                "altitude_km": ALTITUDE_KM,
                "inclination": "sun-synchronous",
                "eccentricity": 0,
                "ltan_hours": LTAN_H,
                "epoch": "2027-01-01T00:00:00Z",
                "duration": "5 years",
            },
        ),
        *environment_rows(),
        row(
            "place-synth-a1",
            "placement",
            "Placeholder placement",
            {
                "location": "A1, a synthetic tray",
                "shielding_material": "Al",
                "shielding_thickness": f"{SHIELD_MM:g} mm",
                "shield_mm_Al": SHIELD_MM,
                "thermal_coupling": "not_reported",
            },
        ),
        row(
            "outcome-synth-field-log",
            "outcome",
            "Synthetic example: a field log, still running (train)",
            {
                "time_window": "5 years",
                "position_reference": "traj-synth-sso-700",
                "upsets": "not_reported",
                "resets": "not_reported",
                "uncorrectable_ecc": "not_reported",
                "temperatures": "not_reported",
                "censor_time_years": 5,
            },
        ),
        row(
            "outcome-synth-failure-a",
            "outcome",
            "Synthetic example: failure, not an observation",
            {
                "time_window": "24 years",
                "position_reference": "traj-synth-sso-700",
                "upsets": "not_reported",
                "resets": "not_reported",
                "uncorrectable_ecc": "not_reported",
                "temperatures": "not_reported",
                "failure_time_years": 24,
            },
            split="holdout",
        ),
        row(
            "outcome-synth-failure-b",
            "outcome",
            "Synthetic example: failure, not an observation",
            {
                "time_window": "31 years",
                "position_reference": "traj-synth-sso-700",
                "upsets": "not_reported",
                "resets": "not_reported",
                "uncorrectable_ecc": "not_reported",
                "temperatures": "not_reported",
                "failure_time_years": 31,
            },
            split="holdout",
        ),
        row(
            "outcome-synth-survivor-a",
            "outcome",
            "Synthetic example: survivor, not an observation",
            {
                "time_window": "10 years",
                "position_reference": "traj-synth-sso-700",
                "upsets": "not_reported",
                "resets": "not_reported",
                "uncorrectable_ecc": "not_reported",
                "temperatures": "not_reported",
                "censor_time_years": 10,
            },
            split="holdout",
        ),
        row(
            "outcome-synth-survivor-b",
            "outcome",
            "Synthetic example: survivor, not an observation",
            {
                "time_window": "18 years",
                "position_reference": "traj-synth-sso-700",
                "upsets": "not_reported",
                "resets": "not_reported",
                "uncorrectable_ecc": "not_reported",
                "temperatures": "not_reported",
                "censor_time_years": 18,
            },
            split="holdout",
        ),
        row(
            "prov-synthetic-notice",
            "provenance",
            "Notice: this case is a format example",
            {
                "source": "Written for 3rok to show the nine record types. No test was run and no part was flown.",
                "standard": "docs/universal-data-input-guidelines.md record layout",
                "facility": "none",
                "date": "2026-10-04",
                "units": "as stated in each row",
                "note": "Every row marked assumed is synthetic. The two rows marked derived are the physics package's own output at this orbit.",
            },
            family="not_chip_specific",
            part="not_chip_specific",
        ),
    ]
    return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    data = records()
    (OUT / "records.json").write_text(json.dumps({"records": data}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    columns = ["record_id", "record_type", "chip_family", "part_number", "test_or_model", "particle_or_stress", "split", "source_url", "value_status", "body"]
    with (OUT / "records.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        writer.writeheader()
        for item in data:
            flat = dict(item)
            flat["particle_or_stress"] = item["particle_or_stress"] or ""
            flat["body"] = json.dumps(item["body"], ensure_ascii=False)
            writer.writerow(flat)
    print(f"wrote {len(data)} records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
