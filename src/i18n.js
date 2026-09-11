const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'roster-planner-language';

let language = DEFAULT_LANGUAGE;
let messages = {};
let fallbackMessages = {};

const preferredLanguage = () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return saved;
  return [...(navigator.languages || []), navigator.language]
    .filter(Boolean)
    .map(value => value.toLowerCase().split('-')[0])
    .find(value => ['en', 'uk', 'ru'].includes(value)) || DEFAULT_LANGUAGE;
};

async function loadPack(code) {
  const response = await fetch(`${import.meta.env.BASE_URL}locales/${code}.json`);
  if (!response.ok) throw new Error(`Language pack "${code}" could not be loaded.`);
  return response.json();
}

function valueAt(object, key) {
  return key.split('.').reduce((value, part) => value && value[part], object);
}

export async function initializeI18n() {
  fallbackMessages = await loadPack(DEFAULT_LANGUAGE);
  await setLanguage(preferredLanguage(), false);
}

export async function setLanguage(code, persist = true) {
  const normalized = code.toLowerCase().split('-')[0];
  try {
    messages = normalized === DEFAULT_LANGUAGE ? fallbackMessages : await loadPack(normalized);
    language = normalized;
  } catch {
    messages = fallbackMessages;
    language = DEFAULT_LANGUAGE;
  }
  if (persist) localStorage.setItem(STORAGE_KEY, language);
  document.documentElement.lang = language;
}

export function currentLanguage() { return language; }

export function t(key, variables = {}) {
  const template = valueAt(messages, key) ?? valueAt(fallbackMessages, key) ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => variables[name] ?? `{${name}}`);
}
