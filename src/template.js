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
const templateExtension = /\.(?:pptx|potx)$/i;
const colorAliases = { bg1: 'lt1', bg2: 'lt2', tx1: 'dk1', tx2: 'dk2' };

function elementNamed(node, name) {
  return node?.getElementsByTagNameNS('*', name)[0];
}

function childNamed(node, name) {
  return Array.from(node?.children ?? []).find((child) => child.localName === name);
}

function rgb(color) {
  if (color?.localName !== 'srgbClr' && color?.localName !== 'sysClr') return null;
  const value = color.getAttribute(color.localName === 'sysClr' ? 'lastClr' : 'val');
  return colorPattern.test(value ?? '') ? value.toUpperCase() : null;
}

function schemeColor(scheme, name) {
  return rgb(childNamed(scheme, name)?.firstElementChild);
}

function solidColor(element, scheme, mappings) {
  const color = childNamed(element, 'solidFill')?.firstElementChild;
  if (color?.localName !== 'schemeClr') return rgb(color);
  const name = color.getAttribute('val');
  const mapped = mappings.map((mapping) => mapping?.getAttribute(name)).find(Boolean);
  return schemeColor(scheme, mapped ?? colorAliases[name] ?? name);
}

function packageReader(zip) {
  const parser = new DOMParser();
  const documents = new Map();
  function xml(path) {
    const entry = path && zip.file(path);
    if (!entry) return Promise.resolve(null);
    if (!documents.has(path)) {
      documents.set(path, entry.async('string').then((data) => {
        const parsed = parser.parseFromString(data, 'application/xml');
        return elementNamed(parsed, 'parsererror') ? null : parsed;
      }));
    }
    return documents.get(path);
  }
  async function relatedPart(path, type, id) {
    if (!path) return null;
    const split = path.lastIndexOf('/') + 1;
    const directory = path.slice(0, split);
    const relationships = await xml(`${directory}_rels/${path.slice(split)}.rels`);
    const relationship = Array.from(relationships?.documentElement?.children ?? []).find((item) =>
      item.getAttribute('Type')?.endsWith(`/${type}`) && (!id || item.getAttribute('Id') === id)
      && item.getAttribute('TargetMode') !== 'External');
    const target = relationship?.getAttribute('Target');
    if (!target) return null;
    try {
      const resolved = new URL(target, `https://package.invalid/${path}`);
      return resolved.hostname === 'package.invalid' ? decodeURIComponent(resolved.pathname.slice(1)) : null;
    } catch {
      return null;
    }
  }
  return { xml, relatedPart };
}

function partId(element) {
  return Array.from(element?.attributes ?? []).find((attribute) => attribute.localName === 'id' && attribute.namespaceURI)?.value;
}

function explicitAccent(documents, background, size) {
  for (const document of documents) {
    const tree = elementNamed(document, 'spTree');
    for (const shape of tree?.getElementsByTagNameNS('*', 'sp') ?? []) {
      const properties = childNamed(shape, 'spPr');
      const dimensions = childNamed(childNamed(properties, 'xfrm'), 'ext');
      if (Number(dimensions?.getAttribute('cx')) > size.width * 0.65
          && Number(dimensions?.getAttribute('cy')) > size.height * 0.65) continue;
      const fill = childNamed(properties, 'solidFill')?.firstElementChild;
      const line = childNamed(childNamed(properties, 'ln'), 'solidFill')?.firstElementChild;
      for (const color of [fill, line]) {
        const value = rgb(color);
        if (!value || value === background) continue;
        const alpha = childNamed(color, 'alpha');
        if (alpha && Number(alpha.getAttribute('val')) < 50000) continue;
        const channels = value.match(/../g).map((hex) => parseInt(hex, 16));
        if (Math.max(...channels) - Math.min(...channels) >= 35) return value;
      }
    }
  }
  return null;
}

function slideBackground(documents, scheme, mappings) {
  for (const document of documents) {
    const bg = childNamed(elementNamed(document, 'cSld'), 'bg');
    const value = solidColor(childNamed(bg, 'bgPr'), scheme, mappings);
    if (value) return value;
  }
  return null;
}

function textStyle(documents, scheme, mappings) {
  let font = null;
  let foreground = null;
  for (const document of documents) {
    const tree = elementNamed(document, 'spTree');
    for (const run of tree?.getElementsByTagNameNS('*', 'rPr') ?? []) {
      const name = childNamed(run, 'ea')?.getAttribute('typeface') || childNamed(run, 'latin')?.getAttribute('typeface');
      if (!font && fontPattern.test(name ?? '')) font = name;
      foreground ??= solidColor(run, scheme, mappings);
      if (font && foreground) return { font, foreground };
    }
  }
  return { font, foreground };
}

export async function readPptxTemplate(file) {
  if (!file || !templateExtension.test(file.name)) throw new Error('请选择 .pptx 或 .potx 文件。');
  if (file.size > 50 * 1024 * 1024) throw new Error('请选用 50 MB 以内的模板。');
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('无法读取文件，请在 PowerPoint 或 WPS 中另存为 .pptx 后再试。');
  }
  const { xml, relatedPart } = packageReader(zip);
  const presentationPath = 'ppt/presentation.xml';
  const presentation = await xml(presentationPath);
  if (!presentation) throw new Error('文件缺少可读取的幻灯片数据。');
  const slides = elementNamed(presentation, 'sldIdLst')?.children;
  const firstSlide = slides?.[0];
  const firstMaster = elementNamed(presentation, 'sldMasterIdLst')?.firstElementChild;
  const coverPath = firstSlide ? await relatedPart(presentationPath, 'slide', partId(firstSlide)) : null;
  const bodyPath = slides?.[1] ? await relatedPart(presentationPath, 'slide', partId(slides[1])) : coverPath;
  const [coverLayoutPath, bodyLayoutPath, defaultMasterPath] = await Promise.all([
    relatedPart(coverPath, 'slideLayout'), relatedPart(bodyPath, 'slideLayout'),
    relatedPart(presentationPath, 'slideMaster', partId(firstMaster)),
  ]);
  const [coverMasterPath, bodyMasterPath] = await Promise.all([
    relatedPart(coverLayoutPath, 'slideMaster'), relatedPart(bodyLayoutPath, 'slideMaster'),
  ]);
  const masterPath = bodyMasterPath ?? coverMasterPath ?? defaultMasterPath;
  const coverMaster = coverMasterPath ?? masterPath;
  const primaryTheme = await relatedPart(masterPath, 'theme');
  const coverTheme = coverMaster === masterPath ? primaryTheme : await relatedPart(coverMaster, 'theme');
  const themeFallback = zip.file(/^ppt\/theme\/theme\d*\.xml$/i)[0]?.name;
  const [theme, coverThemeDocument, cover, coverLayout, coverMasterDocument, body, bodyLayout, bodyMaster] = await Promise.all([
    xml(primaryTheme ?? themeFallback), xml(coverTheme ?? themeFallback),
    xml(coverPath), xml(coverLayoutPath), xml(coverMaster), xml(bodyPath), xml(bodyLayoutPath), xml(masterPath),
  ]);
  const scheme = elementNamed(theme, 'clrScheme');
  const coverScheme = elementNamed(coverThemeDocument, 'clrScheme') ?? scheme;
  const coverDocuments = [cover, coverLayout, coverMasterDocument];
  const bodyDocuments = [body, bodyLayout, bodyMaster];
  const colorMapping = (documents) => documents.map((document) =>
    elementNamed(document, 'overrideClrMapping') ?? childNamed(document?.documentElement, 'clrMap'));
  const coverMappings = colorMapping(coverDocuments);
  const bodyMappings = colorMapping(bodyDocuments);
  const coverBackground = slideBackground(coverDocuments, coverScheme, coverMappings);
  const bodyBackground = slideBackground(bodyDocuments, scheme, bodyMappings);
  const dimensions = elementNamed(presentation, 'sldSz');
  const size = { width: Number(dimensions?.getAttribute('cx')) || 12192000, height: Number(dimensions?.getAttribute('cy')) || 6858000 };
  const accent = explicitAccent(bodyDocuments, bodyBackground, size)
    ?? explicitAccent(coverDocuments, coverBackground, size) ?? schemeColor(scheme, 'accent1');
  if (!accent) throw new Error('这个文件里没有可读取的主题主色。');
  const bodyStyle = textStyle(bodyDocuments, scheme, bodyMappings);
  const coverStyle = textStyle(coverDocuments, coverScheme, coverMappings);
  const minor = elementNamed(theme, 'minorFont');
  const chinese = Array.from(minor?.getElementsByTagNameNS('*', 'font') ?? [])
    .find((node) => node.getAttribute('script') === 'Hans')?.getAttribute('typeface');
  const font = bodyStyle.font || coverStyle.font || chinese || elementNamed(minor, 'ea')?.getAttribute('typeface')
    || elementNamed(minor, 'latin')?.getAttribute('typeface');
  return {
    name: file.name.replace(templateExtension, ''), accent,
    dark: schemeColor(scheme, 'dk2') ?? schemeColor(scheme, 'dk1'),
    paper: schemeColor(scheme, 'lt1'),
    coverBackground, bodyBackground, coverForeground: coverStyle.foreground, bodyForeground: bodyStyle.foreground,
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

function contrast(a, b) {
  const tones = [luminance(a), luminance(b)].sort((first, second) => first - second);
  return (tones[1] + 0.05) / (tones[0] + 0.05);
}

function readable(color, background) {
  if (colorPattern.test(color ?? '') && contrast(color, background) >= 4.5) return color;
  return contrast('FFFFFF', background) >= contrast('161616', background) ? 'FFFFFF' : '161616';
}

function readableAccent(color, ink, background) {
  for (const amount of [0, 0.35, 0.65]) {
    const candidate = mix(color, ink, amount);
    if (contrast(candidate, background) >= 4.5) return candidate;
  }
  return ink;
}

export function slidePalette(template) {
  if (!template || !colorPattern.test(template.accent)) return DEFAULT_PALETTE;
  const defaultDark = colorPattern.test(template.dark ?? '')
    ? (luminance(template.dark) < 0.17 ? template.dark : mix(template.dark, '111111', 0.66))
    : DEFAULT_PALETTE.dark;
  const defaultPaper = colorPattern.test(template.paper ?? '') && luminance(template.paper) > 0.74
    ? template.paper : 'FAFAFA';
  const dark = colorPattern.test(template.coverBackground ?? '') ? template.coverBackground : defaultDark;
  const paper = colorPattern.test(template.bodyBackground ?? '') ? template.bodyBackground : defaultPaper;
  const ink = readable(template.bodyForeground ?? defaultDark, paper);
  const darkInk = readable(template.coverForeground, dark);
  const accent = readableAccent(template.accent, ink, paper);
  return {
    dark, paper, rail: template.accent,
    ink, muted: mix(ink, paper, 0.20), accent,
    darkInk, darkMuted: mix(darkInk, dark, 0.14), darkAccent: readableAccent(template.accent, darkInk, dark),
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
  const darkColor = luminance(palette.dark) < 0.17 ? palette.dark : readable(palette.ink, 'FFFFFF');
  const lightColor = luminance(palette.paper) > 0.74 ? palette.paper : 'FFFFFF';
  const colors = { dk1: darkColor, dk2: darkColor, lt1: lightColor, accent1: palette.rail };
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
