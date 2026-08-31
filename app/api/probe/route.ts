type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function value(value: unknown) {
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean"
    ? value
    : null;
}

async function getJson(url: string, timeoutMs = 5_000, headers: HeadersInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PlanetarySignals/1.0 (open-source planetary data interface)",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function optionalSource(
  sourceId: string,
  name: string,
  url: string,
  headers: HeadersInit = {},
) {
  const started = Date.now();
  try {
    const payload = await getJson(url, 5_000, headers);
    return {
      sourceId,
      name,
      state: "online" as const,
      latencyMs: Date.now() - started,
      payload,
      error: null,
    };
  } catch (error) {
    return {
      sourceId,
      name,
      state: "offline" as const,
      latencyMs: Date.now() - started,
      payload: null,
      error: error instanceof Error ? error.message : "Unavailable",
    };
  }
}

function unconfiguredSource(sourceId: string, name: string, requiredEnv: string) {
  return Promise.resolve({
    sourceId,
    name,
    state: "unconfigured" as const,
    latencyMs: 0,
    payload: null,
    error: `${requiredEnv} is not configured`,
  });
}

function numericValue(input: unknown) {
  const parsed = typeof input === "number" ? input : Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("lat"));
  const longitude = Number(searchParams.get("lon"));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Response.json({ error: "lat and lon must be valid numbers" }, { status: 400 });
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return Response.json({ error: "Coordinates are outside the valid Earth bounds" }, { status: 400 });
  }

  const coordinates = `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}`;
  const topographyKey =
    typeof process === "undefined"
      ? undefined
      : process.env.OPENTOPOGRAPHY_API_KEY?.trim() || undefined;
  const [forecast, air, marine, place, terrain] = await Promise.all([
    optionalSource(
      "open-meteo",
      "Open-Meteo Forecast",
      `https://api.open-meteo.com/v1/forecast?${coordinates}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`,
    ),
    optionalSource(
      "open-meteo",
      "Open-Meteo Air Quality",
      `https://air-quality-api.open-meteo.com/v1/air-quality?${coordinates}&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi&timezone=auto`,
    ),
    optionalSource(
      "open-meteo",
      "Open-Meteo Marine",
      `https://marine-api.open-meteo.com/v1/marine?${coordinates}&current=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,sea_surface_temperature&timezone=auto`,
    ),
    optionalSource(
      "openstreetmap",
      "OpenStreetMap Nominatim",
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude.toFixed(5)}&lon=${longitude.toFixed(5)}&format=jsonv2&zoom=7&addressdetails=1`,
    ),
    topographyKey
      ? optionalSource(
          "open-topography",
          "OpenTopography Terrain",
          `https://portal.opentopography.org/API/v1/elevation?longitude=${longitude.toFixed(5)}&latitude=${latitude.toFixed(5)}&dataset=COP30&API_Key=${encodeURIComponent(topographyKey)}`,
        )
      : unconfiguredSource(
          "open-topography",
          "OpenTopography Terrain",
          "OPENTOPOGRAPHY_API_KEY",
        ),
  ]);

  const forecastPayload = record(forecast.payload);
  const forecastCurrent = record(forecastPayload.current);
  const forecastUnits = record(forecastPayload.current_units);
  const forecastDaily = record(forecastPayload.daily);
  const airPayload = record(air.payload);
  const airCurrent = record(airPayload.current);
  const airUnits = record(airPayload.current_units);
  const marinePayload = record(marine.payload);
  const marineCurrent = record(marinePayload.current);
  const marineUnits = record(marinePayload.current_units);
  const placePayload = record(place.payload);
  const terrainPayload = record(terrain.payload);
  const terrainData = record(terrainPayload.data);
  const address = record(placePayload.address);

  const response = {
    generatedAt: new Date().toISOString(),
    coordinates: { latitude, longitude },
    location: {
      label:
        value(placePayload.display_name) ??
        `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? "E" : "W"}`,
      region: value(address.state) ?? value(address.region) ?? value(address.county),
      country: value(address.country),
      timezone: value(forecastPayload.timezone),
    },
    weather: forecast.payload
      ? {
          observedAt: value(forecastCurrent.time),
          temperature: value(forecastCurrent.temperature_2m),
          apparentTemperature: value(forecastCurrent.apparent_temperature),
          humidity: value(forecastCurrent.relative_humidity_2m),
          precipitation: value(forecastCurrent.precipitation),
          windSpeed: value(forecastCurrent.wind_speed_10m),
          windDirection: value(forecastCurrent.wind_direction_10m),
          weatherCode: value(forecastCurrent.weather_code),
          sunrise: Array.isArray(forecastDaily.sunrise) ? value(forecastDaily.sunrise[0]) : null,
          sunset: Array.isArray(forecastDaily.sunset) ? value(forecastDaily.sunset[0]) : null,
          units: {
            temperature: value(forecastUnits.temperature_2m),
            humidity: value(forecastUnits.relative_humidity_2m),
            precipitation: value(forecastUnits.precipitation),
            windSpeed: value(forecastUnits.wind_speed_10m),
          },
        }
      : null,
    air: air.payload
      ? {
          observedAt: value(airCurrent.time),
          usAqi: value(airCurrent.us_aqi),
          europeanAqi: value(airCurrent.european_aqi),
          pm25: value(airCurrent.pm2_5),
          pm10: value(airCurrent.pm10),
          ozone: value(airCurrent.ozone),
          nitrogenDioxide: value(airCurrent.nitrogen_dioxide),
          units: {
            pm25: value(airUnits.pm2_5),
            pm10: value(airUnits.pm10),
            ozone: value(airUnits.ozone),
          },
        }
      : null,
    marine: marine.payload
      ? {
          observedAt: value(marineCurrent.time),
          waveHeight: value(marineCurrent.wave_height),
          waveDirection: value(marineCurrent.wave_direction),
          wavePeriod: value(marineCurrent.wave_period),
          windWaveHeight: value(marineCurrent.wind_wave_height),
          swellWaveHeight: value(marineCurrent.swell_wave_height),
          seaSurfaceTemperature: value(marineCurrent.sea_surface_temperature),
          units: {
            waveHeight: value(marineUnits.wave_height),
            wavePeriod: value(marineUnits.wave_period),
            temperature: value(marineUnits.sea_surface_temperature),
          },
        }
      : null,
    terrain: terrain.payload
      ? {
          elevation:
            numericValue(terrainPayload.elevation) ??
            numericValue(terrainData.elevation) ??
            numericValue(terrainPayload.value),
          unit: value(terrainPayload.unit) ?? value(terrainData.unit) ?? "m",
          dataset: value(terrainPayload.dataset) ?? value(terrainData.dataset) ?? "COP30",
          verticalDatum:
            value(terrainPayload.verticalDatum) ??
            value(terrainPayload.vertical_datum) ??
            value(terrainData.verticalDatum),
        }
      : null,
    sources: [forecast, air, marine, place, terrain].map(({ sourceId, name, state, latencyMs, error }) => ({
      sourceId,
      name,
      state,
      latencyMs,
      error: error ?? null,
    })),
  };

  return Response.json(response, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
