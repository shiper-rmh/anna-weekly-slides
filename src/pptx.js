import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { pageNumber, slideLabel } from './deck.js';
import { embedTheme, slidePalette } from './template.js';

const W = 13.333;
const H = 7.5;
const LEFT = 0.8;
const BODY_WIDTH = W - LEFT * 2;

function addSlide(pptx, data, projectTitle, index, palette) {
  const slide = pptx.addSlide();
  const dark = data.layout === 'cover' || data.layout === 'closing';
  const ink = dark ? palette.darkInk : palette.ink;
  const muted = dark ? palette.darkMuted : palette.muted;
  const accent = dark ? palette.darkAccent : palette.accent;
  const text = (value, { size, ...placement }) => slide.addText(value, {
    ...placement, fontSize: size, fontFace: palette.font, margin: 0, valign: 'mid', fit: 'shrink',
  });
  slide.background = { color: dark ? palette.dark : palette.paper };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.055, line: { transparency: 100 }, fill: { color: palette.rail },
  });

  if (dark) {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 8.37, y: -0.98, w: 6.53, h: 6.53,
      line: { color: palette.rings, width: 1.4 }, fill: { color: palette.dark, transparency: 100 },
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 8.49, y: -0.38, w: 5.46, h: 5.46,
      line: { color: palette.darkLine, width: 1.2 }, fill: { color: palette.dark, transparency: 100 },
    });
  }
  slide.addShape(pptx.ShapeType.rect, {
    x: LEFT, y: 0.94, w: 0.41, h: 0.045,
    line: { color: accent, transparency: 100 }, fill: { color: accent },
  });
  text(slideLabel(data), { x: 1.36, y: 0.8, w: 6, h: 0.32, color: accent, size: 14, bold: true });

  const longTitle = data.title.length > 13;
  const titleY = dark ? 2.45 : 1.29;
  const titleH = dark ? 1.52 : 1.02;
  text(data.title, {
    x: LEFT, y: titleY, w: dark ? 9.1 : BODY_WIDTH, h: titleH,
    color: ink, size: dark ? (longTitle ? 37 : 58) : (longTitle ? 30 : 43), bold: true,
  });
  if (data.summary) {
    text(data.summary, {
      x: LEFT, y: titleY + titleH + 0.09, w: dark ? 9.4 : BODY_WIDTH, h: 0.52,
      color: muted, size: dark ? 23 : 18,
    });
  }

  data.points.forEach((point, pointIndex) => {
    const grid = data.layout === 'grid';
    const cardWidth = grid ? (BODY_WIDTH - 0.18) / 2 : BODY_WIDTH;
    const left = LEFT + (grid ? (pointIndex % 2) * (cardWidth + 0.18) : 0);
    const top = dark ? 4.82 + pointIndex * 0.42
      : 3.22 + (grid ? Math.floor(pointIndex / 2) * 1.26 : pointIndex * 0.8);
    const height = dark ? 0.39 : grid ? 1.08 : 0.67;
    if (!dark) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: left, y: top, w: cardWidth, h: height, radius: 0.1, rectRadius: 0.1,
        line: { color: palette.lightLine, width: 0.8 }, fill: { color: grid ? palette.card : palette.paper },
      });
    }
    slide.addShape(pptx.ShapeType.ellipse, {
      x: left + (dark ? 0.03 : 0.18), y: top + height / 2 - 0.035, w: 0.07, h: 0.07,
      line: { color: accent, transparency: 100 }, fill: { color: accent },
    });
    text(point, {
      x: left + (dark ? 0.24 : 0.39), y: top + 0.03,
      w: dark ? 9.4 : cardWidth - 0.58, h: height - 0.06,
      color: dark ? muted : ink, size: dark ? 15 : 17,
    });
  });

  slide.addShape(pptx.ShapeType.line, {
    x: LEFT, y: H - 0.86, w: BODY_WIDTH, h: 0, line: { color: dark ? palette.darkLine : palette.lightLine, width: 0.8 },
  });
  text(projectTitle, { x: LEFT, y: H - 0.73, w: 8, h: 0.3, color: muted, size: 12 });
  text(pageNumber(index), { x: W - LEFT - 1, y: H - 0.73, w: 1, h: 0.3, color: muted, size: 12, align: 'right' });
}

export async function downloadPptx(deck) {
  const pptx = new pptxgen();
  const palette = slidePalette(deck.template);
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.slides[0].title;
  pptx.lang = 'zh-CN';
  pptx.theme = { headFontFace: palette.font, bodyFontFace: palette.font, lang: 'zh-CN' };
  deck.slides.forEach((slide, index) => addSlide(pptx, slide, pptx.title, index, palette));
  const title = pptx.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || '项目进展汇报';
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'arraybuffer' }));
  await embedTheme(zip, palette);
  const file = await zip.generateAsync({
    type: 'blob', compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title}.pptx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
