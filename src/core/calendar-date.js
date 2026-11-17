function parseInstant(date) {
  let epochMilliseconds;
  try {
    // Прямой вызов builtin не позволяет Date-subclass подменить getTime().
    epochMilliseconds = Date.prototype.getTime.call(date);
  } catch {
    throw new TypeError('date: Date required');
  }
  if (!Number.isFinite(epochMilliseconds)) throw new RangeError('date: invalid');
  return epochMilliseconds;
}

function dayFormatter(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.trim() !== timeZone) {
    throw new TypeError('timeZone: IANA identifier');
  }
  // ECMA-402 implementations may accept raw offset identifiers (например,
  // +01:00), но public contract требует именованную IANA zone. При этом
  // Intl.supportedValuesOf('timeZone') не является полным allowlist: он не
  // перечисляет валидные tzdb IDs семейства Etc/GMT±N, которые formatter
  // корректно принимает и канонизирует.
  if (/^[+-]\d{2}:\d{2}(?::\d{2})?$/.test(timeZone)) {
    throw new RangeError(`timeZone: unsupported "${timeZone}"`);
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      day: 'numeric',
    });
    const resolved = formatter.resolvedOptions();
    if (resolved.calendar !== 'gregory' || resolved.numberingSystem !== 'latn') {
      throw new Error('Intl: gregory/latn ignored');
    }
    if (typeof resolved.timeZone !== 'string' || resolved.timeZone.length === 0) {
      throw new Error('Intl: canonical time zone absent');
    }
    return { formatter, canonicalTimeZone: resolved.timeZone };
  } catch (error) {
    throw new RangeError(`timeZone: unsupported "${timeZone}"`, { cause: error });
  }
}

/** Разрешает day-of-month из явно переданных instant + time zone. */
export function resolveCalendarDay(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('calendar input must be an object');
  if (Object.keys(input).some(key => key !== 'date' && key !== 'timeZone')) throw new TypeError('calendar input has an unknown field');
  const parsedInput = input;
  const epochMilliseconds = parseInstant(parsedInput.date);
  const { formatter, canonicalTimeZone } = dayFormatter(parsedInput.timeZone);
  const dayParts = formatter
    .formatToParts(new Date(epochMilliseconds))
    .filter(({ type }) => type === 'day');
  if (dayParts.length !== 1 || !/^\d{1,2}$/.test(dayParts[0].value)) {
    throw new Error('calendar day: ambiguous Intl value');
  }
  const day = Number(dayParts[0].value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`calendar day: outside 1..31 (${String(day)})`);
  }
  return Object.freeze({ day, epochMilliseconds, timeZone: canonicalTimeZone });
}

