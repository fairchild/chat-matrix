// The backend axis, as a URL. Swapping cells is this line and nothing else —
// there is no API route in this app to keep in sync.
export const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8001"

export interface Health {
  backend: string
  model: string
  tools: string[]
  threads: number
}
