import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'parse5';
import type { VerificationCheck, VerificationReport } from '../shared/types.ts';

const execFileAsync = promisify(execFile);

interface Parse5Node {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: Parse5Node[];
  value?: string;
}

function walkNodes(node: Parse5Node, visitor: (n: Parse5Node) => void): void {
  visitor(node);
  if (node.childNodes) {
    for (const child of node.childNodes) {
      walkNodes(child, visitor);
    }
  }
}

function getAttr(node: Parse5Node, attrName: string): string | undefined {
  return node.attrs?.find((a) => a.name.toLowerCase() === attrName.toLowerCase())?.value;
}

function getTextContent(node: Parse5Node): string {
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(getTextContent).join('');
}

async function checkJsSyntaxInWorkspace(workspacePath: string): Promise<VerificationCheck> {
  const jsFiles: string[] = [];
  function scan(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) scan(full);
      else if (/\.(js|mjs|cjs)$/.test(ent.name)) jsFiles.push(full);
    }
  }
  scan(workspacePath);

  if (jsFiles.length === 0) {
    return {
      name: 'JS syntax check',
      passed: true,
      details: 'No standalone JS files found to check',
      category: 'syntax',
    };
  }

  for (const file of jsFiles) {
    try {
      await execFileAsync(process.execPath, ['--check', file], { timeout: 5000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        name: 'JS syntax check',
        passed: false,
        details: `Syntax error in ${path.relative(workspacePath, file)}: ${msg}`,
        category: 'syntax',
      };
    }
  }

  return {
    name: 'JS syntax check',
    passed: true,
    details: `Validated syntax for ${jsFiles.length} JS/MJS file(s)`,
    category: 'syntax',
  };
}

export async function verifyWebApp(params: {
  baseUrl: string;
  entryPath?: string;
  workspacePath: string;
  previewDisplayUrl?: string;
}): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];
  const entryPath = params.entryPath?.startsWith('/') ? params.entryPath : `/${params.entryPath ?? ''}`;
  const targetUrl = `${params.baseUrl.replace(/\/$/, '')}${entryPath}`;
  let httpStatus: number | undefined;
  let html = '';

  try {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(8000) });
    httpStatus = res.status;
    html = await res.text();
    checks.push({
      name: 'HTTP entry status',
      passed: res.ok && html.trim().length > 0,
      details: `GET ${entryPath} returned ${res.status} (${html.length} bytes)`,
      category: 'http',
    });
  } catch (err) {
    checks.push({
      name: 'HTTP entry status',
      passed: false,
      details: `Failed to reach ${targetUrl}: ${err instanceof Error ? err.message : String(err)}`,
      category: 'http',
    });
    return {
      passed: false,
      previewUrl: params.previewDisplayUrl,
      httpStatus,
      browserChecked: false,
      browserNote: 'Preview server unreachable; browser check skipped.',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  const doc = parse(html) as unknown as Parse5Node;
  let hasLang = false;
  let titleText = '';
  let hasViewport = false;
  let hasMain = false;
  let hasH1 = false;
  let interactiveCount = 0;
  let missingImgAlts = 0;
  const assetRefs: string[] = [];

  walkNodes(doc, (node) => {
    const tag = node.tagName?.toLowerCase();
    if (!tag) return;

    if (tag === 'html' && getAttr(node, 'lang')) hasLang = true;
    if (tag === 'title') titleText = getTextContent(node).trim();
    if (tag === 'meta' && getAttr(node, 'name')?.toLowerCase() === 'viewport') hasViewport = true;
    if (tag === 'main') hasMain = true;
    if (tag === 'h1' && getTextContent(node).trim().length > 0) hasH1 = true;
    if (['button', 'a', 'input', 'select', 'form', 'canvas'].includes(tag)) interactiveCount++;
    if (tag === 'img') {
      if (getAttr(node, 'alt') === undefined) missingImgAlts++;
      const src = getAttr(node, 'src');
      if (src && !src.startsWith('data:') && !src.startsWith('http')) assetRefs.push(src);
    }
    if (tag === 'link' && getAttr(node, 'rel')?.includes('stylesheet')) {
      const href = getAttr(node, 'href');
      if (href && !href.startsWith('http')) assetRefs.push(href);
    }
    if (tag === 'script') {
      const src = getAttr(node, 'src');
      if (src && !src.startsWith('http')) assetRefs.push(src);
    }
  });

  checks.push({
    name: 'Semantic DOM & landmarks',
    passed: hasLang && titleText.length > 0 && hasMain && hasH1,
    details: `lang=${hasLang}, title="${titleText}", <main>=${hasMain}, <h1>=${hasH1}`,
    category: 'dom',
  });

  checks.push({
    name: 'Responsive viewport & accessibility',
    passed: hasViewport && missingImgAlts === 0 && interactiveCount > 0,
    details: `viewport=${hasViewport}, missingImgAlts=${missingImgAlts}, interactiveElements=${interactiveCount}`,
    category: 'a11y',
  });

  // Verify local CSS/JS/img asset links resolve cleanly
  let brokenAssets: string[] = [];
  let cssContent = '';
  for (const ref of assetRefs) {
    const cleaned = ref.replace(/^\.\//, '');
    const assetUrl = `${params.baseUrl.replace(/\/$/, '')}/${cleaned.replace(/^\//, '')}`;
    try {
      const r = await fetch(assetUrl, { signal: AbortSignal.timeout(5000) });
      const body = await r.text();
      if (!r.ok || body.length === 0) {
        brokenAssets.push(`${ref} (${r.status})`);
      } else if (ref.endsWith('.css')) {
        cssContent += body + '\n';
      }
    } catch {
      brokenAssets.push(`${ref} (fetch failed)`);
    }
  }

  checks.push({
    name: 'Asset integrity',
    passed: brokenAssets.length === 0,
    details:
      brokenAssets.length === 0
        ? `All ${assetRefs.length} local asset reference(s) returned HTTP 200`
        : `Broken assets: ${brokenAssets.join(', ')}`,
    category: 'assets',
  });

  if (cssContent) {
    const hasResponsiveLayout = /@media|grid-template-columns|flex|clamp\(/i.test(cssContent);
    checks.push({
      name: 'Responsive CSS rules',
      passed: hasResponsiveLayout,
      details: hasResponsiveLayout
        ? 'Detected responsive CSS (@media / grid / flex / clamp)'
        : 'Missing responsive CSS layout primitives',
      category: 'dom',
    });
  }

  checks.push(await checkJsSyntaxInWorkspace(params.workspacePath));

  // Optional real headless browser check (only if binary is actually available)
  let browserChecked = false;
  let browserNote =
    'Headless Chromium binary not installed in sandbox; HTTP, asset integrity, DOM/a11y, CSS, and JS syntax checks ran directly.';
  try {
    const { stdout } = await execFileAsync('which', ['chromium', 'google-chrome', 'chromium-browser'], {
      timeout: 2000,
    }).catch(() => ({ stdout: '' }));
    if (stdout.trim()) {
      browserNote = `Browser binary detected at ${stdout.trim().split('\n')[0]} (headless Playwright runner ready in Phase 2).`;
    }
  } catch {
    // Keep honest note
  }

  return {
    passed: checks.every((c) => c.passed),
    previewUrl: params.previewDisplayUrl,
    httpStatus,
    browserChecked,
    browserNote,
    checks,
    timestamp: new Date().toISOString(),
  };
}
