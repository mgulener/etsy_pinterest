export function isValidFacebookInterval(value: number) {
  return Number.isInteger(value) && value >= 5 && value <= 1440;
}
