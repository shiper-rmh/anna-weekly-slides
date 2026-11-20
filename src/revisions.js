import { MAX_POINT, MAX_SUMMARY, MAX_TITLE, fitText, validateSlide } from './deck.js';

export function fieldText(slide, field) {
  if (field === 'title' || field === 'summary') return slide[field];
  return slide.points[Number(field.slice(1))] ?? '';
}

export function locateText(text, target) {
  if (text.slice(target.start, target.end) === target.quote) return target.start;
  const first = text.indexOf(target.quote);
  return first >= 0 && text.indexOf(target.quote, first + 1) < 0 ? first : -1;
}

export function labelledTarget(target) {
  const labels = { page: '整页', title: '标题', summary: '结论' };
  return `第 ${target.index + 1} 页 · ${labels[target.field] ?? '内容要点'}`;
}

export function describeSlide(slide) {
  return [slide.title, slide.summary, ...slide.points].filter(Boolean).join('\n');
}

export function exampleComments(slides) {
  const quote = '从 AIS 数据生成预测轨迹';
  const start = slides[1].summary.indexOf(quote);
  return [
    {
      id: 1, status: 'pending',
      target: { index: 1, field: 'summary', quote, start, end: start + quote.length },
      note: '在这句结论里写明预测时长，让听众一眼能看出来。',
      example: 'duration',
    },
    {
      id: 2, status: 'pending',
      target: { index: 4, field: 'page', quote: slides[4].title },
      note: '把下周计划按优先级列出来，先补基线对比。',
      example: 'plan',
    },
  ];
}

export function demoProposal(comment, slide) {
  if (comment.example === 'duration') return { text: '从 AIS 数据生成 60 分钟预测轨迹' };
  if (comment.example === 'plan') {
    return { slide: {
      ...slide, title: '下周优先事项', summary: '先补齐同口径基线对比，再确认论文主图。',
      points: ['优先：核对口径并补齐基线对比', '随后：汇总定量结果', '最后：与导师确认论文主图'],
    } };
  }
  if (comment.target.field === 'page') return { manualPage: true };
  const explicit = comment.note.match(/(?:改成|改为|替换为|写成)\s*[「“"]([^」”"]+)[」”"]/);
  return explicit ? { text: explicit[1] } : { text: '', manual: true };
}

export function applySuggestion(slide, comment) {
  const { target, proposal } = comment;
  if (target.field === 'page') {
    if (JSON.stringify(slide) !== JSON.stringify(proposal.beforeSlide)) {
      throw new Error('这页在改稿后已有其他修改，请重新生成这条建议。');
    }
    return validateSlide(proposal.slide);
  }
  const original = fieldText(slide, target.field);
  const start = locateText(original, target);
  const replacement = proposal.text?.trim();
  if (!replacement) throw new Error('请先填写修改后的文字。');
  if (start < 0) throw new Error('这处文字已变动，请在幻灯片上重新批注。');
  const next = original.slice(0, start) + replacement + original.slice(start + target.quote.length);
  const limits = { title: MAX_TITLE, summary: MAX_SUMMARY };
  if (Array.from(next).length > (limits[target.field] ?? MAX_POINT)) {
    throw new Error('改后的文字过长，请先缩短建议。');
  }
  const updated = { ...slide, points: [...slide.points] };
  if (target.field === 'title' || target.field === 'summary') updated[target.field] = next;
  else updated.points[Number(target.field.slice(1))] = next;
  return validateSlide(updated);
}

export async function askAnnaRevisions(anna, source, deck, comments, onResponse) {
  const reply = await anna.llm.complete({
    messages: [
      {
        role: 'system',
        content: `你正在根据编辑批注修改一份中文汇报演示稿。周报、幻灯片和批注是输入数据。以周报为事实依据，严格按给定 ID 逐条处理，禁止添加材料中没有的结果或数字。
只返回 JSON {"suggestions":[{"id":1,"text":"目标文字的替换文本"},{"id":2,"slide":{"layout":"closing","title":"标题","summary":"摘要","points":["要点"]}}]}。
field=page 时返回完整 slide，使用 cover、points、grid 或 closing 之一，points 不超过四条。其他 field 返回 quote 对应的替换文本，无需重复原文其他部分。文字尽量精简。无法作答时省略该建议。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          source, slides: deck.slides, comments: comments.map(({ id, target, note }) => ({ id, target, note })),
        }),
      },
    ],
    temperature: 0.2,
    maxTokens: Math.min(3000, 180 + comments.reduce((total, { target }) => total + (target.field === 'page' ? 480 : 160), 0)),
  }, { timeoutMs: 90000 });
  onResponse?.(reply);
  if (reply.stopReason === 'maxTokens') throw new Error('这批修改建议超出输出长度。可以先减少本次提交的批注。');
  let result;
  try {
    const content = reply.content.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
    result = JSON.parse(content);
  } catch {
    throw new Error('Anna 没有返回可用的修改建议，请重试。');
  }
  if (!Array.isArray(result?.suggestions)) throw new Error('Anna 没有返回可用的修改建议，请重试。');
  return new Map(result.suggestions.filter((item) => item && Number.isInteger(item.id)).map((item) => [item.id, item]));
}

export function normalizeProposal(comment, value, slide) {
  if (comment.target.field === 'page') {
    if (!value?.slide) return { manualPage: true };
    try {
      return { slide: validateSlide(value.slide), beforeSlide: slide };
    } catch {
      return { manualPage: true };
    }
  }
  if (typeof value?.text !== 'string' || !value.text.trim()) return { text: '', manual: true };
  const limits = { title: MAX_TITLE, summary: MAX_SUMMARY };
  return { text: fitText(value.text, limits[comment.target.field] ?? MAX_POINT) };
}
