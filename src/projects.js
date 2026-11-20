const PREFIX = 'weekly-studio/drafts/';

export function createProjectStorage(anna) {
  const etags = new Map();
  async function get(id) {
    const key = PREFIX + id;
    if (!anna) return JSON.parse(localStorage.getItem(key));
    const row = await anna.storage.get({ key });
    if (row.etag) etags.set(id, row.etag);
    return row.value;
  }

  async function save(project) {
    const key = PREFIX + project.id;
    if (!anna) {
      localStorage.setItem(key, JSON.stringify(project));
      return;
    }
    const { id, deck, updatedAt } = project;
    const metadata = { title: deck.slides[0].title, updatedAt, pages: deck.slides.length };
    const ifMatch = etags.get(id);
    const result = await anna.storage.set({ key, value: project, metadata, ...(ifMatch ? { if_match: ifMatch } : {}) });
    if (result.etag) etags.set(id, result.etag);
  }

  async function list() {
    if (!anna) {
      const entries = await Promise.all(Object.keys(localStorage).filter((key) => key.startsWith(PREFIX))
        .map((key) => get(key.slice(PREFIX.length))));
      return entries.filter(Boolean).map(projectSummary).sort(byLastEdit);
    }
    const entries = [];
    let cursor;
    do {
      const page = await anna.storage.list({ prefix: PREFIX, limit: 100, cursor });
      for (const row of page.items) {
        const id = row.key.slice(PREFIX.length);
        if (row.metadata?.title) entries.push({ id, ...row.metadata });
        else {
          const project = await get(id);
          if (project) entries.push(projectSummary(project));
        }
      }
      cursor = page.next_cursor;
    } while (cursor);
    return entries.sort(byLastEdit);
  }

  return { get, list, save };
}

function projectSummary(project) {
  return {
    id: project.id, title: project.deck.slides[0].title, updatedAt: project.updatedAt, pages: project.deck.slides.length,
  };
}

function byLastEdit(a, b) {
  return b.updatedAt - a.updatedAt;
}
