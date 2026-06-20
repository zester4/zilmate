import { tool } from 'ai';
import { z } from 'zod';
import { emitProgress } from '../runtime/progress.js';

// ─── Open-Meteo free API (no API key required) ───────────────────────────────
// Docs: https://open-meteo.com/
// Rate limit: 10,000 requests/day for non-commercial use

type OpenMeteoGeoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
};

type OpenMeteoWeather = {
  current?: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
  };
};

// WMO Weather interpretation codes (https://open-meteo.com/en/docs#weathervariables)
const weatherCodes: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function weatherDescription(code: number): string {
  return weatherCodes[code] ?? `Unknown (code ${code})`;
}

function emojiForWeather(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌈';
}

// ─── Geocode: city name → {lat, lon} via Open-Meteo Geocoding API ────────────

async function geocodeCity(city: string, count = 5): Promise<OpenMeteoGeoResult[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=${count}&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geocoding failed (${response.status}): ${response.statusText}`);
  const data = (await response.json()) as { results?: OpenMeteoGeoResult[] };
  return data.results ?? [];
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) return `${lat}, ${lon}`;
  const data = (await response.json()) as { results?: OpenMeteoGeoResult[] };
  const result = data.results?.[0];
  if (!result) return `${lat}, ${lon}`;
  return result.admin1 ? `${result.name}, ${result.admin1}, ${result.country}` : `${result.name}, ${result.country}`;
}

// ─── Fetch current weather from Open-Meteo ───────────────────────────────────

async function fetchWeather(lat: number, lon: number): Promise<OpenMeteoWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=7`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather API failed (${response.status}): ${response.statusText}`);
  return (await response.json()) as OpenMeteoWeather;
}

// ─── Get approximate location from IP ────────────────────────────────────────
// Uses ip-api.com free tier (no key, 45 req/min limit)
// Docs: https://ip-api.com/docs/api:json

async function ipLocation(): Promise<{ lat: number; lon: number; city: string; region: string; country: string; ip: string }> {
  const response = await fetch('http://ip-api.com/json/?fields=status,query,lat,lon,city,region,country');
  if (!response.ok) throw new Error(`IP geolocation failed (${response.status})`);
  const data = (await response.json()) as {
    status: string;
    query: string;
    lat: number;
    lon: number;
    city: string;
    region: string;
    country: string;
  };
  if (data.status !== 'success') throw new Error('IP geolocation returned non-success status');
  return { lat: data.lat, lon: data.lon, city: data.city, region: data.region, country: data.country, ip: data.query };
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const weatherTools = {
  getWeather: tool({
    description: 'Get current weather conditions for a city or coordinates. Uses free Open-Meteo API — no API key needed. Returns temperature, feels-like, humidity, wind, and conditions.',
    inputSchema: z.object({
      location: z.string().min(1).describe('City name (e.g. "London", "Accra", "New York") or "latitude,longitude" coordinates.'),
    }),
    execute: async ({ location }) => {
      emitProgress({ type: 'fetch:start', label: 'Getting weather', detail: location });

      // Parse direct coordinates if provided
      const coordMatch = /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/.exec(location.trim());
      let lat: number;
      let lon: number;
      let resolvedLocation: string;

      if (coordMatch) {
        lat = parseFloat(coordMatch[1]!);
        lon = parseFloat(coordMatch[2]!);
        resolvedLocation = await reverseGeocode(lat, lon);
      } else {
        const results = await geocodeCity(location);
        if (results.length === 0) throw new Error(`Could not find location: "${location}". Try a different city name or use "latitude,longitude" coordinates.`);
        lat = results[0]!.latitude;
        lon = results[0]!.longitude;
        resolvedLocation = results[0]!.admin1
          ? `${results[0]!.name}, ${results[0]!.admin1}, ${results[0]!.country}`
          : `${results[0]!.name}, ${results[0]!.country}`;
      }

      const weather = await fetchWeather(lat, lon);

      if (!weather.current) {
        throw new Error('No current weather data returned for this location.');
      }

      const { temperature_2m: temp, relative_humidity_2m: humidity, apparent_temperature: feelsLike, weather_code: code, wind_speed_10m: wind } = weather.current;
      const today = weather.daily ? {
        high: weather.daily.temperature_2m_max[0]!,
        low: weather.daily.temperature_2m_min[0]!,
        precipChance: weather.daily.precipitation_probability_max[0]!,
      } : null;

      const emoji = emojiForWeather(code);
      const desc = weatherDescription(code);

      emitProgress({ type: 'fetch:end', label: 'Weather fetched', detail: resolvedLocation });

      return {
        location: resolvedLocation,
        coordinates: { lat, lon },
        current: {
          temperature: { value: temp, unit: '°C' },
          feelsLike: { value: feelsLike, unit: '°C' },
          humidity: { value: humidity, unit: '%' },
          windSpeed: { value: wind, unit: 'km/h' },
          condition: desc,
          emoji,
        },
        today: today ? {
          high: { value: today.high, unit: '°C' },
          low: { value: today.low, unit: '°C' },
          precipitationChance: { value: today.precipChance, unit: '%' },
        } : null,
      };
    },
  }),

  getForecast: tool({
    description: 'Get a multi-day weather forecast for a city or coordinates. Returns daily highs, lows, conditions, precipitation chance, and wind. Uses free Open-Meteo API — no API key needed.',
    inputSchema: z.object({
      location: z.string().min(1).describe('City name or "latitude,longitude" coordinates.'),
      days: z.number().int().min(1).max(7).optional().default(5).describe('Number of forecast days (1–7, default 5).'),
    }),
    execute: async ({ location, days }) => {
      emitProgress({ type: 'fetch:start', label: 'Getting forecast', detail: `${location} (${days} days)` });

      const coordMatch = /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/.exec(location.trim());
      let lat: number;
      let lon: number;
      let resolvedLocation: string;

      if (coordMatch) {
        lat = parseFloat(coordMatch[1]!);
        lon = parseFloat(coordMatch[2]!);
        resolvedLocation = await reverseGeocode(lat, lon);
      } else {
        const results = await geocodeCity(location);
        if (results.length === 0) throw new Error(`Could not find location: "${location}".`);
        lat = results[0]!.latitude;
        lon = results[0]!.longitude;
        resolvedLocation = results[0]!.admin1
          ? `${results[0]!.name}, ${results[0]!.admin1}, ${results[0]!.country}`
          : `${results[0]!.name}, ${results[0]!.country}`;
      }

      const weather = await fetchWeather(lat, lon);

      if (!weather.daily) {
        throw new Error('No forecast data returned for this location.');
      }

      const forecastDays = weather.daily.time.slice(0, days).map((date, i) => ({
        date,
        condition: weatherDescription(weather.daily!.weather_code[i]!),
        emoji: emojiForWeather(weather.daily!.weather_code[i]!),
        high: { value: weather.daily!.temperature_2m_max[i]!, unit: '°C' },
        low: { value: weather.daily!.temperature_2m_min[i]!, unit: '°C' },
        precipitationChance: { value: weather.daily!.precipitation_probability_max[i]!, unit: '%' },
        windMax: { value: weather.daily!.wind_speed_10m_max[i]!, unit: 'km/h' },
      }));

      emitProgress({ type: 'fetch:end', label: 'Forecast fetched', detail: `${days} days for ${resolvedLocation}` });

      return {
        location: resolvedLocation,
        coordinates: { lat, lon },
        forecast: forecastDays,
      };
    },
  }),

  getCurrentLocation: tool({
    description: 'Get the approximate current location (city, region, country, and coordinates) from your IP address. Uses free ip-api.com — no API key needed. Pair with getWeather to check local weather.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'fetch:start', label: 'Detecting location from IP' });

      const location = await ipLocation();

      emitProgress({ type: 'fetch:end', label: 'Location detected', detail: `${location.city}, ${location.country}` });

      return {
        ip: location.ip,
        city: location.city,
        region: location.region,
        country: location.country,
        coordinates: { lat: location.lat, lon: location.lon },
        displayName: [location.city, location.region, location.country].filter(Boolean).join(', '),
      };
    },
  }),
};