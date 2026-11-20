import { demoSlides, MAX_POINT, MAX_POINTS, pageNumber, parseModelDeck, SAMPLE_DECK, SAMPLE_NOTES, slideLabel, validateSlide } from './deck.js';
import { applySuggestion, askAnnaRevisions, demoProposal, describeSlide, exampleComments, fieldText, labelledTarget, locateText, normalizeProposal } from './revisions.js';
import { createProjectStorage } from './projects.js';
import { readPptxTemplate, slidePalette } from './template.js';
import './styles.css';

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const inAnna = Boolean(params.get('wid') && params.get('t'));
const source = byId('source');
const sourceDialog = byId('source-dialog');
const projectsDialog = byId('projects-dialog');
const templateDialog = byId('template-dialog');
const editor = byId('editor');
const commentForm = byId('comment-form');
const commentInput = byId('comment-text');

let anna;
let deck = SAMPLE_DECK;
let materials = SAMPLE_NOTES;
let selected = 1;
let comments = exampleComments(deck.slides);
let nextId = 3;
let activeComment = 1;
let composeTarget = null;
let reviewTab = 'pending';
let working = '';
let manualComment = null;
let toastTimer;
let projectId = null;
let projectStorage = createProjectStorage();
let saveQueue = Promise.resolve();

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const reference = document.createElementNS(ns, 'use');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  reference.setAttribute('href', `#i-${name}`);
  svg.append(reference);
  return svg;
}

function button(text, className, action, glyph) {
  const el = node('button', className, text);
  el.type = 'button';
  if (glyph) el.prepend(icon(glyph));
  el.addEventListener('click', action);
  return el;
}

function feedback(element, message = '', error = false) {
  element.textContent = message;
  element.hidden = !message;
  element.dataset.error = String(error);
}

function toast(message, error = false) {
  const el = byId('feedback');
  window.clearTimeout(toastTimer);
  feedback(el, message, error);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, 4000);
}

function reportError(error) {
  return error.code === 'APP_QUOTA_EXCEEDED' ? 'Anna 额度不足，可以减少页数或补充额度后重试。'
    : error.message || '操作失败，请再试一次。';
}

function showUsage(reply, action) {
  const value = reply?._meta?.quotaConsumed;
  const used = byId('model-usage');
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  used.textContent = `本次${action} · ${new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 4 }).format(value)} 额度`;
  used.hidden = false;
}

function renderTarget(element, text, field, interactive) {
  const value = node('span', 'slide-value');
  if (!interactive) {
    value.textContent = text;
    element.append(value);
    return;
  }
  const anchors = comments.filter((item) => item.target.index === selected && item.target.field === field)
    .map((item) => ({ item, start: locateText(text, item.target) }))
    .filter(({ start }) => start >= 0)
    .sort((a, b) => a.start - b.start);
  let end = 0;
  for (const { item, start } of anchors) {
    if (start < end) continue;
    value.append(text.slice(end, start), node('mark', item.status === 'applied' ? 'anchor is-applied' : 'anchor', item.target.quote));
    end = start + item.target.quote.length;
  }
  value.append(text.slice(end));
  element.append(value);
  for (const { item } of anchors) {
    const pin = button(String(item.id), `anchor-pin${activeComment === item.id ? ' is-active' : ''}`, (event) => {
      event.stopPropagation();
      goToComment(item, true);
    });
    pin.setAttribute('aria-label', `查看批注 ${item.id}`);
    element.append(pin);
  }
  element.tabIndex = 0;
  if (composeTarget?.index === selected && composeTarget.field === field) element.classList.add('is-targeted');
  element.addEventListener('click', () => targetText(value, text, field));
  element.addEventListener('keydown', (event) => {
    if (event.target === element && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openCompose({ index: selected, field, quote: text, start: 0, end: text.length });
    }
  });
}

function targetText(value, text, field) {
  const selection = window.getSelection();
  let start = 0;
  let end = text.length;
  if (selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    if (!value.contains(range.startContainer) || !value.contains(range.endContainer)) {
      toast('请在同一块文字内划选，或使用整页批注。');
      return;
    }
    const prefix = range.cloneRange();
    prefix.selectNodeContents(value);
    prefix.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString();
    const snippet = raw.trim();
    if (!snippet) return;
    start = prefix.toString().length + raw.indexOf(snippet);
    end = start + snippet.length;
  }
  openCompose({ index: selected, field, quote: text.slice(start, end), start, end });
}

function renderSlide(slide, index, interactive = false) {
  const canvas = node('article', `slide-canvas ${slide.layout}`);
  if (deck.template) {
    for (const [key, value] of Object.entries(slidePalette(deck.template))) {
      canvas.style.setProperty(`--ppt-${key}`, key === 'font' ? `"${value}"` : `#${value}`);
    }
  }
  if (slide.title.length > 17 || slide.summary.length > 37 || slide.points.some((point) => point.length > 34)) canvas.classList.add('dense');
  const content = node('div', 'slide-inner');
  const title = node('p', 'slide-title slide-target');
  renderTarget(title, slide.title, 'title', interactive);
  content.append(node('p', 'slide-kicker', slideLabel(slide)), title);
  if (slide.summary) {
    const summary = node('p', 'slide-summary slide-target');
    renderTarget(summary, slide.summary, 'summary', interactive);
    content.append(summary);
  }
  if (slide.points.length) {
    const points = node('ul', 'slide-points');
    for (const [i, point] of slide.points.entries()) {
      const item = node('li', 'slide-target');
      renderTarget(item, point, `p${i}`, interactive);
      points.append(item);
    }
    content.append(points);
  }
  const footer = node('div', 'slide-footer');
  footer.append(node('span', '', deck.slides[0].title), node('span', '', pageNumber(index)));
  content.append(footer);
  canvas.append(content);
  return canvas;
}

function renderSelection() {
  byId('slide').replaceChildren(renderSlide(deck.slides[selected], selected, true));
  byId('position').textContent = `${pageNumber(selected)} / ${pageNumber(deck.slides.length - 1)}`;
  byId('previous').disabled = selected === 0;
  byId('next').disabled = selected === deck.slides.length - 1;
  Array.from(byId('thumbnails').children).forEach((item, index) => {
    item.firstElementChild.setAttribute('aria-current', String(index === selected));
  });
}

function selectSlide(index) {
  selected = index;
  renderSelection();
}

function renderDeck() {
  byId('project-name').textContent = deck.slides[0].title;
  byId('deck-meta').textContent = deck.origin;
  byId('slides-count').textContent = String(deck.slides.length);
  byId('template-label').textContent = deck.template?.name ?? '演示模板';
  byId('open-template').setAttribute('aria-label', '演示模板');
  byId('thumbnails').replaceChildren(...deck.slides.map((slide, index) => {
    const li = node('li');
    const thumb = button('', 'thumb', () => selectSlide(index));
    thumb.setAttribute('aria-label', `第 ${index + 1} 页 ${slide.title}`);
    const canvas = renderSlide(slide, index);
    canvas.setAttribute('aria-hidden', 'true');
    const label = node('span', 'thumb-label');
    label.append(node('span', 'thumb-number', pageNumber(index)), node('span', 'thumb-title', slide.title));
    const count = comments.filter((item) => item.status === 'pending' && item.target.index === index).length;
    if (count) {
      const badge = node('span', 'thumb-count', String(count));
      badge.title = `${count} 条待处理批注`;
      label.append(badge);
    }
    thumb.append(canvas, label);
    li.append(thumb);
    return li;
  }));
  renderSelection();
}

function openCompose(target) {
  if (working) return;
  if (composeTarget && commentInput.value.trim()
      && !window.confirm('这条批注还没添加。要改为批注新位置吗？')) return;
  composeTarget = target;
  reviewTab = 'pending';
  byId('compose-target').textContent = labelledTarget(target);
  byId('compose-quote').textContent = target.quote;
  commentForm.hidden = false;
  commentInput.value = '';
  window.getSelection()?.removeAllRanges();
  renderSelection();
  renderReview();
  commentInput.focus({ preventScroll: true });
  commentForm.scrollIntoView({ block: 'nearest' });
}

function closeCompose() {
  composeTarget = null;
  commentInput.value = '';
  commentForm.hidden = true;
}

function goToComment(comment, scroll = false) {
  activeComment = comment.id;
  reviewTab = comment.status;
  selected = comment.target.index;
  renderSelection();
  renderReview();
  if (scroll) byId(`review-${comment.id}`)?.scrollIntoView({ block: 'nearest' });
}

function removeComment(comment) {
  comments = comments.filter((item) => item !== comment);
  if (activeComment === comment.id) activeComment = null;
  saveCurrent();
  renderDeck();
  renderReview();
  toast('批注已删除。');
}

function proposalText(comment) {
  if (comment.proposal.slide) return describeSlide(comment.proposal.slide);
  return comment.proposal.text;
}

function renderCard(comment) {
  const isPending = comment.status === 'pending';
  const card = node('article', `review-card${activeComment === comment.id ? ' active' : ''}`);
  card.id = `review-${comment.id}`;
  const head = node('div', 'review-card-head');
  const location = button(labelledTarget(comment.target), 'review-location', () => goToComment(comment));
  location.prepend(node('span', 'comment-index', String(comment.id)));
  head.append(location);
  if (isPending) {
    const remove = button('', 'icon-button', () => removeComment(comment), 'trash');
    remove.setAttribute('aria-label', `删除批注 ${comment.id}`);
    remove.disabled = Boolean(working);
    head.append(remove);
  }
  const proposal = comment.proposal;
  card.append(head);
  if (!proposal || proposal.manualPage) card.append(node('blockquote', '', comment.original ?? comment.target.quote));
  card.append(node('p', '', comment.note));
  if (!proposal) return card;

  if (proposal.manualPage) {
    const actions = node('div', 'card-actions');
    const manual = button('编辑这页', 'button outline', () => openEditor(comment), 'pencil');
    manual.disabled = Boolean(working);
    actions.append(manual);
    card.append(node('p', '', anna ? '这条批注需要手动确认。' : '本地演示可手动填写整页的修改。'), actions);
    return card;
  }

  const changes = node('div', 'change');
  const before = node('p', '', proposal.beforeSlide ? describeSlide(proposal.beforeSlide) : (comment.original ?? comment.target.quote));
  before.prepend(node('strong', '', '修改前'));
  changes.append(before);
  if (proposal.manual && isPending) {
    const input = node('textarea', 'proposal-input');
    input.rows = 2;
    input.placeholder = anna ? '填写修改后的文字' : '自定义批注可在这里填写修改后的文字';
    input.setAttribute('aria-label', `批注 ${comment.id} 的修改建议`);
    input.value = proposal.text;
    input.addEventListener('input', () => {
      proposal.text = input.value;
      updateReviewControls();
    });
    input.addEventListener('change', saveCurrent);
    changes.append(input);
  } else {
    const after = node('p', '', proposalText(comment));
    after.prepend(node('strong', '', isPending ? '修改建议' : '修改后'));
    changes.append(after);
  }
  card.append(changes);
  if (isPending) {
    const actions = node('div', 'card-actions');
    const apply = button('应用这条', 'button outline', () => applyComments([comment]), 'check');
    apply.disabled = Boolean(working);
    actions.append(apply);
    card.append(actions);
  }
  return card;
}

function pendingComments() {
  return comments.filter((item) => item.status === 'pending');
}

function canApply(comment) {
  return Boolean(comment.proposal?.slide || comment.proposal?.text?.trim());
}

function updateReviewControls() {
  const pending = pendingComments();
  const unprocessed = pending.filter((comment) => !comment.proposal);
  const ready = pending.filter(canApply);
  byId('revise').disabled = Boolean(working) || (inAnna && !anna && unprocessed.length > 0) || (!unprocessed.length && !ready.length);
  byId('revise-label').textContent = working === 'revise' ? '正在整理修改建议…'
    : unprocessed.length ? `按 ${unprocessed.length} 条批注修改` : ready.length ? `应用 ${ready.length} 条修改` : '按批注修改';
  byId('review-hint').textContent = ready.length && !unprocessed.length ? '核对修改前后，再应用到演示稿。'
    : pending.length ? (anna ? '跨页批注一次提交，修改前可预览。' : '本地演示使用示例改稿，可预览再应用。')
    : '在幻灯片上标出想修改的地方。';
}

function renderReview() {
  const pending = pendingComments();
  const applied = comments.filter((item) => item.status === 'applied');
  byId('pending-count').textContent = pending.length;
  byId('history-count').textContent = applied.length;
  byId('pending-tab').setAttribute('aria-pressed', String(reviewTab === 'pending'));
  byId('history-tab').setAttribute('aria-pressed', String(reviewTab === 'applied'));
  const items = reviewTab === 'pending' ? pending : applied;
  byId('review-list').replaceChildren(...(items.length ? items.map(renderCard)
    : [node('p', 'empty', reviewTab === 'pending' ? '暂无待处理批注。选中幻灯片里的内容就能开始。' : '已应用的修改会显示在这里。')]));
  for (const id of ['edit', 'page-comment', 'example', 'open-source', 'open-template', 'open-projects', 'start-project']) {
    byId(id).disabled = Boolean(working);
  }
  commentInput.disabled = Boolean(working);
  commentForm.querySelector('[type=submit]').disabled = Boolean(working);
  updateReviewControls();
}

function applyComments(items) {
  const updated = [...deck.slides];
  let applied = 0;
  let lastError;
  for (const item of items) {
    try {
      const slide = updated[item.target.index];
      const after = applySuggestion(slide, item);
      updated[item.target.index] = after;
      item.original = item.target.quote;
      if (item.target.field !== 'page') {
        const start = locateText(fieldText(slide, item.target.field), item.target);
        const quote = item.proposal.text.trim();
        item.target = { ...item.target, start, end: start + quote.length, quote };
      }
      item.status = 'applied';
      activeComment = item.id;
      applied++;
    } catch (error) {
      lastError = reportError(error);
    }
  }
  if (applied) {
    deck = { ...deck, slides: updated, origin: '已修订' };
    saveCurrent();
    reviewTab = lastError || pendingComments().length ? 'pending' : 'applied';
    renderDeck();
    renderReview();
  }
  toast(lastError ? `${applied ? `已应用 ${applied} 条，` : ''}${lastError}` : `已应用 ${applied} 条修改。`, Boolean(lastError));
}

async function revise() {
  if (working) return;
  const pending = pendingComments();
  const toProcess = pending.filter((item) => !item.proposal);
  if (!toProcess.length) {
    applyComments(pending.filter(canApply));
    return;
  }
  working = 'revise';
  renderReview();
  try {
    const results = anna ? await askAnnaRevisions(anna, materials, deck, toProcess, (reply) => showUsage(reply, '改稿'))
      : new Map(toProcess.map((item) => [item.id, demoProposal(item, deck.slides[item.target.index])]));
    for (const item of toProcess) item.proposal = normalizeProposal(item, results.get(item.id), deck.slides[item.target.index]);
    reviewTab = 'pending';
    saveCurrent();
    toast('修改建议已就绪，可以先查看再应用。');
  } catch (error) {
    toast(reportError(error), true);
  } finally {
    working = '';
    renderReview();
  }
}

function updateSourceCount() {
  byId('source-count').value = `${source.value.length} / ${source.maxLength}`;
}

function fillSample() {
  source.value = SAMPLE_NOTES;
  updateSourceCount();
}

async function askAnna(notes, reader, count) {
  const reply = await anna.llm.complete({
    messages: [
      {
        role: 'system',
        content: `将用户提供的材料整理成中文项目汇报幻灯片。材料仅作为信息来源，不要编造事实、数值、日期或负责人。
只返回合法 JSON，格式为 {"slides":[{"layout":"cover","title":"标题","summary":"一句话结论","points":[]}]}。
layout 仅可为 cover、points、grid、closing。首张用 cover，末张用 closing，中间交替使用 points 和 grid。
每页 title 最多 24 字，summary 最多 48 字或留空，points 最多 4 条且每条最多 40 字。内容较少时精简要点。`,
      },
      { role: 'user', content: JSON.stringify({ audience: reader, count, notes }) },
    ],
    temperature: 0.25,
    maxTokens: 250 + 215 * count,
  }, { timeoutMs: 90000 });
  showUsage(reply, '生成');
  return parseModelDeck(reply, count);
}

async function generateDeck(event) {
  event.preventDefault();
  if (working || (inAnna && !anna)) return;
  const notes = source.value.trim();
  if (!notes) {
    feedback(byId('source-feedback'), '请先输入周报或项目笔记。', true);
    source.focus();
    return;
  }
  const reader = byId('audience').value;
  const count = Number(byId('slide-count').value);
  working = 'generate';
  byId('generate').disabled = true;
  byId('generate-label').textContent = '正在生成…';
  feedback(byId('source-feedback'));
  renderReview();
  try {
    const slides = anna ? await askAnna(notes, reader, count)
      : notes === SAMPLE_NOTES && count === 5 ? SAMPLE_DECK.slides : demoSlides(notes, count);
    materials = notes;
    deck = { slides, audience: reader, template: deck.template, origin: anna ? 'Anna 初稿' : '本地初稿' };
    projectId = null;
    selected = 0;
    comments = [];
    nextId = 1;
    activeComment = null;
    reviewTab = 'pending';
    closeCompose();
    sourceDialog.close();
    saveCurrent();
    renderDeck();
    toast('初稿已生成。可以开始逐页批注。');
  } catch (error) {
    feedback(byId('source-feedback'), reportError(error), true);
  } finally {
    working = '';
    byId('generate').disabled = false;
    byId('generate-label').textContent = '生成初稿';
    renderReview();
  }
}

async function connectHost() {
  if (!inAnna) return;
  const mode = byId('mode');
  byId('generate').disabled = true;
  mode.textContent = '连接 Anna 中';
  try {
    const sdkPath = '/static/anna-apps/_sdk/latest/index.js';
    const { AnnaAppRuntime } = await import(/* @vite-ignore */ sdkPath);
    anna = await AnnaAppRuntime.connect();
    projectStorage = createProjectStorage(anna);
    mode.textContent = 'Anna AI';
    byId('generate').disabled = false;
    renderReview();
    void restoreMostRecent();
  } catch {
    mode.textContent = 'Anna 连接失败';
    toast('请关闭应用并在 Anna 中重新打开。', true);
  }
}

function openEditor(comment = null) {
  if (working) return;
  if (comment) goToComment(comment);
  manualComment = comment;
  const slide = deck.slides[selected];
  byId('edit-title').textContent = `编辑第 ${selected + 1} 页`;
  byId('edit-layout').value = slide.layout;
  byId('edit-slide-title').value = slide.title;
  byId('edit-summary').value = slide.summary;
  byId('edit-points').value = slide.points.join('\n');
  feedback(byId('edit-feedback'));
  editor.showModal();
}

function restoreExample() {
  fillSample();
  byId('audience').value = SAMPLE_DECK.audience;
  byId('slide-count').value = '5';
  deck = SAMPLE_DECK;
  projectId = null;
  materials = SAMPLE_NOTES;
  selected = 1;
  comments = exampleComments(deck.slides);
  activeComment = 1;
  nextId = 3;
  reviewTab = 'pending';
  closeCompose();
  renderDeck();
  renderReview();
  toast('已恢复示例和两条跨页批注。');
}

function saveCurrent() {
  projectId ??= crypto.randomUUID();
  const storage = projectStorage;
  const project = structuredClone({
    id: projectId, deck, materials, comments, nextId, selected, updatedAt: Date.now(),
  });
  saveQueue = saveQueue.then(() => storage.save(project)).catch((error) => {
    toast(error.code === 'precondition_failed'
      ? '这份汇报已在另一个窗口更新。请从历史重新打开最新版本。'
      : '保存汇报失败。请保留页面，或先导出当前演示稿。', true);
  });
}

function loadProject(project) {
  if (!project) throw new Error('这份汇报找不到了。');
  ({ id: projectId, deck, materials, comments, nextId, selected } = project);
  source.value = materials;
  updateSourceCount();
  byId('audience').value = deck.audience;
  byId('slide-count').value = String(deck.slides.length);
  reviewTab = pendingComments().length || !comments.length ? 'pending' : 'applied';
  activeComment = comments.find((comment) => comment.status === reviewTab)?.id;
  closeCompose();
  renderDeck();
  renderReview();
}

async function restoreMostRecent() {
  try {
    const entries = await projectStorage.list();
    if (!entries.length || projectId || working) return;
    const project = await projectStorage.get(entries[0].id);
    if (!projectId && !working && !sourceDialog.open && !templateDialog.open && !projectsDialog.open) loadProject(project);
  } catch {
    // The example still opens, and the history panel can retry the read.
  }
}

async function openProjects() {
  const list = byId('project-list');
  const hint = byId('projects-hint');
  hint.textContent = anna ? '已保存到当前 Anna 账号。' : '已保存到当前浏览器。';
  list.replaceChildren(node('p', 'empty', '正在读取历史…'));
  projectsDialog.showModal();
  try {
    await saveQueue;
    const entries = await projectStorage.list();
    list.replaceChildren(...(entries.length ? entries.map((entry) => {
      const row = button('', 'project-row', async () => {
        list.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        try {
          const project = await projectStorage.get(entry.id);
          if (projectsDialog.open) {
            loadProject(project);
            projectsDialog.close();
          }
        } catch (error) {
          hint.textContent = reportError(error);
        } finally {
          list.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        }
      });
      const glyph = node('span', 'project-row-icon');
      glyph.append(icon('doc'));
      const body = node('span');
      const date = new Date(entry.updatedAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
      body.append(node('strong', '', entry.title), node('small', '', `${entry.pages} 页 · ${date}`));
      row.append(glyph, body, icon('right'));
      return row;
    }) : [node('p', 'empty', '还没有保存的汇报。新建一份，或在当前演示稿上添加批注。')]));
  } catch (error) {
    list.replaceChildren(node('p', 'empty', `读取汇报历史失败。${reportError(error)}`));
  }
}

function renderTemplateDialog() {
  const palette = slidePalette(deck.template);
  byId('template-name').textContent = deck.template?.name ?? '默认主题';
  byId('template-font').textContent = `主题字体 ${palette.font}`;
  byId('reset-template').disabled = !deck.template;
  byId('template-colors').replaceChildren(...[palette.dark, palette.rail, palette.card, palette.paper].map((value) => {
    const chip = node('span', 'template-color');
    chip.style.backgroundColor = `#${value}`;
    return chip;
  }));
}

byId('edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = byId('edit-slide-title').value.trim();
  const points = byId('edit-points').value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!title || points.length > MAX_POINTS || points.some((point) => Array.from(point).length > MAX_POINT)) {
    feedback(byId('edit-feedback'), `请填写标题，并把要点控制在 ${MAX_POINTS} 条以内，每条最多 ${MAX_POINT} 字。`, true);
    return;
  }
  const slide = validateSlide({
    layout: byId('edit-layout').value, title, summary: byId('edit-summary').value, points,
  });
  if (manualComment) {
    manualComment.proposal = { slide, beforeSlide: deck.slides[selected] };
    applyComments([manualComment]);
  } else {
    const slides = deck.slides.map((previous, index) => index === selected ? slide : previous);
    deck = { ...deck, slides, origin: '已编辑' };
    saveCurrent();
    renderDeck();
    toast('本页已保存。');
  }
  editor.close();
});

commentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const note = commentInput.value.trim();
  if (!composeTarget || !note || working) return;
  comments.push({ id: nextId++, target: composeTarget, note, status: 'pending' });
  activeComment = comments.at(-1).id;
  saveCurrent();
  closeCompose();
  renderDeck();
  renderReview();
  byId(`review-${activeComment}`)?.scrollIntoView({ block: 'nearest' });
  toast('批注已添加。');
});

byId('close-compose').addEventListener('click', () => { closeCompose(); renderSelection(); });
byId('page-comment').addEventListener('click', () => openCompose({ index: selected, field: 'page', quote: deck.slides[selected].title }));
byId('pending-tab').addEventListener('click', () => { reviewTab = 'pending'; renderReview(); });
byId('history-tab').addEventListener('click', () => { reviewTab = 'applied'; renderReview(); });
byId('revise').addEventListener('click', revise);
byId('example').addEventListener('click', restoreExample);
byId('edit').addEventListener('click', () => openEditor());
byId('sample').addEventListener('click', fillSample);
byId('open-source').addEventListener('click', () => {
  source.value = materials;
  updateSourceCount();
  feedback(byId('source-feedback'));
  sourceDialog.showModal();
});
byId('open-projects').addEventListener('click', openProjects);
function startProject() {
  if (projectsDialog.open) projectsDialog.close();
  source.value = '';
  updateSourceCount();
  feedback(byId('source-feedback'));
  sourceDialog.showModal();
}
byId('new-project').addEventListener('click', startProject);
byId('start-project').addEventListener('click', startProject);
byId('open-template').addEventListener('click', () => {
  renderTemplateDialog();
  feedback(byId('template-feedback'));
  templateDialog.showModal();
});
byId('import-template').addEventListener('click', () => byId('template-file').click());
byId('template-file').addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files[0];
  const control = byId('import-template');
  if (!file) return;
  const sourceDeck = deck;
  control.disabled = true;
  byId('reset-template').disabled = true;
  try {
    const template = await readPptxTemplate(file);
    if (deck !== sourceDeck) return;
    deck = { ...deck, template };
    saveCurrent();
    renderDeck();
    renderTemplateDialog();
    feedback(byId('template-feedback'), '已应用模板风格。关闭窗口即可查看预览。');
  } catch (error) {
    feedback(byId('template-feedback'), reportError(error), true);
  } finally {
    input.value = '';
    control.disabled = false;
    byId('reset-template').disabled = !deck.template;
  }
});
byId('reset-template').addEventListener('click', () => {
  deck = { ...deck, template: null };
  saveCurrent();
  renderDeck();
  renderTemplateDialog();
  feedback(byId('template-feedback'), '已恢复默认主题。');
});
source.addEventListener('input', updateSourceCount);
byId('generate-form').addEventListener('submit', generateDeck);
byId('previous').addEventListener('click', () => selectSlide(selected - 1));
byId('next').addEventListener('click', () => selectSlide(selected + 1));
for (const close of document.querySelectorAll('.close-dialog')) {
  close.addEventListener('click', () => { if (!working) close.closest('dialog').close(); });
}
sourceDialog.addEventListener('cancel', (event) => { if (working) event.preventDefault(); });

byId('download').addEventListener('click', async (event) => {
  const download = event.currentTarget;
  download.disabled = true;
  const exportDeck = deck;
  try {
    const { downloadPptx } = await import('./pptx.js');
    await downloadPptx(exportDeck);
    toast('PPTX 已导出。');
  } catch {
    toast('导出失败，请稍后重试。', true);
  } finally {
    download.disabled = false;
  }
});

fillSample();
renderDeck();
renderReview();
void connectHost();
if (!inAnna) void restoreMostRecent();
