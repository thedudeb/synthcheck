export const DEFACTIFY = {
  dataset: "Rajarshi-Roy-research/Defactify_Image_Dataset",
  revision: "787334f7857fa54f29027a7f09c30e895ad486ef",
  config: "default",
  sourceNames: {
    0: "real",
    1: "sd21",
    2: "sdxl",
    3: "sd3",
    4: "dalle3",
    5: "midjourney6",
  } satisfies Record<number, string>,
} as const;

export const DEFAULT_SAMPLE = {
  split: "validation",
  real: 250,
  perSyntheticSource: 50,
} as const;
