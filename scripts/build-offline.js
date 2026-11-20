import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'vite';

const result = await build({
  configFile: false,
  build: {
    write: false,
    lib: {
      entry: 'src/main.js',
      name: 'WeeklySlides',
      formats: ['iife'],
    },
  },
});
const assets = [result].flat().flatMap((bundle) => bundle.output);
const script = assets.find((asset) => asset.type === 'chunk' && asset.isEntry);
const stylesheet = assets.find((asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'));
if (!script || !stylesheet || assets.length !== 2) {
  throw new Error('Offline preview must bundle into a single script and stylesheet.');
}

const template = await readFile('index.html', 'utf8');
const page = template
  .replace(/<script type="module" src="\/src\/main\.js"><\/script>/, () =>
    `<style>${String(stylesheet.source).replace(/<\/style/gi, '<\\/style')}</style>`)
  .replace('</body>', () =>
    `<script>${script.code.replace(/<\/script/gi, '<\\/script')}</script>\n  </body>`);

await mkdir('offline', { recursive: true });
await writeFile('offline/周报转PPT.html', page, 'utf8');
