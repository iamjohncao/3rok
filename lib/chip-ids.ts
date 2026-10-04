// The chip ids the physics package knows: `id` under `chips:` in
// starmind-physics/starmind_physics/data/ai_chips.yaml. A copy, so the holdout lane can
// refuse a chip the ranker would refuse without a service call. lib/chip-ids.test.ts reads
// the YAML and fails if this list and the file disagree. Edit the YAML's list in the package
// (never move the package), then update this one.

export const KNOWN_CHIP_IDS: ReadonlySet<string> = new Set([
  "nvidia_vera_rubin_nvl72",
  "nvidia_rubin_gpu_die",
  "google_trillium_tpu_v6e",
  "google_tpu_v5e",
  "google_tpu_v5p",
  "nvidia_h100",
  "nvidia_b200",
  "nvidia_gb200_nvl72",
  "amd_instinct_mi300x",
  "amd_instinct_mi350",
  "intel_gaudi3",
  "amazon_trainium2",
  "microsoft_maia_100",
  "meta_mtia",
  "cerebras_wafer_scale",
  "groq_lpu",
  "tenstorrent_wormhole",
  "sambanova_sn40",
  "nvidia_jetson_agx_orin",
  "qualcomm_cloud_ai_100",
  "bae_rad750",
  "bae_rad5545",
  "amd_versal_xqr",
  "microchip_rt_polarfire",
  "frontgrade_gr740",
]);

/** The two preset names `score_candidate` takes in place of a chip id. */
export const CHIP_PRESETS = ["commercial", "rad_hard"] as const;
export type ChipPreset = (typeof CHIP_PRESETS)[number];
