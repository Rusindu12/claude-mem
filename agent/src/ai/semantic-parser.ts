import { detectLanguage } from '../core/prompts.ts';
import type { LanguageCode } from '../shared/types.ts';
import type { AxiomIntent, AxiomNeuralCore } from './neural-core.ts';

export interface DomainPalette {
  name: string;
  bg: string;
  surface: string;
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  defaultTheme: 'dark' | 'light';
}

export interface DomainEntitySpec {
  singular: string;
  plural: string;
  apiPath: string;
  secondaryFieldLabel: string;
  secondaryOptions: string[];
  sampleItems: Array<{ title: string; secondary: string; done?: boolean }>;
}

export interface ParsedPromptIntent {
  rawPrompt: string;
  language: LanguageCode;
  intent: AxiomIntent;
  confidence: number;
  rankedIntents: Array<{ intent: AxiomIntent; confidence: number }>;
  brand: string;
  domain: string;
  tagline: string;
  palette: DomainPalette;
  entity: DomainEntitySpec;
  features: {
    wantsLightTheme: boolean;
    wantsDarkTheme: boolean;
    wantsCharts: boolean;
    wantsCsvExport: boolean;
    wantsPricing: boolean;
    wantsSearch: boolean;
    wants3D: boolean;
    wantsAndroid: boolean;
  };
  editSignals: {
    isFollowupEdit: boolean;
    newBrand?: string;
    switchTheme?: 'light' | 'dark';
    addSection?: string;
  };
}

const DOMAIN_PALETTES: Record<string, DomainPalette> = {
  coffee: {
    name: 'Artisan Roast',
    bg: '#120d0a',
    surface: '#1d1510',
    accent: '#d97706',
    accent2: '#f59e0b',
    text: '#fef3c7',
    muted: '#d6bfa8',
    defaultTheme: 'dark',
  },
  healthcare: {
    name: 'Clinical Emerald',
    bg: '#061318',
    surface: '#0b2027',
    accent: '#06b6d4',
    accent2: '#10b981',
    text: '#ecfeff',
    muted: '#94b8c2',
    defaultTheme: 'dark',
  },
  cleantech: {
    name: 'Orbital Solar',
    bg: '#070b14',
    surface: '#0f172a',
    accent: '#10b981',
    accent2: '#38bdf8',
    text: '#f8fafc',
    muted: '#94a3b8',
    defaultTheme: 'dark',
  },
  fintech: {
    name: 'Quantum Ledger',
    bg: '#080b16',
    surface: '#11162b',
    accent: '#6366f1',
    accent2: '#22c55e',
    text: '#f8fafc',
    muted: '#94a3b8',
    defaultTheme: 'dark',
  },
  gaming: {
    name: 'Neon Arcade',
    bg: '#050814',
    surface: '#0d1326',
    accent: '#f43f5e',
    accent2: '#38bdf8',
    text: '#f8fafc',
    muted: '#94a3b8',
    defaultTheme: 'dark',
  },
  general: {
    name: 'Axiom Slate',
    bg: '#070b14',
    surface: '#101726',
    accent: '#6366f1',
    accent2: '#10b981',
    text: '#f8fafc',
    muted: '#94a3b8',
    defaultTheme: 'dark',
  },
};

function detectDomain(lower: string): { domain: string; brand: string; tagline: string } {
  if (/coffee|cafe|roast|espresso|කෝපි/.test(lower)) {
    return {
      domain: 'coffee',
      brand: 'Kopi Ceylon Roasters',
      tagline: 'Single-origin highland roasts, precision brewed from bean to cup.',
    };
  }
  if (/hospital|patient|clinic|doctor|medical|appointment|රෝගී/.test(lower)) {
    return {
      domain: 'healthcare',
      brand: 'CarePulse Clinic',
      tagline: 'Real-time clinical scheduling, triage visibility, and patient coordination.',
    };
  }
  if (/solar|orbital|clean|energy|green|climate|grid/.test(lower)) {
    return {
      domain: 'cleantech',
      brand: 'HelioOrbit Energy',
      tagline: 'Continuous gigawatt solar beaming with autonomous grid balancing.',
    };
  }
  if (/finance|invoice|billing|revenue|bank|fintech|expense|ledger/.test(lower)) {
    return {
      domain: 'fintech',
      brand: 'VeloLedger Systems',
      tagline: 'Sub-second financial telemetry, automated reconciliation, and clear cashflow.',
    };
  }
  if (/game|arcade|shooter|3d|gta|open[- ]world|racing|driving|ක්‍රීඩා/.test(lower)) {
    return {
      domain: 'gaming',
      brand: 'Aether Interactive',
      tagline: '60 FPS procedural worlds built from first principles.',
    };
  }

  // Extract explicit brand if user specified "for <Name>" or "called <Name>"
  const explicit = lower.match(/(?:called|named|brand(?:\s+to)?|rename(?:\s+brand)?\s+to)\s+([a-z0-9][a-z0-9\s-]{1,28})/i);
  if (explicit?.[1]) {
    const clean = explicit[1]
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
    return {
      domain: 'general',
      brand: clean,
      tagline: 'Engineered from first principles — modern, resilient, and verified.',
    };
  }

  return {
    domain: 'general',
    brand: 'Aether Studio',
    tagline: 'Engineered from first principles — fast, secure, and built for the future.',
  };
}

function detectEntity(lower: string): DomainEntitySpec {
  if (/patient|appointment|booking|clinic|hospital|රෝගී/.test(lower)) {
    return {
      singular: 'Appointment',
      plural: 'Appointments',
      apiPath: '/api/appointments',
      secondaryFieldLabel: 'Department',
      secondaryOptions: ['Cardiology', 'General', 'Pediatrics'],
      sampleItems: [
        { title: 'Amaya Perera — Follow-up Consult', secondary: 'Cardiology', done: false },
        { title: 'Kasun Silva — Annual Checkup', secondary: 'General', done: true },
        { title: 'Nethmi Fernando — Lab Review', secondary: 'Pediatrics', done: false },
      ],
    };
  }
  if (/invoice|billing|expense|payment|finance/.test(lower)) {
    return {
      singular: 'Invoice',
      plural: 'Invoices',
      apiPath: '/api/invoices',
      secondaryFieldLabel: 'Tier',
      secondaryOptions: ['Enterprise', 'Growth', 'Starter'],
      sampleItems: [
        { title: 'INV-1042 · Cloud Cluster Q4 ($4,200)', secondary: 'Enterprise', done: true },
        { title: 'INV-1043 · Edge Gateway License ($1,150)', secondary: 'Growth', done: false },
        { title: 'INV-1044 · Security Audit Retainer ($2,800)', secondary: 'Enterprise', done: false },
      ],
    };
  }
  if (/inventory|warehouse|product|stock|order|e-?commerce/.test(lower)) {
    return {
      singular: 'Inventory Item',
      plural: 'Inventory Items',
      apiPath: '/api/items',
      secondaryFieldLabel: 'Category',
      secondaryOptions: ['Hardware', 'Sensors', 'Packaging'],
      sampleItems: [
        { title: 'LiDAR Array Module v3 (42 units)', secondary: 'Sensors', done: false },
        { title: 'ARM Edge Compute Node (18 units)', secondary: 'Hardware', done: true },
        { title: 'Thermal Shield Crate (120 units)', secondary: 'Packaging', done: false },
      ],
    };
  }
  if (/bookmark|link|note/.test(lower)) {
    return {
      singular: 'Note',
      plural: 'Notes',
      apiPath: '/api/notes',
      secondaryFieldLabel: 'Tag',
      secondaryOptions: ['Architecture', 'Research', 'Ops'],
      sampleItems: [
        { title: 'First-principles caching spec', secondary: 'Architecture', done: true },
        { title: 'OWASP input validation checklist', secondary: 'Ops', done: false },
      ],
    };
  }
  return {
    singular: 'Task',
    plural: 'Tasks',
    apiPath: '/api/tasks',
    secondaryFieldLabel: 'Priority',
    secondaryOptions: ['High', 'Medium', 'Low'],
    sampleItems: [
      { title: 'Design zero-bloat core architecture', secondary: 'High', done: true },
      { title: 'Verify live preview & asset integrity', secondary: 'Medium', done: false },
      { title: 'Run regression benchmark evals', secondary: 'Low', done: false },
    ],
  };
}

export function parsePromptWithBrain(
  prompt: string,
  brain: AxiomNeuralCore,
  context?: { hasExistingWorkspaceFiles?: boolean },
): ParsedPromptIntent {
  const lower = prompt.toLowerCase();
  const language = detectLanguage(prompt);
  const neural = brain.classify(prompt);

  // Deterministic safety & structural overrides combined with neural classification
  let intent: AxiomIntent = neural.intent;

  if (/(rm\s+-rf|force[- ]push|--force|reset\s+--hard|terraform\s+apply|npm\s+publish)/.test(lower)) {
    intent = 'safety_command';
  } else if (
    context?.hasExistingWorkspaceFiles &&
    /(change|rename|update|edit|modify|switch|wenas|add\s+a\s+)/i.test(lower) &&
    !/^(make me|build a new|create a new)/i.test(lower)
  ) {
    intent = 'followup_edit';
  } else if (/(3d|three\.?js|gta|open[- ]world|minimap|npc\s+traffic)/.test(lower)) {
    intent = 'game_3d';
  } else if (/(2d\s*game|canvas\s*game|arcade|space[- ]defender|brick\s*breaker|runner)/.test(lower)) {
    intent = 'game_2d';
  } else if (/(capacitor|android\s*apk|\bapk\b|mobile\s*app)/.test(lower)) {
    intent = 'mobile_app';
  } else if (/(rest\s*api|api\s*service|backend.*api|endpoints?)/.test(lower)) {
    intent = 'api_service';
  } else if (/(analytics|chart|graph|kpi|visualization|dashboard)/.test(lower) && !/crud/.test(lower)) {
    intent = 'analytics_dashboard';
  } else if (/(crud|tracker|todo|booking|inventory|appointment|invoice)/.test(lower)) {
    intent = 'crud_app';
  }

  const { domain, brand, tagline } = detectDomain(lower);
  const basePalette = DOMAIN_PALETTES[domain] ?? DOMAIN_PALETTES.general;
  const wantsLightTheme = /light\s*(mode|theme)|bright|white\s*background/i.test(lower);
  const wantsDarkTheme = /dark\s*(mode|theme)/i.test(lower);

  const palette: DomainPalette = wantsLightTheme
    ? {
        ...basePalette,
        bg: '#f8fafc',
        surface: '#ffffff',
        text: '#0f172a',
        muted: '#475569',
        defaultTheme: 'light',
      }
    : basePalette;

  const renameMatch = prompt.match(/(?:rename(?:\s+brand)?\s+to|brand\s+to)\s+([A-Za-z0-9][A-Za-z0-9\s-]{1,28})/i);
  const addSectionMatch = prompt.match(/add\s+(?:a\s+)?([a-z0-9\s]{3,28})\s+section/i);

  return {
    rawPrompt: prompt,
    language,
    intent,
    confidence: neural.confidence,
    rankedIntents: neural.ranked.slice(0, 4),
    brand: renameMatch?.[1]?.trim() || brand,
    domain,
    tagline,
    palette,
    entity: detectEntity(lower),
    features: {
      wantsLightTheme,
      wantsDarkTheme,
      wantsCharts: /chart|graph|analytics|metrics|kpi/.test(lower),
      wantsCsvExport: /csv|export|download/.test(lower),
      wantsPricing: /pricing|plan|tier/.test(lower),
      wantsSearch: /search|filter/.test(lower),
      wants3D: intent === 'game_3d',
      wantsAndroid: intent === 'mobile_app',
    },
    editSignals: {
      isFollowupEdit: intent === 'followup_edit',
      newBrand: renameMatch?.[1]?.trim(),
      switchTheme: wantsLightTheme ? 'light' : wantsDarkTheme ? 'dark' : undefined,
      addSection: addSectionMatch?.[1]?.trim(),
    },
  };
}
