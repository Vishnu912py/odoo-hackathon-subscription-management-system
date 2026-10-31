// Format exact decimal strings without converting financial values to binary floating point.
export function money(value: string) {
  const [whole, fraction] = value.split('.')
  return `₹${BigInt(whole).toLocaleString('en-IN')}.${fraction ?? '00'}`
}
