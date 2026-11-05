// The colour radio screens EdgeTX supports. `fonts` is which of EdgeTX's three font sets the firmware builds in for that screen
// (radio/src/fonts/CMakeLists.txt: 320x240 -> sml, 800x480 -> lrg, everything else -> std). `yaapu` is the matching Yaapu folder.
export const SCREENS = {
  '480x272': { name: 'TX16S / 480x272', w: 480, h: 272, fonts: 'std', yaapu: 'c480x272' },
  '480x320': { name: 'TX15 / 480x320', w: 480, h: 320, fonts: 'std', yaapu: 'c480x320' },
  '800x480': { name: 'T15 Pro / 800x480', w: 800, h: 480, fonts: 'lrg', yaapu: 'c800x480' },
  '320x240': { name: 'NV14 / 320x240', w: 320, h: 240, fonts: 'sml', yaapu: 'c320x240' },
  '320x480': { name: 'Portrait 320x480', w: 320, h: 480, fonts: 'std', yaapu: 'c320x480' },
};
export const DEFAULT_SCREEN = '480x272';
