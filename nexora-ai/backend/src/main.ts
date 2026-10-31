import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

export async function createNexoraApp() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    cors: {
      origin: true,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Confirm-Password',
        'X-Device-Fingerprint',
        'Stripe-Signature',
      ],
    },
  });

  // Security headers (frameguard/CSP/COOP relaxed for browser live preview iframe & binary download compatibility)
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Preserve rawBody for cryptographic Stripe-Signature HMAC verification while allowing 20MB JSON uploads
  app.use(
    express.json({
      limit: '20mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('NEXORA AI — Commercial Multi-Model SaaS API')
    .setDescription(
      'INTELLIGENCE WITHOUT LIMITS — Production REST, SSE & WebSocket API for Android, Web, Business API & Owner Governance.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'BusinessApiKey')
    .build();

  try {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  } catch {
    // Under esbuild/vitest (where emitDecoratorMetadata is omitted), skip runtime reflection for OpenAPI
  }

  // Serve downloadable Release Artifacts (Signed Android APK + Production Web App ZIP) at /downloads/*
  const candidateReleaseDirs = [
    process.env.RELEASES_DIR,
    path.resolve(__dirname, '../../releases'),
    path.resolve(process.cwd(), '../releases'),
  ].filter(Boolean) as string[];

  const releasesDir = candidateReleaseDirs.find((d) => fs.existsSync(d));
  const httpInstance = app.getHttpAdapter().getInstance();
  httpInstance.use('/downloads', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const dir = releasesDir || candidateReleaseDirs.find((d) => fs.existsSync(d));
    if (!dir) return next();
    const safeFile = path.basename(req.path || '');
    const fullPath = path.join(dir, safeFile);
    if (!safeFile || !fs.existsSync(fullPath)) return res.status(404).json({ message: 'Release file not found' });
    if (safeFile.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    } else if (safeFile.endsWith('.zip')) {
      res.setHeader('Content-Type', 'application/zip');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
    return res.sendFile(fullPath);
  });

  // Dedicated /download HTML Download Center page (works in any mobile/desktop browser & sandboxed preview)
  httpInstance.get('/download', (_req: express.Request, res: express.Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="si">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NEXORA AI — Download Android APK & Web App</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #05050A; color: #F9FAFB; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { max-width: 520px; width: 100%; background: #0F101A; border: 1px solid #2E2B4F; border-radius: 20px; padding: 28px; box-shadow: 0 20px 50px rgba(124,58,237,0.22); }
    h1 { margin: 0 0 6px; font-size: 24px; color: #38BDF8; }
    .tag { font-size: 12px; letter-spacing: 2px; color: #A78BFA; font-weight: 800; margin-bottom: 18px; }
    p { color: #9CA3AF; font-size: 14px; line-height: 1.6; }
    .btn { display: block; text-align: center; text-decoration: none; padding: 14px 18px; border-radius: 12px; font-weight: 800; font-size: 15px; margin-top: 12px; cursor: pointer; border: none; width: 100%; box-sizing: border-box; }
    .btn-primary { background: linear-gradient(135deg, #7C3AED, #2563EB); color: #fff; }
    .btn-mirror { background: #111827; color: #38BDF8; border: 1px solid #38BDF8; }
    .btn-web { background: #1E1B4B; color: #C4B5FD; border: 1px solid #7C3AED; }
    .meta { margin-top: 18px; padding: 12px; border-radius: 10px; background: #08090F; font-size: 12px; color: #9CA3AF; }
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">INTELLIGENCE WITHOUT LIMITS</div>
    <h1>📲 NEXORA AI v1.0.0 Downloads</h1>
    <p>ඔබගේ Android දුරකථනය සඳහා Signed <b>NEXORA-AI-v1.0.0.apk</b> ගොනුව හෝ <b>Production Web App (.zip)</b> එක පහතින් කෙලින්ම Download කරගන්න:</p>
    <a class="btn btn-primary" href="/downloads/NEXORA-AI-v1.0.0.apk" download="NEXORA-AI-v1.0.0.apk">📥 Download Android APK (Direct Server)</a>
    <a class="btn btn-mirror" href="https://github.com/Rusindu12/claude-mem/raw/arena/fbfc6b1f-claude-mem/nexora-ai/releases/NEXORA-AI-v1.0.0.apk" target="_blank" rel="noopener">⚡ Download Android APK (GitHub CDN Mirror)</a>
    <a class="btn btn-web" href="/downloads/NEXORA-AI-WebApp-v1.0.0.zip" download="NEXORA-AI-WebApp-v1.0.0.zip">🌐 Download Standalone Web App (.zip)</a>
    <a class="btn btn-web" href="/" style="margin-top:16px;background:transparent;">🚀 Open Live NEXORA AI Web App →</a>
    <div class="meta">
      <b>Package:</b> com.nexora.ai &bull; <b>Android:</b> 5.0 – 15 (minSdk 21 / targetSdk 34)<br/>
      <b>Signatures:</b> APK Signature Scheme v1 + v2 + v3 Verified &bull; <b>Zero Embedded API Keys</b>
    </div>
  </div>
</body>
</html>`);
  });

  // Serve exported NEXORA AI Expo Web bundle on the same origin when present
  const candidateWebDirs = [
    process.env.WEB_BUNDLE_DIR,
    path.resolve(__dirname, '../../mobile/web-bundle'),
    path.resolve(process.cwd(), '../mobile/web-bundle'),
  ].filter(Boolean) as string[];

  const webDir = candidateWebDirs.find((d) => fs.existsSync(path.join(d, 'index.html')));
  if (webDir) {
    const httpAdapter = app.getHttpAdapter().getInstance();
    httpAdapter.use(express.static(webDir));
    httpAdapter.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (
        req.method === 'GET' &&
        !req.path.startsWith('/api') &&
        !req.path.startsWith('/ws') &&
        !req.path.startsWith('/socket.io')
      ) {
        return res.sendFile(path.join(webDir, 'index.html'));
      }
      return next();
    });
  }

  return app;
}

function loadLocalEnvFiles() {
  const candidates = [
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

async function bootstrap() {
  if (process.env.NODE_ENV !== 'test') {
    loadLocalEnvFiles();
  }
  const logger = new Logger('NexoraBootstrap');
  const app = await createNexoraApp();
  const port = Number(process.env.PORT || 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`NEXORA AI Backend listening on http://0.0.0.0:${port}/api/v1 (Swagger: /api/docs)`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}
