import JSZip from 'jszip';

const DEFAULT_PALETTE = {
  dark: '24183B', paper: 'FCFBFF', rail: '8B6DE8',
  ink: '211936', muted: '675C7E', accent: '6745DC',
  darkInk: 'F9F5FF', darkMuted: 'E4D9F9', darkAccent: 'C9B6FF',
  darkLine: '594779', rings: '8261BE', lightLine: 'E4DCF4', card: 'F1ECFB',
  font: 'Microsoft YaHei',
};

const colorPattern = /^[\da-f]{6}$/i;
const fontPattern = /^[\p{L}\p{N} _+-]{1,60}$/u;

function elementNamed(node, name) {
  return node?.getElementsByTagNameNS('*', name)[0];
}

function schemeColor(scheme, name) {
  const color = elementNamed(scheme, name)?.firstElementChild;
  const value = color?.getAttribute(color.localName === 'sysClr' ? 'lastClr' : 'val');
  return colorPattern.test(value ?? '') ? value.toUpperCase() : null;
}

export async function readPptxTemplate(file) {
  if (!file || !/\.pptx$/i.test(file.name)) throw new Error('请选择 PowerPoint（.pptx）模板。');
  if (file.size > 20 * 1024 * 1024) throw new Error('请选用 20 MB 以内的模板。');
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('无法读取这个 PPTX 文件，请在 PowerPoint 或 WPS 中重新另存后再试。');
  }
  const theme = zip.file('ppt/theme/theme1.xml') ?? zip.file(/^ppt\/theme\/theme\d+\.xml$/)[0];
  const presentation = zip.file('ppt/presentation.xml');
  if (!theme || !presentation) throw new Error('文件缺少可读取的幻灯片主题。');
  const xml = new DOMParser().parseFromString(await theme.async('string'), 'application/xml');
  const scheme = elementNamed(xml, 'clrScheme');
  const accent = schemeColor(scheme, 'accent1');
  if (!accent) throw new Error('这个主题里没有可读取的主色。');
  const minor = elementNamed(xml, 'minorFont');
  const chinese = Array.from(minor?.getElementsByTagNameNS('*', 'font') ?? [])
    .find((node) => node.getAttribute('script') === 'Hans')?.getAttribute('typeface');
  const font = chinese || elementNamed(minor, 'ea')?.getAttribute('typeface')
    || elementNamed(minor, 'latin')?.getAttribute('typeface');
  return {
    name: file.name.replace(/\.pptx$/i, ''), accent,
    dark: schemeColor(scheme, 'dk2') ?? schemeColor(scheme, 'dk1'),
    paper: schemeColor(scheme, 'lt1'),
    font: fontPattern.test(font ?? '') ? font : null,
  };
}

function mix(a, b, amount) {
  return [0, 2, 4].map((index) => {
    const start = Number.parseInt(a.slice(index, index + 2), 16);
    const end = Number.parseInt(b.slice(index, index + 2), 16);
    return Math.round(start + (end - start) * amount).toString(16).padStart(2, '0').toUpperCase();
  }).join('');
}

function luminance(color) {
  return [0, 2, 4].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

export function slidePalette(template) {
  if (!template || !colorPattern.test(template.accent)) return DEFAULT_PALETTE;
  const dark = colorPattern.test(template.dark ?? '')
    ? (luminance(template.dark) < 0.17 ? template.dark : mix(template.dark, '111111', 0.66))
    : DEFAULT_PALETTE.dark;
  const paper = colorPattern.test(template.paper ?? '') && luminance(template.paper) > 0.74
    ? template.paper : 'FAFAFA';
  const accent = mix(template.accent, dark, 0.36);
  return {
    dark, paper, rail: template.accent,
    ink: dark, muted: mix(dark, paper, 0.31), accent,
    darkInk: 'FFFFFF', darkMuted: mix(dark, 'FFFFFF', 0.83), darkAccent: mix(template.accent, 'FFFFFF', 0.51),
    darkLine: mix(dark, template.accent, 0.55), rings: mix(dark, template.accent, 0.70),
    lightLine: mix(paper, template.accent, 0.23), card: mix(paper, template.accent, 0.10),
    font: fontPattern.test(template.font ?? '') ? template.font : DEFAULT_PALETTE.font,
  };
}

export async function embedTheme(zip, palette) {
  const path = 'ppt/theme/theme1.xml';
  const entry = zip.file(path);
  if (!entry) return;
  const theme = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  const scheme = elementNamed(theme, 'clrScheme');
  const colors = { dk1: palette.dark, dk2: palette.dark, lt1: palette.paper, accent1: palette.rail };
  for (const [name, rgb] of Object.entries(colors)) {
    const color = elementNamed(scheme, name)?.firstElementChild;
    if (color) color.setAttribute(color.localName === 'sysClr' ? 'lastClr' : 'val', rgb);
  }
  for (const name of ['majorFont', 'minorFont']) {
    const font = elementNamed(theme, name);
    elementNamed(font, 'latin')?.setAttribute('typeface', palette.font);
    elementNamed(font, 'ea')?.setAttribute('typeface', palette.font);
    const hans = Array.from(font?.getElementsByTagNameNS('*', 'font') ?? [])
      .find((node) => node.getAttribute('script') === 'Hans');
    hans?.setAttribute('typeface', palette.font);
  }
  zip.file(path, new XMLSerializer().serializeToString(theme));
}
