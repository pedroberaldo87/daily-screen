// Weather module — Open-Meteo API (free, no API key)
// Caches for 30 minutes to avoid excessive requests

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 min

// WMO Weather Codes → emoji + description + optional hint
const WEATHER_MAP = {
  0:  { icon: '☀️', desc: 'Céu limpo' },
  1:  { icon: '🌤️', desc: 'Poucas nuvens' },
  2:  { icon: '⛅', desc: 'Parcialmente nublado' },
  3:  { icon: '☁️', desc: 'Nublado' },
  45: { icon: '🌫️', desc: 'Névoa' },
  48: { icon: '🌫️', desc: 'Névoa com geada' },
  51: { icon: '🌦️', desc: 'Garoa leve' },
  53: { icon: '🌦️', desc: 'Garoa' },
  55: { icon: '🌦️', desc: 'Garoa forte' },
  56: { icon: '🌧️', desc: 'Garoa gelada' },
  57: { icon: '🌧️', desc: 'Garoa gelada forte' },
  61: { icon: '🌧️', desc: 'Chuva leve' },
  63: { icon: '🌧️', desc: 'Chuva' },
  65: { icon: '🌧️', desc: 'Chuva forte' },
  66: { icon: '🧊', desc: 'Chuva gelada' },
  67: { icon: '🧊', desc: 'Chuva gelada forte' },
  71: { icon: '❄️', desc: 'Neve leve' },
  73: { icon: '❄️', desc: 'Neve' },
  75: { icon: '❄️', desc: 'Neve forte' },
  77: { icon: '🌨️', desc: 'Granizo fino' },
  80: { icon: '🌦️', desc: 'Pancadas leves' },
  81: { icon: '🌧️', desc: 'Pancadas de chuva' },
  82: { icon: '⛈️', desc: 'Pancadas fortes' },
  85: { icon: '🌨️', desc: 'Pancadas de neve' },
  86: { icon: '🌨️', desc: 'Pancadas de neve forte' },
  95: { icon: '⛈️', desc: 'Tempestade' },
  96: { icon: '⛈️', desc: 'Tempestade com granizo' },
  99: { icon: '⛈️', desc: 'Tempestade com granizo forte' },
};

// Context-aware hints based on weather + temperature
function getHint(code, temp) {
  if (code >= 61 && code <= 67) return 'Leva guarda-chuva ☂️';
  if (code >= 80 && code <= 99) return 'Leva guarda-chuva ☂️';
  if (code >= 51 && code <= 57) return 'Pode chover, leva guarda-chuva';
  if (temp <= 15) return 'Tá frio, leva casaco 🧥';
  if (temp >= 32) return 'Calor forte, bebe bastante água 💧';
  if (code === 0 && temp >= 25) return 'Sol forte, passa protetor ☀️';
  return null;
}

async function fetchWeather(lat, lon, timezone) {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL) {
    return cache;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=${encodeURIComponent(timezone)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

  const data = await res.json();
  const temp = data.current.temperature_2m;
  const code = data.current.weather_code;
  const weather = WEATHER_MAP[code] || { icon: '🌡️', desc: 'Indefinido' };

  cache = {
    temperature: temp,
    weatherCode: code,
    icon: weather.icon,
    description: weather.desc,
    hint: getHint(code, temp),
  };
  cacheTime = now;

  return cache;
}

module.exports = { fetchWeather };
