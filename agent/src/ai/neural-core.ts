import type { BrainStatusInfo } from '../shared/types.ts';

export interface BrainStorageAdapter {
  read(): string | null;
  write(data: string): void;
}

export const AXIOM_INTENTS = [
  'landing_page',
  'crud_app',
  'analytics_dashboard',
  'game_2d',
  'game_3d',
  'api_service',
  'mobile_app',
  'followup_edit',
  'safety_command',
] as const;

export type AxiomIntent = (typeof AXIOM_INTENTS)[number];

interface TrainingSample {
  text: string;
  intent: AxiomIntent;
}

const CURATED_DATASET: TrainingSample[] = [
  // landing_page
  { text: 'make me a landing page', intent: 'landing_page' },
  { text: 'build a responsive startup website with pricing and waitlist', intent: 'landing_page' },
  { text: 'create a portfolio landing page for a product designer', intent: 'landing_page' },
  { text: 'build a SaaS marketing website with hero section and FAQ', intent: 'landing_page' },
  { text: 'make me a landing page for an orbital solar clean-tech startup', intent: 'landing_page' },
  { text: 'mata coffee shop ekakata lassana landing page ekak hadanna', intent: 'landing_page' },
  { text: 'mage company ekata aluth website ekak hadala denna', intent: 'landing_page' },
  { text: 'lassana hero section ekak ekka product site ekak hadanna', intent: 'landing_page' },
  { text: 'මට කෝපි කඩේකට ලස්සන වෙබ් අඩවියක් හදන්න', intent: 'landing_page' },
  { text: 'නවීන තාක්ෂණික සමාගමකට landing page එකක් නිර්මාණය කරන්න', intent: 'landing_page' },
  { text: 'design a modern agency homepage with dark theme and contact form', intent: 'landing_page' },
  { text: 'build a product launch showcase page with interactive ROI calculator', intent: 'landing_page' },
  { text: 'tea export brand website with story and contact form', intent: 'landing_page' },
  { text: 'fitness gym membership homepage with plans and signup', intent: 'landing_page' },
  { text: 'ai startup homepage with feature cards and testimonials', intent: 'landing_page' },

  // crud_app
  { text: 'build a task tracker CRUD web app', intent: 'crud_app' },
  { text: 'create a todo list app with search filter and localStorage', intent: 'crud_app' },
  { text: 'build a hospital patient appointment booking tracker with search', intent: 'crud_app' },
  { text: 'make an inventory manager app where I can add edit and delete items', intent: 'crud_app' },
  { text: 'create an issue tracker CRUD tool with priority tags', intent: 'crud_app' },
  { text: 'build an invoice billing management web app', intent: 'crud_app' },
  { text: 'mata task manager web app ekak hadanna add delete karanna puluwan', intent: 'crud_app' },
  { text: 'patient bookings daganna saha search karanna system ekak hadanna', intent: 'crud_app' },
  { text: 'රෝගීන්ගේ වේලාවන් වෙන්කරන පද්ධතියක් හදන්න', intent: 'crud_app' },
  { text: 'කාර්යයන් කළමනාකරණය කරන CRUD ඇප් එකක් හදන්න', intent: 'crud_app' },
  { text: 'student attendance and grade tracker web application', intent: 'crud_app' },
  { text: 'customer CRM contact list with create update delete', intent: 'crud_app' },
  { text: 'expense tracker with categories and filter', intent: 'crud_app' },
  { text: 'library book lending tracker web app', intent: 'crud_app' },

  // analytics_dashboard
  { text: 'build a revenue analytics dashboard with interactive charts and CSV export', intent: 'analytics_dashboard' },
  { text: 'create a SaaS metrics dashboard with KPI cards bar chart and donut chart', intent: 'analytics_dashboard' },
  { text: 'data visualization dashboard from CSV sales data', intent: 'analytics_dashboard' },
  { text: 'admin telemetry dashboard with live charts and filters', intent: 'analytics_dashboard' },
  { text: 'sales performance chart dashboard with monthly breakdown', intent: 'analytics_dashboard' },
  { text: 'mata sales data charts ekka dashboard ekak hadanna', intent: 'analytics_dashboard' },
  { text: 'CSV export saha graph pennana analytics panel ekak hadanna', intent: 'analytics_dashboard' },
  { text: 'දත්ත ප්‍රස්තාර සහ KPI පෙන්වන dashboard එකක් හදන්න', intent: 'analytics_dashboard' },
  { text: 'financial portfolio analytics board with interactive graphs', intent: 'analytics_dashboard' },
  { text: 'energy grid monitoring dashboard with metrics and charts', intent: 'analytics_dashboard' },
  { text: 'marketing funnel conversion analytics dashboard', intent: 'analytics_dashboard' },
  { text: 'e-commerce orders and revenue chart dashboard', intent: 'analytics_dashboard' },

  // game_2d
  { text: 'build a playable 2D canvas space-defender game', intent: 'game_2d' },
  { text: 'make a 2D arcade shooter game with score lives and restart', intent: 'game_2d' },
  { text: 'create a 2D endless runner platformer canvas game', intent: 'game_2d' },
  { text: 'build a retro brick breaker 2D game in HTML5 canvas', intent: 'game_2d' },
  { text: '2D space shooter game with waves and particles', intent: 'game_2d' },
  { text: 'mata 2D canvas game ekak hadanna score saha lives ekka', intent: 'game_2d' },
  { text: 'play karanna puluwan 2D arcade game ekak hadanna', intent: 'game_2d' },
  { text: '2D අභ්‍යවකාශ වෙඩි තැබීමේ ක්‍රීඩාවක් හදන්න', intent: 'game_2d' },
  { text: '60fps 2D dodge and survive mini game', intent: 'game_2d' },
  { text: 'arcade starfighter 2d browser game', intent: 'game_2d' },
  { text: 'neon cyber runner 2d jump game', intent: 'game_2d' },
  { text: 'classic breakout paddle ball 2d game', intent: 'game_2d' },

  // game_3d
  { text: 'build a 3D open world game vertical slice with vehicles and NPC traffic', intent: 'game_3d' },
  { text: 'make a GTA style 3D city driving game in Three.js with minimap and mission', intent: 'game_3d' },
  { text: 'create a 3D WebGL city district with 3 switchable cars and day night cycle', intent: 'game_3d' },
  { text: 'build an open world 3D action driving slice with wanted HUD and traffic', intent: 'game_3d' },
  { text: 'Three.js 3D car driving game with city buildings and mission waypoint', intent: 'game_3d' },
  { text: 'GTA wage 3D open world game slice ekak hadanna cars saha city ekak ekka', intent: 'game_3d' },
  { text: '3D game ekak hadanna minimap day night saha NPC traffic ekka', intent: 'game_3d' },
  { text: 'වාහන පදවන 3D විවෘත ලෝක ක්‍රීඩාවක් හදන්න', intent: 'game_3d' },
  { text: '3D city racing and delivery mission game in browser', intent: 'game_3d' },
  { text: 'threejs 3d district exploration with vehicles and weather', intent: 'game_3d' },
  { text: 'AAA ambition 3d open world sandbox slice', intent: 'game_3d' },
  { text: 'driveable 3d vehicles in a procedural city with traffic AI', intent: 'game_3d' },

  // api_service
  { text: 'build a Node.js REST API service with health and notes endpoints', intent: 'api_service' },
  { text: 'create a backend HTTP API server with CRUD endpoints and integration tests', intent: 'api_service' },
  { text: 'build a microservice REST API with OpenAPI spec and validation', intent: 'api_service' },
  { text: 'create a JSON API backend for user bookmarks with unit tests', intent: 'api_service' },
  { text: 'Node ESM REST API with Dockerfile and automated tests', intent: 'api_service' },
  { text: 'mata backend REST API ekak hadanna tests ekkama', intent: 'api_service' },
  { text: 'JSON endpoints saha health check thiyena API service ekak hadanna', intent: 'api_service' },
  { text: 'දත්ත සුරකින backend REST API සේවාවක් හදන්න', intent: 'api_service' },
  { text: 'express or node http api endpoint service with validation', intent: 'api_service' },
  { text: 'build a webhook and event ingestion HTTP API', intent: 'api_service' },
  { text: 'create a shortlink REST API service with tests', intent: 'api_service' },
  { text: 'inventory REST backend server with CRUD endpoints', intent: 'api_service' },

  // mobile_app
  { text: 'build a mobile app ready for Android APK using Capacitor', intent: 'mobile_app' },
  { text: 'create an Android app web wrapper with Capacitor config and touch UI', intent: 'mobile_app' },
  { text: 'mobile first habit tracker app packaged for Android APK build', intent: 'mobile_app' },
  { text: 'build a React Native or Capacitor mobile fitness companion app', intent: 'mobile_app' },
  { text: 'mata Android APK hadanna puluwan mobile app ekak hadanna', intent: 'mobile_app' },
  { text: 'phone ekata install karanna puluwan mobile app ekak hadanna', intent: 'mobile_app' },
  { text: 'ඇන්ඩ්‍රොයිඩ් දුරකථන සඳහා mobile app එකක් හදන්න', intent: 'mobile_app' },
  { text: 'offline-capable mobile PWA and Capacitor Android project', intent: 'mobile_app' },
  { text: 'mobile delivery driver companion app with touch navigation', intent: 'mobile_app' },
  { text: 'android mobile pocket expense app with capacitor config', intent: 'mobile_app' },

  // followup_edit
  { text: 'change theme to light mode and rename brand to NovaGrid', intent: 'followup_edit' },
  { text: 'update the existing page to add a pricing section', intent: 'followup_edit' },
  { text: 'switch colors to emerald and change the hero heading', intent: 'followup_edit' },
  { text: 'add a search bar and CSV export to the existing app', intent: 'followup_edit' },
  { text: 'rename the title and add a dark mode toggle button', intent: 'followup_edit' },
  { text: 'dan thiyena page eke theme eka light karanna', intent: 'followup_edit' },
  { text: 'meke brand nama wenas karala aluth section ekak add karanna', intent: 'followup_edit' },
  { text: 'දැනට තියෙන වෙබ් පිටුවේ වර්ණ සහ මාතෘකාව වෙනස් කරන්න', intent: 'followup_edit' },
  { text: 'modify current CSS layout and add mobile menu support', intent: 'followup_edit' },
  { text: 'edit the existing code to fix spacing and add footer links', intent: 'followup_edit' },

  // safety_command
  { text: 'delete everything with rm -rf ./tmp-build', intent: 'safety_command' },
  { text: 'run git push origin main --force now', intent: 'safety_command' },
  { text: 'execute git reset --hard HEAD~5', intent: 'safety_command' },
  { text: 'deploy directly to production using vercel --prod', intent: 'safety_command' },
  { text: 'remove all build artifacts with rm -rf ./dist', intent: 'safety_command' },
  { text: 'force push to github repository', intent: 'safety_command' },
  { text: 'okkom files delete karanna rm -rf gahala', intent: 'safety_command' },
  { text: 'සියලුම ගොනු මකා දමන්න rm -rf', intent: 'safety_command' },
  { text: 'publish package to npm immediately', intent: 'safety_command' },
  { text: 'run terraform apply on production infrastructure', intent: 'safety_command' },
];

const DIMS = 384;
const HIDDEN = 64;

function fnv1aHash(str: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function featurizeText(text: string): Float32Array {
  const vec = new Float32Array(DIMS);
  const norm = text.toLowerCase().trim();
  if (!norm) return vec;

  const words = norm.split(/[\s,.;:!?()[\]{}"'`/\\|-]+/).filter(Boolean);
  const addFeature = (feat: string, weight: number) => {
    const h = fnv1aHash(feat);
    const idx = h % DIMS;
    const sign = ((h >>> 16) & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    addFeature(`w:${w}`, 2.0);
    if (i + 1 < words.length) {
      addFeature(`b:${w}_${words[i + 1]}`, 1.6);
    }
    if (w.length >= 3) {
      const padded = `^${w}$`;
      for (let j = 0; j <= padded.length - 3; j++) {
        addFeature(`c3:${padded.slice(j, j + 3)}`, 0.7);
      }
    }
  }

  // Also add character trigrams for Unicode / Sinhala sequences
  for (let i = 0; i <= norm.length - 3; i++) {
    const gram = norm.slice(i, i + 3);
    if (/[\u0D80-\u0DFF]/.test(gram)) {
      addFeature(`si:${gram}`, 1.2);
    }
  }

  // L2 normalize
  let sumSq = 0;
  for (let i = 0; i < DIMS; i++) sumSq += vec[i] * vec[i];
  const mag = Math.sqrt(sumSq);
  if (mag > 1e-8) {
    for (let i = 0; i < DIMS; i++) vec[i] /= mag;
  }
  return vec;
}

function createPrng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface SerializedBrain {
  version: string;
  dims: number;
  hidden: number;
  intents: string[];
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  trainingSamples: number;
  onlineUpdates: number;
  trainAccuracy: number;
  lastLoss: number;
  trainedAt: string;
}

export class AxiomNeuralCore {
  private w1: Float32Array;
  private b1: Float32Array;
  private w2: Float32Array;
  private b2: Float32Array;
  private trainingSamples = 0;
  private onlineUpdates = 0;
  private trainAccuracy = 0;
  private lastLoss = 0;
  private trainedAt = new Date().toISOString();
  private storage?: BrainStorageAdapter;

  constructor(storage?: BrainStorageAdapter) {
    this.storage = storage;
    this.w1 = new Float32Array(DIMS * HIDDEN);
    this.b1 = new Float32Array(HIDDEN);
    this.w2 = new Float32Array(HIDDEN * AXIOM_INTENTS.length);
    this.b2 = new Float32Array(AXIOM_INTENTS.length);

    if (storage && this.loadFromStorage(storage)) {
      return;
    }
    this.initAndTrain();
  }

  private initWeights(): void {
    const rand = createPrng(20261122);
    const s1 = Math.sqrt(2 / DIMS);
    for (let i = 0; i < this.w1.length; i++) {
      this.w1[i] = (rand() * 2 - 1) * s1;
    }
    this.b1.fill(0);
    const s2 = Math.sqrt(2 / HIDDEN);
    for (let i = 0; i < this.w2.length; i++) {
      this.w2[i] = (rand() * 2 - 1) * s2;
    }
    this.b2.fill(0);
  }

  private forward(x: Float32Array): { hidden: Float32Array; probs: Float32Array } {
    const k = AXIOM_INTENTS.length;
    const hidden = new Float32Array(HIDDEN);
    for (let j = 0; j < HIDDEN; j++) {
      let sum = this.b1[j];
      const colOffset = j;
      for (let i = 0; i < DIMS; i++) {
        const xi = x[i];
        if (xi !== 0) sum += xi * this.w1[i * HIDDEN + colOffset];
      }
      hidden[j] = sum > 0 ? sum : 0; // ReLU
    }

    const logits = new Float32Array(k);
    let maxLogit = -Infinity;
    for (let c = 0; c < k; c++) {
      let sum = this.b2[c];
      for (let j = 0; j < HIDDEN; j++) {
        sum += hidden[j] * this.w2[j * k + c];
      }
      logits[c] = sum;
      if (sum > maxLogit) maxLogit = sum;
    }

    const probs = new Float32Array(k);
    let sumExp = 0;
    for (let c = 0; c < k; c++) {
      const e = Math.exp(logits[c] - maxLogit);
      probs[c] = e;
      sumExp += e;
    }
    for (let c = 0; c < k; c++) {
      probs[c] /= sumExp;
    }
    return { hidden, probs };
  }

  private trainStep(
    samples: Array<{ x: Float32Array; targetIdx: number }>,
    epochs: number,
    lr: number,
  ): { accuracy: number; loss: number } {
    const k = AXIOM_INTENTS.length;
    const reg = 0.0002;
    let finalLoss = 0;
    let correct = 0;

    for (let ep = 0; ep < epochs; ep++) {
      let epLoss = 0;
      let epCorrect = 0;
      const stepLr = lr * (1 - (ep / (epochs + 5)) * 0.5);

      for (const sample of samples) {
        const { hidden, probs } = this.forward(sample.x);
        const target = sample.targetIdx;

        let bestC = 0;
        for (let c = 1; c < k; c++) {
          if (probs[c] > probs[bestC]) bestC = c;
        }
        if (bestC === target) epCorrect++;
        epLoss += -Math.log(Math.max(1e-7, probs[target]));

        // Backprop output layer
        const dLogits = new Float32Array(k);
        for (let c = 0; c < k; c++) {
          dLogits[c] = probs[c] - (c === target ? 1 : 0);
        }

        const dHidden = new Float32Array(HIDDEN);
        for (let j = 0; j < HIDDEN; j++) {
          const hj = hidden[j];
          let gradH = 0;
          for (let c = 0; c < k; c++) {
            const wIdx = j * k + c;
            gradH += dLogits[c] * this.w2[wIdx];
            this.w2[wIdx] -= stepLr * (hj * dLogits[c] + reg * this.w2[wIdx]);
          }
          dHidden[j] = hj > 0 ? gradH : 0;
        }
        for (let c = 0; c < k; c++) {
          this.b2[c] -= stepLr * dLogits[c];
        }

        // Backprop hidden layer
        for (let i = 0; i < DIMS; i++) {
          const xi = sample.x[i];
          if (xi === 0) continue;
          const rowBase = i * HIDDEN;
          for (let j = 0; j < HIDDEN; j++) {
            if (dHidden[j] !== 0) {
              this.w1[rowBase + j] -=
                stepLr * (xi * dHidden[j] + reg * this.w1[rowBase + j]);
            }
          }
        }
        for (let j = 0; j < HIDDEN; j++) {
          if (dHidden[j] !== 0) {
            this.b1[j] -= stepLr * dHidden[j];
          }
        }
      }

      finalLoss = epLoss / samples.length;
      correct = epCorrect;
    }

    return {
      accuracy: Number((correct / samples.length).toFixed(4)),
      loss: Number(finalLoss.toFixed(4)),
    };
  }

  initAndTrain(extraSamples: TrainingSample[] = []): BrainStatusInfo {
    this.initWeights();
    const allSamples = [...CURATED_DATASET, ...extraSamples];
    const encoded = allSamples.map((s) => ({
      x: featurizeText(s.text),
      targetIdx: AXIOM_INTENTS.indexOf(s.intent),
    }));

    const metrics = this.trainStep(encoded, 55, 0.045);
    this.trainingSamples = encoded.length;
    this.trainAccuracy = metrics.accuracy;
    this.lastLoss = metrics.loss;
    this.trainedAt = new Date().toISOString();
    this.saveToDisk();
    return this.getStatus();
  }

  learnOnline(text: string, intent: AxiomIntent): void {
    const idx = AXIOM_INTENTS.indexOf(intent);
    if (idx === -1) return;
    const x = featurizeText(text);
    const metrics = this.trainStep([{ x, targetIdx: idx }], 5, 0.02);
    this.onlineUpdates += 1;
    this.lastLoss = Number(((this.lastLoss * 0.8) + (metrics.loss * 0.2)).toFixed(4));
    this.saveToDisk();
  }

  classify(text: string): {
    intent: AxiomIntent;
    confidence: number;
    ranked: Array<{ intent: AxiomIntent; confidence: number }>;
    embedding: Float32Array;
  } {
    const x = featurizeText(text);
    const { hidden, probs } = this.forward(x);
    const ranked = AXIOM_INTENTS.map((intent, idx) => ({
      intent,
      confidence: Number(probs[idx].toFixed(4)),
    })).sort((a, b) => b.confidence - a.confidence);

    return {
      intent: ranked[0].intent,
      confidence: ranked[0].confidence,
      ranked,
      embedding: hidden,
    };
  }

  getStatus(): BrainStatusInfo {
    return {
      engineName: 'Axiom Neural Core (MLP + Trigram/Word Hashing)',
      version: '1.0.0',
      vocabDims: DIMS,
      hiddenUnits: HIDDEN,
      intents: [...AXIOM_INTENTS],
      trainingSamples: this.trainingSamples,
      onlineUpdates: this.onlineUpdates,
      trainAccuracy: this.trainAccuracy,
      lastLoss: this.lastLoss,
      trainedAt: this.trainedAt,
    };
  }

  private saveToDisk(): void {
    if (!this.storage) return;
    try {
      const payload: SerializedBrain = {
        version: '1.0.0',
        dims: DIMS,
        hidden: HIDDEN,
        intents: [...AXIOM_INTENTS],
        w1: Array.from(this.w1),
        b1: Array.from(this.b1),
        w2: Array.from(this.w2),
        b2: Array.from(this.b2),
        trainingSamples: this.trainingSamples,
        onlineUpdates: this.onlineUpdates,
        trainAccuracy: this.trainAccuracy,
        lastLoss: this.lastLoss,
        trainedAt: this.trainedAt,
      };
      this.storage.write(JSON.stringify(payload));
    } catch {
      // Non-fatal if read-only/ephemeral
    }
  }

  private loadFromStorage(adapter: BrainStorageAdapter): boolean {
    try {
      const raw = adapter.read();
      if (!raw) return false;
      const data = JSON.parse(raw) as SerializedBrain;
      if (
        data.dims !== DIMS ||
        data.hidden !== HIDDEN ||
        data.intents.length !== AXIOM_INTENTS.length ||
        data.w1.length !== DIMS * HIDDEN
      ) {
        return false;
      }
      this.w1 = Float32Array.from(data.w1);
      this.b1 = Float32Array.from(data.b1);
      this.w2 = Float32Array.from(data.w2);
      this.b2 = Float32Array.from(data.b2);
      this.trainingSamples = data.trainingSamples;
      this.onlineUpdates = data.onlineUpdates;
      this.trainAccuracy = data.trainAccuracy;
      this.lastLoss = data.lastLoss;
      this.trainedAt = data.trainedAt;
      return true;
    } catch {
      return false;
    }
  }
}
