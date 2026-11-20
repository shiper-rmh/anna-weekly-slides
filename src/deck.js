export const MAX_TITLE = 42;
export const MAX_SUMMARY = 68;
export const MAX_POINT = 52;
export const MAX_POINTS = 4;

export const SAMPLE_NOTES = `# 港区船舶轨迹预测

本周结论：完成 60 分钟预测流程联调，已能从 AIS 数据生成预测轨迹。

已完成：对 AIS 轨迹做 3 分钟间隔重采样；跑通训练、推理、评估和可视化。

关键结果：整理了 3 组起点相近但路线不同的轨迹案例。现有案例可以展示多种航行路线。

待解决：仍需在相同数据切分和采样设置下补齐基线对比。

下周计划：核对对比口径，汇总定量结果，并与导师确认论文主图。`;

export const SAMPLE_DECK = {
  audience: '导师 / 项目负责人',
  origin: '示例演示稿',
  slides: [
    {
      layout: 'cover',
      title: '港区船舶轨迹预测',
      summary: '项目周报 · 60 分钟预测流程联调',
      points: [],
    },
    {
      layout: 'grid',
      title: '60 分钟预测流程已跑通',
      summary: '已能从 AIS 数据生成预测轨迹。',
      points: ['AIS 轨迹按 3 分钟间隔重采样', '训练、推理、评估与可视化已联通'],
    },
    {
      layout: 'grid',
      title: '已完成的工作',
      summary: '从 AIS 数据到预测结果的处理流程已跑通。',
      points: ['按 3 分钟间隔重采样 AIS 轨迹', '完成训练与推理联调', '跑通评估与可视化', '整理 3 组不同航线案例'],
    },
    {
      layout: 'points',
      title: '案例与待验证事项',
      summary: '现有案例可以展示相近起点下的不同航行路线。',
      points: ['整理 3 组起点相近、路线不同的轨迹案例。', '仍需在相同数据切分和采样设置下补齐基线对比。'],
    },
    {
      layout: 'closing',
      title: '下周计划',
      summary: '补齐对比结果，并和导师确认论文主图。',
      points: ['核对数据切分与采样口径', '汇总定量结果', '讨论主图的案例与呈现方式'],
    },
  ],
};

const layouts = new Set(['cover', 'points', 'grid', 'closing']);

export function fitText(text, length) {
  const characters = Array.from(text.trim());
  return characters.length <= length ? characters.join('') : characters.slice(0, length - 1).join('') + '…';
}

export function validateSlide(value) {
  if (!value || !layouts.has(value.layout) || typeof value.title !== 'string' || !value.title.trim()
      || typeof value.summary !== 'string' || !Array.isArray(value.points) || value.points.length > MAX_POINTS
      || value.points.some((point) => typeof point !== 'string' || !point.trim())) {
    throw new Error('幻灯片字段不完整，请重新生成。');
  }
  return {
    layout: value.layout,
    title: fitText(value.title, MAX_TITLE),
    summary: fitText(value.summary, MAX_SUMMARY),
    points: value.points.map((point) => fitText(point, MAX_POINT)),
  };
}

export function parseModelDeck(reply, count) {
  if (reply.stopReason === 'maxTokens') {
    throw new Error('模型输出被截断，请缩短材料或减少页数后再试。');
  }
  let data;
  try {
    data = JSON.parse(reply.content.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'));
  } catch {
    throw new Error('Anna 没有返回可用的幻灯片数据，请重新生成。');
  }
  if (!Array.isArray(data?.slides) || data.slides.length !== count) {
    throw new Error('Anna 返回的页数与所选页数不符，请重新生成。');
  }
  return data.slides.map(validateSlide);
}

export function demoSlides(notes, count) {
  const [firstLine, ...rest] = notes.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const heading = firstLine.replace(/^[-*#]+\s*/, '');
  const hasHeading = heading && rest.length > 0 && (/^#/.test(firstLine) || (firstLine.length < 26 && !/[：:。]/.test(firstLine)));
  const units = (hasHeading ? rest : [firstLine, ...rest])
    .flatMap((line) => line.replace(/^[-*#]+\s*/, '').split(/(?<=[。！？；])\s*|;\s*/))
    .map((line) => line.trim())
    .filter(Boolean);
  const sectionCount = count - 2;
  const unitsPerSection = Math.min(MAX_POINTS, Math.max(1, Math.ceil(units.length / sectionCount)));
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const points = units.slice(index * unitsPerSection, (index + 1) * unitsPerSection);
    const namedSection = points[0]?.match(/^([^：:]{2,14})[：:]\s*(.+)$/);
    if (namedSection) points[0] = namedSection[2];
    return {
      layout: index % 2 ? 'grid' : 'points',
      title: namedSection?.[1] ?? (points.length ? `项目进展 ${index + 1}` : '补充材料'),
      summary: points.length ? '' : '此页可用于补充原材料未覆盖的内容。',
      points,
    };
  });
  return [
    { layout: 'cover', title: hasHeading ? heading : '项目进展汇报', summary: hasHeading ? '项目进展汇报' : '', points: [] },
    ...sections,
    { layout: 'closing', title: '下一步', summary: '整理汇报后的行动项与负责人。', points: units.filter((line) => /^(下周计划|下一步)[：:]/.test(line)).slice(0, 3) },
  ].map(validateSlide);
}

export function slideLabel(slide) {
  return { cover: '项目进展汇报', points: '汇报要点', grid: '进展概览', closing: '行动项' }[slide.layout];
}

export function pageNumber(index) {
  return String(index + 1).padStart(2, '0');
}
