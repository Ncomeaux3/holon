// The only humanising the screen does to a job's name: real job identifiers
// are snake_case or dash-case (`nightly_digest`, `sync_simplefin`), and the
// artboard's hand-written names ("Bank + card sync") do not exist in code.
// Turning underscores and dashes into spaces and capitalising is a faithful
// stand-in that never invents a name a job does not have.
export function jobLabel(name: string): string {
  const words = name.replace(/[_-]/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
