const TURKISH_MONTHS = [
  'OCAK',
  'ŞUBAT',
  'MART',
  'NİSAN',
  'MAYIS',
  'HAZİRAN',
  'TEMMUZ',
  'AĞUSTOS',
  'EYLÜL',
  'EKİM',
  'KASIM',
  'ARALIK',
] as const;

// getDay(): 0 = Pazar ... 1 = Pazartesi
const TURKISH_WEEKDAYS = [
  'PAZAR',
  'PTESİ',
  'SALI',
  'ÇŞMBA',
  'PERŞ',
  'CUMA',
  'CTESİ',
] as const;

export function formatTurkishClock(date: Date): string {
  const day = date.getDate();
  const month = TURKISH_MONTHS[date.getMonth()];
  const weekday = TURKISH_WEEKDAYS[date.getDay()];
  const time = date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${day} ${month}, ${weekday} - ${time}`;
}
